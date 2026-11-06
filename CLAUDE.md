# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Camera Hub is a self-hosted, ad-free ONVIF/NVR viewer: a small home hub serves a web UI so a phone or browser can watch cameras with no vendor cloud in the path. See `README.md` for setup, env vars, hardware findings and the roadmap (M0–M6).

## Commands

In normal use the hub runs as the systemd service `ownsee-hub` (`scripts/install-service.sh`), not from a terminal. **Backup, restore, fresh install, VPS rebuild and the rules for handling secrets are in `docs/OPERATIONS.md`; follow it for any of those tasks.**

```bash
sudo systemctl restart ownsee-hub   # after code or .env.local changes; logs: journalctl -u ownsee-hub -f
npm start        # node src/server.ts — the hub, on :3000; spawns bin/go2rtc (stop the service first)
npm run dev      # same, with node --watch
npx tsc          # type-check only (noEmit); this is the only static check
```

There is no test suite, linter or build step. TypeScript runs directly on Node, and `public/` is served as-is. Verifying a change means `npx tsc` plus exercising it against the running hub or real hardware.

`bin/go2rtc` and `.env.local` (`NVR_USER`, `NVR_PASS`) are required at runtime and gitignored. `HUB_EXTERNAL_GO2RTC=1` makes the hub write the config and proxy to an already-running go2rtc instead of spawning one.

## Architecture

```
Browser/phone → hub (src/, public/) → go2rtc on 127.0.0.1:1984 → NVR (DVRIP :34567)
```

The hub does no video work. go2rtc converts camera streams for the browser; the hub supervises it, feeds it config and proxies to it. **The hub is the only public listener**: go2rtc's API stays on localhost and its RTSP/SRTP/WebRTC listeners are disabled. Keep it that way.

**Config flow.** `data/sources.json` (Source → Camera → Stream) is the source of truth for cameras. Each stream's `src` holds `${NVR_USER}`/`${NVR_PASS}` placeholders, never real credentials. On startup, `toGo2rtcStreams()` expands and URL-encodes them into `data/go2rtc.json`, which therefore *does* contain plaintext credentials. Stream `id`s (e.g. `ch0_main`) become go2rtc stream names, so they must be globally unique, and they are how the frontend addresses a stream.

**Request routing** (`src/server.ts`): two listeners share one handler. Plain HTTP on :3000 serves the home network; it has no authentication, so it refuses clients from the WireGuard tunnel (`HUB_TUNNEL_PREFIX`). HTTPS on :8443 (`src/tls-server.ts`) serves paired phones through the VPS; it requires a client certificate from the hub's own CA (`src/pki.ts`, `data/pki/`) and re-checks the paired-device list per connection and per request. Routes: `/api/sources`, `/api/health`, `/api/recordings` and `/api/playback` (NVR recordings over DVRIP, see `src/dvrip.ts` and `src/playback.ts`), then `/api/pair/*` and `/api/devices*` (pairing and revocation, `src/pairing.ts`; plain-HTTP listener only), then `/go2rtc/*` (prefix stripped, proxied to go2rtc), then static files from `public/`. WebSocket upgrades are proxied separately in the `upgrade` handler, using a raw TCP pipe; the player depends on this. `/api/sources` goes through `sourcesView()`, which strips `src` so credentials never reach the client. Anything new that exposes sources must do the same.

**Frontend** (`public/`): vanilla ES modules with no dependencies. `app.js` imports go2rtc's `<video-stream>` component through the proxy (`/go2rtc/video-stream.js`) and points it at `/go2rtc/api/ws?src=<streamId>`. The player mode order puts MSE first, because that is what makes the H.265 channels play. The page is one view: the selected camera on the main stream, the others below on sub streams, and that camera's recordings picked by day and hour. Fonts are self-hosted in `public/fonts/`, so the page makes no third-party requests.

**Languages:** en-US and pt-BR only. Every user-facing string goes in both: `public/i18n.js` for the web, `res/values/` and `res/values-pt/` for Android (`values-pt` so pt-PT phones get Portuguese too). Format dates from the language the UI is showing, not the device locale: `i18n.js` on the web, `ui/Dates.kt` on Android. Times stay 24-hour to match the NVR and the cameras' burned-in clock. File names keep ISO dates so they sort. Hub API errors are technical English; the clients translate the ones people hit in normal use, by status code.

## Android app (`android/`)

Native Kotlin app (app id `org.ownsee.app`): Jetpack Compose UI, Media3/ExoPlayer for video, no WebView. It is a second client of the same hub HTTP API as `public/`.

