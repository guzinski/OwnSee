// Loads go2rtc's <video-stream> web component through the hub proxy, then
// builds a live grid from /api/sources. No build step, no external deps.
import "/go2rtc/video-stream.js";

const PLAYER_MODE = "mse,webrtc,mjpeg"; // MSE first so H.265 channels play
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const qualityToggle = document.getElementById("quality");
const viewer = document.getElementById("viewer");
const viewerMount = document.getElementById("viewer-mount");
const viewerLabel = document.getElementById("viewer-label");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function makePlayer(streamId) {
  const v = document.createElement("video-stream");
  v.mode = PLAYER_MODE;
  v.background = true; // keep buffering when offscreen so tiles stay warm
  v.src = `/go2rtc/api/ws?src=${encodeURIComponent(streamId)}`;
  return v;
}

/** Pick the stream id for a camera at the requested quality, with fallback. */
function streamFor(cam, quality) {
  const want = cam.streams.find((s) => s.quality === quality);
  return (want ?? cam.streams[0]).id;
}

let cameras = [];

function render() {
  const quality = qualityToggle.checked ? "main" : "sub";
  grid.innerHTML = "";
  for (const cam of cameras) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.setAttribute("aria-label", `Open ${cam.name}`);

    const player = makePlayer(streamFor(cam, quality));
    tile.appendChild(player);

    const label = document.createElement("span");
    label.className = "tile-label";
    label.textContent = cam.name;
    tile.appendChild(label);

    tile.addEventListener("click", () => openViewer(cam));
    grid.appendChild(tile);
  }
  grid.setAttribute("aria-busy", "false");
}

const pbControls = document.getElementById("playback-controls");
const pbDate = document.getElementById("pb-date");
const pbStatus = document.getElementById("pb-status");
const pbHour = document.getElementById("pb-hour");
const pbMinute = document.getElementById("pb-minute");
const pbPlay = document.getElementById("pb-play");
const pbPrev = document.getElementById("pb-prev");
const pbNext = document.getElementById("pb-next");
const tabLive = document.getElementById("tab-live");
const tabPlayback = document.getElementById("tab-playback");
let currentCam = null;
let recordings = []; // the selected day's segments, sorted by start time
let playingIndex = -1;

