# Phase 9 Android native evidence

## Environment and safety boundary

- Device: `emulator-5554`, AVD `AcademicPhase1Low`.
- Platform: Android 7.0 / API 24 / x86_64.
- Fixture source: dual-gated `CalendarPreview`, synthetic local records only.
- No production account, backend, Google account/calendar, provider, or data was accessed.
- The preview cannot prove authenticated storage/provider lifecycle; those boundaries use automated owner/lifecycle tests.

## Profiles reviewed

| Profile | Effective layout | Coverage |
|---|---|---|
| Phone light | 720×1280 px, density 320, 360 dp, font scale 1.0 | Agenda/Week/Month, all states, details, Back, CRUD, native dialogs, Google partial |
| Phone dark | 720×1280 px, density 320, 360 dp, font scale 1.0 | Agenda color/contrast and classification |
| Compact large text | 720×1280 px, density 360, 320 dp, font scale 2.0 | Vertical view control, long Turkish text, sheet scrolling, reachable actions |
| Tablet | 1280×1920 px, density 240, approximately 853 dp, font scale 1.0 | Agenda and Month readable-width/layout behavior |

## Smoke results

- Agenda is selected on initial launch; Week and Month switch without losing item identity.
- Academic detail exposes source and inclusive date-only meaning. Android system Back returns to the Calendar screen in the same process.
- Personal exam create launches the Android date and time dialogs; created detail, edit, edited detail, delete alert, and removal were observed.
- Loading, populated, empty, stale-retained, partial-retained, offline-retained, refreshing-retained, error, and Google-partial states are distinct.
- Type is visible as icon and text as well as color.
- At exact 320 dp/font-scale-2, the view selector stacks vertically, titles wrap, and editor/detail actions remain reachable after vertical scroll.
- Temporary tablet Agenda and Month remain bounded and readable.

## Artifact inventory and integrity

`screenshots/` and `hierarchies/` contain 33 basename-matched original-resolution PNG/XML pairs. [`raw/integrity-index.txt`](raw/integrity-index.txt) records pair counts, dimensions, and hashes. [`raw/final-runtime-logcat.txt`](raw/final-runtime-logcat.txt) is the final cold-source log and [`raw/final-filtered-logcat.txt`](raw/final-filtered-logcat.txt) records zero matched fatal/runtime patterns with the same PID before and after Back.

The final x86_64 debug APK was 56,804,991 bytes with SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD`. The final assembly passed in 1m22s with 268 tasks (7 executed / 261 up-to-date).

## Restoration and limitations

[`raw/restoration-proof.txt`](raw/restoration-proof.txt) records the restored 720×1280, density-320, font-scale-1.0 profile, no ADB reverse, no port-8081 listener, and no app process. The AVD was retained.

TalkBack was unavailable (`accessibility_enabled=0`), so XML semantics are not screen-reader traversal evidence. API 24 cannot demonstrate predictive Back. Windows cannot supply an iOS build/simulator, VoiceOver, Dynamic Type, or native Liquid Glass result. A synthetic preview cannot establish live SecureStore/account/provider behavior.
