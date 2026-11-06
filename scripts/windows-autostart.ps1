# Start the WSL camera hub automatically when you log in to Windows.
#
# Run ONCE in an elevated PowerShell (Start -> "PowerShell" -> Run as administrator):
#   powershell -ExecutionPolicy Bypass -File \\wsl$\<Distro>\<path-to-repo>\scripts\windows-autostart.ps1
#
# It registers a scheduled task that, at each login:
#   1. starts the WSL distro (systemd then starts the hub and the WireGuard tunnel),
#   2. points the phone port forward (:3000) at WSL's current IP, which changes
#      after a reboot, and
#   3. keeps WSL running in the background, since WSL shuts an idle distro down.
#
# Remove with:  Unregister-ScheduledTask -TaskName "OwnSee hub" -Confirm:$false
param(
  [string]$Distro = "Ubuntu",
  [int]$Port = 3000
)
$ErrorActionPreference = "Stop"

$dir = Join-Path $env:ProgramData "OwnSee"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$boot = Join-Path $dir "boot.ps1"

# The script the task runs. Kept on the Windows disk so it works before WSL is up.
@"
`$ErrorActionPreference = 'Continue'
`$log = Join-Path '$dir' 'boot.log'
"`$(Get-Date -Format s) starting" | Out-File `$log
# Starting any command boots the distro; retry while WSL comes up.
for (`$i = 0; `$i -lt 30; `$i++) {
  `$ip = (wsl.exe -d $Distro --exec hostname -I) 2>`$null
  if (`$ip) { `$ip = `$ip.Trim().Split(' ')[0]; break }
  Start-Sleep -Seconds 2
}
if (`$ip) {
  netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>`$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=`$ip | Out-Null
  "`$(Get-Date -Format s) port $Port -> `$ip" | Out-File `$log -Append
} else {
  "`$(Get-Date -Format s) could not reach WSL" | Out-File `$log -Append
}
# Keep the distro alive (and with it the hub) for as long as you're logged in.
wsl.exe -d $Distro --exec sleep infinity
"@ | Set-Content -Encoding UTF8 $boot

if (-not (Get-NetFirewallRule -DisplayName "Camera Hub $Port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Camera Hub $Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$boot`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# Elevated, so it can update the port forward; runs as you, so it sees your WSL distro.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "OwnSee hub" -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "Starts the WSL camera hub and its phone port forward at login" -Force | Out-Null

Write-Host "Registered task 'OwnSee hub'. Starting it now..."
Start-ScheduledTask -TaskName "OwnSee hub"
Start-Sleep -Seconds 8
Get-Content (Join-Path $dir "boot.log")
Write-Host "`nIt will run at every login. Log: $dir\boot.log"