```bash
cd android && ANDROID_HOME=~/Android/Sdk ./gradlew assembleDebug --no-daemon   # → app/build/outputs/apk/debug/app-debug.apk
adb connect <phone-ip>:<port> && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- **AGP 9 compiles Kotlin itself.** Don't add the `org.jetbrains.kotlin.android` plugin; only the Compose compiler plugin is applied, and its version (in `gradle/libs.versions.toml`) sets the Kotlin version.
- **compileSdk is 37** because current AndroidX libraries require it; targetSdk stays 36.
- **Screens:** Home (`GridScreen`) is the live grid on sub streams; tapping a camera opens `ViewerScreen`, which starts live on main and plays recordings in place. Colours, type and shared controls are in `ui/Theme.kt`; the fonts are bundled in `res/font` (no downloadable fonts, which would call Google).
- **Live video uses `/go2rtc/api/stream.mp4?src=<id>&mp4`.** The bare `mp4` flag is required: without it go2rtc offers H.264 only, and H.265 streams never start.
- **Plain HTTP:** the network security config allows cleartext globally (Android can't scope it to IP ranges), and `HubAddress.normalize()` rejects plain-HTTP hub addresses that aren't private. Keep both until the hub serves HTTPS.
- `android/local.properties` holds the machine's SDK path and is gitignored.
- Install over Wi-Fi with adb wireless debugging. Connecting through the WireGuard tunnel address doesn't work (the phone accepts no inbound connections there).

## Public repo: no personal information

This repo is public and open source. **Never commit personal information or IP addresses**, including in code defaults, comments, docs, test fixtures and commit messages. That covers:

- Real IPs, even private LAN ones, plus hostnames and MAC addresses of the owner's network or devices
- Credentials and tokens
- Names, email addresses, and local paths such as home directories
- Camera inventories or anything else describing the owner's own setup

Keep real values in gitignored `.env.local` or `data/`, and use placeholders in tracked files (`NVR_IP`, `your_nvr_ip`). Before committing, stage explicit paths rather than `git add -A`, because other sessions may be working in this folder, and read `git diff --cached`. Stop if anything above appears. Commits use the GitHub noreply address set in this repo's git config.

## Gotchas

- **Node type stripping:** only erasable TypeScript works (no `enum`, no parameter properties, no `namespace`). Imports must use the `.ts` extension, and type-only imports need `import type` (`verbatimModuleSyntax`).
- **Service worker is network-first** for everything except `/api/` and `/go2rtc/` (it falls back to the cached shell only when offline). A reload picks up edits to `public/`, though the first reload after a service worker change may still show the old page. Bump `CACHE` in `public/sw.js` when the shell list changes, and add new shell files to `SHELL`.
- **`HUB_PORT`/`HUB_HOST` are read when `config.ts` is imported, before `loadEnv()` runs**, so setting them in `.env.local` has no effect. Pass them in the real environment. Newer settings (`HUB_PUBLIC_URL`, `HUB_LAN_URL`, `HUB_TLS*`, `HUB_TUNNEL_PREFIX`) are read at use time, so `.env.local` works for them; keep it that way.
- **Pairing security model:** the phone's key is generated in the Android Keystore and only a CSR is sent; the pairing QR carries the CA fingerprint the app verifies. Never add an endpoint that hands out private keys, and keep `/api/pair/*` off the HTTPS listener. The app accepts the server only if its certificate names `hub.ownsee` (`SERVER_NAME` in `pki.ts` and `Tls.kt` must match).
- **Revocation must cut live streams:** `revokeDevice()` notifies `onRevoke` listeners, which destroy that device's open TLS sockets. A keep-alive connection otherwise outlives the handshake check.
- **Seeding only happens when `data/sources.json` is missing or corrupt.** Changing `seedSources()` or `NVR_HOST` does nothing to an existing file; edit or delete the file (a corrupt file is silently overwritten by the seed).
- **Runtime source changes don't reach go2rtc yet:** `reloadGo2rtc()` and `saveSources()` exist for this, but nothing outside `sources.ts` calls them.
- **Hardware:** a Xiongmai NVR on DVRIP. Audio is G.711, which browsers can't play, so the app is video-first. DVRIP is unencrypted; never suggest exposing port 34567.

## Testing from WSL2 and Claude Code

- Development is on WSL2 on Windows 10. TCP to LAN devices works from WSL, but **UDP multicast does not**, so WS-Discovery gets no replies. Any discovery feature needs a subnet-scan mode too.
- Phones reach the hub through a Windows port forward: run `scripts/wsl-portproxy.ps1` in an elevated PowerShell, and re-run it after a reboot.
- The Claude Code Bash sandbox kills long-lived processes (exit 144, no output), including the hub and go2rtc. Verify in pieces with `npx tsc`, `node --check` and short foreground commands, and ask the user to run `npm start` in their own terminal for end-to-end checks.
