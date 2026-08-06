# Phase 11 Android native evidence

## Environment and safety boundary

- Source baseline/current HEAD at capture: `8dbe5e1efdb0c5fab665345188228ff66a0f84f6` plus the uncommitted, scoped Phase 11 working-tree patch. The final commit is reported by the Phase 11 completion handoff because a commit cannot contain its own hash.
- Device: existing `AcademicPhase1Low` AVD, Android 7.0 / API 24 / x86_64, serial `emulator-5554`.
- Final debug assembly: `:app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon`, PASS in 43 s, 268 tasks (7 executed, 261 up-to-date).
- Debug APK: version `0.1.1` / versionCode `12`, 56,804,991 bytes, SHA-256 `FA93D03F277DB169564B09CC4E389D146D0D0E6911C7CA0774372DFB8A0A1BCA`.
- Fixture source: development-only Phase 6–10 synthetic preview gates, isolated to one gate per Metro restart with `EXPO_OFFLINE=1`. Fixtures use `.invalid` or reserved preview hosts. No production account, backend, provider, calendar, notification delivery, credential, or data was accessed.
- The final native Java/Kotlin APK hash was unchanged after the JavaScript-only Button repair. The installed native APK therefore already matched the final assembly; the final source was served by the restarted local Metro preview before the final captures and theme-transition proof.

[`raw/android-device-and-build.txt`](raw/android-device-and-build.txt) contains the APK/package and AVD metadata. [`raw/capture-preview.ps1`](raw/capture-preview.ps1) is the bounded capture helper used for cold preview launches.

## Reviewed matrix

Every retained PNG was reviewed at original resolution and has a basename-matched UIAutomator XML export.

| Profile | Native coverage |
|---|---|
| 360 dp / 100% | Light login and keyboard; dark Home; Calendar Agenda/Week/Month, detail/Back, editor keyboard, Android date/time pickers, cold and warm theme transitions; reduced-motion sheet |
| 393 dp / 130% | Dark registration, long Turkish Home context, Profile summary, notification active/settings-required truth, Google Calendar partial success |
| 430 dp / 150% | Announcement detail and same-process Android Back to the feed |
| 320 dp / 200% | Dark feed and Calendar top/scrolled reachability; destructive sheet top and scroll-reachable irreversible action |
| Approximately 853 dp / 100% | Month Calendar and Profile grouped inside readable centered widths using `wm size 1280x1920`, density 240 |

The app remains intentionally portrait-only. Landscape behavior is not claimed. Tablet evidence uses a temporary display/density override on the authorized AVD, not a physical tablet or foldable.

## Artifact inventory

### Authentication and Home

- Login: [PNG](screenshots/android-auth-login-light-360-font100.png) / [XML](hierarchies/android-auth-login-light-360-font100.xml)
- Login keyboard: [PNG](screenshots/android-auth-login-keyboard-light-360-font100.png) / [XML](hierarchies/android-auth-login-keyboard-light-360-font100.xml)
- Dark registration at 130%: [PNG](screenshots/android-auth-register-dark-393-font130.png) / [XML](hierarchies/android-auth-register-dark-393-font130.xml)
- Long-title Home at 130%: [PNG](screenshots/android-home-long-title-light-393-font130.png) / [XML](hierarchies/android-home-long-title-light-393-font130.xml)
- Dark Home: [PNG](screenshots/android-home-populated-dark-360-font100.png) / [XML](hierarchies/android-home-populated-dark-360-font100.xml)

### Announcements

- Detail at 430 dp / 150%: [PNG](screenshots/android-feed-detail-light-430-font150.png) / [XML](hierarchies/android-feed-detail-light-430-font150.xml)
- Feed after ordinary Back: [PNG](screenshots/android-feed-after-back-light-430-font150.png) / [XML](hierarchies/android-feed-after-back-light-430-font150.xml)
- Dark 320 dp / 200% top: [PNG](screenshots/android-feed-long-title-dark-320-font200.png) / [XML](hierarchies/android-feed-long-title-dark-320-font200.xml)
- Dark 320 dp / 200% scrolled content: [PNG](screenshots/android-feed-long-title-dark-320-font200-scrolled.png) / [XML](hierarchies/android-feed-long-title-dark-320-font200-scrolled.xml)

### Calendar and personal exams

