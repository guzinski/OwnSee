// Loads go2rtc's <video-stream> web component through the hub proxy, then
// builds the page from /api/sources: one selected camera in HD on the stage,
// the others live below on their sub streams, and that camera's recordings
// picked by day and hour. No build step, no external deps.
import "/go2rtc/video-stream.js";
import { longDay, numericDate, shortDay, t } from "/i18n.js";

const PLAYER_MODE = "mse,webrtc,mjpeg"; // MSE first so H.265 channels play
const DAYS_BACK = 60;
const $ = (id) => document.getElementById(id);

const grid = $("grid");
const statusEl = $("status");
const stage = $("stage");
const mount = $("stage-mount");
const stageTitle = $("stage-title");
const livePill = $("live-pill");
const backLive = $("back-live");
const pauseBtn = $("pause");
const saveBtn = $("save-photo");
const downloadBtn = $("download");
const daysEl = $("days");
const hoursEl = $("hours");
const recStatus = $("rec-status");
const blocksBox = $("blocks-box");
const blocksEl = $("blocks");
const blocksTitle = $("blocks-title");

let cameras = [];
let currentCam = null;
let date = ""; // selected day, YYYY-MM-DD
let recordings = []; // that day's segments, sorted by start time
let playingIndex = -1; // into recordings; -1 means live

// Dates are ISO (YYYY-MM-DD) in the NVR's local wall-clock time. Never use
// toISOString() here: it's UTC and can be a day ahead in the evening.
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localToday = () => isoDate(new Date());

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

function makeTile(cam) {
  const tile = document.createElement("button");
  tile.className = "tile";
  tile.setAttribute("aria-label", t("openCamera", { name: cam.name }));
  const label = document.createElement("span");
  label.className = "tile-label";
  label.textContent = cam.name;
  tile.append(makePlayer(streamFor(cam, "sub")), label);
  tile.addEventListener("click", () => {
    const previous = currentCam;
    selectCamera(cam);
    tile.replaceWith(makeTile(previous)); // the other tiles keep their streams
    stage.scrollIntoView({ block: "nearest" });
  });
  return tile;
}

function selectCamera(cam) {
  currentCam = cam;
  showLive();
  loadRecordings();
}

function showLive() {
  stopPlayback();
  playingIndex = -1;
  mount.replaceChildren();
  const player = makePlayer(streamFor(currentCam, "main"));
  mount.append(player);
  if (player.video) player.video.controls = false; // the stage has its own
  stageTitle.textContent = currentCam.name;
  livePill.hidden = false;
  backLive.hidden = true;
  pauseBtn.hidden = true;
  downloadBtn.hidden = true;
  saveBtn.hidden = false;
  renderHours();
  renderBlocks();
}

function renderDays() {
  const today = new Date();
  const buttons = [];
  for (let back = 0; back < DAYS_BACK; back++) { // newest first; the row runs right to left
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const iso = isoDate(d);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day";
    b.setAttribute("aria-pressed", String(iso === date));
    b.setAttribute("aria-label", longDay(d));
    const name = document.createElement("span");
    name.textContent = shortDay(d);
    const num = document.createElement("b");
    num.textContent = d.getDate();
    b.append(name, num);
    b.addEventListener("click", () => {
      date = iso;
      renderDays();
      showLive();
      loadRecordings();
    });
    buttons.push(b);
  }
  const keep = daysEl.scrollLeft;
  daysEl.replaceChildren(...buttons);
  daysEl.scrollLeft = keep;
}

/** First segment of each hour that has any, keyed by hour number. */
function segmentsByHour() {
  const first = new Map();
  recordings.forEach((r, i) => {
    const h = Number(r.begin.slice(11, 13));
    if (!first.has(h)) first.set(h, i);
  });
  return first;
}

function renderHours(loaded = true) {
  const now = new Date();
  const first = segmentsByHour();
  const playing = recordings[playingIndex];
  const playingHour = playing ? Number(playing.begin.slice(11, 13)) : -1;
  const buttons = [];
  for (let h = 0; h < 24; h++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hour";
    b.textContent = pad2(h);
    b.setAttribute("aria-pressed", String(h === playingHour));
    const future = date === localToday() && h > now.getHours();
    if (first.has(h)) {
      b.setAttribute("aria-label", t("playFrom", { time: `${pad2(h)}:00` }));
      b.addEventListener("click", () => playIndex(first.get(h)));
    } else {
      b.disabled = true;
      // Dashed = time that has passed with nothing on the NVR.
      if (loaded && !future) {
        b.classList.add("missing");
        b.setAttribute("aria-label", t("noRecordingAt", { time: `${pad2(h)}:00` }));
      }
    }
    buttons.push(b);
  }
  hoursEl.replaceChildren(...buttons);
}

