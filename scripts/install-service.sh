#!/usr/bin/env bash
# Install the hub as a systemd service: it starts at boot (or when WSL
# starts) and restarts by itself if it ever stops.
#
# Usage, from the repo root, as your normal user (not root):
#   sudo bash scripts/install-service.sh "$(command -v node)"
#
# The node path is passed in because sudo drops version managers such as nvm
# from PATH. Re-run this after upgrading node to a new path.
# Logs:     journalctl -u ownsee-hub -f
# Control:  sudo systemctl restart|stop|status ownsee-hub
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
NODE=${1:-}
[[ -n $NODE && -x $NODE ]] || { echo "usage: sudo bash $0 \"\$(command -v node)\"" >&2; exit 1; }
USER_NAME=${SUDO_USER:?run via sudo from your normal user}
REPO=$(cd "$(dirname "$0")/.." && pwd)
[[ -f $REPO/src/server.ts ]] || { echo "can't find src/server.ts under $REPO" >&2; exit 1; }

UNIT=/etc/systemd/system/ownsee-hub.service
echo "== writing $UNIT (user $USER_NAME, $REPO)"
cat > "$UNIT" <<EOF
[Unit]
Description=OwnSee camera hub
# The tunnel is optional (LAN works without it), so only order after it.
After=network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$REPO
ExecStart=$NODE src/server.ts
Restart=always
RestartSec=3
# The hub stops go2rtc itself on SIGTERM; give it a moment.
TimeoutStopSec=10
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ownsee-hub.service
systemctl restart ownsee-hub.service
sleep 3
systemctl --no-pager --lines=8 status ownsee-hub.service || true
echo
echo "== done. Logs: journalctl -u ownsee-hub -f"
