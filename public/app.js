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

function openViewer(cam) {
  viewerMount.innerHTML = "";
  viewerLabel.textContent = `${cam.name} · HD`;
  viewerMount.appendChild(makePlayer(streamFor(cam, "main")));
  viewer.showModal();
}

function closeViewer() {
  viewer.close();
  viewerMount.innerHTML = ""; // tear down the player so it stops streaming
}

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
