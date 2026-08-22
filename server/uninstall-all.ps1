<#
.SYNOPSIS
  Removes everything the Waterboys video server install put on this machine.

.DESCRIPTION
  Tears down, in order:
    1. Running Waterboys.exe / node / cloudflared processes
    2. The NSSM services WaterboysVideoServer and WaterboysCloudflared
    3. The four "Waterboys: ..." Windows Firewall rules
    4. NTFS grant/deny ACEs for WaterboysSvc (video roots, ProgramData, Plex,
       user-data folders)
    5. The local WaterboysSvc account and its profile
    6. The Cloudflare tunnel named "waterboys" (cleanup + delete -f)
    7. %PROGRAMDATA%\Waterboys (config.json, logs, mirrored .cloudflared)
    8. The tunnel bits in %USERPROFILE%\.cloudflared
    9. The Electron app itself via its NSIS uninstaller, plus %APPDATA%\Waterboys

  It never touches your video files.

.PARAMETER RemovePrereqs
  Also winget-uninstall NSSM, cloudflared, and Node.js. Off by default - other
  software on this box probably uses Node.

.PARAMETER KeepCloudflareLogin
  Keep %USERPROFILE%\.cloudflared\cert.pem (your Cloudflare account login) so
  you don't have to re-auth in a browser if you reinstall later.

.PARAMETER Yes
  Skip the confirmation prompt.

.EXAMPLE
  Open this file in PowerShell ISE (started with "Run as administrator") and
  press F5.

.EXAMPLE
  PowerShell -ExecutionPolicy Bypass -File uninstall-all.ps1

.NOTES
  Everything here needs Administrator. From a normal console the script
  re-launches itself elevated; from PowerShell ISE it stops and asks you to
  restart ISE as administrator, since a relaunch would open a separate window
  and you'd lose the output.
  The DNS CNAME for api.waterboyshockey.com is NOT removed - deleting it needs
  Cloudflare API access this script doesn't have. Remove it in the Cloudflare
  dashboard (DNS -> the api record) if you want it gone.
#>

[CmdletBinding()]
param(
  [switch]$RemovePrereqs,
  [switch]$KeepCloudflareLogin,
  [switch]$Yes
)

$ErrorActionPreference = 'Continue'

# --------------------------------------------------------------------------
# Constants - these mirror admin/lib/*.js and must stay in sync with it.
# --------------------------------------------------------------------------
$SERVER_SVC   = 'WaterboysVideoServer'
$TUNNEL_SVC   = 'WaterboysCloudflared'
$SERVICE_USER = 'WaterboysSvc'
$TUNNEL_NAME  = 'waterboys'
$PRODUCT      = 'Waterboys'

$FIREWALL_RULES = @(
  'Waterboys: deny node outbound',
  'Waterboys: allow node loopback',
  'Waterboys: allow cloudflared outbound',
  'Waterboys: deny cloudflared LAN'
)

$ConfigDir = Join-Path $(if ($env:PROGRAMDATA) { $env:PROGRAMDATA } else { 'C:\ProgramData' }) $PRODUCT
$LogsDir   = Join-Path $ConfigDir 'logs'
$CfHome    = Join-Path $env:USERPROFILE '.cloudflared'

# --------------------------------------------------------------------------
# Plumbing
# --------------------------------------------------------------------------
$script:Failures = 0

function Write-Head($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "   [ ok ] $text" -ForegroundColor Green }
function Write-Skip($text) { Write-Host "   [skip] $text" -ForegroundColor DarkGray }
function Write-Bad($text)  { Write-Host "   [fail] $text" -ForegroundColor Yellow; $script:Failures++ }

