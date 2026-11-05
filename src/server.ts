import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_HOST, HUB_PORT, GO2RTC_API, loadEnv } from "./config.ts";
import { startGo2rtc, stopGo2rtc } from "./go2rtc.ts";
import { loadSources } from "./sources.ts";

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
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("go2rtc unavailable");
  });
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

const server = http.createServer(async (req, res) => {
  try {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/api/sources") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(sourcesView()));
      return;
    }
    if (path === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path.startsWith("/go2rtc/")) return proxyToGo2rtc(req, res);
    await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal error");
  }
});

/** Proxy the WebSocket upgrade go2rtc uses for MSE/WebRTC playback. */
server.on("upgrade", (req, socket, head) => {
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
});

loadEnv();
if (!process.env.NVR_USER || !process.env.NVR_PASS)
  console.warn("[hub] NVR_USER/NVR_PASS not set in .env.local — streams will fail to authenticate");

startGo2rtc();
server.listen(HUB_PORT, HUB_HOST, () => {
  console.log(`[hub] listening on http://${HUB_HOST}:${HUB_PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopGo2rtc();
    server.close(() => process.exit(0));
  });
