# Phase 4 Native Evidence

Date: 31 July 2026
Platform: Android 7.0 / API 24 / x86_64
AVD: `AcademicPhase1Low`
Package/activity: `com.anssoft.akademiktakvim/.MainActivity`
Source parent: `b74bdcc8da7657c2886cf35f6a9b4f2dedbe29d8` plus the staged Phase 4 tree; the resulting commit SHA is reported in the terminal handoff because a commit cannot contain its own SHA.

## Primitive visual matrix

The matrix uses `DesignSystemPreview`, which is reachable only when both `__DEV__` and `EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW=1` are true. It is not a product route and cannot be selected in a production build.

The emulator was temporarily configured to a 640×1136 logical display at 320 dpi, or 320×568 dp. Android screencap retained the 720×1280 physical framebuffer dimensions. The theme is light; the first five images use font scale 1.0. The final image is a bounded font-scale 2.0 observation, not full large-text acceptance.

| Screenshot | State | SHA-256 |
|---|---|---|
| [`android-api24-320dp-light-font1x-design-preview-actions.png`](./screenshots/android-api24-320dp-light-font1x-design-preview-actions.png) | Primary, secondary, destructive, disabled, loading, success, and error actions | `B6070FFE09D2204CFAB77ED615AB474625B5FC04A591F3F808366CC1C9975535` |
| [`android-api24-320dp-light-font1x-design-preview-fields.png`](./screenshots/android-api24-320dp-light-font1x-design-preview-fields.png) | Disabled/password/search and selector states | `5960AF2E65F8F61926907C5977B284E2BA5F662AF4BE82B7B3E65290DFC759C6` |
| [`android-api24-320dp-light-font1x-design-preview-selection.png`](./screenshots/android-api24-320dp-light-font1x-design-preview-selection.png) | Disabled/loading selectors, chips, segmented control, and content surfaces | `729E67FB9095E322FCBC56ED7E2D3F4227CF493D7D8C0B6A62DC5F60C3E9BD6A` |
| [`android-api24-320dp-light-font1x-design-preview-feedback.png`](./screenshots/android-api24-320dp-light-font1x-design-preview-feedback.png) | Warning/error/success feedback, skeleton, and actionable error state | `80D7569FB989A08F55E8CC14D0755EA0411F409E8737B5E3EC705CD81DD418E7` |
| [`android-api24-320dp-light-font1x-design-preview-bottom-sheet.png`](./screenshots/android-api24-320dp-light-font1x-design-preview-bottom-sheet.png) | Modal bottom sheet, safe-area placement, close target, and rows | `33F93AEB022AA388A8355E8E7A53915DAD8A3657241F7D50F2E1D0A3898BA74C` |
| [`android-api24-320dp-light-font2x-design-preview-actions.png`](./screenshots/android-api24-320dp-light-font2x-design-preview-actions.png) | Font-scale 2.0 wrapping observation | `0B7C9C67C84C3956CE87E33A74AAF3E9E8FB66C0A8134E5FE9DD3E4A996C30D8` |

All six curated captures were visually inspected. At font scale 1.0, the reviewed application surfaces showed no blank state, horizontal text clipping, or overlapping primary controls; vertical crop at screenshot edges reflects the scroll position. At font scale 2.0, the application title and body wrap vertically without horizontal clipping, but the API 24 system status-bar clock clips at the far right. Full large-text, authenticated-screen, tablet/rail, screen-reader, dark-screen, and iOS acceptance is not claimed.

UIAutomator text/role probes matched the intended states. The filtered React Native/Expo/AndroidRuntime log contains only normal `Running "main"` lines. The final x86_64 debug APK is 56,804,991 bytes with SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D`.

## Exact preview capture commands

```powershell
$adb = 'C:\Users\buyuk\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$apk = 'C:\Users\buyuk\academicmobileapp\apps\mobile-native\android\app\build\outputs\apk\debug\app-debug.apk'
& $adb -s emulator-5554 install -r -t $apk
& $adb -s emulator-5554 shell wm size 640x1136
& $adb -s emulator-5554 shell wm density 320
& $adb -s emulator-5554 shell settings put system font_scale 1.0