# $Check is an optional predicate: when it returns $false the step is reported
# as skipped instead of run.
function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Action,
    [scriptblock]$Check = $null,
    [switch]$Quiet          # don't count a throw as a failure (best-effort steps)
  )
  if ($Check -and -not (& $Check)) { Write-Skip "$Label (not present)"; return }
  try {
    & $Action | Out-Null
    Write-Ok $Label
  } catch {
    if ($Quiet) { Write-Skip "$Label ($($_.Exception.Message))" }
    else        { Write-Bad "$Label -> $($_.Exception.Message)" }
  }
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-Tool($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

# --------------------------------------------------------------------------
# Elevate if needed - everything below needs Administrator.
# --------------------------------------------------------------------------
$InIse = ($host.Name -eq 'Windows PowerShell ISE Host') -or ($null -ne $psISE)

if (-not (Test-Admin)) {
  if ($InIse -or -not $PSCommandPath) {
    # Relaunching from ISE would run in a separate console window, so the log
    # you're here to read would vanish with it. Ask instead.
    Write-Host ""
    Write-Host "This script needs Administrator." -ForegroundColor Red
    Write-Host "Close PowerShell ISE, right-click it, choose 'Run as administrator'," -ForegroundColor Yellow
    Write-Host "reopen this file, and press F5 again." -ForegroundColor Yellow
    Write-Host ""
    return
  }
  Write-Host "Not running as Administrator - relaunching elevated..." -ForegroundColor Yellow
  $argList = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($RemovePrereqs)       { $argList += '-RemovePrereqs' }
  if ($KeepCloudflareLogin) { $argList += '-KeepCloudflareLogin' }
  if ($Yes)                 { $argList += '-Yes' }
  try {
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs
  } catch {
    Write-Host "Elevation was declined. Re-run this from an elevated PowerShell prompt." -ForegroundColor Red
    exit 1
  }
  exit 0
}

# --------------------------------------------------------------------------
# Read config BEFORE we delete it - we need the video roots to strip ACLs.
# --------------------------------------------------------------------------
$VideoRoots = @()
$ConfigFile = Join-Path $ConfigDir 'config.json'
if (Test-Path $ConfigFile) {
  try {
    $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    if ($cfg.libraries) {
      foreach ($p in $cfg.libraries.PSObject.Properties) {
        if ($p.Value.videoRoot) { $VideoRoots += $p.Value.videoRoot }
      }
    }
    if ($cfg.videoRoot) { $VideoRoots += $cfg.videoRoot }   # pre-libraries layout
  } catch {
    Write-Host "Could not parse $ConfigFile - ACL cleanup may miss the video folders." -ForegroundColor Yellow
  }
}
$VideoRoots = $VideoRoots | Sort-Object -Unique

# Grab the SID before the account is deleted; icacls needs it to strip ACEs
# that Windows has already resolved to a raw SID.
$SvcSid = $null
try { $SvcSid = (Get-LocalUser -Name $SERVICE_USER -ErrorAction Stop).SID.Value } catch {}

# --------------------------------------------------------------------------
# Confirm
# --------------------------------------------------------------------------
Write-Host ""
# Built as plain variables rather than inline $() subexpressions: Windows
# PowerShell 5.1 cannot parse a double-quoted string nested inside a $() that
# is itself inside a double-quoted string.
$svcAcctLabel = if ($SvcSid)        { "$SERVICE_USER ($SvcSid)" } else { "$SERVICE_USER (not present)" }
$videoLabel   = if ($VideoRoots)    { $VideoRoots -join '; ' }   else { '(none found)' }
$prereqLabel  = if ($RemovePrereqs) { 'nssm, cloudflared, node WILL be uninstalled' } else { 'kept (pass -RemovePrereqs to remove)' }

Write-Host "Waterboys - full uninstall" -ForegroundColor White
Write-Host "--------------------------"
Write-Host "  services      : $SERVER_SVC, $TUNNEL_SVC"
Write-Host "  service acct  : $svcAcctLabel"
Write-Host "  firewall      : $($FIREWALL_RULES.Count) rules"
Write-Host "  tunnel        : $TUNNEL_NAME (DNS record left in place)"
Write-Host "  config + logs : $ConfigDir"
Write-Host "  video roots   : $videoLabel  <- ACLs only, files kept"
Write-Host "  prereqs       : $prereqLabel"
Write-Host ""

if (-not $Yes) {
  $answer = Read-Host "Proceed? Type 'yes' to continue"
  if ($answer -ne 'yes') { Write-Host "Aborted."; exit 0 }
}

$nssm        = Resolve-Tool 'nssm'
$cloudflared = Resolve-Tool 'cloudflared'

# --------------------------------------------------------------------------
# 1. Processes
# --------------------------------------------------------------------------
Write-Head "1/9  Stopping processes"
Invoke-Step -Label "kill Waterboys.exe tree" -Quiet `
  -Check { [bool](Get-Process -Name 'Waterboys' -ErrorAction SilentlyContinue) } `
  -Action { taskkill /F /IM Waterboys.exe /T 2>&1 | Out-Null }

# --------------------------------------------------------------------------
# 2. Services
# --------------------------------------------------------------------------
Write-Head "2/9  Removing Windows services"
foreach ($svc in @($SERVER_SVC, $TUNNEL_SVC)) {
  $present = { [bool](Get-Service -Name $svc -ErrorAction SilentlyContinue) }
  Invoke-Step -Label "stop $svc" -Check $present -Quiet -Action {
    Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
    if ($nssm) { & $nssm stop $svc 2>&1 | Out-Null }
  }

  Invoke-Step -Label "remove $svc" -Check $present -Action {
    if ($nssm) { & $nssm remove $svc confirm 2>&1 | Out-Null }
    # sc.exe is the fallback path for boxes where NSSM is already gone.
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
      & sc.exe delete $svc 2>&1 | Out-Null
    }
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
      throw "service still registered (a reboot may be needed to clear it)"
    }
  }
}

