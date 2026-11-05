# Expose the WSL2 Camera Hub to your LAN (phone access).
# Run in an ELEVATED PowerShell on Windows (not inside WSL):
#   Start menu -> type "PowerShell" -> right-click -> Run as administrator
#   Then:  powershell -ExecutionPolicy Bypass -File \\wsl$\... (or copy-paste the block below)
# Re-run after a reboot (WSL's IP can change). The hub itself runs in WSL via `npm start`.

$Port = 3000
$wslIp = (wsl hostname -I).Trim().Split(" ")[0]
if (-not $wslIp) { Write-Error "Could not get WSL IP. Is WSL running?"; exit 1 }

Write-Host "Forwarding Windows :$Port  ->  WSL $wslIp`:$Port"
netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null | Out-Null
netsh interface portproxy add    v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=$wslIp

if (-not (Get-NetFirewallRule -DisplayName "Camera Hub $Port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Camera Hub $Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
  Write-Host "Added firewall rule 'Camera Hub $Port'."
}

Write-Host "`nActive port forwards:"
netsh interface portproxy show v4tov4
$lan = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -First 1).IPAddress
Write-Host "`nOn your phone (same Wi-Fi) open:  http://$lan`:$Port"
