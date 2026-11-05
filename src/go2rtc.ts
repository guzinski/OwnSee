import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, GO2RTC_API, GO2RTC_BIN, ensureDataDir } from "./config.ts";
import { loadSources, toGo2rtcStreams } from "./sources.ts";

let proc: ChildProcess | null = null;

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
  const path = resolve(DATA_DIR, "go2rtc.json");
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  return path;
}

export function startGo2rtc(): void {
  const config = writeConfig();
  // Deployments may run go2rtc as its own service/container (e.g. docker).
  // In that mode the hub only writes the config and proxies to it.
  if (process.env.HUB_EXTERNAL_GO2RTC) {
    console.log(`[go2rtc] external mode — wrote config ${config}, not spawning`);
    return;
  }
  proc = spawn(GO2RTC_BIN, ["-config", config], { stdio: "inherit" });
  proc.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") return;
    console.error(`[go2rtc] exited (code=${code}); restarting in 2s`);
    proc = null;
    setTimeout(startGo2rtc, 2000);
  });
}

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
  proc?.kill("SIGTERM");
  proc = null;
}
