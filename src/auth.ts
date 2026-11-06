// Admin password for the plain-HTTP (home network) listener.
//
// That listener used to be open to anyone on the Wi-Fi, including pairing a
// phone for permanent remote access. Now the web UI, its API and the video
// proxy need a login session. Paired phones don't use this: they authenticate
// with their client certificate on the HTTPS listener, at home too.
//
// The password is set on the hub with scripts/set-password.sh and stored only
// as a scrypt hash. Sessions are random tokens in an HttpOnly cookie; the hub
// keeps only their SHA-256, in data/auth.json, so they survive restarts.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type http from "node:http";
import { DATA_DIR } from "./config.ts";

const AUTH_FILE = join(DATA_DIR, "auth.json");
const COOKIE = "ownsee_session";
const SESSION_DAYS = 90;
const MIN_LENGTH = 8;

interface Session {
  hash: string; // sha256 of the token
  created: string;
  expires: string;
}
interface AuthData {
  password?: { salt: string; hash: string };
  sessions: Session[];
}

function load(): AuthData {
  if (!existsSync(AUTH_FILE)) return { sessions: [] };
  try {
    const d = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
    return { password: d.password, sessions: Array.isArray(d.sessions) ? d.sessions : [] };
  } catch {
    // Corrupt file: fail closed (no password means nobody can log in remotely
    // from the LAN until it is set again).
    return { sessions: [] };
  }
}

function save(d: AuthData): void {
  const tmp = `${AUTH_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  renameSync(tmp, AUTH_FILE);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const scrypt = (pw: string, salt: string) => scryptSync(pw, salt, 64).toString("hex");

export function passwordSet(): boolean {
  return !!load().password;
}

/** Sets the admin password and logs out every browser. */
export function setPassword(pw: string): void {
  if (pw.length < MIN_LENGTH) throw new Error(`The password needs at least ${MIN_LENGTH} characters.`);
  const salt = randomBytes(16).toString("hex");
  save({ password: { salt, hash: scrypt(pw, salt) }, sessions: [] });
}

function checkPassword(pw: string): boolean {
  const p = load().password;
  if (!p) return false;
  const a = Buffer.from(scrypt(pw, p.salt), "hex");
  const b = Buffer.from(p.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenOf(req: http.IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=") || null;
  }
  return null;
}

function isLoopback(req: http.IncomingMessage): boolean {
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

/**
 * Whether this LAN request may use the hub. Before a password is set, only
 * the hub machine itself (localhost) gets in, so a fresh install isn't open
 * to the whole Wi-Fi.
 */
export function isLoggedIn(req: http.IncomingMessage): boolean {
  const d = load();
  if (!d.password) return isLoopback(req);
  const t = tokenOf(req);
  if (!t) return false;
  const h = sha256(t);
  const now = new Date().toISOString();
  return d.sessions.some((s) => s.hash === h && s.expires > now);
}

// Slow down password guessing: after 5 wrong tries from one address, wait a
// minute, doubling with each further miss (max 1 hour).
const fails = new Map<string, { count: number; until: number }>();

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) return {};
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function cookie(value: string, maxAge: number): string {
  // No Secure flag: this listener is plain HTTP on the home network.
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/** /api/auth, /api/login, /api/logout. Returns true if it handled the request. */
export async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<boolean> {
  if (path === "/api/auth" && req.method === "GET") {
    json(res, 200, { passwordSet: passwordSet(), loggedIn: isLoggedIn(req) });
    return true;
  }

  if (path === "/api/login" && req.method === "POST") {
    const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      json(res, 429, { error: "too-many", retryIn: Math.ceil((f.until - Date.now()) / 1000) });
      return true;
    }
    if (!passwordSet()) {
      json(res, 409, { error: "no-password" });
      return true;
    }
    const body = await readBody(req);
    if (!checkPassword(String(body.password ?? ""))) {
      const count = (f?.count ?? 0) + 1;
      const wait = count >= 5 ? Math.min(3600, 60 * 2 ** (count - 5)) * 1000 : 0;
      fails.set(ip, { count, until: Date.now() + wait });
      json(res, 401, { error: "wrong-password" });
      return true;
    }
    fails.delete(ip);
    const token = randomBytes(32).toString("base64url");
    const d = load();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
    d.sessions = d.sessions.filter((s) => s.expires > now.toISOString()).concat({
      hash: sha256(token),
      created: now.toISOString(),
      expires: expires.toISOString(),
    });
    save(d);
    json(res, 200, { ok: true }, { "set-cookie": cookie(token, SESSION_DAYS * 86400) });
    return true;
  }

  if (path === "/api/logout" && req.method === "POST") {
    const t = tokenOf(req);
    if (t) {
      const d = load();
      const h = sha256(t);
      d.sessions = d.sessions.filter((s) => s.hash !== h);
      save(d);
    }
    json(res, 200, { ok: true }, { "set-cookie": cookie("", 0) });
    return true;
  }
  return false;
}

/** Paths on the LAN listener that work without logging in. */
export function isOpenPath(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/auth" ||
    path === "/api/login" ||
    path === "/api/logout" ||
    // The phone claims its certificate with the one-time token from the QR
    // code, which only a logged-in browser can create.
    path === "/api/pair/claim" ||
    // The APK is harmless without pairing; the download QR is scanned by a
    // phone browser that isn't logged in.
    path.startsWith("/app/")
  );
}
