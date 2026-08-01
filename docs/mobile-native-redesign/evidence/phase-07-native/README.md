# Phase 7 Android native evidence

Target: `AcademicPhase1Low`, Android 7.0 / API 24 / x86_64, 720×1280 physical pixels. Default density/font were 320/1.0; the compact large-text case used density 360 (approximately 320 dp wide) and font scale 2.0. Device settings were restored to 320/1.0 after capture.

All content is local synthetic `__DEV__` preview data under `preview.edu.tr`. The preview imports no API, persistence, Google/provider, notification, credential, or production-data module. Evidence proves native presentation only; it is not authenticated backend E2E.

## Reviewed matrix

| PNG/XML pair | Reviewed result |
|---|---|
| `incomplete-light` | Exclusive incomplete-profile hierarchy; primary completion action visible and reachable; no zero dashboard |
| `loading-light` | Initial loading hierarchy with greeting/context and one labelled busy region; decorative skeletons expose no duplicate labels or roles |
| `populated-light` | Greeting/context, Today, live remaining time, important trusted announcement; opaque single-column hierarchy |
| `empty-light` | Genuine empty copy and Calendar action; no simultaneous loading/error |
| `stale-light` | Retained useful content plus explicit stale/retry banner |
| `error-light` | Recoverable no-data error and retry action |
| `announcement-detail` | Full announcement row navigates to the synthetic existing-detail handoff |
| `long-title-dark-320dp-font2` | Dark semantic surface at approximately 320 dp/200% font; content remains vertically scrollable |
| `long-title-dark-320dp-font2-scrolled-clean` | Scrolled long Turkish title remains full, wrapping, horizontally unclipped, labelled, and reachable |

The large-text capture intentionally grows typography without a screen-specific multiplier cap. The viewport cannot contain the entire brief at once, so reachability is vertical-scroll based. Android system navigation remains outside application content. The UI hierarchy exposes `home-android-16-large-text`, `scrollable=true`, headings, and the complete long announcement label.

## Exact native commands

```powershell
Set-Location apps/mobile-native/android
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon

$env:EXPO_PUBLIC_PHASE7_HOME_PREVIEW='1'
$env:EXPO_PUBLIC_PHASE7_HOME_PREVIEW_SCENARIO='<scenario>'
$env:EXPO_PUBLIC_PHASE7_HOME_PREVIEW_THEME='<light|dark>'
npm.cmd --prefix apps/mobile-native run start -- --localhost

adb install -r -d apps/mobile-native/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
adb shell am force-stop com.anssoft.akademiktakvim
adb shell am start -n com.anssoft.akademiktakvim/.MainActivity
adb shell uiautomator dump /sdcard/<name>.xml
adb shell screencap -p /sdcard/<name>.png
adb pull /sdcard/<name>.xml <evidence>/<name>.xml
adb pull /sdcard/<name>.png <evidence>/<name>.png

adb shell wm density 360
adb shell settings put system font_scale 2.0
# capture compact large-text states
adb shell wm density 320
adb shell settings put system font_scale 1.0
```

Assembly passed in 42 seconds, 245 tasks (7 executed, 238 up-to-date). The debug APK is 56,804,991 bytes with SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7`. `adb install -r -d` returned `Success`; Metro bundled the final preview with Fabric active.

## Integrity index

```text
3B40FBA87D2A47E08269001038DA8105798D5F815890EB65EBB9771B28426953  announcement-detail.png
F698B3951F7C599D549DB56FB9189A871581E02C8B41A902C652EEF8B19A37BB  announcement-detail.xml
25578DB416B1AD6DAAB1741875B3131433F45554F40B7428B338694FF2C487BC  empty-light.png
4AE8B28C9458BFBE17E934A5E6E6F79AC5388140E6B4688399CA1D42899F3969  empty-light.xml
CD0A5F2081381A0DF5175E45E2A1A911FBD4C1F430423545C405CA9415BEE02E  error-light.png
E5354D77498BDF11C9C8FEE52846518D205A64DD7761A7856A0F528AC37DC3F1  error-light.xml
F309E791FC1C95F68F41C304D78E114F6EA7ED488A55037BB7F936698429E8F1  incomplete-light.png
B434F82ED26C09435380D43CF13E928102E57E95C1251590B0C77410392EF2DB  incomplete-light.xml
C91BB0CA96A86A710581A2C68151B3DC059EE632C65F6FBE5D977BA44703832C  long-title-dark-320dp-font2.png
698D8EDE5BBE0CAE7EBBF8FD17EC421CE891A85BD3548D202B0711DCA0B14D0B  long-title-dark-320dp-font2.xml
E5040DB7A89AE8860BDA9699E9375F5EE4DECB2C900BEEF7DBE2DE06C3E0CC74  long-title-dark-320dp-font2-scrolled-clean.png
24CE7DF493A69838C37B36CD387EC5597B5F4928BCE112B42CF2B7D5B8F80745  long-title-dark-320dp-font2-scrolled-clean.xml
1E28C791837AE389283150A8995C49DFFE8A93A05BFFE3CCA27269CED4E4AA08  populated-light.png
92618AC8749602EBD6292F93EE781BD7B3F31A6381345A032AB67729AB6EFC63  populated-light.xml
185924A3546B345E657BF52288B0F393E09E26F8D1B27E0C9F2C29D04208341A  stale-light.png
26450DBADA488384EC7FE5047DC320130D203857D31F397B6576EDEA984F814C  stale-light.xml
53E45030CE0FE895EAB5ABFA1B899FA3E0FD80285ACF966653CE076666245DBD  loading-light.png
D321BD5606C3B96FA1DF3D812FBA7E19834DE6005D4E9EBC2AF71112EC2C475E  loading-light.xml
```

## Exact blockers

- The preview has no four-tab shell, so installed native Home-tab re-selection could not be exercised without an authorized authenticated fixture. React Navigation and `HomeDailyBrief` renderer tests cover stable repeated root taps plus `useScrollToTop` registration; this is not relabelled native acceptance.
- No authorized authenticated local API/account fixture was supplied. The matrix does not prove live account hydration, real refresh failure, real offline radio changes, or backend detail lookup.
- TalkBack is unavailable on the authorized API 24 image. UIAutomator labels are not screen-reader traversal evidence.
- Windows has no Xcode/iOS runtime. No iOS build, Dynamic Type, VoiceOver, swipe-back, or Liquid Glass runtime acceptance is claimed.
- API 24 cannot demonstrate predictive Back or modern Android notification permission behavior.
