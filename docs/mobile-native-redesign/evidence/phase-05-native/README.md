# Phase 5 Native Evidence

- Date: 31 July 2026
- Platform: Android 7.0 / API 24 / x86_64
- AVD: `AcademicPhase1Low`
- Package/activity: `com.anssoft.akademiktakvim/.MainActivity`
Source parent: `abbf1b721fc632f75e6ce5cad91b20434f6af2bf` plus the reviewed Phase 5 working tree; the resulting commit SHA is reported in the terminal handoff because a commit cannot contain its own SHA.

The installed x86_64 debug APK is 56,804,991 bytes with SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D`.

## Evidence boundary

The matrix uses `AppShellPreview`, which is reachable only when both `__DEV__` and `EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW=1` are true. It mounts the real authenticated `AppNavigator` with deterministic shell-only content and is not a product route. It does not call application APIs, provider integrations, notification delivery, or persistence, and it cannot be selected in a production build.

The normal captures use the AVD's native 720×1280 display at 320 dpi, or 360×640 dp including system bars. For compact-width captures, the emulator was temporarily configured to a 640×1136 logical display at 320 dpi, or 320×568 dp. Android screencap retained the 720×1280 physical framebuffer dimensions in both cases. Every curated PNG is therefore 720×1280 pixels.

Each screenshot has a same-basename UIAutomator hierarchy under [`hierarchies/`](./hierarchies/). The hierarchy pairs preserve the semantic labels, bounds, and selected state used for the behavioral assertions.

## Curated matrix

| Screenshot | State | Bytes | SHA-256 |
|---|---|---:|---|
| [`android-api24-360dp-light-font1x-home-selected.png`](./screenshots/android-api24-360dp-light-font1x-home-selected.png) | Light, normal scale, Ana Sayfa selected | 99,313 | `12D3D30C5AD5404A4A576D3E1428BBEC1B0AE8E3F6B9ACDBCA79D2D9ADA7C50D` |
| [`android-api24-360dp-light-font1x-announcements-selected.png`](./screenshots/android-api24-360dp-light-font1x-announcements-selected.png) | Light, normal scale, Duyurular selected | 93,159 | `FEB9D7BC7733F51A48379974FC5246C4249E8FBA272FADDC5AE4DBAA5BC226E1` |
| [`android-api24-360dp-light-font1x-calendar-selected.png`](./screenshots/android-api24-360dp-light-font1x-calendar-selected.png) | Light, normal scale, Takvim selected | 92,714 | `B45311A3959A424A8D9CB02882B8C7A72AF254949D2B77A5A4FE748B4269D846` |
| [`android-api24-360dp-light-font1x-profile-selected.png`](./screenshots/android-api24-360dp-light-font1x-profile-selected.png) | Light, normal scale, Profil selected | 91,899 | `8858C9906610371901D0CADA21A2CC1F078878ADD6561600B2F7F76E0B0A0C17` |
| [`android-api24-360dp-dark-font1x-home-selected.png`](./screenshots/android-api24-360dp-dark-font1x-home-selected.png) | Explicit dark preview renderer, Ana Sayfa selected | 102,055 | `69C83E85EE5F283DD32DB2B4BC527C042141E98B0530A1D71E3725774921F396` |
| [`android-api24-320dp-light-font1x-bottom-navigation-home-selected.png`](./screenshots/android-api24-320dp-light-font1x-bottom-navigation-home-selected.png) | Approximately 320 dp, font scale 1.0 | 170,395 | `172B20B64F5FFE985DCE27B5DD0C8B0D33B7E9FEA6D1D0490CA06482CF504EE2` |
| [`android-api24-320dp-light-font2x-bottom-navigation-home-selected.png`](./screenshots/android-api24-320dp-light-font2x-bottom-navigation-home-selected.png) | Approximately 320 dp, font scale 2.0 | 147,847 | `8D4BD92AA1FBFFEAF21473822B5C3609D7F84B699554E1BB83D0044B13875C0D` |
| [`android-api24-360dp-light-font1x-yok-nested-before-back.png`](./screenshots/android-api24-360dp-light-font1x-yok-nested-before-back.png) | YÖK nested route before Android Back | 65,965 | `C282D167A3752B457C783C3E76913E205E4B2E33FB590AB1AE4CD6ED5DCD3178` |
| [`android-api24-360dp-light-font1x-announcements-root-after-back.png`](./screenshots/android-api24-360dp-light-font1x-announcements-root-after-back.png) | Duyurular root after `KEYCODE_BACK` | 93,243 | `CD459836116C4068D1E80A058037F37277DE981CC8AC7B41D76DC8A145706AF1` |
| [`android-api24-360dp-light-font1x-yok-nested-before-reselection.png`](./screenshots/android-api24-360dp-light-font1x-yok-nested-before-reselection.png) | YÖK nested route before selected-tab reselection | 65,965 | `C282D167A3752B457C783C3E76913E205E4B2E33FB590AB1AE4CD6ED5DCD3178` |
| [`android-api24-360dp-light-font1x-announcements-root-after-reselection.png`](./screenshots/android-api24-360dp-light-font1x-announcements-root-after-reselection.png) | Duyurular root after selected-tab reselection | 93,002 | `4CCC9017664ED196D93B011E6065A304F1BD0F79E5A1CFD4AF8C4F68A91B17FD` |
| [`android-api24-360dp-light-font1x-announcements-scrolled-before-reselection.png`](./screenshots/android-api24-360dp-light-font1x-announcements-scrolled-before-reselection.png) | Duyurular root scrolled to rows 7–10 | 86,356 | `F15DF0DF269BA9840B0C8034FD3B0A0945B61913C36912F11DD4A5FCFD11E10A` |
| [`android-api24-360dp-light-font1x-announcements-top-after-reselection.png`](./screenshots/android-api24-360dp-light-font1x-announcements-top-after-reselection.png) | Duyurular root returned to top after reselection | 93,002 | `4CCC9017664ED196D93B011E6065A304F1BD0F79E5A1CFD4AF8C4F68A91B17FD` |

Identical hashes in the two YÖK frames and the two root-after-reselection frames are expected: the repeated sequences converged on the same deterministic visual states.

## Reviewed results

All 13 curated PNGs were opened at original resolution and visually inspected.

- Exactly four bottom destinations are present: `Ana Sayfa`, `Duyurular`, `Takvim`, and `Profil`. YÖK and Yaz Okulu remain reachable through Duyurular actions and are not primary tabs.
- Each normal-scale frame has exactly one selected root tab in UIAutomator. Selection is communicated by the tonal pill, filled icon, label treatment, and `selected=true`, rather than color alone. No badges or synthetic unread counts appear.
- At 360 dp, each tab target is approximately 90×79.5 dp. At 320 dp, each target is approximately 80×79.5 dp. The navigation item union is `[0,1025][720,1184]` at 360 dp and `[0,881][640,1040]` at 320 dp.
- At 320 dp and font scale 1.0, all four labels remain complete and separated. At font scale 2.0, UIAutomator reports the complete labels `Ana Sayfa`, `Duyurular`, `Takvim`, and `Profil`; none is ellipsized, wrapped, clipped, or overlapped. The enlarged label bounds end at logical y=1013, leaving 27 px / 13.5 dp before the bottom-bar boundary at y=1040.
- The API 24 system status-bar clock clips at font scale 2.0; the application bottom-navigation labels do not. This is a bounded bottom-navigation observation, not full-screen 200% large-text acceptance.
- `KEYCODE_BACK` moves from the synthetic YÖK nested route to the Duyurular root while Duyurular remains selected.
- Pressing the already-selected Duyurular tab from the YÖK nested route returns that tab to its root. Duplicate-push prevention is covered by the automated navigation tests rather than inferred from a static frame.
- After semantic-bound-derived swipes expose deterministic rows 7–10 and remove the root marker from the hierarchy, pressing the selected Duyurular tab restores the root marker and scrolls to the top.
- The explicit dark preview renderer has readable opaque content surfaces, tonal shell chrome, and light status-bar icons. API 24 returns `No shell command implementation.` for `cmd uimode night`; this capture therefore validates the native dark renderer under the dev-only theme override, not OS theme-switch acceptance.

The final filtered runtime log has eight lines: two log-section headers and six normal `ReactNativeJS: Running "main"` entries. A case-insensitive scan found zero matches for `FATAL EXCEPTION`, React Native/Expo/AndroidRuntime errors, `Unable to load script`, or `Cannot connect to Metro`.

## Exact launch and capture commands

```powershell
$adb = '<ANDROID_SDK_ROOT>\platform-tools\adb.exe'
$emulator = '<ANDROID_SDK_ROOT>\emulator\emulator.exe'
$apk = '<REPO_ROOT>\apps\mobile-native\android\app\build\outputs\apk\debug\app-debug.apk'

