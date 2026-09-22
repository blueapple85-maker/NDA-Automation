$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $PSScriptRoot '..\.tools\node-v24.21.0-win-x64\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 22 or newer is required. Install Node.js and run npm install first.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\fflate'))) { throw 'Dependencies are missing. Run npm ci in this folder first.' }
$managedProcessFile = Join-Path $PSScriptRoot '.runtime\server-process.json'
if (Test-Path -LiteralPath $managedProcessFile) {
    $managedInfo = Get-Content -LiteralPath $managedProcessFile -Raw | ConvertFrom-Json
    $managedProcess = Get-Process -Id $managedInfo.id -ErrorAction SilentlyContinue
    if ($managedProcess -and $managedProcess.Path -eq $managedInfo.executable -and $managedProcess.StartTime.ToUniversalTime().ToString('o') -eq $managedInfo.started) {
        Write-Host 'Restarting the preview server with current settings...'
        Stop-Process -Id $managedProcess.Id
    }
}
Write-Host 'Open http://localhost:4173 in your browser. Press Ctrl+C to stop.'
& $nodePath --env-file-if-exists=.env server/index.cjs
