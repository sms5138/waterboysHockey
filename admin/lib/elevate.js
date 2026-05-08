// Run a batch of commands elevated (as Administrator) via a single UAC prompt.
//
// We emit a temp PowerShell script that loops through the steps, runs each,
// and writes a JSON results file. Then we launch the script via Start-Process
// -Verb RunAs (which triggers the UAC dialog) and wait for completion.
//
// Why batch: each Start-Process -Verb RunAs is a separate UAC prompt, which
// is hostile UX. Bundling all NSSM (or icacls, or netsh) calls for one wizard
// action into one script means the user sees one prompt per action.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { run } = require('./exec');

// `steps` is an array of { label, cmd, args[] }.
// Returns { ok, error?, steps: [{ label, code, stdout, stderr }] }.
async function runElevated(steps) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'elevation is only supported on Windows', steps: [] };
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: true, steps: [] };
  }

  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const stepsPath   = path.join(tmpDir, `wb-elev-${id}-steps.json`);
  const scriptPath  = path.join(tmpDir, `wb-elev-${id}.ps1`);
  const resultsPath = path.join(tmpDir, `wb-elev-${id}-results.json`);

  const normalized = steps.map(s => ({
    label: s.label || s.cmd,
    cmd: s.cmd,
    args: Array.isArray(s.args) ? s.args.map(a => String(a)) : [],
    allowFail: Boolean(s.allowFail)
  }));
  fs.writeFileSync(stepsPath, JSON.stringify(normalized), 'utf8');

  // The elevated script reads steps from JSON, runs each by splatting the
  // args array (`@argList`), captures combined stdout/stderr via 2>&1 and
  // Out-String, and writes results to a JSON file the parent reads back.
  //
  // Note on encoding: PowerShell 5.1's `Out-File -Encoding utf8` writes a
  // UTF-8 BOM, which JSON.parse rejects. We use [System.IO.File]::WriteAllText
  // with a no-BOM UTF-8 encoding so Node can parse the result directly.
  const script = `
$ErrorActionPreference = 'Continue'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-JsonFile($path, $obj) {
  $json = $obj | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($path, $json, $utf8NoBom)
}
try {
  $steps = Get-Content -Raw -LiteralPath '${stepsPath}' | ConvertFrom-Json
  if ($steps -isnot [array]) { $steps = @($steps) }
  $results = @()
  foreach ($step in $steps) {
    $exe = [string]$step.cmd
    [string[]]$argList = @()
    foreach ($a in $step.args) { $argList += [string]$a }
    $code = 0
    $out = ''
    try {
      # Unwrap ErrorRecord objects to their underlying message so the log
      # doesn't get filled with PowerShell's NativeCommandError stack traces
      # for tools like nssm that legitimately write info to stderr.
      $out = & $exe @argList 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
          $_.Exception.Message
        } else {
          $_.ToString()
        }
      } | Out-String
      $code = $LASTEXITCODE
      if ($null -eq $code) { $code = 0 }
    } catch {
      $out = $_.Exception.Message
      $code = -1
    }
    $results += [pscustomobject]@{ label = [string]$step.label; code = [int]$code; output = [string]$out; allowFail = [bool]$step.allowFail }
  }
  # ConvertTo-Json on a single-element array unwraps to a scalar, so wrap.
  Write-JsonFile '${resultsPath}' @($results)
} catch {
  Write-JsonFile '${resultsPath}' @{ error = $_.Exception.Message }
  exit 1
}
`;
  fs.writeFileSync(scriptPath, script, 'utf8');

  // Wrapper invocation: the outer powershell calls Start-Process -Verb RunAs,
  // which is what triggers the UAC prompt. -Wait blocks until the elevated
  // process exits. -WindowStyle Hidden suppresses the brief PS console flash.
  const wrapper =
    `try { Start-Process -FilePath 'powershell.exe' ` +
    `-Verb RunAs -Wait -WindowStyle Hidden ` +
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}') ` +
    `-ErrorAction Stop } catch { Write-Error $_.Exception.Message; exit 1 }`;

  const r = await run('powershell', ['-NoProfile', '-Command', wrapper], { timeoutMs: 5 * 60 * 1000 });

  // Keep the script + steps file on disk for one extra moment; if reading
  // results fails, we can include the script content in the error report so
  // we know what we tried to run.
  const scriptContent = (() => { try { return fs.readFileSync(scriptPath, 'utf8'); } catch { return ''; } })();
  try { fs.unlinkSync(scriptPath); } catch {}
  try { fs.unlinkSync(stepsPath); } catch {}

  if (r.code !== 0) {
    const raw = (r.stderr || '').trim() || (r.stdout || '').trim() || `powershell exited ${r.code}`;
    const cancelled = /cancell?ed by the user|operation was canc[el]+ed/i.test(raw);
    return {
      ok: false,
      error: cancelled
        ? 'Administrator access was denied. Click Yes on the UAC prompt to continue.'
        : `outer powershell failed (exit ${r.code}): ${raw}`,
      steps: []
    };
  }

  let parsed;
  try {
    let raw = fs.readFileSync(resultsPath, 'utf8');
    // Strip UTF-8 BOM if present — PowerShell 5.1's default UTF-8 writer
    // emits one and JSON.parse can't handle it.
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    parsed = JSON.parse(raw);
    fs.unlinkSync(resultsPath);
  } catch (err) {
    // The outer powershell exited 0 but the elevated script never produced
    // a results file. Most common cause: the elevated script crashed before
    // its catch block (PS parse error, encoding mismatch, etc.). Surface as
    // much context as we can.
    const psStderr = (r.stderr || '').trim();
    const psStdout = (r.stdout || '').trim();
    return {
      ok: false,
      error: [
        `Elevated script ran but produced no results file at ${resultsPath}.`,
        `read error: ${err.message}`,
        psStderr ? `outer ps stderr: ${psStderr}` : '',
        psStdout ? `outer ps stdout: ${psStdout}` : '',
        scriptContent ? `--- elevated script ---\n${scriptContent}` : ''
      ].filter(Boolean).join('\n'),
      steps: []
    };
  }

  if (parsed && parsed.error) {
    return { ok: false, error: parsed.error, steps: [] };
  }
  if (!Array.isArray(parsed)) parsed = [parsed];

  const stepResults = parsed.map(rr => ({
    label: rr.label,
    code: rr.code,
    stdout: (rr.output || '').trim(),
    stderr: '',
    allowFail: Boolean(rr.allowFail)
  }));
  return {
    // A failure on an allowFail step doesn't count against overall ok —
    // these are best-effort cleanup steps (e.g. removing a service that
    // may or may not exist).
    ok: stepResults.every(s => s.code === 0 || s.allowFail),
    steps: stepResults
  };
}

module.exports = { runElevated };
