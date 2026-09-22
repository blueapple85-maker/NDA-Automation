param([Parameter(Mandatory=$true)][string]$FixtureDirectory,[switch]$CreateLegacy)
$ErrorActionPreference = 'Stop'
$word = $null
$currentDoc = $null
$saveChanges = 0
$expected = Get-Content -LiteralPath (Join-Path $FixtureDirectory 'expected.json') -Raw -Encoding UTF8 | ConvertFrom-Json
try {
    Write-Output 'Starting isolated Word verification instance...'
    $word = New-Object -ComObject Word.Application
    Write-Output 'Word automation connected.'
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $word.Options.UpdateLinksAtOpen = $false
    $checks = @()
    foreach ($version in @('v1', 'v2')) {
        foreach ($action in @('accept', 'reject')) {
            Write-Output "Opening $version for $action..."
            $currentDoc = $word.Documents.Open((Join-Path $FixtureDirectory ($version + '.docx')), $false, $true, $false)
            $count = $currentDoc.Revisions.Count
            if ($count -le 0) { throw 'Word did not recognize tracked changes.' }
            if ($action -eq 'accept') { $currentDoc.AcceptAllRevisions() } else { $currentDoc.RejectAllRevisions() }
            $actual = $currentDoc.Content.Text.TrimEnd([char]13, [char]10)
            $wanted = if ($action -eq 'reject') { $expected.original } else { $expected.$version }
            if ($actual -cne $wanted.TrimEnd([char]13, [char]10)) {
                Set-Content -LiteralPath (Join-Path $FixtureDirectory ($version + '-' + $action + '-actual.txt')) -Value $actual -Encoding UTF8
                throw "Word $version $action text did not match expected output."
            }
            $checks += "$version $action : $count revisions; text matched"
            Write-Output $checks[-1]
            $currentDoc.Close([ref]$saveChanges)
            $currentDoc = $null
        }
    }
    if ($CreateLegacy) {
        Write-Output 'Creating optional legacy DOC fixture...'
        $currentDoc = $word.Documents.Open((Join-Path $FixtureDirectory 'v1.docx'), $false, $true)
        $currentDoc.RejectAllRevisions()
        $legacyPath = Join-Path $FixtureDirectory 'legacy.doc'
        $legacyFormat = 0
        $currentDoc.SaveAs2([ref][object]$legacyPath, [ref][object]$legacyFormat)
        $currentDoc.Close([ref]$saveChanges)
        $currentDoc = $null
    }
    $checks | ConvertTo-Json
} finally {
    if ($currentDoc) { $currentDoc.Close([ref]$saveChanges) }
    if ($word) { $word.Quit([ref]$saveChanges); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
}
