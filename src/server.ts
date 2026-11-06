import http from "node:http";
import https from "node:https";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_HOST, HUB_PORT, GO2RTC_API, loadEnv } from "./config.ts";
import { startGo2rtc, stopGo2rtc } from "./go2rtc.ts";
import { loadSources } from "./sources.ts";
import { handleRecordings, handlePlayback } from "./playback.ts";
import { handlePairing } from "./pairing.ts";
import { handleAppDist } from "./appdist.ts";
import { ensurePki } from "./pki.ts";
import { createTlsServer, isPairedRequest } from "./tls-server.ts";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const [GO2RTC_HOST, GO2RTC_PORT] = GO2RTC_API.split(":");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};

/** Public camera list for the UI — no credentials, just ids/names/qualities. */
function sourcesView() {
  return loadSources().map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    cameras: s.cameras.map((c) => ({
      id: c.id,
      name: c.name,
      channel: c.channel,
      streams: c.streams.map((st) => ({ id: st.id, quality: st.quality })),
    })),
  }));
}

function proxyToGo2rtc(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = req.url!.replace(/^\/go2rtc/, "") || "/";
  const upstream = http.request(
    { host: GO2RTC_HOST, port: Number(GO2RTC_PORT), path, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
      // A stream cut off on go2rtc's side surfaces here; unhandled, it would
      // crash the hub.
      up.on("error", () => res.destroy());
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("go2rtc unavailable");
  });
  // Live streams never end on their own. When the client goes away, cancel the
  // upstream request too, or go2rtc keeps pulling the camera for nobody.
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}

/** Requests from both listeners. `secure` = arrived on the HTTPS listener
 *  from a paired device; LAN-only admin endpoints (pairing) are hidden there. */
async function handle(req: http.IncomingMessage, res: http.ServerResponse, secure: boolean) {
  // Re-check on every request: keep-alive connections outlive the handshake,
  // so a device revoked mid-connection must not get further requests through.
  if (secure && !isPairedRequest(req)) {
    req.socket.destroy();
    return;
  }
  try {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/api/sources") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(sourcesView()));
      return;
    }
    if (path === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, secure }));
      return;
    }
    if (path === "/api/recordings") {
      await handleRecordings(new URL(req.url!, "http://localhost"), res);
      return;
    }
    if (path === "/api/playback") {
      await handlePlayback(new URL(req.url!, "http://localhost"), res);
      return;
    }
    if (!secure && (path.startsWith("/api/pair/") || path.startsWith("/api/devices")))
      if (await handlePairing(req, res, path)) return;
    if ((path === "/api/app" || path.startsWith("/app/")) && handleAppDist(req, res, path, secure)) return;
    if (path.startsWith("/go2rtc/")) return proxyToGo2rtc(req, res);
    await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal error");
  }
}

/** Proxy the WebSocket upgrade go2rtc uses for MSE/WebRTC playback. */
function handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
  if (!req.url?.startsWith("/go2rtc/")) {
    socket.destroy();
    return;
  }
  const path = req.url.replace(/^\/go2rtc/, "") || "/";
  const up = net.connect(Number(GO2RTC_PORT), GO2RTC_HOST, () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\r\n");
    up.write(`GET ${path} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
  up.on("close", () => socket.destroy());
  socket.on("close", () => up.destroy());
}

/**
 * The plain-HTTP listener has no authentication, so it must only serve the
 * home network. Clients arriving through the WireGuard tunnel (the VPS, old
 * phone peers) are refused; from outside, the only way in is the HTTPS
 * listener with a paired client certificate.
 */
function fromTunnel(sock: net.Socket): boolean {
  // Read per call: .env.local is loaded after this module is imported.
  const prefix = process.env.HUB_TUNNEL_PREFIX ?? "10.66.0.";
  const ip = (sock.remoteAddress ?? "").replace(/^::ffff:/, "");
  return prefix !== "" && ip.startsWith(prefix);
}

const server = http.createServer((req, res) => {
  if (fromTunnel(req.socket)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Use the HTTPS address with a paired device.");
    return;
  }
  handle(req, res, false);
});
server.on("upgrade", (req, socket, head) => {
  if (fromTunnel(socket as net.Socket)) return socket.destroy();
  handleUpgrade(req, socket as net.Socket, head);
});

/** HTTPS listener for remote access; see tls-server.ts. */
function startTlsServer(): https.Server | null {
  if (process.env.HUB_TLS === "0") return null;
  const port = Number(process.env.HUB_TLS_PORT ?? 8443);
  try {
    ensurePki();
  } catch (err) {
    console.error("[hub] HTTPS disabled: could not set up certificates (is openssl installed?)", (err as Error).message);
    return null;
  }
  const tlsServer = createTlsServer((req, res) => handle(req, res, true), handleUpgrade);
  tlsServer.listen(port, HUB_HOST, () => {
    console.log(`[hub] HTTPS (paired devices only) on https://${HUB_HOST}:${port}`);
  });
  return tlsServer;
}

loadEnv();
if (!process.env.NVR_USER || !process.env.NVR_PASS)
  console.warn("[hub] NVR_USER/NVR_PASS not set in .env.local — streams will fail to authenticate");

void startGo2rtc();
server.listen(HUB_PORT, HUB_HOST, () => {
  console.log(`[hub] listening on http://${HUB_HOST}:${HUB_PORT}`);
});
const tlsServer = startTlsServer();

// Shut down promptly: open browser connections (live WebSockets, playback
// streams) would otherwise keep server.close() waiting forever, so the hub
// never exited and go2rtc was left behind.
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    console.log(`[hub] ${sig} — shutting down`);
    stopGo2rtc();
    server.close(() => process.exit(0));
    server.closeAllConnections();
    tlsServer?.close();
    tlsServer?.closeAllConnections();
    setTimeout(() => process.exit(0), 1500).unref();
  });
