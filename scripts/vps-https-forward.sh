#!/usr/bin/env bash
# Forward the hub's HTTPS port from the VPS, through the WireGuard tunnel, to
# the hub at home. Run after wg-vps-setup.sh.
#
# The VPS only relays TCP bytes: TLS runs end to end between the phone and the
# hub, so the VPS can't read the traffic, and the hub (not the VPS) decides who
# gets in, by client certificate. Uses systemd-socket-proxyd, which ships with
# systemd, so nothing is installed.
#
# Usage (on the VPS):  sudo bash vps-https-forward.sh [hub_tunnel_ip] [port]
set -euo pipefail

HUB_IP=${1:-10.66.0.2}
PORT=${2:-8443}

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
PROXYD=/usr/lib/systemd/systemd-socket-proxyd
[[ -x $PROXYD ]] || PROXYD=/lib/systemd/systemd-socket-proxyd
[[ -x $PROXYD ]] || { echo "systemd-socket-proxyd not found" >&2; exit 1; }

echo "== writing ownsee-https.socket / .service ($PORT -> $HUB_IP:$PORT)"
cat > /etc/systemd/system/ownsee-https.socket <<EOF
[Unit]
Description=OwnSee: accept HTTPS for the home hub on port $PORT

[Socket]
ListenStream=$PORT

[Install]
WantedBy=sockets.target
EOF

cat > /etc/systemd/system/ownsee-https.service <<EOF
[Unit]
Description=OwnSee: relay HTTPS to the home hub through WireGuard
Requires=ownsee-https.socket
After=ownsee-https.socket wg-quick@wg0.service

[Service]
ExecStart=$PROXYD $HUB_IP:$PORT
DynamicUser=yes
PrivateTmp=yes
NoNewPrivileges=yes
EOF

systemctl daemon-reload
systemctl enable --now ownsee-https.socket
systemctl restart ownsee-https.socket

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "== ufw: allow $PORT/tcp"
  ufw allow "$PORT/tcp" comment "ownsee hub https (client certs required)" >/dev/null
fi

echo
systemctl --no-pager status ownsee-https.socket | head -5
echo
echo "== done. Phones use https://<this-vps-ip>:$PORT (set HUB_PUBLIC_URL on the hub)."
echo "If your provider also has a cloud firewall (security group), allow TCP $PORT there too."