// Dates are ISO (YYYY-MM-DD) in the NVR's local wall-clock time. Never use
// toISOString() here: it's UTC and can be a day ahead in the evening.
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localToday = () => isoDate(new Date());
const validIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00`));
function shiftDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

function showLive() {
  stopPlayback();
  tabLive.classList.add("active");
  tabPlayback.classList.remove("active");
  pbControls.hidden = true;
  viewerLabel.textContent = `${currentCam.name} · HD`;
  viewerMount.innerHTML = "";
  viewerMount.appendChild(makePlayer(streamFor(currentCam, "main")));
}

function showPlayback() {
  tabPlayback.classList.add("active");
  tabLive.classList.remove("active");
  pbControls.hidden = false;
  viewerLabel.textContent = `${currentCam.name} · Playback`;
  if (!validIso(pbDate.value)) pbDate.value = localToday();
  loadRecordings();
}

async function loadRecordings() {
  stopPlayback();
  setMountMessage("Choose a time and press Play");
  recordings = [];
  playingIndex = -1;
  pbHour.replaceChildren();
  pbMinute.replaceChildren();
  pbPlay.disabled = true;
  pbNext.disabled = pbDate.value >= localToday();
  if (!validIso(pbDate.value)) {
    pbStatus.textContent = "Use YYYY-MM-DD";
    return;
  }
  const cam = currentCam;
  const date = pbDate.value;
  pbStatus.textContent = "Loading…";
  try {
    const recs = await (await fetch(`/api/recordings?camera=${cam.id}&date=${date}`)).json();
    if (cam !== currentCam || date !== pbDate.value) return; // a newer request won
    if (!Array.isArray(recs) || !recs.length) {
      pbStatus.textContent = "No recordings this day";
      return;
    }
    recordings = recs;
    pbStatus.textContent = `${recs.length} segments, ${recs[0].begin.slice(11, 16)}–${recs.at(-1).end.slice(11, 16)}`;
    const hours = [...new Set(recs.map((r) => r.begin.slice(11, 13)))];
    pbHour.replaceChildren(...hours.map((h) => new Option(h, h)));
    pbHour.value = hours.at(-1); // default to the most recent footage
    fillMinutes(true);
    pbPlay.disabled = false;
  } catch {
    pbStatus.textContent = "Failed to load recordings";
  }
}

/** Minutes dropdown = the segments that start in the selected hour.
 *  Option values are indexes into `recordings`. */
function fillMinutes(selectLast = false) {
  const opts = [];
  recordings.forEach((r, i) => {
    if (r.begin.slice(11, 13) === pbHour.value) opts.push(new Option(r.begin.slice(14, 16), String(i)));
  });
  pbMinute.replaceChildren(...opts);
  if (selectLast && opts.length) pbMinute.value = opts.at(-1).value;
}

function playIndex(i) {
  const rec = recordings[i];
  if (!rec) return;
  playingIndex = i;
  // keep the dropdowns in sync (matters when auto-advancing to the next segment)
  if (pbHour.value !== rec.begin.slice(11, 13)) {
    pbHour.value = rec.begin.slice(11, 13);
    fillMinutes();
  }
  pbMinute.value = String(i);
  viewerLabel.textContent = `${currentCam.name} · ${rec.begin}`;

  viewerMount.innerHTML = "";
  const video = document.createElement("video");
  video.controls = true;
  video.autoplay = true;
  video.muted = true; // recordings have no audio yet; muted lets autoplay start
  video.playsInline = true;
  const msg = document.createElement("div");
  msg.className = "mount-msg";
  msg.textContent = "Loading recording…";
  viewerMount.append(video, msg);
  video.addEventListener("playing", () => msg.remove());
  video.addEventListener("error", () => {
    const e = video.error;
    const why = { 1: "aborted", 2: "network error", 3: "decode error", 4: "format not supported" };
    msg.textContent = `Can't play: ${why[e?.code] ?? "unknown error"}${e?.message ? " — " + e.message : ""}`;
  });
  // Continuous viewing: roll into the next 5-minute segment when one ends.
  video.addEventListener("ended", () => {
    if (playingIndex === i && recordings[i + 1]) playIndex(i + 1);
  });
  const q = new URLSearchParams({ camera: currentCam.id, file: rec.fileName, begin: rec.begin, end: rec.end });
  streamIntoVideo(video, `/api/playback?${q}`, msg);
}

pbHour.addEventListener("change", () => fillMinutes());
pbMinute.addEventListener("change", () => playIndex(Number(pbMinute.value)));
pbPlay.addEventListener("click", () => playIndex(Number(pbMinute.value)));
pbDate.addEventListener("keydown", (e) => e.key === "Enter" && pbDate.blur());
pbPrev.addEventListener("click", () => {
  pbDate.value = shiftDate(validIso(pbDate.value) ? pbDate.value : localToday(), -1);
  loadRecordings();
});
pbNext.addEventListener("click", () => {
  pbDate.value = shiftDate(validIso(pbDate.value) ? pbDate.value : localToday(), 1);
  loadRecordings();
});

// Abort controller for the playback download currently in progress, so that
// switching segment or closing the viewer stops the NVR transfer.
let playbackAbort = null;

function stopPlayback() {
  playbackAbort?.abort();
  playbackAbort = null;
}

/** Feed the hub's fragmented-MP4 stream into <video> through MediaSource.
 *  A plain <video src> can't know the length of a stream with no duration
 *  (it shows a few seconds then stops); MSE lets us declare the real
 *  segment length and append data as the NVR delivers it. */
