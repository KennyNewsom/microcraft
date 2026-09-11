$ErrorActionPreference = 'Stop'
# Permit only this server program/port and the currently requested home subnet.
$ruleName = 'Microcraft-Home-LAN-25565'
if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $ruleName -DisplayName 'Microcraft LAN' -Direction Inbound `
        -Action Allow -Protocol TCP -LocalPort 25565 -RemoteAddress 192.168.1.0/24 `
        -LocalAddress 192.168.1.148 -Program 'C:\Program Files\nodejs\node.exe' -Profile Any
}
Get-NetFirewallRule -Name $ruleName | Select-Object DisplayName, Enabled
