// HTTP endpoints for pairing phones and managing paired devices.
//
// These are served on the plain-HTTP (LAN) listener only: pairing happens at
// home, by scanning a QR code shown in the web UI.

import { execFileSync } from "node:child_process";
import type http from "node:http";
import {
  PairError, caFingerprint, claimPairing, loadDevices, newPairToken, revokeDevice,
} from "./pki.ts";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new PairError(413, "request too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new PairError(400, "invalid JSON");
  }
}

function isLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h.startsWith("127.") || h === "[::1]";
  } catch {
    return true;
  }
}

/** The hub's home-network address for phones: the page's origin, unless that
 *  is localhost (useless on a phone), else HUB_LAN_URL. Read at request time,
 *  so values from .env.local apply. */
export function homeAddress(fromBrowser: unknown): string | null {
  const env = process.env.HUB_LAN_URL?.trim();
  const browser = typeof fromBrowser === "string" ? fromBrowser.trim() : "";
  const lan = (browser && !isLoopback(browser) ? browser : env) || null;
  return lan?.replace(/\/+$/, "") ?? null;
}

/** The addresses a phone should use, as put into the pairing QR. */
function addresses(lanFromBrowser: unknown): { lan: string | null; remote: string | null } {
  const remote = process.env.HUB_PUBLIC_URL?.trim() || null;
  return { lan: homeAddress(lanFromBrowser), remote: remote?.replace(/\/+$/, "") ?? null };
}

/** The HTTPS address of the hub on the home network, for paired phones: the
 *  host the phone just reached (its LAN address) on the TLS port. At home the
 *  phone uses its certificate too; the plain-HTTP listener needs a password. */
function secureHome(req: http.IncomingMessage): string | null {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!host || process.env.HUB_TLS === "0") return null;
  return `https://${host}:${process.env.HUB_TLS_PORT ?? 8443}`;
}

/** QR code as SVG via the qrencode CLI, or null if it isn't installed. */
export function qrSvg(text: string): string | null {
  try {
    return execFileSync("qrencode", ["-t", "SVG", "-m", "2", "-s", "6", "-o", "-", text], { encoding: "utf8" });
  } catch {
    return null;
  }
}

/** Returns true if it handled the request. */
export async function handlePairing(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<boolean> {
  try {
    // POST /api/pair/start {lan} -> one-time pairing QR
    if (path === "/api/pair/start" && req.method === "POST") {
      const body = await readJson(req);
      const { lan, remote } = addresses(body.lan);
      if (!lan)
        throw new PairError(400,
          "Open this page using the hub's LAN address (not localhost), or set HUB_LAN_URL in .env.local.");
      const { token, expires } = newPairToken();
      const q = new URLSearchParams({ v: "1", t: token, lan, ca: caFingerprint() });
      if (remote) q.set("remote", remote);
      const uri = `ownsee://pair?${q}`;
      // qrSvg is null if qrencode is missing; the UI then shows the link.
      json(res, 200, { uri, qrSvg: qrSvg(uri), expires, lan, remote });
      return true;
    }

    // POST /api/pair/claim {token, name, csr} -> signed client certificate
    if (path === "/api/pair/claim" && req.method === "POST") {
      const body = await readJson(req);
      const { cert, ca, device } = claimPairing(String(body.token ?? ""), String(body.name ?? ""), String(body.csr ?? ""));
      const { remote } = addresses(null);
      json(res, 200, { cert, ca, deviceId: device.id, remote, lanSecure: secureHome(req) });
      return true;
    }

    // GET /api/devices -> paired devices (no secrets: fingerprints only)
    if (path === "/api/devices" && req.method === "GET") {
      json(res, 200, loadDevices());
      return true;
    }

    // POST /api/devices/<id>/revoke
    const m = path.match(/^\/api\/devices\/([0-9a-f]{12})\/revoke$/);
    if (m && req.method === "POST") {
      json(res, revokeDevice(m[1]) ? 200 : 404, { ok: true });
      return true;
    }
  } catch (err) {
    if (err instanceof PairError) {
      json(res, err.status, { error: err.message });
      return true;
    }
    throw err;
  }
  return false;
}
