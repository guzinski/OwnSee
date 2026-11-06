#!/usr/bin/env bash
# Back up everything that can't be recreated from the repo, into one archive.
# Store it in a password manager (e.g. a 1Password "Document" item), then
# delete the local copy. The archive contains secrets in plain form.
#
# Usage, from the repo root:  bash scripts/backup.sh [output-dir]
# Restore with:               bash scripts/restore.sh <archive>
# What's inside and why: docs/OPERATIONS.md
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR=${1:-$HOME}
STAMP=$(date +%Y%m%d-%H%M)
ARCHIVE=$OUT_DIR/ownsee-backup-$STAMP.tar.gz
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
umask 077

mkdir -p "$STAGE/hub/data" "$STAGE/home"
copy() { [[ -e $1 ]] && cp -a "$1" "$2" && echo "  + $3" || echo "  - $3 (not found, skipped)"; }

echo "Collecting:"
copy "$REPO/.env.local"          "$STAGE/hub/"       ".env.local            NVR login, hub URLs"
copy "$REPO/data/sources.json"   "$STAGE/hub/data/"  "data/sources.json     camera list"
copy "$REPO/data/pki"            "$STAGE/hub/data/"  "data/pki/             hub CA + paired phones"
copy "$REPO/data/wg"             "$STAGE/hub/data/"  "data/wg/              WireGuard keys + configs"
copy "$HOME/.ownsee"             "$STAGE/home/"      "~/.ownsee/            Android release signing key"
date -Iseconds > "$STAGE/CREATED"

tar -czf "$ARCHIVE" -C "$STAGE" .
chmod 600 "$ARCHIVE"
echo
echo "Wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo "It contains private keys and the NVR password: store it in your password manager,"
echo "then delete this file:  rm '$ARCHIVE'"
