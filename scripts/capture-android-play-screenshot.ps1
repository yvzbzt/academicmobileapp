param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [Parameter(Mandatory = $true)]
  [int]$CropX,
  [Parameter(Mandatory = $true)]
  [int]$CropY,
  [Parameter(Mandatory = $true)]
  [int]$Width,
  [Parameter(Mandatory = $true)]
  [int]$Height,
  [string]$Serial = "emulator-5554"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repoRoot ".android-sdk\platform-tools\adb.exe"
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$outputDirectory = Split-Path -Parent $resolvedOutput
$temporaryPng = Join-Path $env:TEMP "academic-calendar-play-capture-$PID.png"
$remotePng = "/sdcard/academic-calendar-play-capture-$PID.png"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $adb -s $Serial shell screencap -p $remotePng | Out-Null
& $adb -s $Serial pull $remotePng $temporaryPng | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not pull the emulator screenshot."
}

Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Bitmap]::FromFile($temporaryPng)
try {
  if ($CropX -lt 0 -or $CropY -lt 0 -or $CropX + $Width -gt $source.Width -or $CropY + $Height -gt $source.Height) {
    throw "Crop ${CropX},${CropY},${Width},${Height} exceeds source $($source.Width)x$($source.Height)."
  }
  $rectangle = New-Object System.Drawing.Rectangle($CropX, $CropY, $Width, $Height)
  $cropped = $source.Clone($rectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $cropped.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $cropped.Dispose()
  }
} finally {
  $source.Dispose()
  Remove-Item -LiteralPath $temporaryPng -Force -ErrorAction SilentlyContinue
  & $adb -s $Serial shell rm $remotePng | Out-Null
}

$result = Get-Item -LiteralPath $resolvedOutput
Write-Output "$($result.FullName) $Width`x$Height $($result.Length) bytes"
