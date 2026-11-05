# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Camera Hub is a self-hosted, ad-free ONVIF/NVR viewer: a small home hub serves a web UI so a phone or browser can watch cameras with no vendor cloud in the path. See `README.md` for setup, env vars, hardware findings and the roadmap (M0–M6).

## Commands

```bash
npm start        # node src/server.ts — the hub, on :3000; spawns bin/go2rtc
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

**Request routing** (`src/server.ts`): `/api/sources`, `/api/health`, `/api/recordings` and `/api/playback` (NVR recordings over DVRIP, see `src/dvrip.ts` and `src/playback.ts`), then `/go2rtc/*` (prefix stripped, proxied to go2rtc), then static files from `public/`. WebSocket upgrades are proxied separately in the `upgrade` handler, using a raw TCP pipe; the player depends on this. `/api/sources` goes through `sourcesView()`, which strips `src` so credentials never reach the client. Anything new that exposes sources must do the same.

**Frontend** (`public/`): vanilla ES modules with no dependencies. `app.js` imports go2rtc's `<video-stream>` component through the proxy (`/go2rtc/video-stream.js`) and points it at `/go2rtc/api/ws?src=<streamId>`. The player mode order puts MSE first, because that is what makes the H.265 channels play. The grid uses sub streams by default; the fullscreen viewer always uses main.

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
- **`HUB_PORT`/`HUB_HOST` are read when `config.ts` is imported, before `loadEnv()` runs**, so setting them in `.env.local` has no effect. Pass them in the real environment.
- **Seeding only happens when `data/sources.json` is missing or corrupt.** Changing `seedSources()` or `NVR_HOST` does nothing to an existing file; edit or delete the file (a corrupt file is silently overwritten by the seed).
- **Runtime source changes don't reach go2rtc yet:** `reloadGo2rtc()` and `saveSources()` exist for this, but nothing outside `sources.ts` calls them.
- **Hardware:** a Xiongmai NVR on DVRIP. Audio is G.711, which browsers can't play, so the app is video-first. DVRIP is unencrypted; never suggest exposing port 34567.

## Testing from WSL2 and Claude Code

- Development is on WSL2 on Windows 10. TCP to LAN devices works from WSL, but **UDP multicast does not**, so WS-Discovery gets no replies. Any discovery feature needs a subnet-scan mode too.
- Phones reach the hub through a Windows port forward: run `scripts/wsl-portproxy.ps1` in an elevated PowerShell, and re-run it after a reboot.
- The Claude Code Bash sandbox kills long-lived processes (exit 144, no output), including the hub and go2rtc. Verify in pieces with `npx tsc`, `node --check` and short foreground commands, and ask the user to run `npm start` in their own terminal for end-to-end checks.
