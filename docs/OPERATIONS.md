# Operations: backup, restore, fresh install

For people and coding agents running an OwnSee hub. Commands assume the repo
root as the working directory. Placeholders: `<vps-ip>`, `<hub-lan-ip>`,
`<user>`.

## What state exists

The repo holds code only. Everything below lives outside git and is what a
backup must cover.

| What | Where | If lost |
| --- | --- | --- |
| **Android release signing key** | `~/.ownsee/release.jks`, `~/.ownsee/signing.properties` | **Can't be recreated.** Updates can no longer install over the existing app; every phone must uninstall, reinstall and re-pair. |
| Hub certificate authority + paired phones | `data/pki/` | Every phone must re-pair. |
| WireGuard keys and configs | `data/wg/`, copy in `/etc/wireguard/wg0.conf` | Make new keys and re-run the VPS setup. |
| NVR login, hub addresses | `.env.local` | Re-enter by hand. |
| Camera list | `data/sources.json` | Re-seeded with defaults; re-edit names. |
| Published APK | `data/app/` | Rebuild with `scripts/publish-apk.sh`. Not backed up. |
| go2rtc config | `data/go2rtc.json` | Regenerated at every start. Not backed up. |
| go2rtc binary | `bin/go2rtc` | Download again. Not backed up. |
| VPS state | VPS `/etc/wireguard/`, `ownsee-https.*` units | Re-run the two VPS scripts (see "VPS rebuilt or moved"). |

## Backup

When: after pairing or revoking a phone, after changing cameras or `.env.local`,
and after creating the signing key. Monthly otherwise.

```bash
bash scripts/backup.sh            # writes ~/ownsee-backup-<date>.tar.gz (mode 600)
```

1. Store the archive in a password manager. In 1Password, use a **Document**
   item named "OwnSee – hub backup" and replace the file each time.
2. Delete the local copy: `rm ~/ownsee-backup-*.tar.gz`. It contains private
   keys and the NVR password in plain form.
3. Keep the signing key in its **own** item as well ("OwnSee – Android signing
   key", Document, with `release.jks` attached and a concealed `password` field
   holding `storePassword`, alias `ownsee`). It is the one file nothing can
   replace, so it shouldn't depend on a single archive.

## Restore on a new machine (for example, moving to a mini PC)

Target: Debian 12+ or Ubuntu 24.04+. The new machine takes over the old hub's
identity (same WireGuard key, same tunnel address, same CA), so the VPS and the
paired phones need no changes.

1. **Packages**
   ```bash
   sudo apt install -y git curl ffmpeg openssl qrencode wireguard-tools
   ```
   Node 24 or newer: through nvm (`nvm install 24`) or your distribution's
   packages. Check with `node -v`.

2. **Code and go2rtc**
   ```bash
   git clone <repo-url> ownsee && cd ownsee
   mkdir -p bin
   curl -fL -o bin/go2rtc https://github.com/AlexxIT/go2rtc/releases/download/v1.9.15/go2rtc_linux_amd64
   chmod +x bin/go2rtc
   ```
   Use `go2rtc_linux_arm64` on ARM boards.

3. **Restore the backup.** Download it from the password manager, then:
   ```bash
   bash scripts/restore.sh ~/ownsee-backup-<date>.tar.gz
   rm ~/ownsee-backup-<date>.tar.gz
   ```

4. **Update the home address** in `.env.local`: `HUB_LAN_URL=http://<hub-lan-ip>:3000`
   (the new machine's IP). Give the machine a fixed IP (DHCP reservation) in the
   router.

5. **Stop the old hub first.** Two machines with the same WireGuard key fight
   over the tunnel. On the old machine:
   `sudo systemctl disable --now ownsee-hub wg-quick@wg0`. On Windows/WSL, also
   remove the login task (see "Windows/WSL hosts").

6. **Tunnel**
   ```bash
   sudo install -m 600 data/wg/home.conf /etc/wireguard/wg0.conf
   sudo systemctl enable --now wg-quick@wg0
   ping -c3 10.66.0.1          # the VPS, through the tunnel
   ```

7. **Hub service**
   ```bash
   sudo bash scripts/install-service.sh "$(command -v node)"
   ```

8. **Verify**
   - `curl -s http://127.0.0.1:3000/api/health` returns `{"ok":true,...}`
   - `journalctl -u ownsee-hub -n 20` shows both `listening on http://…:3000`
     and `HTTPS (paired devices only)`
   - `curl -skv https://<vps-ip>:8443/api/health 2>&1 | grep -i 'certificate required'`
     prints a line. That means the hub answered through the VPS and refused a
     client without a certificate, which is correct.
   - Phone on mobile data: OwnSee shows "Remote · encrypted".

9. **Phones at home.** The app saved the old machine's LAN address at pairing.
   Until it's updated, it falls back to the remote route at home too (it works,
   but goes through the VPS). Re-pair each phone once to store the new home
   address, then revoke its old entry in Phones.

