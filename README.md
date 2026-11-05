# Camera Hub

A self-hosted, open-source, ad-free viewer for ONVIF cameras and NVRs — like ICSee
or XMEye, but **your video never leaves your network through a vendor cloud**. A
small hub runs at home; your phone and browser connect only to it.

> Status: **M1 (MVP web view) — in progress.** Live LAN grid of all NVR cameras.

## Why

Cheap IP cameras and NVRs usually force you through a vendor app and cloud server.
This project keeps everything local: the hub talks to your cameras over ONVIF /
RTSP / DVRIP, and serves a web UI (installable as an Android PWA later) that works
in any browser on your LAN.

## Architecture

```
Phone / Browser ──HTTP(S)──► Hub (this app) ──┬── proxy ──► go2rtc ──► NVR / cameras
                              Node + static UI │                       (RTSP/DVRIP)
                                               └── /api/sources, config
```

- **Hub** (`src/`): a tiny Node/TypeScript server (zero runtime dependencies). It
  serves the web UI, exposes `/api/sources`, generates the go2rtc config from
  `data/sources.json`, supervises go2rtc, and reverse-proxies go2rtc (including the
  WebSocket the player uses). The hub is the *only* public listener.
- **[go2rtc](https://github.com/AlexxIT/go2rtc)** (`bin/go2rtc`): does all the hard
  video work — connects to cameras/NVR and converts their streams to browser-playable
  WebRTC / fragmented-MP4 (MSE). Bound to `127.0.0.1` only; reached via the hub proxy.
- **Web UI** (`public/`): a dependency-free PWA. Live grid of all cameras, tap for a
  fullscreen HD view, toggle between sub (low-res, grid) and main (HD) streams. The
  player is go2rtc's own `<video-stream>` component (WebRTC/MSE with fallback).

## Requirements

- Node.js **>= 22** (runs TypeScript natively; dev box uses Node 24).
- The `go2rtc` binary at `bin/go2rtc` (download below).
- An NVR or ONVIF camera reachable on your LAN.

## Setup

```bash
# 1. Get go2rtc (Linux amd64 shown; see releases for other platforms)
mkdir -p bin
curl -fsSL -o bin/go2rtc \
  https://github.com/AlexxIT/go2rtc/releases/download/v1.9.15/go2rtc_linux_amd64
chmod +x bin/go2rtc

# 2. Credentials (gitignored). Create .env.local:
cat > .env.local <<'EOF'
NVR_USER=your_nvr_username
NVR_PASS=your_nvr_password
NVR_HOST=your_nvr_ip
EOF

# 3. (optional) install dev tooling for type-checking
npm install

# 4. Run
npm start
# open http://localhost:3000  (or http://<hub-lan-ip>:3000 from your phone)
```

### Running go2rtc separately (optional)

For deployments where go2rtc runs as its own service/container, start the hub with
`HUB_EXTERNAL_GO2RTC=1`. The hub then only writes `data/go2rtc.json` and proxies to
an already-running go2rtc on `127.0.0.1:1984`, instead of spawning its own.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `NVR_USER`, `NVR_PASS` | — | NVR / camera login (read from `.env.local`) |
| `HUB_PORT` | `3000` | Hub HTTP port |
| `HUB_HOST` | `0.0.0.0` | Bind address (use `127.0.0.1` to keep it local-only) |
| `NVR_HOST` | `192.168.1.100` | NVR IP, used when seeding `data/sources.json` on first run |
| `NVR_DVRIP_PORT` | `34567` | NVR DVRIP port |
| `HUB_EXTERNAL_GO2RTC` | unset | If set, don't spawn go2rtc; proxy to an external one |

Cameras are stored in `data/sources.json` (auto-seeded on first run). Credentials are
**never** stored there — only `${NVR_USER}` / `${NVR_PASS}` placeholders, expanded at
runtime into the generated `data/go2rtc.json`.

## Tested hardware

Developed against a **Xiongmai-family NVR** (RTSP banner `H264DVR 1.0`; ICSee / XMEye
ecosystem).

- **Protocol:** DVRIP on TCP **34567** (proprietary). go2rtc reads it directly:
  `dvrip://USER:PASS@NVR_IP:34567?channel=N&subtype=0` (subtype `0`=main HD, `1`=sub
  low-res). DVRIP is unencrypted — never port-forward 34567; reach the NVR only through
  the hub.
- **Channels:** the first-run seed creates 5 channels (0–4). Edit `data/sources.json`
  to match your NVR.
- **Codecs:** main and sub streams can be H.264 or H.265, and H.265 plays through MSE
  on browsers that decode it. Audio is G.711 (PCMU/PCMA), which browsers can't play
  natively, so audio will need transcoding or dropping later (currently video-first).

## Roadmap

- **M0 — Risk check** ✅ Proven: one NVR login, 5 cameras, browser-ready video via go2rtc.
- **M1 — MVP web view** 🚧 Live grid, fullscreen, main/sub toggle, LAN access. *(this)*
- **M2 — Daily use** PTZ, snapshots, authentication, settings, one-command install.
- **M3 — Phone + remote** Installable PWA over HTTPS; VPN (WireGuard/Tailscale) guide.
- **M4 — Events** ONVIF motion events; local browser notifications.
- **M5 — Recording/playback** Browse NVR recordings (DVRIP playback) + hub recording.
- **M6 — Native app** (optional) Capacitor/Flutter wrapper, background alerts.

Camera onboarding will become a 2–3 step flow (find → log in → confirm), with QR-code
add and subnet-scan discovery (needed because UDP multicast discovery doesn't cross
some networks, e.g. WSL2 and separate VLANs).

## Security notes

- The hub is the only thing exposed; cameras/NVR and go2rtc stay on localhost.
- Don't port-forward camera/NVR/DVRIP ports on your router.
- These cameras often phone home to vendor clouds on their own — block their internet
  access at the router if you want video to truly stay local.
- `.env.local`, `bin/`, `data/`, `node_modules/` and `PASSWORDS` are gitignored.

## License

[MIT](LICENSE).