# --------------------------------------------------------------------------
# 3. Firewall
# --------------------------------------------------------------------------
Write-Head "3/9  Removing firewall rules"
foreach ($rule in $FIREWALL_RULES) {
  Invoke-Step -Label "delete rule '$rule'" -Quiet -Action {
    & netsh advfirewall firewall delete rule "name=$rule" 2>&1 | Out-Null
  }
}

# --------------------------------------------------------------------------
# 4. NTFS ACLs - strip every grant and deny for the service principal.
#    Must run before the account is deleted so icacls can still resolve it.
# --------------------------------------------------------------------------
Write-Head "4/9  Restoring NTFS permissions"

$plexRelative = @('Plex Media Server', 'Plex', 'Plex Media Player')
$plexBases    = @($env:LOCALAPPDATA, $env:APPDATA, $env:PROGRAMDATA,
                  'C:\Program Files', 'C:\Program Files (x86)') | Where-Object { $_ }
$plexPaths    = foreach ($b in $plexBases) { foreach ($r in $plexRelative) { Join-Path $b $r } }

$userDataPaths = @('Documents','Desktop','Downloads','Pictures','Videos','Music',
                   'OneDrive','OneDrive - Personal','Dropbox') |
                 ForEach-Object { Join-Path $env:USERPROFILE $_ }

$aclTargets = @($VideoRoots) + @($ConfigDir, $LogsDir) + $plexPaths + $userDataPaths |
              Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique

if (-not $aclTargets) {
  Write-Skip "no ACL targets found on disk"
} else {
  $principals = @($SERVICE_USER)
  if ($SvcSid) { $principals += "*$SvcSid" }
  foreach ($t in $aclTargets) {
    Invoke-Step -Label "clear $SERVICE_USER ACEs on $t" -Quiet -Action {
      foreach ($p in $principals) {
        & icacls "$t" /remove:g $p 2>&1 | Out-Null
        & icacls "$t" /remove:d $p 2>&1 | Out-Null
      }
    }
  }
}

