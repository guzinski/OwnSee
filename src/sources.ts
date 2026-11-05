import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SOURCES_FILE, ensureDataDir } from "./config.ts";

/** A single viewable stream (one camera channel at one quality). */
export interface Stream {
  /** go2rtc stream name, e.g. "ch0_main". Must be unique. */
  id: string;
  quality: "main" | "sub";
  /** go2rtc source URL template with ${NVR_USER}/${NVR_PASS} placeholders. */
  src: string;
}

/** A camera: a logical device with one or more quality streams. */
export interface Camera {
  id: string;
  name: string;
  channel: number;
  streams: Stream[];
}

export interface Source {
  id: string;
  type: "nvr" | "onvif" | "rtsp";
  name: string;
  host: string;
  cameras: Camera[];
}

/** First-run seed: one Xiongmai-style NVR with 5 channels (0-4). */
function seedSources(): Source[] {
  const host = process.env.NVR_HOST ?? "192.168.1.100";
  const port = process.env.NVR_DVRIP_PORT ?? "34567";
  const cameras: Camera[] = [];
  for (let ch = 0; ch < 5; ch++) {
    const base = `dvrip://\${NVR_USER}:\${NVR_PASS}@${host}:${port}?channel=${ch}`;
    cameras.push({
      id: `cam${ch}`,
      name: `Camera ${ch + 1}`,
      channel: ch,
      streams: [
        { id: `ch${ch}_main`, quality: "main", src: `${base}&subtype=0` },
        { id: `ch${ch}_sub`, quality: "sub", src: `${base}&subtype=1` },
      ],
    });
  }
  return [{ id: "nvr0", type: "nvr", name: "NVR", host, cameras }];
}

export function loadSources(): Source[] {
  ensureDataDir();
  if (existsSync(SOURCES_FILE)) {
    try {
      return JSON.parse(readFileSync(SOURCES_FILE, "utf8")) as Source[];
    } catch {
      /* fall through to seed on corrupt file */
    }
  }
  const seeded = seedSources();
  saveSources(seeded);
  return seeded;
}

export function saveSources(sources: Source[]): void {
  ensureDataDir();
  writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

/** Flatten every stream across all sources into go2rtc's streams map. */
export function toGo2rtcStreams(sources: Source[]): Record<string, string> {
  const streams: Record<string, string> = {};
  for (const s of sources)
    for (const cam of s.cameras)
      for (const st of cam.streams) streams[st.id] = expandEnv(st.src);
  return streams;
}

/** Replace ${VAR} with the env value, URL-encoding so passwords stay valid. */
function expandEnv(tpl: string): string {
  return tpl.replace(/\$\{(\w+)\}/g, (_m, key: string) => {
    const v = process.env[key] ?? "";
    return encodeURIComponent(v).replace(
      /[!'()*~]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  });
}