- Agenda: [PNG](screenshots/android-calendar-agenda-light-360-font100.png) / [XML](hierarchies/android-calendar-agenda-light-360-font100.xml)
- Week: [PNG](screenshots/android-calendar-week-light-360-font100.png) / [XML](hierarchies/android-calendar-week-light-360-font100.xml)
- Month: [PNG](screenshots/android-calendar-month-light-360-font100.png) / [XML](hierarchies/android-calendar-month-light-360-font100.xml)
- Academic all-day/range detail: [PNG](screenshots/android-calendar-academic-detail-light-360-font100.png) / [XML](hierarchies/android-calendar-academic-detail-light-360-font100.xml)
- Calendar after ordinary Back: [PNG](screenshots/android-calendar-after-back-light-360-font100.png) / [XML](hierarchies/android-calendar-after-back-light-360-font100.xml)
- Personal-exam editor: [PNG](screenshots/android-calendar-personal-editor-light-360-font100.png) / [XML](hierarchies/android-calendar-personal-editor-light-360-font100.xml)
- Personal-exam keyboard: [PNG](screenshots/android-calendar-personal-editor-keyboard-light-360-font100.png) / [XML](hierarchies/android-calendar-personal-editor-keyboard-light-360-font100.xml)
- Native Android date picker: [PNG](screenshots/android-calendar-personal-date-picker-light-360-font100.png) / [XML](hierarchies/android-calendar-personal-date-picker-light-360-font100.xml)
- Native Android time picker: [PNG](screenshots/android-calendar-personal-time-picker-light-360-font100.png) / [XML](hierarchies/android-calendar-personal-time-picker-light-360-font100.xml)
- Final cold dark Agenda: [PNG](screenshots/android-calendar-agenda-dark-final-360-font100.png) / [XML](hierarchies/android-calendar-agenda-dark-final-360-font100.xml)
- Final warm light transition: [PNG](screenshots/android-calendar-theme-transition-light-360-font100.png) / [XML](hierarchies/android-calendar-theme-transition-light-360-font100.xml)
- Final warm dark transition: [PNG](screenshots/android-calendar-theme-transition-dark-360-font100.png) / [XML](hierarchies/android-calendar-theme-transition-dark-360-font100.xml)
- Dark 320 dp / 200% top: [PNG](screenshots/android-calendar-long-title-dark-320-font200.png) / [XML](hierarchies/android-calendar-long-title-dark-320-font200.xml)
- Dark 320 dp / 200% scrolled records: [PNG](screenshots/android-calendar-long-title-dark-320-font200-scrolled.png) / [XML](hierarchies/android-calendar-long-title-dark-320-font200-scrolled.xml)
- Tablet Month: [PNG](screenshots/android-calendar-month-light-tablet-font100.png) / [XML](hierarchies/android-calendar-month-light-tablet-font100.xml)

### Profile, integrations, and destructive actions

- Profile at 393 dp / 130%: [PNG](screenshots/android-profile-summary-light-393-font130.png) / [XML](hierarchies/android-profile-summary-light-393-font130.xml)
- Active notification truth: [PNG](screenshots/android-notifications-active-light-393-font130.png) / [XML](hierarchies/android-notifications-active-light-393-font130.xml)
- Dark settings-required notification truth: [PNG](screenshots/android-notifications-settings-required-dark-393-font130.png) / [XML](hierarchies/android-notifications-settings-required-dark-393-font130.xml)
- Dark Google Calendar partial success: [PNG](screenshots/android-google-calendar-partial-dark-393-font130.png) / [XML](hierarchies/android-google-calendar-partial-dark-393-font130.xml)
- Destructive sheet at 320 dp / 200%: [PNG](screenshots/android-data-delete-confirm-light-320-font200.png) / [XML](hierarchies/android-data-delete-confirm-light-320-font200.xml)
- Scroll-reachable destructive action: [PNG](screenshots/android-data-delete-confirm-action-light-320-font200.png) / [XML](hierarchies/android-data-delete-confirm-action-light-320-font200.xml)
- Tablet Profile: [PNG](screenshots/android-profile-summary-light-tablet-font100.png) / [XML](hierarchies/android-profile-summary-light-tablet-font100.xml)
- Reduced-motion destructive sheet: [PNG](screenshots/android-reduced-motion-data-sheet-light-360-font100.png) / [XML](hierarchies/android-reduced-motion-data-sheet-light-360-font100.xml)