# --------------------------------------------------------------------------
# 5. Service account
# --------------------------------------------------------------------------
Write-Head "5/9  Removing the $SERVICE_USER account"
Invoke-Step -Label "delete local user $SERVICE_USER" `
  -Check { [bool](Get-LocalUser -Name $SERVICE_USER -ErrorAction SilentlyContinue) } `
  -Action { Remove-LocalUser -Name $SERVICE_USER -ErrorAction Stop }

# The profile directory outlives the account; remove it and its registry entry.
if ($SvcSid) {
  Invoke-Step -Label "delete $SERVICE_USER profile" -Quiet -Action {
    $prof = Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue |
            Where-Object { $_.SID -eq $SvcSid }
    if ($prof) { $prof | Remove-CimInstance -ErrorAction SilentlyContinue }
  }
}

# --------------------------------------------------------------------------
# 6. Cloudflare tunnel
# --------------------------------------------------------------------------
Write-Head "6/9  Deleting the Cloudflare tunnel"
if (-not $cloudflared) {
  Write-Skip "cloudflared not on PATH - delete the '$TUNNEL_NAME' tunnel from the Cloudflare dashboard"
} else {
  # cleanup releases active connectors, otherwise delete fails with
  # "tunnel has active connections".
  Invoke-Step -Label "cloudflared tunnel cleanup $TUNNEL_NAME" -Quiet -Action {
    & $cloudflared tunnel cleanup $TUNNEL_NAME 2>&1 | Out-Null
  }
  Invoke-Step -Label "cloudflared tunnel delete $TUNNEL_NAME" -Quiet -Action {
    & $cloudflared tunnel delete -f $TUNNEL_NAME 2>&1 | Out-Null
  }
  Write-Host "   note: the api.waterboyshockey.com CNAME stays until you remove it in Cloudflare DNS." -ForegroundColor DarkGray
}

# --------------------------------------------------------------------------
# 7. ProgramData (config, logs, mirrored cloudflared cert + credentials)
# --------------------------------------------------------------------------
Write-Head "7/9  Deleting config and logs"
Invoke-Step -Label "remove $ConfigDir" `
  -Check { Test-Path $ConfigDir } `
  -Action { Remove-Item -LiteralPath $ConfigDir -Recurse -Force -ErrorAction Stop }

# --------------------------------------------------------------------------
# 8. User-profile .cloudflared
# --------------------------------------------------------------------------
Write-Head "8/9  Cleaning $CfHome"
Invoke-Step -Label "remove config.yml" `
  -Check { Test-Path (Join-Path $CfHome 'config.yml') } `
  -Action { Remove-Item -LiteralPath (Join-Path $CfHome 'config.yml') -Force -ErrorAction Stop }

Invoke-Step -Label "remove tunnel credential JSON files" -Quiet `
  -Check { Test-Path $CfHome } `
  -Action {
    # Tunnel credentials are named <tunnel-uuid>.json; cert.pem is the account
    # login and is handled separately below.
    Get-ChildItem -LiteralPath $CfHome -Filter '*.json' -ErrorAction SilentlyContinue |
      Where-Object { $_.BaseName -match '^[0-9a-fA-F-]{36}$' } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }

if ($KeepCloudflareLogin) {
  Write-Skip "keeping cert.pem (-KeepCloudflareLogin)"
} else {
  Invoke-Step -Label "remove cert.pem (Cloudflare account login)" `
    -Check { Test-Path (Join-Path $CfHome 'cert.pem') } `
    -Action { Remove-Item -LiteralPath (Join-Path $CfHome 'cert.pem') -Force -ErrorAction Stop }
}

