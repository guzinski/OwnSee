// Real timing for NVR recordings, and a minimal MPEG-TS writer to hand the
// timed frames to ffmpeg.
//
// Recordings arrive as bare frames with no timestamps. Assuming a fixed frame
// rate breaks whenever a camera drops frames (weak Wi-Fi): the frames that did
// arrive play back to back and the clip runs fast (one 201 s file had 639
// frames, about 3 fps, and played in 21 s). Each keyframe carries the
// camera's clock time to the second, so frames are placed by that clock.

import type { Frame } from "./dvrip.ts";

export interface TimedFrame {
  data: Buffer;
  key: boolean;
  /** Seconds from the start of the recording. */
  t: number;
}

/**
 * Places frames on the camera's clock. Frames are held per GOP (keyframe to
 * keyframe) and played at the nominal rate; each keyframe starts at the
 * nominal-rate prediction pulled into its clock second [stamp, stamp + 1).
 * Smooth video keeps the nominal rate. When frames were lost (a Wi-Fi camera
 * once delivered 2 s groups 14 s apart), the picture holds and the video
 * continues at the right time instead of running fast.
 */
export class Retimer {
  private fps: number;
  private gop: Frame[] = [];
  private gopT = 0;
  private base: number | undefined; // clock time of the first keyframe

  constructor(fps: number) {
    this.fps = fps;
  }

  push(f: Frame): TimedFrame[] {
    if (this.base === undefined) {
      // Nothing can be decoded before the first keyframe; drop it.
      if (!f.key || f.stamp === undefined) return [];
      this.base = f.stamp;
      this.gop = [f];
      return [];
    }
    if (!f.key || f.stamp === undefined) {
      this.gop.push(f);
      // A keyframe is normally 1-4 s away; don't hold frames forever if not.
      return this.gop.length > 600 ? this.emit(this.gopT + this.gop.length / this.fps) : [];
    }
    const wall = f.stamp - this.base;
    const predicted = this.gopT + this.gop.length / this.fps;
    // Never faster than 2x the nominal rate, even when the clock disagrees
    // (short GOPs within one clock second).
    const fastest = this.gopT + this.gop.length / (2 * this.fps);
    const t = Math.max(Math.min(Math.max(predicted, wall), wall + 1), fastest);
    const out = this.emit(t);
    this.gop = [f];
    return out;
  }

  /** The frames still held at the end of the file, at the nominal rate. */
  flush(): TimedFrame[] {
    return this.emit(this.gopT + this.gop.length / this.fps);
  }

  /** Emit the held GOP at the nominal rate from its start; `end` starts the
   *  next GOP. If there's a gap (frames lost on the way to the NVR) the last
   *  picture holds until then; if there's too little time, frames squeeze. */
  private emit(end: number): TimedFrame[] {
    const n = this.gop.length;
    const step = n ? Math.min(1 / this.fps, (end - this.gopT) / n) : 0;
    const out = this.gop.map((g, i) => ({ data: g.data, key: g.key, t: this.gopT + i * step }));
    this.gop = [];
    this.gopT = end;
    return out;
  }
}

// --- MPEG-TS: one video stream, a PTS per frame. Just enough for ffmpeg. ---

const PID_PMT = 0x1000;
const PID_VIDEO = 0x100;
const CLOCK = 90_000;
/** PTS runs this far ahead of the PCR, as decoders expect. */
const DELAY = 0.5;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let j = 0; j < 8; j++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ x) & 0xff]) >>> 0;
  return c >>> 0;
}

/** A PSI section (PAT/PMT) with its CRC, preceded by the pointer field. */
function section(body: Buffer): Buffer {
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([Buffer.from([0]), body, crc]);
}

export class TsWriter {
  private cc = new Map<number, number>();
  private streamType: number;

  /** codec: "h264" or "hevc" (Annex-B frames, written as they are). */
  constructor(codec: "h264" | "hevc") {
    this.streamType = codec === "hevc" ? 0x24 : 0x1b;
  }