& $emulator -avd AcademicPhase1Low -accel on -gpu host -memory 1536 `
  -cores 2 -partition-size 2047 -camera-back none -camera-front none `
  -no-audio -no-boot-anim
& $adb wait-for-device
& $adb -s emulator-5554 install -r -t $apk
& $adb -s emulator-5554 reverse tcp:8081 tcp:8081

$env:EXPO_OFFLINE = '1'
$env:EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW = '1'
$env:EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME = 'light'
Remove-Item Env:EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW -ErrorAction SilentlyContinue
$metroOut = 'C:\tmp\phase5-shell-20260731-1620\final\metro-light.stdout.log'
$metroErr = 'C:\tmp\phase5-shell-20260731-1620\final\metro-light.stderr.log'
Start-Process -FilePath (Get-Command npx.cmd).Source `
  -ArgumentList @('expo','start','--dev-client','--localhost','--port','8081','--clear') `
  -WorkingDirectory '<REPO_ROOT>\apps\mobile-native' `
  -RedirectStandardOutput $metroOut -RedirectStandardError $metroErr `
  -WindowStyle Hidden

& $adb -s emulator-5554 logcat -c
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
& $adb -s emulator-5554 shell am start -W -n com.anssoft.akademiktakvim/.MainActivity
```

The dark render used the same command after restarting the local Metro process with `EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME=dark`. The light process was then restored for the remaining captures. No animation-scale setting was changed.

Normal, compact, and enlarged-font configurations used:

```powershell
# Normal 360 dp / font 1.0
& $adb -s emulator-5554 shell settings put system font_scale 1.0
& $adb -s emulator-5554 shell wm size reset
& $adb -s emulator-5554 shell wm density reset

