# Phase 8 Android native evidence

Status: Complete and reviewed.

Target: `emulator-5554` / `AcademicPhase1Low`, Android 7.0 / API 24 / x86_64, 720×1280 physical pixels. The normal profile was density 320 (360 dp wide) at font scale 1.0. The exact compact large-text profile was override density 360 (320 dp wide) at font scale 2.0. Capture cleanup restored physical 720×1280, density 320, and font scale 1.0.

All content is local synthetic `__DEV__` preview data under `preview.edu.tr` and official YÖK HTTPS URLs. The preview imports no API, persistence, provider, account, credential, or production-data module. This evidence proves native Phase 8 presentation and the listed interactions only; it is not authenticated backend, external-provider, or production E2E.

## Reviewed matrix

Every named item below has one original-resolution PNG under `screenshots/` and a same-basename UIAutomator XML under `hierarchies/`. All 20 PNGs are 720×1280, all 20 XML files pair by basename, and both audits passed.

| PNG/XML basename | Reviewed result |
|---|---|
| `android-api24-360dp-light-font1x-populated` | Light opaque one-column feed; academic context, labelled search, both wrapped filter groups, YÖK/Yaz Okulu routes, and source-first chronological trusted rows |
| `android-api24-360dp-dark-font1x-populated` | Equivalent populated hierarchy on the explicit dark semantic preview; content cards/readable rows remain opaque |
| `android-api24-360dp-light-font1x-search-results-feed` | Debounced synthetic search result with query and matching trusted row visible |
| `android-api24-360dp-light-font1x-search-results-detail-before-back` | Full-row selection opened the in-app detail in the same process; trusted title/source/domain/summary/actions are reachable |
| `android-api24-360dp-light-font1x-search-results-feed-after-back` | Ordinary Android Back returned to the mounted feed in the same PID and retained search plus prior feed scroll state |
| `android-api24-360dp-light-font1x-no-results` | No-results state is distinct from empty/error and exposes **Filtreleri temizle** |
| `android-api24-360dp-light-font1x-active-filters` | Content and academic-source selections are visibly active, semantically selected, and produce the expected filtered result |
| `android-api24-360dp-light-font1x-partial-retained` | Explicit partial-source banner appears without hiding the retained trusted rows |
| `android-api24-360dp-light-font1x-stale-retained` | Explicit stale/retry banner appears without hiding the retained trusted rows |
| `android-api24-360dp-light-font1x-yok-feed` / `android-api24-360dp-light-font1x-yok-detail` | YÖK source content is reachable in the unified feed and opens the shared trusted detail before external handoff |
| `android-api24-360dp-light-font1x-summer-school-feed` / `android-api24-360dp-light-font1x-summer-school-detail` | Compatible Summer School trusted content is reachable in the unified feed and opens the shared detail; nested Summer ownership remains named |
| `android-api24-360dp-light-font1x-official-handoff-before` / `android-api24-360dp-light-font1x-official-handoff-contained` | `preview.edu.tr` is disclosed; the synthetic unsupported handoff remains on the detail screen, retains the same PID, and resumes `MainActivity` without an external transition |
| `android-api24-320dp-dark-font2x-long-title-feed` / `android-api24-320dp-dark-font2x-long-title-detail-top` / `android-api24-320dp-dark-font2x-long-title-detail-scrolled` | Exact 320 dp / font-scale-2 dark case; long Turkish institution/title wraps without horizontal clipping, detail is vertically reachable, and the clickable official-source action is reachable after scrolling |
| `android-api24-360dp-light-font1x-long-feed-top` / `android-api24-360dp-light-font1x-long-feed-after-scroll` | Representative deterministic 100-record virtualized feed; after scroll, rows 023/024 are visible and the hierarchy remains coherent |

The search-detail Back proof retained process ID `21552` before/after. The contained handoff retained process ID `24235` and `com.anssoft.akademiktakvim/.MainActivity` as the resumed activity. These values are run-specific evidence, not stable product identifiers.

## Exact native command ledger

Android assembly ran from `apps/mobile-native/android`:

```powershell
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon
```

The installed evidence build reported `BUILD SUCCESSFUL in 1m 48s`, 245 actionable tasks (7 executed / 238 up-to-date), and `adb install -r -d app-debug.apk` returned `Success`. After the final request-ownership fixes, the same command passed again incrementally in 1m 7s with the same task totals. The resulting debug APK remained 56,804,991 bytes with SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7`; both results are preserved in [`raw/android-build-install-apk.txt`](./raw/android-build-install-apk.txt).

Each scoped Metro preview server was launched from the repository root with the development gate, one exact scenario, and one exact theme:

```powershell
$env:EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW='1'
$env:EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_SCENARIO='<scenario>'
$env:EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW_THEME='<light|dark>'
npm.cmd --prefix apps/mobile-native run start -- --localhost
```

The executed scenario/theme combinations were `populated/light`, `populated/dark`, `search-results/light`, `no-results/light`, `active-filters/light`, `partial/light`, `stale/light`, `yok/light`, `summer-school/light`, `official-source-handoff/light`, `long-title/dark`, and `long-feed/light`. Search, YÖK, Summer School, and long-title details were reached by pressing their full feed rows. The official-handoff scenario used its deterministic in-app stack setup; Back and the handoff action were then exercised from mounted detail routes rather than represented by static screenshots alone.

The following ADB commands supplied install/runtime routing, capture, profile, interaction, observation, and cleanup. `<name>` took the exact artifact basenames in the reviewed matrix:

```powershell
adb devices -l
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
adb -s emulator-5554 shell am start -n com.anssoft.akademiktakvim/.MainActivity

