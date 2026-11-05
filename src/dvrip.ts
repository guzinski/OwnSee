import net from "node:net";
import crypto from "node:crypto";
import { Readable } from "node:stream";

// Minimal DVRIP (Xiongmai "Sofia") client: login, recording search, and
// playback. go2rtc covers live streams; this covers NVR recordings, which ride
// a proprietary protocol on TCP 34567. See memory dvrip-protocol for details.

const MSG = {
  LOGIN: 1000,
  FILE_QUERY: 1440,
  PLAY_CLAIM: 1424,
  PLAY_START: 1420,
  PLAY_DATA: 1426,
} as const;

export interface Recording {
  begin: string; // "YYYY-MM-DD hh:mm:ss"
  end: string;
  fileName: string;
  disk: number;
}

function sofiaHash(password: string): string {
  const md5 = crypto.createHash("md5").update(password, "utf8").digest();
  let out = "";
  for (let i = 0; i < 8; i++) {
    let n = (md5[2 * i] + md5[2 * i + 1]) % 62;
    n += n > 9 ? (n > 35 ? 61 : 55) : 0x30;
    out += String.fromCharCode(n);
  }
  return out;
}

export function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Parse the NVR's "YYYY-MM-DD hh:mm:ss" (local wall-clock) into a Date. */
export function parseTime(s: string): Date | null {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

export class DvripClient {
  private sock: net.Socket | null = null;
  private session = 0;
  private seq = 0;
  private buf = Buffer.alloc(0);
  private jsonWaiters: ((m: { msg: number; body: string }) => void)[] = [];
  private onData: ((payload: Buffer) => void) | null = null;
  private host: string;
  private port: number;
  private user: string;
  private pass: string;

  constructor(host: string, port: number, user: string, pass: string) {
    this.host = host;
    this.port = port;
    this.user = user;
    this.pass = pass;
  }

  private packet(msg: number, obj: unknown): Buffer {
    const data = Buffer.from(JSON.stringify(obj), "utf8");
    const h = Buffer.alloc(20);
    h[0] = 0xff;
    h.writeInt32LE(this.session, 4);
    h.writeInt32LE(this.seq++, 8);
    h.writeUInt16LE(msg, 14);
    h.writeInt32LE(data.length + 2, 16);
    return Buffer.concat([h, data, Buffer.from([0x0a, 0x00])]);
  }

  private get sidHex(): string {
    return "0x" + this.session.toString(16).padStart(8, "0").toUpperCase();
  }

  private handle(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 20) {
      const len = this.buf.readInt32LE(16);
      if (this.buf.length < 20 + len) break;
      const msg = this.buf.readUInt16LE(14);
      const payload = this.buf.subarray(20, 20 + len);
      this.buf = this.buf.subarray(20 + len);
      if (msg === MSG.PLAY_DATA && this.onData) {
        this.onData(Buffer.from(payload));
      } else {
        const w = this.jsonWaiters.shift();
        if (w) w({ msg, body: payload.toString("utf8").replace(/\0+$/, "") });
      }
    }
  }

  private recvJson(): Promise<{ msg: number; body: string }> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("DVRIP response timeout")), 10000);
      this.jsonWaiters.push((m) => {
        clearTimeout(t);
        resolve(m);
      });
    });
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.sock = net.connect(this.port, this.host);
      this.sock.on("data", (d) => this.handle(d));
      this.sock.on("error", reject);
      this.sock.once("connect", resolve);
    });
    this.sock!.write(
      this.packet(MSG.LOGIN, {
        EncryptType: "MD5",
        LoginType: "DVRIP-Web",
        PassWord: sofiaHash(this.pass),
        UserName: this.user,
      }),
    );
    const resp = JSON.parse((await this.recvJson()).body);
    if (resp.Ret !== 100) throw new Error(`DVRIP login failed (Ret=${resp.Ret})`);
    this.session = parseInt(resp.SessionID, 16);
  }

  /** List recordings for a channel between two Date instances. */
  async fileQuery(channel: number, begin: Date, end: Date, type = "h264"): Promise<Recording[]> {
    this.sock!.write(
      this.packet(MSG.FILE_QUERY, {
        Name: "OPFileQuery",
        SessionID: this.sidHex,
        OPFileQuery: {
          BeginTime: fmtTime(begin),
          EndTime: fmtTime(end),
          Channel: channel,
          DriverTypeMask: "0x0000FFFF",
          Event: "*",
          Type: type,
        },
      }),
    );
    const resp = JSON.parse((await this.recvJson()).body);
    const files = Array.isArray(resp.OPFileQuery) ? resp.OPFileQuery : [];
    return files.map((f: any) => ({
      begin: f.BeginTime,
      end: f.EndTime,
      fileName: f.FileName,
      disk: f.DiskNo ?? 0,
    }));
  }

  /** Like fileQuery, but pages through the NVR's 64-results-per-search cap
   *  (64 × 5-min segments ≈ 5h20m) to return the whole range. */
  async fileQueryAll(channel: number, begin: Date, end: Date, type = "h264"): Promise<Recording[]> {
    const PAGE_CAP = 64;
    const byName = new Map<string, Recording>();
    let from = begin;
    for (let i = 0; i < 50; i++) {
      const page = await this.fileQuery(channel, from, end, type);
      for (const r of page) byName.set(r.fileName, r); // pages overlap at the edges
      if (page.length < PAGE_CAP) break;
      const next = parseTime(page[page.length - 1].end);
      if (!next || next <= from) break; // no progress: stop rather than loop
      from = next;
    }
    return [...byName.values()].sort((a, b) => a.begin.localeCompare(b.begin));
  }

  /** Start playback of a recording by name; returns a stream of clean
   *  Annex-B video (audio dropped). Close the client to stop. */
  openPlayback(rec: Recording): Readable {
    const param = {
      PlayMode: "ByName",
      FileName: rec.fileName,
      StreamType: 0,
      Value: 0,
      TransMode: "TCP",
    };
    const deframer = new Deframer();
    const out = new Readable({ read() {} });
    this.onData = (payload) => {
      for (const v of deframer.push(payload)) out.push(v);
    };

    (async () => {
      try {
        this.sock!.write(
          this.packet(MSG.PLAY_CLAIM, {
            Name: "OPPlayBack",
            SessionID: this.sidHex,
            OPPlayBack: { Action: "Claim", Parameter: param, StartTime: rec.begin, EndTime: rec.end },
          }),
        );
        const claim = JSON.parse((await this.recvJson()).body);
        if (claim.Ret !== 100) throw new Error(`playback claim failed (Ret=${claim.Ret})`);
        this.sock!.write(
          this.packet(MSG.PLAY_START, {
            Name: "OPPlayBack",
            SessionID: this.sidHex,
            OPPlayBack: { Action: "DownloadStart", Parameter: param, StartTime: rec.begin, EndTime: rec.end },
          }),
        );
      } catch (err) {
        out.destroy(err as Error);
      }
    })();

    this.sock!.once("close", () => out.push(null));
    return out;
  }

  close(): void {
    this.onData = null;
    this.sock?.destroy();
    this.sock = null;
  }
}

