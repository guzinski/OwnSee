import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = resolve(ROOT, "data");
export const SOURCES_FILE = resolve(DATA_DIR, "sources.json");

export const HUB_PORT = Number(process.env.HUB_PORT ?? 3000);
export const HUB_HOST = process.env.HUB_HOST ?? "0.0.0.0";
export const GO2RTC_API = "127.0.0.1:1984";
export const GO2RTC_BIN = resolve(ROOT, "bin/go2rtc");

/** Load KEY=VALUE pairs from .env.local into process.env (no external dep). */
export function loadEnv(): void {
  const file = resolve(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    if (!(key in process.env)) process.env[key] = line.slice(i + 1);
  }
}

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}