10. **Publish the app** (only on the machine that builds releases; needs the
    Android SDK, see README):
    `bash scripts/publish-apk.sh`.

## Fresh install with no backup

Same as above, but instead of step 3:

- Create `.env.local` with `NVR_USER`, `NVR_PASS`, `HUB_PUBLIC_URL`,
  `HUB_LAN_URL` (see README, Configuration). `chmod 600 .env.local`.
- The CA in `data/pki/` and `data/sources.json` are created on first start.
- WireGuard keys:
  ```bash
  mkdir -p data/wg && chmod 700 data/wg
  wg genkey | tee data/wg/home.key | wg pubkey > data/wg/home.pub
  chmod 600 data/wg/home.key
  ```
  Run `scripts/wg-vps-setup.sh` on the VPS with
  `home:10.66.0.2:$(cat data/wg/home.pub)`, then write `data/wg/home.conf`
  (template in README, "Remote access") with the VPS public key it prints.
- If the signing key is gone, a new one means every phone reinstalls. Create it
  only if the old one is truly lost (`keytool -genkeypair`, as done in the
  project history), and back it up immediately.

## VPS rebuilt or moved

1. Copy `scripts/wg-vps-setup.sh` and `scripts/vps-https-forward.sh` to the VPS.
2. `sudo bash wg-vps-setup.sh home:10.66.0.2:<home_pubkey>`. A new VPS has a new
   server key: put the printed public key and the new `Endpoint` into
   `data/wg/home.conf` and `/etc/wireguard/wg0.conf`, then
   `sudo systemctl restart wg-quick@wg0`.
3. `sudo bash vps-https-forward.sh`, and open UDP 51820 and TCP 8443 in any cloud
   firewall.
4. If the VPS **address** changed: update `HUB_PUBLIC_URL` in `.env.local`,
   restart the hub, and re-pair the phones (they store the remote address).

## Routine operations

| Task | Command |
| --- | --- |
| Logs | `journalctl -u ownsee-hub -f` |
| Restart after a code change or `.env.local` edit | `sudo systemctl restart ownsee-hub` |
| Update the hub | `git pull && sudo systemctl restart ownsee-hub` |
| Release a new app version | bump `versionCode`/`versionName` in `android/app/build.gradle.kts`, then `bash scripts/publish-apk.sh` |
| Pair / revoke a phone | web UI → Phones (home network only) |
| Tunnel status | `sudo wg show` (latest handshake under 2 minutes = up) |

## Windows/WSL hosts

- Hub and tunnel run as systemd services inside WSL, as above.
- `scripts/windows-autostart.ps1` (run once, elevated) registers the "OwnSee
  hub" task. At each login it starts WSL, points the phone port forward at
  WSL's current IP, and keeps WSL alive. Log: `C:\ProgramData\OwnSee\boot.log`.
- It starts at **login**, not boot. Set Windows sleep to "Never" while plugged in.
- Remove: `Unregister-ScheduledTask -TaskName "OwnSee hub" -Confirm:$false`.

## Rules for agents

- **Never print, copy into chat, or commit** the contents of `.env.local`,
  `data/pki/*.key`, `data/wg/*.key`, `data/wg/*.conf`, `~/.ownsee/*` or backup
  archives. Refer to them by path. Public keys and certificate fingerprints are
  fine to show.
- Backups contain secrets. Write them only to the user's home or a scratch
  directory, never inside the repo, and remind the user to delete the local
  copy after storing it.
- **Ask before** anything that changes the VPS, rotates keys, revokes devices,
  or replaces the signing key. These lock phones out or force reinstalls.
- Don't run two hubs with the same WireGuard key at once.
- Restarting the hub service needs sudo. Without it, an agent can stop the
  process (`kill $(systemctl show -p MainPID --value ownsee-hub)`) and systemd
  restarts it within seconds. That briefly drops all camera streams, so say so.
