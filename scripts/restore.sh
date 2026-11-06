#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into this checkout and ~/.ownsee.
# Refuses to overwrite existing files unless --force is given.
#
# Usage, from the repo root:  bash scripts/restore.sh <ownsee-backup-*.tar.gz> [--force]
# Then follow "Restore" in docs/OPERATIONS.md (WireGuard config, service).
set -euo pipefail

ARCHIVE=${1:?usage: bash scripts/restore.sh <archive> [--force]}
FORCE=${2:-}
REPO=$(cd "$(dirname "$0")/.." && pwd)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
umask 077

tar -xzf "$ARCHIVE" -C "$STAGE"
echo "Backup created: $(cat "$STAGE/CREATED" 2>/dev/null || echo unknown)"

put() { # src dst label
  [[ -e $1 ]] || { echo "  - $3 (not in backup)"; return; }
  if [[ -e $2 && $FORCE != --force ]]; then
    echo "  ! $3 already exists, kept (use --force to overwrite)"
    return
  fi
  mkdir -p "$(dirname "$2")"
  rm -rf "$2"
  cp -a "$1" "$2"
  echo "  + $3"
}

echo "Restoring:"
put "$STAGE/hub/.env.local"        "$REPO/.env.local"        ".env.local"
put "$STAGE/hub/data/sources.json" "$REPO/data/sources.json" "data/sources.json"
put "$STAGE/hub/data/auth.json"    "$REPO/data/auth.json"    "data/auth.json"
put "$STAGE/hub/data/pki"          "$REPO/data/pki"          "data/pki/"
put "$STAGE/hub/data/wg"           "$REPO/data/wg"           "data/wg/"
put "$STAGE/home/.ownsee"          "$HOME/.ownsee"           "~/.ownsee/"
chmod 600 "$REPO/.env.local" "$REPO/data/auth.json" 2>/dev/null || true
chmod -R go-rwx "$REPO/data/pki" "$REPO/data/wg" "$HOME/.ownsee" 2>/dev/null || true
echo
echo "Next: docs/OPERATIONS.md, \"Restore on a new machine\" (WireGuard config + service)."