async function streamIntoVideo(video, url, msg) {
  stopPlayback();
  const abort = new AbortController();
  playbackAbort = abort;
  let res;
  try {
    res = await fetch(url, { signal: abort.signal });
  } catch {
    return; // aborted
  }
  if (!res.ok) {
    msg.textContent = `Can't play: hub returned ${res.status}`;
    return;
  }
  const codec = res.headers.get("x-codec") || "avc1.640033";
  const duration = Number(res.headers.get("x-duration")) || 300;
  const mime = `video/mp4; codecs="${codec}"`;
  const MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS || !MS.isTypeSupported(mime)) {
    abort.abort();
    msg.textContent = codec.startsWith("hvc1")
      ? "This browser can't play H.265 recordings (try the Android app/browser)"
      : `This browser can't play ${codec}`;
    return;
  }

  const ms = new MS();
  video.disableRemotePlayback = true; // required for ManagedMediaSource
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
  ms.duration = duration;
  const sb = ms.addSourceBuffer(mime);
  const updated = () => new Promise((r) => sb.addEventListener("updateend", r, { once: true }));

  video.play().catch(() => (msg.textContent = "Tap ▶ to play"));

  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (abort.signal.aborted || ms.readyState !== "open") return;
      // Keep memory bounded on phones: drop video more than 30s behind.
      const behind = video.currentTime - 30;
      if (sb.buffered.length && sb.buffered.start(0) < behind) {
        sb.remove(0, behind);
        await updated();
      }
      try {
        sb.appendBuffer(value);
        await updated();
      } catch (err) {
        if (err.name !== "QuotaExceededError") throw err;
        // Buffer full: wait for playback to catch up, then retry once.
        await new Promise((r) => setTimeout(r, 1000));
        sb.remove(0, Math.max(0, video.currentTime - 5));
        await updated();
        sb.appendBuffer(value);
        await updated();
      }
    }
    if (ms.readyState === "open") ms.endOfStream();
  } catch (err) {
    if (!abort.signal.aborted) msg.textContent = `Playback stopped: ${err.message}`;
  }
}

function setMountMessage(text) {
  viewerMount.innerHTML = "";
  const m = document.createElement("div");
  m.className = "mount-msg";
  m.textContent = text;
  viewerMount.appendChild(m);
}

function openViewer(cam) {
  currentCam = cam;
  showLive();
  viewer.showModal();
}

function closeViewer() {
  viewer.close();
  stopPlayback();
  viewerMount.innerHTML = ""; // tear down player/video so streaming stops
  pbControls.hidden = true;
}

tabLive.addEventListener("click", showLive);
tabPlayback.addEventListener("click", showPlayback);
pbDate.addEventListener("change", loadRecordings);

document.getElementById("close").addEventListener("click", closeViewer);
viewer.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeViewer();
});
viewer.addEventListener("click", (e) => {
  if (e.target === viewer) closeViewer();
});
qualityToggle.addEventListener("change", render);

async function init() {
  try {
    const sources = await (await fetch("/api/sources")).json();
    cameras = sources.flatMap((s) => s.cameras);
    if (!cameras.length) {
      setStatus("No cameras configured");
      grid.setAttribute("aria-busy", "false");
      return;
    }
    setStatus(`${cameras.length} cameras`);
    render();
  } catch (err) {
    setStatus("Failed to load cameras");
    console.error(err);
  }
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

init();

// Fullscreen the video area (works for live and playback). On Android, also
// rotate to landscape while fullscreen; unsupported browsers just skip that.
document.getElementById("fullscreen").addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  try {
    await viewerMount.requestFullscreen({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape").catch(() => {});
  } catch {
    // Fallback: native fullscreen of the <video> element itself.
    viewerMount.querySelector("video")?.requestFullscreen?.().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) screen.orientation?.unlock?.();
});