/** One block per 5 minutes of the playing hour: click to jump, gaps stay blank. */
function renderBlocks() {
  const rec = recordings[playingIndex];
  blocksBox.hidden = !rec;
  if (!rec) return;
  const hour = rec.begin.slice(11, 13);
  const slot = (r) => Math.floor(Number(r.begin.slice(14, 16)) / 5);
  const bySlot = new Map();
  recordings.forEach((r, i) => {
    if (r.begin.slice(11, 13) === hour && !bySlot.has(slot(r))) bySlot.set(slot(r), i);
  });
  blocksTitle.textContent = t("withinHour", { from: `${hour}:00`, to: `${pad2(Number(hour) + 1)}:00` });
  const buttons = [];
  for (let i = 0; i < 12; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "block";
    const index = bySlot.get(i);
    b.setAttribute("aria-label", `${hour}:${pad2(i * 5)}`);
    if (index === undefined) b.disabled = true;
    else {
      if (i === slot(rec)) b.classList.add("now");
      else if (i < slot(rec)) b.classList.add("past");
      b.addEventListener("click", () => playIndex(index));
    }
    buttons.push(b);
  }
  blocksEl.replaceChildren(...buttons);
}

async function loadRecordings() {
  recordings = [];
  renderHours(false);
  recStatus.hidden = false;
  recStatus.textContent = t("loadingRecordings");
  const cam = currentCam;
  const day = date;
  try {
    const res = await fetch(`/api/recordings?camera=${encodeURIComponent(cam.id)}&date=${day}`);
    if (!res.ok) throw new Error(`hub returned ${res.status}`);
    const recs = await res.json();
    if (cam !== currentCam || day !== date) return; // a newer request won
    recordings = Array.isArray(recs) ? recs : [];
    recStatus.hidden = recordings.length > 0;
    recStatus.textContent = t("noRecordings");
  } catch {
    if (cam !== currentCam || day !== date) return;
    recStatus.textContent = t("recordingsFailed");
  }
  renderHours();
}

function dayLabel() {
  const today = localToday();
  const [y, m, d] = date.split("-").map(Number);
  const when = new Date(y, m - 1, d);
  if (date === today) return t("today");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === isoDate(yesterday)) return t("yesterday");
  return `${shortDay(when)} ${d}`;
}

function setPauseIcon(paused) {
  $("pause-icon").setAttribute("d", paused ? "M7 4l13 8-13 8z" : "M6 4h4v16H6zM14 4h4v16h-4z");
  pauseBtn.setAttribute("aria-label", t(paused ? "play" : "pause"));
}

function playIndex(i) {
  const rec = recordings[i];
  if (!rec) return;
  playingIndex = i;
  livePill.hidden = true;
  backLive.hidden = false;
  pauseBtn.hidden = false;
  saveBtn.hidden = true;
  downloadBtn.hidden = false;
  stageTitle.textContent = t("dayAtTime", { day: dayLabel(), time: rec.begin.slice(11, 16) });
  setPauseIcon(false);
  renderHours();
  renderBlocks();

  mount.replaceChildren();
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true; // recordings have no audio yet; muted lets autoplay start
  video.playsInline = true;
  const msg = document.createElement("div");
  msg.className = "mount-msg";
  msg.textContent = t("loadingRecording");
  mount.append(video, msg);
  video.addEventListener("playing", () => {
    msg.remove();
    setPauseIcon(false);
  });
  video.addEventListener("pause", () => setPauseIcon(true));
  video.addEventListener("error", () => {
    const e = video.error;
    const why = { 1: "playAborted", 2: "playNetwork", 3: "playDecode", 4: "playFormat" };
    const reason = t(why[e?.code] ?? "playUnknown");
    msg.textContent = t("cantPlay", { reason: e?.message ? `${reason}, ${e.message}` : reason });
  });
  // Continuous viewing: roll into the next 5-minute segment when one ends.
  video.addEventListener("ended", () => {
    if (playingIndex === i && recordings[i + 1]) playIndex(i + 1);
  });
  const q = new URLSearchParams({ camera: currentCam.id, file: rec.fileName, begin: rec.begin, end: rec.end });
  streamIntoVideo(video, `/api/playback?${q}`, msg);
}

pauseBtn.addEventListener("click", () => {
  const video = mount.querySelector("video");
  if (video) video.paused ? video.play().catch(() => {}) : video.pause();
});
backLive.addEventListener("click", showLive);

function clickDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

// Download the playing segment as an MP4 file, with a progress bar on the
// video, just above the controls. A plain link would only show "45 MB" in the browser's downloads:
// the hub can't know the final size up front, but the NVR reports each file's
// size, which is close enough for a percentage. The NVR sends at about
// real-time speed, so 5 minutes of video takes ~5 minutes.
let download = null; // { abort, box } while one is running

