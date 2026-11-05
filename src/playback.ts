import { spawn } from "node:child_process";
import type http from "node:http";
import { DvripClient, codecString, detectCodec, type Recording } from "./dvrip.ts";
import { loadSources } from "./sources.ts";

function creds(): { user: string; pass: string } {
  return { user: process.env.NVR_USER ?? "", pass: process.env.NVR_PASS ?? "" };
}

interface Target { host: string; port: number; channel: number }

/** Resolve a camera id (e.g. "cam0") to its NVR address and channel, from
 *  data/sources.json, the same place live view gets it. The DVRIP port is
 *  taken from the camera's stream URL. */
function targetOf(cameraId: string): Target | null {
  for (const s of loadSources())
    for (const c of s.cameras) {
      if (c.id !== cameraId) continue;
      const m = c.streams[0]?.src.match(/@[^:/?]+:(\d+)/);
      return { host: s.host, port: m ? Number(m[1]) : 34567, channel: c.channel };
    }
  return null;
}

function parseLocal(s: string): Date | null {
  // "YYYY-MM-DD hh:mm:ss" or ISO — interpret as local wall-clock.
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** GET /api/recordings?camera=cam0&date=YYYY-MM-DD → segment list. */
export async function handleRecordings(
  url: URL,
  res: http.ServerResponse,
): Promise<void> {
  const camera = url.searchParams.get("camera") ?? "";
  const date = url.searchParams.get("date") ?? "";
  const target = targetOf(camera);
  const day = parseLocal(`${date} 00:00:00`);
  if (!target || !day) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad camera or date" }));
    return;
  }
  const end = new Date(day.getTime() + 24 * 3600 * 1000);
  const { user, pass } = creds();
  const client = new DvripClient(target.host, target.port, user, pass);
  try {
    await client.connect();
    // The NVR ignores the Type filter and returns every recording for the
    // channel (H.265 cameras included) with proper ".h264"-style filenames;
    // the real codec is detected from the stream at playback time. Querying a
    // second type only returns the same files with mangled (extension-less)
    // names, so one query is correct.
    const all = await client.fileQueryAll(target.channel, day, end, "h264");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(all));
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String((err as Error).message) }));
  } finally {
    client.close();
  }
}

/** GET /api/playback?camera=cam0&file=<name>&begin=<t>&end=<t>
 *  Streams the recording as fragmented MP4 (video only, for now). */
export async function handlePlayback(
  url: URL,
  res: http.ServerResponse,
): Promise<void> {
  const camera = url.searchParams.get("camera") ?? "";
  const fileName = url.searchParams.get("file") ?? "";
  const begin = url.searchParams.get("begin") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const target = targetOf(camera);
  if (!target || !fileName || !begin || !end) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad request");
    return;
  }

  const { user, pass } = creds();
  const client = new DvripClient(target.host, target.port, user, pass);
  const rec: Recording = { fileName, begin, end, disk: 0 };

  let ffmpeg: ReturnType<typeof spawn> | null = null;
  const cleanup = () => {
    client.close();
    ffmpeg?.kill("SIGKILL");
  };
  res.on("close", cleanup);

  try {
    await client.connect();
    const video = client.openPlayback(rec);

    // Sniff the codec from the first chunk, then spawn ffmpeg to remux to fMP4.
    let started = false;
    video.on("data", (chunk: Buffer) => {
      if (started) return;
      started = true;
      const fmt = detectCodec(chunk) === "hevc" ? "hevc" : "h264";
      const b = parseLocal(begin), e = parseLocal(end);
      const duration = b && e ? Math.max(1, (e.getTime() - b.getTime()) / 1000) : 300;
      ffmpeg = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-fflags", "+genpts", "-r", "20",
        "-f", fmt, "-i", "pipe:0",
        "-c", "copy",
        "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        // Flush fragments incrementally so the browser can play/seek while the
        // segment is still downloading (otherwise ffmpeg buffers until EOF).
        "-frag_duration", "500000", "-flush_packets", "1",
        "pipe:1",
      ]);
      res.writeHead(200, {
        "content-type": "video/mp4",
        "cache-control": "no-store",
        // The browser feeds this into MediaSource, which needs the exact codec
        // and the segment length up front (the stream itself has no duration).
        "x-codec": codecString(chunk, fmt),
        "x-duration": String(duration),
      });
      ffmpeg.stdout!.pipe(res);
      ffmpeg.stderr!.on("data", (d) => console.error("[ffmpeg]", d.toString().trim()));
      ffmpeg.on("error", (e) => res.destroyed || res.destroy(e));
      // Re-pump: write this first chunk, then pipe the rest.
      ffmpeg.stdin!.write(chunk);
      video.pipe(ffmpeg.stdin!);
    });
    video.on("error", (e) => {
      console.error("[playback]", e.message);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    video.on("end", () => ffmpeg?.stdin?.end());
  } catch (err) {
    cleanup();
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(String((err as Error).message));
  }
}
