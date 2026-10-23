# reloads the unpacked ytm-comments extension INCLUDING manifest.json changes.
# (same pattern as blindspot/tabsync tools/reload-extension.ps1: Extensions
# Reloader only toggles management.setEnabled and never re-reads the manifest,
# so manifest bumps used to need a manual chrome://extensions click. this
# rebuilds the chrome dist, then opens the loader page, which messages bg to
# blank its tab + self-reload. full release build is still `pnpm build`.)
#
# usage: pwsh tools/reload-extension.ps1
# note: the extension must be loaded unpacked once (chrome://extensions ->
# Load unpacked -> .output/chrome-mv3) before this works - the handler has to
# exist in the RUNNING copy first.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host 'building chrome-mv3…' -ForegroundColor Cyan
Push-Location $repoRoot
try {
  # npx instead of pnpm run: this machine's pnpm install trips on ignored
  # esbuild builds (see repo AGENTS.md), but build/compile work without install
  & npx wxt build *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "wxt build failed with exit code $LASTEXITCODE - run 'npx wxt build' manually to see the error"
  }
} finally {
  Pop-Location
}

# the loaded unpacked extension's id is derived from its load path, so read it
# from the browser's own state instead of hardcoding a store id (which is a
# DIFFERENT id and would 404 the loader page). Edge: Secure Preferences.
$extId = $null
$prefs = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Secure Preferences"
if (Test-Path -LiteralPath $prefs) {
  try {
    $settings = (Get-Content -LiteralPath $prefs -Raw | ConvertFrom-Json).extensions.settings
    foreach ($prop in $settings.PSObject.Properties) {
      if ($prop.Value.path -and (Resolve-Path $prop.Value.path -ErrorAction SilentlyContinue).Path -eq (Resolve-Path (Join-Path $repoRoot '.output' 'chrome-mv3') -ErrorAction SilentlyContinue).Path) {
        $extId = $prop.Name
        break
      }
    }
  } catch {}
}

if (-not $extId) {
  throw "ytm-comments is not loaded unpacked in Edge - Load unpacked once at chrome://extensions pointing at $repoRoot\.output\chrome-mv3, then rerun this script"
}

Start-Process 'msedge' -ArgumentList "chrome-extension://$extId/reload.html"
Write-Host "opened reload page for $extId - check edge://extensions for the new version" -ForegroundColor Green