# --------------------------------------------------------------------------
# 9. The app itself
# --------------------------------------------------------------------------
Write-Head "9/9  Uninstalling the Waterboys app"

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$entry = $null
foreach ($root in $uninstallRoots) {
  if (-not (Test-Path $root)) { continue }
  $hit = Get-ChildItem $root -ErrorAction SilentlyContinue |
         ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
         Where-Object { $_.DisplayName -eq $PRODUCT }
  if ($hit) { $entry = $hit | Select-Object -First 1; break }
}

if ($entry) {
  $installDir = $entry.InstallLocation
  Invoke-Step -Label "run NSIS uninstaller" -Action {
    $cmd = $entry.QuietUninstallString
    if (-not $cmd) { $cmd = $entry.UninstallString }
    # UninstallString is a bare quoted path for electron-builder; /S makes it silent.
    $exe = ($cmd -replace '^"?([^"]+\.exe)"?.*$', '$1')
    if (-not (Test-Path $exe)) { throw "uninstaller not found at $exe" }
    Start-Process -FilePath $exe -ArgumentList '/S' -Wait
    # NSIS re-launches itself from %TEMP% and detaches, so -Wait returns early.
    # Poll for the real uninstaller to finish before we touch the install dir.
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      $running = Get-Process -ErrorAction SilentlyContinue |
                 Where-Object { $_.ProcessName -like 'Un_A*' -or $_.ProcessName -like "Uninstall $PRODUCT*" }
      if (-not $running) { break }
      Start-Sleep -Seconds 1
    }
  }
  if ($installDir) {
    Invoke-Step -Label "remove leftover $installDir" -Quiet `
      -Check { Test-Path $installDir } `
      -Action { Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction Stop }
  }
} else {
  Write-Skip "no '$PRODUCT' entry in Add/Remove Programs"
  # Fall back to the default per-user install location.
  $guess = Join-Path $env:LOCALAPPDATA "Programs\$PRODUCT"
  Invoke-Step -Label "remove $guess" -Quiet `
    -Check { Test-Path $guess } `
    -Action { Remove-Item -LiteralPath $guess -Recurse -Force -ErrorAction Stop }
}

# Electron user data + singleton locks that the NSIS uninstaller leaves behind.
$appData = Join-Path $env:APPDATA $PRODUCT
Invoke-Step -Label "remove $appData" -Quiet `
  -Check { Test-Path $appData } `
  -Action { Remove-Item -LiteralPath $appData -Recurse -Force -ErrorAction Stop }

foreach ($lnk in @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$PRODUCT.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$PRODUCT.lnk"),
  (Join-Path $env:PROGRAMDATA "Microsoft\Windows\Start Menu\Programs\$PRODUCT.lnk")
)) {
  Invoke-Step -Label "remove shortcut $lnk" -Quiet `
    -Check { Test-Path $lnk } `
    -Action { Remove-Item -LiteralPath $lnk -Force -ErrorAction Stop }
}

# --------------------------------------------------------------------------
# Optional: the prerequisites
# --------------------------------------------------------------------------
if ($RemovePrereqs) {
  Write-Head "extra  Removing prerequisites"
  $winget = Resolve-Tool 'winget'
  if (-not $winget) {
    Write-Skip "winget not available - uninstall NSSM / cloudflared / Node.js manually"
  } else {
    foreach ($pkg in @('NSSM.NSSM', 'Cloudflare.cloudflared', 'OpenJS.NodeJS.LTS')) {
      Invoke-Step -Label "winget uninstall $pkg" -Quiet -Action {
        & $winget uninstall --id $pkg --silent --accept-source-agreements 2>&1 | Out-Null
      }
    }
  }
}

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
Write-Host ""
if ($script:Failures -eq 0) {
  Write-Host "Uninstall complete. Your video files were not touched." -ForegroundColor Green
} else {
  Write-Host "Uninstall finished with $($script:Failures) problem(s) - see the [fail] lines above." -ForegroundColor Yellow
}
Write-Host "Still to do by hand: remove the api.waterboyshockey.com DNS record in Cloudflare." -ForegroundColor DarkGray
Write-Host ""