## Measured native checks

- Agenda, Week, and Month exported selected radio state, check marks, and text labels; event classifications exported icon/text rather than color alone.
- The academic detail retained `3 Ağustos 2026 – 7 Ağustos 2026` and `Tüm gün · son gün dahildir · saat bilgisi verilmemiştir`; no clock time was invented.
- The personal-exam editor exposed labeled title/date/time controls and the API 24 platform date and clock dialogs. No exam was saved and no provider was called.
- Feed Back returned to `Duyurular` in PID `6978`; Calendar detail Back returned to the Calendar event list in PID `8099`. [`raw/android-feed-back.txt`](raw/android-feed-back.txt) and [`raw/android-calendar-back.txt`](raw/android-calendar-back.txt) record the same-process checks. This is ordinary Android Back, not predictive Back.
- Keyboard presence is retained in [`raw/android-auth-keyboard-input-method.txt`](raw/android-auth-keyboard-input-method.txt) and [`raw/android-calendar-editor-input-method.txt`](raw/android-calendar-editor-input-method.txt).
- The verified runtime-theme defect was a stale Android ripple-backed Button background after a warm mode change. The shared Button now remounts its native control by semantic mode. Final pixel checks record light `#4338CA` and dark `#A5B4FC` in [`raw/android-runtime-theme-transition.txt`](raw/android-runtime-theme-transition.txt); both are paired with their tested semantic foregrounds.
- With window, transition, and animator duration scales all set to `0`, the reduced-motion sheet rendered immediately and remained usable. [`raw/android-reduced-motion-settings.txt`](raw/android-reduced-motion-settings.txt) records the values. Android API 24 has no Reduce Transparency runtime switch; opaque fallback is deterministic renderer/code evidence only.
- At 320 dp / 200% text, filters, Calendar records, and the destructive confirmation action remained vertically scroll-reachable. Large text intentionally spans multiple lines/screens; no horizontal-scrolling navigation or clipped irreversible action was accepted.
- Tablet Calendar/Profile content remains centered within the 720 dp readable-width policy instead of stretching to the full approximately 853 dp width.

## Runtime, integrity, and cleanup

- [`raw/android-runtime.log`](raw/android-runtime.log) is the scoped final synthetic Profile/Google smoke log. [`raw/android-runtime-scan.txt`](raw/android-runtime-scan.txt) records zero fatal/React errors and zero sensitive-value matches. Debug-level `AndroidRuntime` lines created by ordinary `adb shell` command processes are not fatal exceptions and are explicitly excluded from the error pattern.
- There are 32 original-resolution PNG files and 32 basename-matched UIAutomator XML files. [`raw/integrity-index.csv`](raw/integrity-index.csv) contains 97 rows covering those 64 artifacts plus 33 raw evidence files, with byte counts and SHA-256 hashes. The index SHA-256 is `AD1F872742FCD8819A25B61CBC8EE22F90234EA03BAA44EB32C96D629F2AA419`.
- [`raw/android-cleanup.txt`](raw/android-cleanup.txt) confirms restoration to physical 720 x 1280, density 320, font scale 1.0, and the exact original `null` values for all three animation settings. It also records removal of the ADB reverse, successful uninstall of the debug package installed for this run, clear ports 8081/27017, and AVD shutdown.

## Limitations

- TalkBack was unavailable and disabled (`accessibility_enabled=0`, no enabled services or TalkBack package). UIAutomator is structural semantic evidence, not TalkBack traversal acceptance.
- API 24 cannot prove Android 13 notification permission/channel behavior, modern predictive Back, or modern system bold-text behavior.
- Windows cannot run an iOS build/simulator and cannot prove VoiceOver, Dynamic Type, native swipe-back, Reduce Transparency, or Liquid Glass runtime behavior.
- The release performance harness separately proves only one cold activity start and five deterministic 100-record Announcements-feed trials. It does not measure release-mode shell, Home, Calendar/editor, selectors, Profile, iOS, physical-device, or production-fleet distributions.
- No live Google Calendar, notification provider, authenticated backend, production account, or production data behavior was exercised. Automated contracts, not these fixtures, remain the evidence for authenticated persistence/account switching and provider lifecycle protections.
