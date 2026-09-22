param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$word = $null
$document = $null
$saveChanges = 0
$docxFormat = 12
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $word.Options.UpdateLinksAtOpen = $false
    $document = $word.Documents.Open($InputPath, $false, $true, $false, '', '', $false, '', '', 0, $null, $false)
    $document.SaveAs2([ref][object]$OutputPath, [ref][object]$docxFormat)
    $document.Close([ref]$saveChanges)
    $document = $null
} finally {
    if ($document) { $document.Close([ref]$saveChanges) }
    if ($word) { $word.Quit([ref]$saveChanges); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
}