function downloadBox() {
  const box = document.createElement("div");
  box.className = "dl";
  box.innerHTML = `<div class="dl-row"><span class="dl-text"></span>
    <button type="button" class="dl-cancel">${t("cancel")}</button></div>
    <progress class="dl-bar" max="1"></progress>`;
  stage.append(box);
  return box;
}

// The page holds the download, so leaving or reloading would lose it: ask first.
window.addEventListener("beforeunload", (e) => {
  if (download) e.preventDefault();
});

const mbOf = (n) => `${Math.round(n / (1024 * 1024))} MB`;

downloadBtn.addEventListener("click", async () => {
  const rec = recordings[playingIndex];
  if (!rec || download) return;
  const cam = currentCam;
  const label = `${cam.name}, ${numericDate(new Date(`${rec.begin.slice(0, 10)}T00:00:00`))} ${rec.begin.slice(11, 16)}`;
  const q = new URLSearchParams({ camera: cam.id, file: rec.fileName, begin: rec.begin, end: rec.end, download: "1" });
  const abort = new AbortController();
  const box = downloadBox();
  const text = box.querySelector(".dl-text");
  const bar = box.querySelector(".dl-bar");
  const cancel = box.querySelector(".dl-cancel");
  download = { abort, box };
  downloadBtn.disabled = true;
  cancel.addEventListener("click", () => abort.abort());
  text.textContent = t("dlWaiting", { label });

  const finish = (msg, keep = 8000) => {
    download = null;
    downloadBtn.disabled = false;
    text.textContent = msg;
    cancel.remove();
    bar.remove();
    setTimeout(() => box.remove(), keep);
  };
  try {
    const res = await fetch(`/api/playback?${q}`, { signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(t("errHubStatus", { status: res.status }));
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "recording.mp4";
    const chunks = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (rec.size) {
        const f = Math.min(got / rec.size, 0.99);
        bar.value = f;
        text.textContent = t("dlProgress", { label, percent: Math.round(f * 100), got: mbOf(got), total: mbOf(rec.size) });
      } else {
        text.textContent = t("dlBytes", { label, got: mbOf(got) });
      }
    }
    if (!got) throw new Error(t("errNoVideo"));
    const url = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
    clickDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    finish(t("dlSaved", { name }));
  } catch (e) {
    finish(abort.signal.aborted ? t("dlCancelled", { label }) : t("dlFailed", { reason: e.message }), 15000);
  }
});

saveBtn.addEventListener("click", () => {
  const stream = streamFor(currentCam, "main");
  const now = new Date();
  const time = `${isoDate(now)}_${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  const name = `${currentCam.name.replace(/[^A-Za-z0-9_-]+/g, "_")}_${time}.jpg`;
  clickDownload(`/go2rtc/api/frame.jpeg?src=${encodeURIComponent(stream)}`, name);
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
    msg.textContent = t("cantPlayHub", { status: res.status });
    return;
  }
  const codec = res.headers.get("x-codec") || "avc1.640033";
  const duration = Number(res.headers.get("x-duration")) || 300;
  const mime = `video/mp4; codecs="${codec}"`;
  const MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS || !MS.isTypeSupported(mime)) {
    abort.abort();
    msg.textContent = codec.startsWith("hvc1") ? t("noH265") : t("noCodec", { codec });
    return;
  }

  const ms = new MS();
  video.disableRemotePlayback = true; // required for ManagedMediaSource
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));
  ms.duration = duration;
  const sb = ms.addSourceBuffer(mime);
  const updated = () => new Promise((r) => sb.addEventListener("updateend", r, { once: true }));

  video.play().catch(() => (msg.textContent = t("pressPlay")));

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
    if (!abort.signal.aborted) msg.textContent = t("playbackStopped", { reason: err.message });
  }
}

async function init() {
  date = localToday();
  renderDays();
  renderHours(false);
  try {
    const [sources, health] = await Promise.all([
      fetch("/api/sources").then((r) => r.json()),
      fetch("/api/health").then((r) => r.json()),
    ]);
    cameras = sources.flatMap((s) => s.cameras);
    statusEl.textContent = t(health.secure ? "awayEncrypted" : "onHomeNetwork");
    if (!cameras.length) {
      statusEl.textContent = t("noCameras");
      grid.setAttribute("aria-busy", "false");
      return;
    }
    selectCamera(cameras[0]);
    grid.replaceChildren(...cameras.slice(1).map(makeTile));
    grid.setAttribute("aria-busy", "false");
  } catch (err) {
    statusEl.textContent = t("cantReachHub");
    console.error(err);
  }
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

init();

// Fullscreen the stage, controls included. On Android, also rotate to
// landscape while fullscreen; unsupported browsers just skip that.
$("fullscreen").addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  try {
    await stage.requestFullscreen({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape").catch(() => {});
  } catch {
    // Fallback: native fullscreen of the <video> element itself.
    mount.querySelector("video")?.requestFullscreen?.().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) screen.orientation?.unlock?.();
});
