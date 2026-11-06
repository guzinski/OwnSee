#!/usr/bin/env bash
# Set (or change) the hub's admin password: needed to use the web page and to
# pair phones on the home network. Paired phones don't need it.
# Changing it logs out every browser. No hub restart needed.
#
# Usage, from the repo root:  bash scripts/set-password.sh
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
read -rsp "New hub password (at least 8 characters): " p1; echo
read -rsp "Same again: " p2; echo
if [[ "$p1" != "$p2" ]]; then echo "They don't match. Nothing changed." >&2; exit 1; fi
cd "$REPO" && printf '%s' "$p1" | node src/set-password.ts