/** Streaming Xiongmai de-framer: emits H.264/H.265 Annex-B video payloads,
 *  dropping audio and the proprietary frame headers, across TCP chunks. */
class Deframer {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Buffer[] = [];
    let p = 0;
    while (p + 8 <= this.buf.length) {
      if (!(this.buf[p] === 0 && this.buf[p + 1] === 0 && this.buf[p + 2] === 1 && this.buf[p + 3] >= 0xf0)) {
        p++;
        continue;
      }
      const tag = this.buf[p + 3];
      let hdr: number, len: number, video = false;
      if (tag === 0xfc || tag === 0xfe) {
        if (p + 16 > this.buf.length) break;
        hdr = 16;
        len = this.buf.readUInt32LE(p + 12);
        video = true;
      } else if (tag === 0xfd) {
        hdr = 8;
        len = this.buf.readUInt32LE(p + 4);
        video = true;
      } else if (tag === 0xfa || tag === 0xf9) {
        hdr = 8;
        len = this.buf.readUInt16LE(p + 6);
      } else {
        p++;
        continue;
      }
      if (p + hdr + len > this.buf.length) break; // wait for more data
      if (video) out.push(Buffer.from(this.buf.subarray(p + hdr, p + hdr + len)));
      p += hdr + len;
    }
    this.buf = Buffer.from(this.buf.subarray(p));
    return out;
  }
}

/** Strip H.264/H.265 emulation-prevention bytes (00 00 03 → 00 00). */
function unescapeRbsp(b: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    if (i >= 2 && b[i] === 3 && b[i - 1] === 0 && b[i - 2] === 0) continue;
    out.push(b[i]);
  }
  return Buffer.from(out);
}

/** Find the payload of the first NAL matching `isType` (after its header). */
function findNal(sample: Buffer, headerLen: number, isType: (b: number) => boolean): Buffer | null {
  for (let i = 0; i + 4 < sample.length; i++) {
    if (sample[i] === 0 && sample[i + 1] === 0 && sample[i + 2] === 1 && isType(sample[i + 3]))
      return sample.subarray(i + 3 + headerLen, Math.min(sample.length, i + 3 + headerLen + 64));
  }
  return null;
}

/** Build the RFC 6381 codec string browsers need for MediaSource
 *  (e.g. "avc1.640033" or "hvc1.1.6.L153.B0") from the stream's SPS. */
export function codecString(sample: Buffer, codec: "h264" | "hevc"): string {
  if (codec === "h264") {
    const sps = findNal(sample, 1, (b) => (b & 0x1f) === 7);
    if (!sps || sps.length < 3) return "avc1.640033";
    return "avc1." + [sps[0], sps[1], sps[2]].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const raw = findNal(sample, 2, (b) => ((b >> 1) & 0x3f) === 33);
  if (!raw) return "hvc1.1.6.L153.B0";
  const sps = unescapeRbsp(raw);
  // sps[0] = vps_id/max_sub_layers/nesting; profile_tier_level starts at sps[1].
  const space = sps[1] >> 6, tier = (sps[1] >> 5) & 1, profile = sps[1] & 0x1f;
  let compat = sps.readUInt32BE(2), rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const constraints = [...sps.subarray(6, 12)];
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = sps[12];
  const parts = [
    "hvc1",
    (space ? "ABC"[space - 1] : "") + profile,
    (rev >>> 0).toString(16),
    (tier ? "H" : "L") + level,
    ...constraints.map((c) => c.toString(16)),
  ];
  return parts.join(".");
}

/** Detect H.264 vs H.265 from the first NAL after an Annex-B start code. */
export function detectCodec(sample: Buffer): "h264" | "hevc" {
  for (let i = 0; i + 4 < sample.length; i++) {
    if (sample[i] === 0 && sample[i + 1] === 0 && sample[i + 2] === 1) {
      const nal = sample[i + 3];
      const hevcType = (nal >> 1) & 0x3f; // HEVC: VPS32/SPS33/PPS34
      if (hevcType >= 32 && hevcType <= 34) return "hevc";
      return "h264";
    }
  }
  return "h264";
}
