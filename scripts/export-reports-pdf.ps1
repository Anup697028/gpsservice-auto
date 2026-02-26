param(
  [string]$ReportsDir = "docs/reports",
  [switch]$OpenOutputFolder
)

$ErrorActionPreference = "Stop"

function Resolve-Tool {
  param([string]$Name)

  if ($Name -ieq "wkhtmltopdf") {
    $wkCandidates = @(
      "$env:ProgramFiles\wkhtmltopdf\bin\wkhtmltopdf.exe",
      "$env:ProgramFiles(x86)\wkhtmltopdf\bin\wkhtmltopdf.exe"
    )

    foreach ($candidate in $wkCandidates) {
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    return $cmd.Source
  }

  if ($Name -ieq "pandoc") {
    $pandocCandidates = @(
      "$env:LOCALAPPDATA\Pandoc\pandoc.exe",
      "$env:ProgramFiles\Pandoc\pandoc.exe",
      "$env:ProgramFiles(x86)\Pandoc\pandoc.exe",
      "$env:USERPROFILE\scoop\apps\pandoc\current\pandoc.exe"
    )

    foreach ($candidate in $pandocCandidates) {
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  return $null
}

function Convert-ReportToPdf {
  param(
    [string]$MarkdownFile,
    [string]$OutputFile,
    [string]$PdfEngine,
    [string]$PandocPath
  )

  if ([string]::IsNullOrWhiteSpace($PdfEngine)) {
    & $PandocPath $MarkdownFile -o $OutputFile
  } else {
    $engineArg = "--pdf-engine=$PdfEngine"
    & $PandocPath $MarkdownFile -o $OutputFile $engineArg
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Pandoc conversion failed with exit code $LASTEXITCODE"
  }

  if (-not (Test-Path $OutputFile)) {
    throw "Expected output file not created: $OutputFile"
  }
}

Write-Host "\n=== GPS Report PDF Export ===" -ForegroundColor Cyan

$pandocPath = Resolve-Tool -Name "pandoc"
if (-not $pandocPath) {
  Write-Host "Pandoc is not installed or not in PATH." -ForegroundColor Red
  Write-Host "Install Pandoc: https://pandoc.org/installing.html" -ForegroundColor Yellow
  exit 1
}

Write-Host "Using pandoc: $pandocPath" -ForegroundColor Green

$pdfEngine = $null
$engineCandidates = @("wkhtmltopdf", "weasyprint", "xelatex", "pdflatex")
foreach ($candidate in $engineCandidates) {
  $resolvedEngine = Resolve-Tool -Name $candidate
  if ($resolvedEngine) {
    $pdfEngine = $resolvedEngine
    break
  }
}

if ($pdfEngine) {
  Write-Host "Using PDF engine: $pdfEngine" -ForegroundColor Green
} else {
  Write-Host "No explicit PDF engine found (wkhtmltopdf/weasyprint/xelatex/pdflatex)." -ForegroundColor Yellow
  Write-Host "Pandoc will use its default PDF pipeline." -ForegroundColor Yellow
}

if (-not (Test-Path $ReportsDir)) {
  Write-Host "Reports directory not found: $ReportsDir" -ForegroundColor Red
  exit 1
}

$targetFiles = @(
  "01_USER_STEP_BY_STEP_GUIDE.md",
  "02_FO_DASHBOARD_GUIDE.md",
  "03_RH_DASHBOARD_GUIDE.md",
  "04_PAYMENT_DASHBOARD_GUIDE.md",
  "05_VENDOR_DASHBOARD_GUIDE.md",
  "06_ADMIN_DASHBOARD_GUIDE.md",
  "07_CTO_MASTER_TECHNICAL_REPORT.md"
)

$successCount = 0
$failureCount = 0

foreach ($fileName in $targetFiles) {
  $inputPath = Join-Path $ReportsDir $fileName

  if (-not (Test-Path $inputPath)) {
    Write-Host "[SKIP] Missing file: $inputPath" -ForegroundColor Yellow
    $failureCount++
    continue
  }

  $outputPath = [System.IO.Path]::ChangeExtension($inputPath, ".pdf")

  try {
    Convert-ReportToPdf -MarkdownFile $inputPath -OutputFile $outputPath -PdfEngine $pdfEngine -PandocPath $pandocPath
    Write-Host "[OK] $fileName -> $([System.IO.Path]::GetFileName($outputPath))" -ForegroundColor Green
    $successCount++
  }
  catch {
    Write-Host "[FAIL] $fileName" -ForegroundColor Red
    Write-Host "       $($_.Exception.Message)" -ForegroundColor DarkRed
    $failureCount++
  }
}

Write-Host "\nExport completed: $successCount succeeded, $failureCount failed." -ForegroundColor Cyan

if ($OpenOutputFolder) {
  $resolvedPath = Resolve-Path $ReportsDir
  Start-Process explorer.exe $resolvedPath
}

if ($failureCount -gt 0) {
  exit 1
}
