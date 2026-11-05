#!/usr/bin/env bash
# Set up the VPS side of Camera Hub remote access: a WireGuard relay.
#
# The home hub and your phone both connect OUT to this VPS; the VPS forwards
# traffic between them inside the tunnel only. Nothing at home is exposed and
# no router port is opened.
#
# Usage (on the VPS):
#   sudo bash wg-vps-setup.sh <peer> [<peer> ...]
#   peer = name:tunnel_ip:public_key   e.g. home:10.66.0.2:AbC...=
#
# Re-running is safe: the server key is kept, the peer list is rewritten.
set -euo pipefail

WG_IF=wg0
WG_PORT=${WG_PORT:-51820}
WG_NET=10.66.0
CONF=/etc/wireguard/$WG_IF.conf

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
[[ $# -ge 1 ]] || { echo "usage: $0 name:ip:pubkey ..." >&2; exit 1; }

echo "== installing wireguard-tools"
command -v wg >/dev/null || { apt-get update -qq && apt-get install -y -qq wireguard-tools; }

umask 077
mkdir -p /etc/wireguard
if [[ ! -s /etc/wireguard/server.key ]]; then
  echo "== generating server key"
  wg genkey > /etc/wireguard/server.key
fi
wg pubkey < /etc/wireguard/server.key > /etc/wireguard/server.pub

echo "== writing $CONF"
{
  echo "[Interface]"
  echo "Address = $WG_NET.1/24"
  echo "ListenPort = $WG_PORT"
  echo "PrivateKey = $(cat /etc/wireguard/server.key)"
  for p in "$@"; do
    IFS=: read -r name ip pub <<<"$p"
    [[ $ip == $WG_NET.* && -n $pub ]] || { echo "bad peer: $p" >&2; exit 1; }
    echo
    echo "[Peer]"
    echo "# $name"
    echo "PublicKey = $pub"
    echo "AllowedIPs = $ip/32"
  done
} > "$CONF"

echo "== enabling IPv4 forwarding (needed to relay phone <-> home)"
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-camhub-wireguard.conf
sysctl -q -p /etc/sysctl.d/99-camhub-wireguard.conf

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "== ufw: allow $WG_PORT/udp in, and forwarding only wg0 -> wg0"
  ufw allow "$WG_PORT/udp" comment "camhub wireguard" >/dev/null
  ufw route allow in on "$WG_IF" out on "$WG_IF" comment "camhub peer-to-peer" >/dev/null
fi

echo "== starting wg-quick@$WG_IF"
systemctl enable -q "wg-quick@$WG_IF"
systemctl restart "wg-quick@$WG_IF"

# Copy the public key somewhere the invoking user can read it without sudo.
if [[ -n ${SUDO_USER:-} ]]; then
  install -m 644 -o "$SUDO_USER" /etc/wireguard/server.pub "$(getent passwd "$SUDO_USER" | cut -d: -f6)/wg-server.pub"
fi

echo
echo "== done. server public key: $(cat /etc/wireguard/server.pub)"
wg show "$WG_IF"
echo
echo "== ufw rules (review):"
ufw status verbose 2>/dev/null || true
echo
echo "If your provider also has a cloud firewall (security group), allow UDP $WG_PORT there too."