  /** PAT and PMT; write before the first frame and now and then after. */
  tables(): Buffer {
    const pat = Buffer.from([
      0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, // table 0, length 13, ts id 1, v0 current
      0x00, 0x01, 0xe0 | (PID_PMT >> 8), PID_PMT & 0xff, // program 1 -> PMT
    ]);
    const pmt = Buffer.from([
      0x02, 0xb0, 0x12, 0x00, 0x01, 0xc1, 0x00, 0x00, // table 2, length 18, program 1
      0xe0 | (PID_VIDEO >> 8), PID_VIDEO & 0xff, 0xf0, 0x00, // PCR on the video PID, no program info
      this.streamType, 0xe0 | (PID_VIDEO >> 8), PID_VIDEO & 0xff, 0xf0, 0x00,
    ]);
    return Buffer.concat([this.packets(0, section(pat)), this.packets(PID_PMT, section(pmt))]);
  }

  frame(f: TimedFrame): Buffer {
    const pts = Math.round((f.t + DELAY) * CLOCK);
    const pes = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x80, 0x80, 0x05]), // video, unbounded, PTS only
      ptsBytes(pts),
      f.data,
    ]);
    return Buffer.concat([
      f.key ? this.tables() : Buffer.alloc(0),
      this.packets(PID_VIDEO, pes, { pcr: Math.round(f.t * CLOCK), key: f.key }),
    ]);
  }

  /** Split a payload into 188-byte packets, the first one starting the unit. */
  private packets(pid: number, payload: Buffer, opts?: { pcr: number; key: boolean }): Buffer {
    const out: Buffer[] = [];
    let pos = 0;
    let first = true;
    while (pos < payload.length || first) {
      // Adaptation field: PCR and random-access flag on the first packet,
      // stuffing on the last one so it fills 188 bytes.
      let af: Buffer | null = null;
      if (first && opts) {
        const f = Buffer.alloc(8);
        f[0] = 7;
        f[1] = 0x10 | (opts.key ? 0x40 : 0);
        pcrBytes(opts.pcr).copy(f, 2);
        af = f;
      }
      const room = 184 - (af?.length ?? 0);
      const left = payload.length - pos;
      if (left < room) {
        const stuff = room - left;
        if (af) af = Buffer.concat([af, Buffer.alloc(stuff, 0xff)]);
        else af = stuff === 1 ? Buffer.from([0]) : Buffer.concat([Buffer.from([stuff - 1, 0x00]), Buffer.alloc(stuff - 2, 0xff)]);
        af[0] = af.length - 1;
      }
      const take = 184 - (af?.length ?? 0);
      const cc = this.cc.get(pid) ?? 0;
      this.cc.set(pid, (cc + 1) & 0x0f);
      const h = Buffer.from([
        0x47,
        (first ? 0x40 : 0) | ((pid >> 8) & 0x1f),
        pid & 0xff,
        (af ? 0x30 : 0x10) | cc,
      ]);
      out.push(h, af ?? Buffer.alloc(0), payload.subarray(pos, pos + take));
      pos += take;
      first = false;
    }
    return Buffer.concat(out);
  }
}

function ptsBytes(pts: number): Buffer {
  const hi = Math.floor(pts / 2 ** 30) & 0x07;
  const lo = pts % 2 ** 30;
  return Buffer.from([
    0x21 | (hi << 1),
    (lo >>> 22) & 0xff,
    (((lo >>> 15) & 0x7f) << 1) | 1,
    (lo >>> 7) & 0xff,
    ((lo & 0x7f) << 1) | 1,
  ]);
}

function pcrBytes(base: number): Buffer {
  const hi = Math.floor(base / 2 ** 25); // top 8 of 33 bits
  const lo = base % 2 ** 25;
  return Buffer.from([
    hi & 0xff,
    (lo >>> 17) & 0xff,
    (lo >>> 9) & 0xff,
    (lo >>> 1) & 0xff,
    ((lo & 1) << 7) | 0x7e,
    0x00,
  ]);
}