$env:EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW = '1'
Start-Process -FilePath (Get-Command npx.cmd).Source `
  -ArgumentList @('expo','start','--dev-client','--localhost','--port','8081') `
  -WorkingDirectory 'C:\Users\buyuk\academicmobileapp\apps\mobile-native' `
  -WindowStyle Hidden

& $adb -s emulator-5554 reverse tcp:8081 tcp:8081
& $adb -s emulator-5554 logcat -c
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
& $adb -s emulator-5554 shell am start -W -n com.anssoft.akademiktakvim/.MainActivity
& $adb -s emulator-5554 shell settings put global window_animation_scale 0.0
& $adb -s emulator-5554 shell settings put global transition_animation_scale 0.0
& $adb -s emulator-5554 shell settings put global animator_duration_scale 0.0
```

Each named state used the following dump/capture/pull pattern:

```powershell
& $adb -s emulator-5554 shell uiautomator dump "/sdcard/phase4-preview-NAME.xml"
& $adb -s emulator-5554 pull "/sdcard/phase4-preview-NAME.xml" "C:\tmp\phase4-preview-NAME.xml"
& $adb -s emulator-5554 shell screencap -p "/sdcard/phase4-preview-NAME.png"
& $adb -s emulator-5554 pull "/sdcard/phase4-preview-NAME.png" "C:\tmp\phase4-preview-NAME.png"
```

The exact interaction sequence between `top`, `fields`, `selection`, `feedback`, `bottom`, and `sheet` was:

```powershell
& $adb -s emulator-5554 shell input swipe 320 950 320 220 500
& $adb -s emulator-5554 shell input swipe 320 950 320 220 500
& $adb -s emulator-5554 shell input swipe 320 930 320 360 500
& $adb -s emulator-5554 shell input swipe 320 930 320 220 500
& $adb -s emulator-5554 shell input swipe 320 930 320 220 500
& $adb -s emulator-5554 shell input swipe 320 930 320 420 500
& $adb -s emulator-5554 shell input tap 320 956
```

The bounded font-2 capture, log filter, and restoration were:

```powershell
& $adb -s emulator-5554 shell settings put system font_scale 2.0
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
& $adb -s emulator-5554 shell am start -W -n com.anssoft.akademiktakvim/.MainActivity
& $adb -s emulator-5554 shell screencap -p /sdcard/phase4-preview-font2-top.png
& $adb -s emulator-5554 pull /sdcard/phase4-preview-font2-top.png C:\tmp\phase4-preview-font2-top.png

& $adb -s emulator-5554 logcat -d -v threadtime ReactNativeJS:V ReactNative:E AndroidRuntime:E Expo:E '*:S' |
  Out-File C:\tmp\phase4-preview-logcat.txt -Encoding utf8

& $adb -s emulator-5554 shell settings put system font_scale 1.0
& $adb -s emulator-5554 shell wm size reset
& $adb -s emulator-5554 shell wm density reset
& $adb -s emulator-5554 shell settings delete global window_animation_scale
& $adb -s emulator-5554 shell settings delete global transition_animation_scale
& $adb -s emulator-5554 shell settings delete global animator_duration_scale
& $adb -s emulator-5554 reverse --remove tcp:8081
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
& $adb -s emulator-5554 emu kill
```

Raw PNG/XML/log files remain under `C:\tmp\phase4-preview-*`. They contain deterministic local preview copy only: no token, credential, provider account, notification payload, production identifier, or production data. Display, font, animation, ADB reverse, app, Metro, and emulator state were restored/stopped after capture.

## Unavailable evidence

- Windows has no Xcode/iOS simulator, so there is no iOS Liquid Glass, swipe, Dynamic Type, or primitive visual matrix.
- API 24 cannot exercise predictive-back callbacks/animation, Android 26+ notification channels, or Android 13+ runtime notification permission.
- No authorized non-production provider/account fixture exists for Google chooser/mutation/revoke or real FCM/APNs delivery.
