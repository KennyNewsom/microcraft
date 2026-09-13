param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory

try {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $playitService = Get-Service -Name playitd -ErrorAction Stop
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory '.tools\viaproxy\plugins\MicrocraftIdentity.jar'))) {
        throw 'Run npm.cmd run setup:versions first.'
    }
    if ($CheckOnly) {
        Write-Host "Project: $projectDirectory"
        Write-Host "Node: $($nodeCommand.Source)"
        Write-Host "playit service: $($playitService.Status)"
        Write-Host 'Launcher checks passed. No programs started.'
        exit 0
    }

    if ($playitService.Status -ne 'Running') {
        Write-Host 'Starting playit.gg. Windows may request administrator permission for its service.'
        try { Start-Service -Name playitd -ErrorAction Stop }
        catch {
            # Elevate only service startup; the Minecraft server runs normally.
            $serviceStarter = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
                '-NoProfile', '-Command', '"try { Start-Service -Name playitd -ErrorAction Stop } catch { exit 1 }"'
            )
            if ($serviceStarter.ExitCode -ne 0) { throw 'Could not start playit.gg.' }
        }
        $playitService.Refresh()
        $playitService.WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
    }

    $runningBridge = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -match 'host[/\\]server\.js'
    })
    if ($runningBridge.Count -gt 0) {
        Write-Host 'A Microcraft bridge is already running. playit.gg is running; no duplicate server started.'
        exit 0
    }
    # The board is already running its firmware and waiting for the startup handshake.
    $env:MICROCRAFT_PORT = 'COM5'
    $env:MICROCRAFT_BAUD = '230400'
    $env:MICROCRAFT_HOST = '127.0.0.1'
    $env:MICROCRAFT_LISTEN_PORT = '25565'
    $env:MICROCRAFT_ONLINE_MODE = 'true'
    $env:MICROCRAFT_COMPAT = 'true'
    Write-Host 'Starting Microcraft. The 10,000-packet check takes about 70 seconds.'
    Write-Host 'Join: schmidt-eq.tun.ply.gg   (Java 26.1 or 26.2)'
    Write-Host 'Keep this window open. Press Ctrl+C to stop the server.'
    & $nodeCommand.Source (Join-Path $projectDirectory 'host\server.js') --playit
    exit $LASTEXITCODE
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
