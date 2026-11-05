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
| `HUB_TLS_PORT` | `8443` | HTTPS listener for paired phones (remote access) |
| `HUB_TLS` | on | Set to `0` to disable the HTTPS listener |
| `HUB_PUBLIC_URL` | unset | Remote address phones use, e.g. `https://<vps-ip>:8443`; goes into the pairing QR |
| `HUB_LAN_URL` | page origin | Home address phones use, e.g. `http://<hub-lan-ip>:3000`. Needed when you open the web UI via `localhost` |
| `HUB_TUNNEL_PREFIX` | `10.66.0.` | Clients from this prefix (the WireGuard tunnel) are refused on the plain-HTTP port |

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

## Remote access (HTTPS through your own VPS)

Away from home, the phone talks HTTPS to the hub through a small VPS you control.
No router port is opened and the phone needs no VPN app.

```
Phone ──HTTPS + device cert──► VPS :8443 ══ WireGuard (opened from home) ══► Hub :8443 ──LAN──► NVR
                               (forwards bytes, can't decrypt)
```

- **The hub dials out.** It keeps a WireGuard tunnel open to the VPS, so the VPS can
  reach it without any inbound port at home. The VPS forwards TCP 8443 into that tunnel
  with `systemd-socket-proxyd`. TLS runs end to end between phone and hub.
- **The hub is its own certificate authority** (`data/pki/`, gitignored). It signs its
  server certificate and one client certificate per paired phone. The app trusts only
  this CA; no domain, Let's Encrypt or Cloudflare is involved.
- **Only paired devices get in.** The HTTPS listener requires a client certificate from
  that CA *and* checks the paired-device list on every connection and request.
  Revoking a phone in the web UI cuts its open streams immediately.
- **Pairing happens at home.** Web UI → **Devices** → **Pair a phone** shows a one-time
  QR code (10 minutes, single use) with the hub's addresses and the CA fingerprint. The
  app creates its key in the Android Keystore (hardware-backed, never leaves the phone),
  sends only a certificate request, and checks the returned CA against the fingerprint.
- **The plain-HTTP port stays home-only.** It has no authentication, so it refuses
  clients coming through the tunnel; from outside, HTTPS with a paired device is the
  only way in.

Setup:

1. **VPS tunnel:** copy `scripts/wg-vps-setup.sh` to the VPS and run
   `sudo bash wg-vps-setup.sh home:10.66.0.2:<home_pubkey>`. It installs WireGuard and
   opens UDP 51820 in ufw (open it in any cloud firewall too).
2. **Hub tunnel:** install `wireguard-tools`, put the home config in
   `/etc/wireguard/wg0.conf` (`Address = 10.66.0.2/32`, peer = VPS,
   `AllowedIPs = 10.66.0.0/24`, `PersistentKeepalive = 25`) and
   `systemctl enable --now wg-quick@wg0`. Keep keys in `data/wg/` (gitignored).
3. **VPS forward:** copy `scripts/vps-https-forward.sh` and run it with sudo. It forwards
   TCP 8443 to `10.66.0.2:8443` and opens 8443 in ufw.
4. **Hub:** set `HUB_PUBLIC_URL=https://<vps-ip>:8443` (and `HUB_LAN_URL` if needed) in
   `.env.local`, then restart. The CA is created on first start (needs `openssl`;
   `qrencode` draws the pairing QR).
5. **Phone:** install the app, then pair from the web UI's Devices dialog.

Pick a VPS close to you: every request crosses it twice.

**Without the app (browser only):** you can put the phone itself in the tunnel with the
WireGuard app (add it as a peer with `wg-vps-setup.sh`; use `AllowedIPs = 10.66.0.0/24`
and no `DNS` line) and open `http://10.66.0.2:3000`. That skips client certificates,
because the plain-HTTP port has no authentication, so the hub refuses tunnel clients by
default. Set `HUB_TUNNEL_PREFIX=` (empty) in `.env.local` to allow it.

## Android app

`android/` is a native Kotlin app (Jetpack Compose, Media3/ExoPlayer). The phone's
hardware decodes both H.264 and H.265. It shows the live grid, an HD viewer with
fullscreen, NVR playback, and QR pairing; it uses the LAN address at home and HTTPS away.

```bash
cd android && ANDROID_HOME=~/Android/Sdk ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 17+ and the Android SDK (command-line tools are enough).

## Roadmap

- **M0 — Risk check** ✅ Proven: one NVR login, 5 cameras, browser-ready video via go2rtc.
- **M1 — MVP web view** 🚧 Live grid, fullscreen, main/sub toggle, LAN access. *(this)*
- **M2 — Daily use** PTZ, snapshots, authentication, settings, one-command install.
- **M3 — Phone + remote** ✅ HTTPS through your own VPS, per-device client certificates, QR pairing, revocation. Next: web login for the LAN page, run as a service.
- **M4 — Events** ONVIF motion events; local browser notifications.
- **M5 — Recording/playback** Browse NVR recordings (DVRIP playback) + hub recording.
- **M6 — Native Android app** 🚧 v0.2: live grid, viewer, playback, QR pairing, home/remote routing. Next: release signing, timeline, push alerts.

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
