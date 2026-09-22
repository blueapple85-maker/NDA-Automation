$ErrorActionPreference = 'Stop'
$repositoryPath = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repositoryPath 'prompts/nda-review-system.md'
$outputPath = Join-Path $repositoryPath 'assets/review-prompt.js'
$promptText = [System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)
$jsonText = ConvertTo-Json -InputObject $promptText -Compress
$scriptText = "// Generated from prompts/nda-review-system.md. Run scripts/sync-prompt.ps1 after changes.`nconst NDA_SYSTEM_PROMPT = $jsonText;`n"
[System.IO.File]::WriteAllText($outputPath, $scriptText, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Updated assets/review-prompt.js from the source prompt.'
