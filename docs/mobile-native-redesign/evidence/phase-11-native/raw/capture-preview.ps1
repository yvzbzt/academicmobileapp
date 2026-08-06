param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('phase6-auth', 'phase7-home', 'phase8-feed', 'phase9-calendar', 'phase10-profile')]
  [string]$Preview,

  [Parameter(Mandatory = $true)]
  [string]$Scenario,

  [Parameter(Mandatory = $true)]
  [ValidateSet('light', 'dark')]
  [string]$Theme,

  [Parameter(Mandatory = $true)]
  [string]$Name,

  [Parameter(Mandatory = $true)]
  [string]$Expected,

  [Parameter(Mandatory = $true)]
  [ValidateSet('320', '360', '393', '430', 'tablet')]
  [string]$Display,

  [Parameter(Mandatory = $true)]
  [ValidateSet('1.0', '1.3', '1.5', '2.0')]
  [string]$FontScale
)

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\buyuk\academicmobileapp'
$evidence = Join-Path $repo 'docs\mobile-native-redesign\evidence\phase-11-native'
$adb = 'C:\Users\buyuk\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$package = 'com.anssoft.akademiktakvim'

$previewConfiguration = @{
  'phase6-auth' = @{
    Flag = 'EXPO_PUBLIC_PHASE6_AUTH_PREVIEW'
    Scenario = 'EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO'
    Theme = 'EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME'
  }
  'phase7-home' = @{
    Flag = 'EXPO_PUBLIC_PHASE7_HOME_PREVIEW'
    Scenario = 'EXPO_PUBLIC_PHASE7_HOME_PREVIEW_SCENARIO'
    Theme = 'EXPO_PUBLIC_PHASE7_HOME_PREVIEW_THEME'
  }
  'phase8-feed' = @{
    Flag = 'EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW'
    Scenario = 'EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_SCENARIO'
    Theme = 'EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_THEME'
  }
  'phase9-calendar' = @{
    Flag = 'EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW'
    Scenario = 'EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_SCENARIO'
    Theme = 'EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_THEME'
  }
  'phase10-profile' = @{
    Flag = 'EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW'
    Scenario = 'EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_SCENARIO'
    Theme = 'EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_THEME'
  }
}

$previewVariables = @(
  'EXPO_PUBLIC_PHASE6_AUTH_PREVIEW',
  'EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO',
  'EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME',
  'EXPO_PUBLIC_PHASE7_HOME_PREVIEW',
  'EXPO_PUBLIC_PHASE7_HOME_PREVIEW_SCENARIO',
  'EXPO_PUBLIC_PHASE7_HOME_PREVIEW_THEME',
  'EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW',
  'EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_SCENARIO',
  'EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_THEME',
  'EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW',
  'EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_SCENARIO',
  'EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW_THEME',
  'EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW',
  'EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_SCENARIO',
  'EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW_THEME'
)

foreach ($variable in $previewVariables) {
  Remove-Item -LiteralPath "Env:$variable" -ErrorAction SilentlyContinue
}

$listeners = @(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($process.CommandLine -notmatch 'mobile-native|expo') {
    throw "Port 8081 belongs to an unrelated process: $($listener.OwningProcess)"
  }
  Stop-Process -Id $listener.OwningProcess -Force
}

switch ($Display) {
  '320' {
    & $adb -s emulator-5554 shell wm size reset | Out-Null
    & $adb -s emulator-5554 shell wm density 360 | Out-Null
  }
  '360' {
    & $adb -s emulator-5554 shell wm size reset | Out-Null
    & $adb -s emulator-5554 shell wm density reset | Out-Null
  }
  '393' {
    & $adb -s emulator-5554 shell wm size 786x1398 | Out-Null
    & $adb -s emulator-5554 shell wm density 320 | Out-Null
  }
  '430' {
    & $adb -s emulator-5554 shell wm size 860x1529 | Out-Null
    & $adb -s emulator-5554 shell wm density 320 | Out-Null
  }
  'tablet' {
    & $adb -s emulator-5554 shell wm size 1280x1920 | Out-Null
    & $adb -s emulator-5554 shell wm density 240 | Out-Null
  }
}
& $adb -s emulator-5554 shell settings put system font_scale $FontScale | Out-Null

$configuration = $previewConfiguration[$Preview]
Set-Item -LiteralPath "Env:$($configuration.Flag)" -Value '1'
Set-Item -LiteralPath "Env:$($configuration.Scenario)" -Value $Scenario
Set-Item -LiteralPath "Env:$($configuration.Theme)" -Value $Theme
$env:NODE_ENV = 'development'
$env:EXPO_OFFLINE = '1'

$stdout = Join-Path $evidence "raw\metro-$Name.stdout.log"
$stderr = Join-Path $evidence "raw\metro-$Name.stderr.log"
Start-Process -FilePath 'npm.cmd' `
  -ArgumentList @('--prefix', 'apps/mobile-native', 'run', 'start', '--', '--localhost', '--clear') `
  -WorkingDirectory $repo `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden | Out-Null

$ready = $false
for ($index = 0; $index -lt 60; $index += 1) {
  if (Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  throw "Metro did not listen for $Preview/$Scenario/$Theme"
}

& $adb -s emulator-5554 reverse tcp:8081 tcp:8081 | Out-Null
& $adb -s emulator-5554 shell am force-stop $package | Out-Null
& $adb -s emulator-5554 shell am start -n "$package/.MainActivity" | Out-Null

$rendered = $false
$probe = 'C:\tmp\phase11-preview-probe.xml'
for ($index = 0; $index -lt 35; $index += 1) {
  Start-Sleep -Seconds 2
  & $adb -s emulator-5554 shell uiautomator dump --compressed /sdcard/phase11-preview-probe.xml | Out-Null
  & $adb -s emulator-5554 pull /sdcard/phase11-preview-probe.xml $probe | Out-Null
  $xml = Get-Content -LiteralPath $probe -Raw -Encoding UTF8
  if ($xml.Contains($Expected)) {
    $rendered = $true
    break
  }
}
if (-not $rendered) {
  Get-Content -LiteralPath $stdout -Tail 80
  Get-Content -LiteralPath $stderr -Tail 80
  throw "Expected native text was not rendered: $Expected"
}

& $adb -s emulator-5554 shell uiautomator dump --compressed "/sdcard/$Name.xml" | Out-Null
& $adb -s emulator-5554 shell screencap -p "/sdcard/$Name.png" | Out-Null
& $adb -s emulator-5554 pull "/sdcard/$Name.xml" (Join-Path $evidence "hierarchies\$Name.xml") | Out-Null
& $adb -s emulator-5554 pull "/sdcard/$Name.png" (Join-Path $evidence "screenshots\$Name.png") | Out-Null

"CAPTURED=$Name"
"PREVIEW=$Preview"
"SCENARIO=$Scenario"
"THEME=$Theme"
"DISPLAY=$Display"
"FONT_SCALE=$FontScale"
"EXPECTED=$Expected"