adb -s emulator-5554 shell uiautomator dump /sdcard/<name>.xml
adb -s emulator-5554 shell screencap -p /sdcard/<name>.png
adb -s emulator-5554 pull /sdcard/<name>.xml docs/mobile-native-redesign/evidence/phase-08-native/hierarchies/<name>.xml
adb -s emulator-5554 pull /sdcard/<name>.png docs/mobile-native-redesign/evidence/phase-08-native/screenshots/<name>.png

adb -s emulator-5554 shell wm size
adb -s emulator-5554 shell wm density
adb -s emulator-5554 shell settings get system font_scale
adb -s emulator-5554 shell wm density 360
adb -s emulator-5554 shell settings put system font_scale 2.0
adb -s emulator-5554 shell input keyevent KEYCODE_BACK
adb -s emulator-5554 shell pidof com.anssoft.akademiktakvim
adb -s emulator-5554 shell dumpsys activity activities

adb -s emulator-5554 shell dumpsys gfxinfo com.anssoft.akademiktakvim reset
adb -s emulator-5554 shell input swipe 360 1050 360 250 400
adb -s emulator-5554 shell dumpsys gfxinfo com.anssoft.akademiktakvim

adb -s emulator-5554 shell wm density 320
adb -s emulator-5554 shell settings put system font_scale 1.0
adb -s emulator-5554 reverse --remove tcp:8081
adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
```

Scenario changes used a deliberate scoped Metro restart/rebundle. They were not assumed to alter an already bundled fixture. Per-scenario Metro stdout/stderr is retained under `raw/`.

## Runtime, performance, and integrity

- The scoped live-Metro filtered log contains Fabric startup and no fatal, `TypeError`, React/native runtime-error, raw-search, credential, or production-endpoint match. It is stored at [`raw/phase8-filtered-logcat.txt`](./raw/phase8-filtered-logcat.txt).
- Two `Cannot connect to Metro` warnings were emitted only after intentionally tearing down development servers between captures. They are transparently retained in `raw/phase8-dev-server-teardown-logcat.txt` and classified in [`raw/runtime-log-scope-note.txt`](./raw/runtime-log-scope-note.txt). The teardown log has no fatal-exception match and is not relabelled as live-server output.
- Debug APK + Metro + API 24 emulator `gfxinfo` is observational only: 547 total frames, 528 janky (96.53%), p50 26 ms, p90 42 ms, p95 46 ms, p99 61 ms. No release threshold, production-runtime, or performance-acceptance claim is made. Raw summary/frame data is in `raw/long-feed-gfxinfo-summary.txt` and `raw/long-feed-gfxinfo-framestats.txt`.
- The artifact audit passed 20 PNGs, 20 XML files, basename pairing, and 720×1280 dimensions. Full SHA-256 values for every accepted PNG/XML are in [`raw/integrity-index.txt`](./raw/integrity-index.txt); placeholder or reconstructed hashes are not used.
- Repository hygiene passed `git diff --check` plus the forbidden-modifier, snapshot, vacuous-test, search log/persistence, credential/production literal, unsafe-preview-URL, raw-diagnostic-search, credential-diagnostic, live-fatal, and teardown-fatal scans. `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. The captured ledger is [`raw/repository-hygiene.txt`](./raw/repository-hygiene.txt).

## Restoration and exact non-claims

Restoration passed: physical 720×1280, density 320, font scale 1.0, no ADB reverse, no port-8081 listener, and no app PID. The emulator was deliberately retained. See [`raw/restoration-proof.txt`](./raw/restoration-proof.txt).

- `accessibility_enabled=0` and `enabled_accessibility_services=null`; TalkBack was unavailable. UIAutomator labels are not screen-reader traversal evidence.
- Windows has no Xcode/iOS simulator. No iOS build, runtime, Dynamic Type, VoiceOver, native iOS Share, swipe-back, or Liquid Glass acceptance is claimed.
- API 24 proves ordinary Back only; it cannot demonstrate API 33+ predictive Back callbacks/animation.
- The contained synthetic handoff proves local failure containment and route/process preservation, not a successful external browser/provider round trip.
- The preview cannot prove live authentication/session ownership, exact endpoint retrieval, production source health/pagination, provider behavior, or production content. No production account, credential, API, provider, or data was used.
