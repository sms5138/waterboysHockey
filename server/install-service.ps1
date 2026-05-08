# Install the Waterboys video server and Cloudflare Tunnel as Windows services using NSSM.
# Run this from an elevated PowerShell prompt:
#   PowerShell -ExecutionPolicy Bypass -File install-service.ps1
#
# Prereqs:
#   - Node.js LTS installed (so `node` is on PATH)
#   - cloudflared installed (winget install --id Cloudflare.cloudflared)
#   - You've already run `cloudflared tunnel login` and `cloudflared tunnel create waterboys`
#     and configured ~/.cloudflared/config.yml — see server/README.md for details.
#   - NSSM installed (winget install --id NSSM.NSSM) so `nssm` is on PATH.

$ErrorActionPreference = 'Stop'

$serverDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe     = (Get-Command node).Source
$cloudflared = (Get-Command cloudflared).Source

Write-Host "Installing 'WaterboysVideoServer' as a Windows service..."
nssm install WaterboysVideoServer $nodeExe "$serverDir\server.js"
nssm set WaterboysVideoServer AppDirectory $serverDir
nssm set WaterboysVideoServer Start SERVICE_AUTO_START
nssm set WaterboysVideoServer AppStdout "$serverDir\logs\server.out.log"
nssm set WaterboysVideoServer AppStderr "$serverDir\logs\server.err.log"
New-Item -ItemType Directory -Force -Path "$serverDir\logs" | Out-Null

Write-Host "Installing 'WaterboysCloudflared' as a Windows service..."
nssm install WaterboysCloudflared $cloudflared "tunnel run waterboys"
nssm set WaterboysCloudflared Start SERVICE_AUTO_START
nssm set WaterboysCloudflared AppStdout "$serverDir\logs\cloudflared.out.log"
nssm set WaterboysCloudflared AppStderr "$serverDir\logs\cloudflared.err.log"

Write-Host "Starting services..."
nssm start WaterboysVideoServer
nssm start WaterboysCloudflared

Write-Host "Done. Use 'nssm status WaterboysVideoServer' or Services.msc to check state."
Write-Host "To uninstall later: nssm remove WaterboysVideoServer confirm; nssm remove WaterboysCloudflared confirm"
