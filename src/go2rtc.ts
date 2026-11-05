import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { DATA_DIR, GO2RTC_API, GO2RTC_BIN, ensureDataDir } from "./config.ts";
import { loadSources, toGo2rtcStreams } from "./sources.ts";

let proc: ChildProcess | null = null;
let stopping = false;
const CONFIG_PATH = resolve(DATA_DIR, "go2rtc.json");

/** Kill go2rtc processes left over from a previous hub run (e.g. the hub was
 *  killed hard). Only matches this project's exact binary + config, read from
 *  /proc, so unrelated go2rtc instances are never touched. Linux only. */
function killStaleGo2rtc(): number {
  let killed = 0;
  let pids: string[] = [];
  try {
    pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return 0; // no /proc (non-Linux): skip
  }
  for (const pid of pids) {
    if (Number(pid) === process.pid || Number(pid) === proc?.pid) continue;
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (argv[0] === GO2RTC_BIN && argv.includes(CONFIG_PATH)) {
        process.kill(Number(pid), "SIGTERM");
        killed++;
      }
    } catch {
      /* process vanished or not ours to read */
    }
  }
  return killed;
}

/** Resolve once nothing is listening on go2rtc's API port (or after timeout). */
async function waitPortFree(timeoutMs = 3000): Promise<void> {
  const [host, port] = GO2RTC_API.split(":");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = await new Promise<boolean>((r) => {
      const s = net.connect(Number(port), host);
      s.once("connect", () => (s.destroy(), r(true)));
      s.once("error", () => r(false));
    });
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Write a go2rtc config from the current sources. API bound to localhost; the
 *  hub is the only public listener, so go2rtc's own RTSP/WebRTC ports stay off. */
function writeConfig(): string {
  ensureDataDir();
  const streams = toGo2rtcStreams(loadSources());
  const cfg = {
    api: { listen: GO2RTC_API },
    rtsp: { listen: "" },
    srtp: { listen: "" },
    webrtc: { listen: "", candidates: [] as string[] },
    log: { level: "warn" },
    streams,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return CONFIG_PATH;
}

export async function startGo2rtc(): Promise<void> {
  const config = writeConfig();
  // Deployments may run go2rtc as its own service/container (e.g. docker).
  // In that mode the hub only writes the config and proxies to it.
  if (process.env.HUB_EXTERNAL_GO2RTC) {
    console.log(`[go2rtc] external mode — wrote config ${config}, not spawning`);
    return;
  }
  const stale = killStaleGo2rtc();
  if (stale) console.log(`[go2rtc] stopped ${stale} leftover go2rtc process(es) from a previous run`);
  await waitPortFree();
  if (stopping) return;

  proc = spawn(GO2RTC_BIN, ["-config", config], { stdio: "inherit" });
  proc.on("exit", (code, signal) => {
    proc = null;
    if (stopping) return;
    console.error(`[go2rtc] exited (code=${code}, signal=${signal}); restarting in 2s`);
    setTimeout(() => void startGo2rtc(), 2000);
  });
}

// Last line of defence: never leave go2rtc running after the hub process ends.
process.on("exit", () => {
  stopping = true;
  proc?.kill("SIGKILL");
});

/** Regenerate config and ask go2rtc to reload without dropping the process. */
export async function reloadGo2rtc(): Promise<void> {
  writeConfig();
  try {
    await fetch(`http://${GO2RTC_API}/api/restart`, { method: "POST" });
  } catch {
    /* if the API isn't up yet, the next start picks up the new config */
  }
}

export function stopGo2rtc(): void {
  stopping = true;
  proc?.kill("SIGTERM");
}