# Compact 320 dp / font 1.0
& $adb -s emulator-5554 shell wm size 640x1136
& $adb -s emulator-5554 shell wm density 320
& $adb -s emulator-5554 shell settings put system font_scale 1.0

# Compact 320 dp / font 2.0
& $adb -s emulator-5554 shell settings put system font_scale 2.0
```

Each state used the following same-basename hierarchy/screenshot pattern:

```powershell
& $adb -s emulator-5554 shell uiautomator dump /sdcard/window.xml
& $adb -s emulator-5554 pull /sdcard/window.xml C:\tmp\phase5-shell-20260731-1620\final\NAME.xml
& $adb -s emulator-5554 shell screencap -p /sdcard/phase5-capture.png
& $adb -s emulator-5554 pull /sdcard/phase5-capture.png C:\tmp\phase5-shell-20260731-1620\final\NAME.png
```

Interactions were located from exact `content-desc` values and the center of their UIAutomator bounds. The sequence was:

```powershell
# Tap exact semantic tab/action bounds, never a guessed screen coordinate.
Tap-Semantic 'Duyurular'
Tap-Semantic 'YÖK duyuruları iç rotasını aç'
& $adb -s emulator-5554 shell input keyevent KEYCODE_BACK

Tap-Semantic 'YÖK duyuruları iç rotasını aç'
Tap-Semantic 'Duyurular' # selected-tab press: nested route -> root

# Swipe X and Y limits were derived from the selected Duyurular tab and
# the node whose content-desc ends with "üst gezinme çubuğu".
1..2 | ForEach-Object {
  & $adb -s emulator-5554 shell input swipe $swipeX $swipeStart $swipeX $swipeEnd 250
}
Tap-Semantic 'Duyurular' # selected-tab press: root scroll -> top
```

The filtered log command was:

```powershell
& $adb -s emulator-5554 logcat -d -v threadtime `
  ReactNativeJS:V ReactNative:E AndroidRuntime:E Expo:E '*:S' |
  Out-File C:\tmp\phase5-shell-20260731-1620\final\phase5-filtered-logcat.txt -Encoding utf8
```

## Restoration

```powershell
& $adb -s emulator-5554 shell settings put system font_scale 1.0
& $adb -s emulator-5554 shell wm size reset
& $adb -s emulator-5554 shell wm density reset
& $adb -s emulator-5554 reverse --remove tcp:8081
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
# Stop only the Phase 5 Metro process tree, then:
& $adb -s emulator-5554 emu kill
& $adb devices -l
```

Restoration was verified, not inferred: font scale was 1.0 and size/density were reset before shutdown; the ADB reverse was removed; the app and Phase 5 Metro process tree were stopped; port 8081 had no listener; emulator PIDs 13112/13752 exited; and `adb devices -l` returned an empty device list. Night mode was never changed because the API 24 image does not implement the `uimode` shell command.

Raw PNG/XML/log files remain under `C:\tmp\phase5-shell-20260731-1620\final`. They contain deterministic local preview copy only: no token, credential, provider account, notification payload, production identifier, or production data.

## Unavailable evidence

- Windows has no Xcode/iOS simulator, so there is no native iOS Liquid Glass, fallback-material, swipe, Dynamic Type, or visual acceptance.
- API 24 validates layout and ordinary Android Back only. It cannot exercise predictive Back, Android 26+ notification channels, or Android 13+ runtime notification permission.
- API 24 cannot validate OS-controlled light/dark switching because `cmd uimode night` is unavailable; only the explicit dev-preview renderer was captured.
- TalkBack traversal was not run. UIAutomator validates node exposure, labels, bounds, and selected state, but is not a screen-reader acceptance pass.
- The 200% observation is scoped to bottom-navigation label fit. The API 24 system clock clips and full-screen large-text acceptance is not claimed.
- The deterministic preview does not constitute authenticated production-content, live deep-link/provider, real notification-destination, tablet/rail, or end-to-end account acceptance.
