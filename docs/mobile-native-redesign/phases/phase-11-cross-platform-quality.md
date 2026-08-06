# Phase 11 — Cross-Platform Quality

Status: Phase 11 implementation, automated validation, Android debug/release
performance evidence, installed-app native evidence, and final hygiene are
complete. This report is included in the required single scoped local commit.
Full two-platform native visual acceptance remains explicitly unclaimed because
iOS is unavailable on Windows.

Date: 6 August 2026

Branch: `agent/google-play-readiness-20260724`

Accepted Phase 10 baseline and starting HEAD:
`8dbe5e1efdb0c5fab665345188228ff66a0f84f6`

Current HEAD before the required Phase 11 commit:
`8dbe5e1efdb0c5fab665345188228ff66a0f84f6`

Required local commit subject:
`feat(mobile-native): complete cross-platform quality hardening`

## Repository entry gate

- The accepted baseline is an ancestor of HEAD; HEAD was exactly the accepted
  baseline before Phase 11 work began.
- There were no commits after the accepted baseline.
- The tracked worktree and index were clean before edits.
- Twenty-three unrelated untracked paths were recorded and preserved. No
  reset, rebase, amend, clean, stash, discard, push, deploy, publish, migration,
  or production/provider access was performed.

## Scope completed

- Audited routed authentication/onboarding, Home, Announcements and detail,
  Calendar and personal-exam flows, Profile/settings, navigation, fields,
  selectors, sheets, dialogs, switches, feedback, and system states for roles,
  labels, state, focus, announcements, and non-color meaning.
- Added route-title focus, sheet heading/return focus, validation-error focus,
  and active-route result feedback. Feed search/filter and Calendar view/period
  changes now announce useful result context and counts.
- Corrected semantic light/dark text and outline tokens and added deterministic
  4.5:1 normal-text and 3:1 meaningful-boundary regression checks. Disabled,
  selected, invalid, busy, expanded, status, destructive, and event-type states
  remain distinguishable without color alone.
- Reconciled the 320, 360, 393, 430, and 853 dp policies at 130%, 150%, and
  200% font scale. Forms and long reading surfaces keep readable maximum widths,
  compact controls stack, tabs reserve the platform-safe navigation height, and
  unbounded reachable collections remain virtualized.
- Completed reachable light/dark presentation, including bootstrap/error/
  fallback states and the YÖK and Summer School destinations. React Navigation
  now receives the semantic theme, and the Android splash has a dark semantic
  background. Liquid Glass eligibility remains navigation/control chrome only;
  reading, form, feed, Calendar, and settings surfaces stay opaque.
- Preserved restrained motion and deterministic reduced-motion and
  reduced-transparency policies. No continuous decorative animation, Three.js,
  or interaction-blocking animation was introduced.
- Hardened the release feed performance runner so it records Git/build/runtime
  metadata, proves Hermes/Fabric and non-debuggable/no-Metro operation, applies
  and restores an exact device profile, captures one activity-start timing, and
  measures five deterministic 100-record feed trials.
- Preserved safe canonical HTTP(S) official-link handoff and all Phase 1–10
  authentication, academic-content trust, notification, Google Calendar,
  personal-exam ownership/persistence, Profile, and destructive-action
  contracts. Phase 11 adds no product feature or second navigation model.

## Files changed

| Area | Paths |
|---|---|
| Application/config | `apps/mobile-native/App.tsx`, `apps/mobile-native/app.json` |
| Academic, content, Calendar, auth, Profile | `src/academic/AcademicProfileFields.tsx`; `src/announcements/AnnouncementsFeed.tsx` and new `SourceDestinationScreens.tsx`; `src/auth/AuthScreens.tsx`; `src/calendar/CalendarEventDetail.tsx`, `CalendarExperience.tsx`, and `PersonalExamEditor.tsx`; `src/profile/ProfileSettings.tsx` |
| Design system/platform | `src/design-system/platform.ts`, `tokens.ts`, and primitives `BottomSheet.tsx`, `Button.tsx`, `Content.tsx`, `SelectField.tsx` |
| Navigation/system state | `src/navigation/AdaptiveTopBar.tsx`, `AppNavigator.tsx`, `app-shell.ts`, and new `navigation-theme.ts` and `SystemStateScreens.tsx` |
| Notifications/performance | `src/notifications/native-notification-adapter.ts`, `src/performance/feed-performance.ts`, `performance/README.md`, `performance/release-evidence.json`, `scripts/measure-mobile-native-feed-performance.ts` |
| Native tests | Announcement, Calendar, design-system, navigation, and Profile suites; new `tests/announcements/SourceDestinationScreens.test.tsx` and `tests/quality/CrossPlatformQuality.test.tsx` |
| Root tests | `mobile-native-app-shell.test.ts`, `mobile-native-auth-recovery.test.ts`, `mobile-native-design-foundation.test.ts`, `mobile-native-feed-performance.test.ts`, and new `mobile-native-cross-platform-quality.test.ts` |
| Documentation | `DESIGN_SYSTEM.md`, `PLATFORM_ADAPTATION.md`, `SCREEN_INVENTORY.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_MATRIX.md`, this report, and the Phase 11 native-evidence index |

The exact final scoped file list is owned by the final staged diff. Unrelated
untracked files are not Phase 11 changes and must remain unstaged.

## Design and architecture decisions

1. Semantic tokens remain the only raw palette source under
   `apps/mobile-native/src`; reachable screens do not own local color systems.
   `App.tsx` still contains dormant compatibility JSX/styles with raw colors.
   That is documented MN-010 architecture debt, not falsely closed by Phase 11;
   the final diff scan must prove Phase 11 added no new raw `App.tsx` palette.
2. The one active owning route presents important feedback. Focus moves to a
   route heading, modal heading, or invalid field when context changes and
   returns to the launcher where the platform permits.
3. Selection and classification use text, icon/check shape, and accessibility
   state in addition to color. Cards preserve caller-supplied roles and busy
   state; switches expose the same disabled state at wrapper and native-control
   levels.
4. Existing bottom tabs remain the phone navigation model. Tablet policy may
   use the established adaptive rail, but no feature route or information
   architecture changed. Android reserves 80 dp and iOS 64 pt for reachable
   bottom navigation at large text.
5. Android uses opaque Material-compatible tonal surfaces, ripple, edge-to-edge,
   and ordinary Back. iOS glass remains eligible navigation/control chrome only,
   with opaque semantic fallback for unavailable glass or Reduce Transparency.
6. Performance changes are evidence hardening, not speculative tuning. Existing
   list virtualization is retained without forcing clipping or smaller batches;
   the rejected SwiftShader and batch-size experiments remain historical
   controls in the evidence record.
7. Native warm light/dark switching exposed a stale Android ripple-backed
   Button background. The shared Button now remounts its native control by
   semantic theme mode so ripple/background/foreground change as one tested
   contrast-safe pair; final pixel evidence records `#4338CA` in light and
   `#A5B4FC` in dark.

Decision D-051 in `DECISIONS.md` is the normative Phase 11 reconciliation.

## API and data contracts

None. Phase 11 changes no endpoint, DTO, database schema, repository, session or
recent-authentication rule, notification registration/provider contract, Google
Calendar ownership/lifecycle/storage rule, personal-exam persistence envelope,
or production-data behavior. YÖK and Summer School retain trusted academic
content and date-only/range semantics; no clock time is invented. Only synthetic
local fixtures were used.

## Accessibility and contrast result

Automated and renderer evidence passes for roles/labels; selected, checked,
disabled, busy, expanded, invalid, and error state; route/sheet/validation focus
handoffs; live result announcements; programmatically named switches; decorative
content hiding; non-color selection/classification; and minimum 48 dp Android /
44 pt iOS policy. Light and dark token tests require every audited normal-text
pair to meet at least 4.5:1 and meaningful controls, outlines, focus, status, and
disabled boundaries to meet at least 3:1.

This is not TalkBack or VoiceOver runtime acceptance. TalkBack is unavailable on
the authorized API 24 image, and Windows cannot run VoiceOver. UIAutomator
hierarchies, once captured, are structural evidence only and must not be
relabelled as screen-reader traversal.

## Responsive, dark-mode, and reduced-effect result

Deterministic policy coverage passes for 320/360/393/430/853 dp and font scales
1.3/1.5/2.0. It verifies single-column collapse, readable 720 dp maximums,
stacked compact controls, no horizontal-scrolling policy, unclipped one-line tab
labels, 48 dp Android targets, and tablet gutters/adaptive navigation. Long
selected institution values are no longer silently truncated.

Light/dark component state and navigation-theme tests pass, including system
states and disabled controls. Reduced Motion simplifies sheet/result behavior;
Reduce Transparency selects opaque readable fallback. Native iOS, Dynamic Type,
bold-text, Reduce Transparency, swipe-back, and Liquid Glass runtime behavior
remain unverified. The app remains intentionally portrait-only; Phase 11 does
not introduce unsupported rotation or multitasking behavior.

## Performance result

`$env:FEED_PERFORMANCE_EPHEMERAL_DEVICE='1'; npm.cmd run
measure:mobile-native:feed-release` passed on
`AcademicPhase1Low`, API 24, x86_64, host OpenGL renderer. The fresh release APK
used Hermes/Fabric/new architecture, was non-debuggable, required no Metro, was
29,525,380 bytes, and had SHA-256
`6f32ed35453881073664c516792b69fae2a6af82e18109a7535fce92be2ede63`.
Gradle executed 430 tasks in 8 min 03 s. The one cold activity-start sample was
ThisTime 630 ms, TotalTime 630 ms, WaitTime 660 ms; it is not a percentile.

Five trials each produced 120 valid frames (600 aggregate). Aggregate p90 was
18.965375 ms, p95 was 19.595379 ms, and frozen frames were 0, passing thresholds
of p90 <= 32 ms, p95 <= 50 ms, at least 100 valid frames per trial, and no frame
at or above 700 ms. The runner restored the exact original display, density,
font, animation, package, and prior artifact state and added no ADB reverse.

This proves one release activity start and the deterministic 100-record
Announcements feed only. It does not establish release timing distributions for
the shell, Home, Agenda/Week/Month, personal-exam editor, selectors, Profile,
iOS, physical devices, or a production fleet. Those surfaces retain static
virtualization/renderer coverage and are not relabelled as measured timings.

## Tests added or materially extended

- New root Phase 11 suite: semantic contrast, complete width/font matrix,
  platform/reduced-effect policy, raw-color boundary, non-color semantics,
  focus/announcement handoff, collection virtualization, opaque/glass boundary,
  and safe-link canonicalization.
- New native Phase 11 suite: Card semantics, light/dark disabled controls,
  sheet focus return, invalid long selector behavior, and semantic system states.
- New source-destination native suite for virtualized YÖK/Summer state truth,
  trusted date semantics, and safe official-link actions.
- Existing design-foundation, app-shell, auth, feed, Calendar, navigation,
  Profile, and release-performance suites were extended for the repaired
  boundaries. A stale Phase 1 static assertion was updated to recognize the
  shared semantic Banner; its focused rerun passed 20/20 before the final full
  regression.

## Exact automated commands and results

| Command | Result |
|---|---|
| `npx.cmd vitest run tests/unit/mobile-native-cross-platform-quality.test.ts tests/unit/mobile-native-design-foundation.test.ts tests/unit/mobile-native-feed-performance.test.ts tests/unit/mobile-native-content-trust.test.ts tests/unit/mobile-native-notification-adapter.test.ts --configLoader runner` | PASS — 5 files / 77 tests |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/quality/CrossPlatformQuality.test.tsx tests/design-system/actions.test.tsx tests/design-system/feedback.test.tsx tests/design-system/fields-content.test.tsx tests/design-system/selection-sheet.test.tsx tests/design-system/theme-surfaces.test.tsx tests/navigation/AdaptiveTopBar.test.tsx tests/navigation/AppNavigator.test.tsx tests/auth/AuthScreens.test.tsx tests/announcements/AnnouncementsFeed.test.tsx tests/announcements/SourceDestinationScreens.test.tsx tests/calendar/CalendarExperience.test.tsx tests/calendar/CalendarEventDetail.test.tsx tests/calendar/PersonalExamCancellation.test.tsx tests/profile/ProfileSettings.test.tsx` | PASS — final rerun: 15 suites / 155 tests / 0 snapshots |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — final rerun: 25 suites / 227 tests / 0 snapshots; Phase 10 was 23 / 206 |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests using a dedicated temporary `127.0.0.1` Mongo fixture, stopped after the run |
| `npm.cmd test -- --configLoader runner` | PASS — 73 files / 854 tests; Phase 10 was 72 / 841 |
| `npm.cmd test -- tests/unit/phase-1-8-documentation-consistency.test.ts --configLoader runner` | PASS — 1 file / 7 tests after final documentation reconciliation |
| `npx.cmd vitest run apps/api/tests/server-outbound-inventory.test.ts --configLoader runner` | PASS — 1 file / 2 tests; approved outbound boundary unchanged |
| `npm.cmd run typecheck` | PASS — workspace TypeScript |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS — native TypeScript |
| `npm.cmd run build:admin -- --configLoader runner` | PASS — final rerun: 1,742 modules; JS 250.51 kB / 73.89 kB gzip; 10.66 s |
| `npm.cmd run build:mobile -- --configLoader runner` | PASS — final rerun: 1,755 modules; JS 349.76 kB / 104.37 kB gzip; 14.14 s |
| `$env:FEED_PERFORMANCE_EPHEMERAL_DEVICE='1'; npm.cmd run measure:mobile-native:feed-release` | PASS — release x86_64 Hermes/Fabric, 5 trials / 600 frames, p90 18.965375 ms, p95 19.595379 ms, 0 frozen; the guard authorized replacing only the disposable local package |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | PASS — 43 s; 268 tasks (7 executed / 261 up-to-date); APK 56,804,991 bytes; SHA-256 `FA93D03F277DB169564B09CC4E389D146D0D0E6911C7CA0774372DFB8A0A1BCA` |
| Android install and Phase 11 native state matrix on `AcademicPhase1Low` | PASS — install `Success`; version `0.1.1`, versionCode `12`, x86_64; 32 PNG + 32 paired XML artifacts; clean runtime/sensitive scan; exact restoration and teardown |
| Final whitespace, NUL, secret/log, credential, Firestore, outbound/TLS, fake-social, forbidden-test, raw-color, and Phase 12 scope gates | PASS — `git diff --check`; 113 intended text artifacts with zero trailing-whitespace/NUL findings; no prohibited match; ports 8081/27017 clear and no ADB device attached |

The first admin/mobile-web build attempts were blocked before compilation by
restricted parent-config reads. Identical unchanged-source reruns with the
required filesystem access passed; these are environment diagnostics, not
product failures. No live service was required by any successful run.

## Native Android evidence

The final x86_64 debug assembly passed in 43 seconds with 268 tasks (7 executed /
261 up-to-date). The APK is 56,804,991 bytes with SHA-256
`FA93D03F277DB169564B09CC4E389D146D0D0E6911C7CA0774372DFB8A0A1BCA`.
Installation returned `Success`; package metadata reports version `0.1.1`,
versionCode `12`, and x86_64. The final native APK hash remained stable after
the JavaScript-only shared-Button theme repair; final captures used the repaired
source through a restarted local Metro preview.

[`evidence/phase-11-native`](../evidence/phase-11-native/README.md) indexes 32
original-resolution PNGs and 32 basename-paired UIAutomator XML exports. Its
integrity index has 97 rows for those 64 artifacts plus 33 raw evidence files;
the index SHA-256 is
`AD1F872742FCD8819A25B61CBC8EE22F90234EA03BAA44EB32C96D629F2AA419`.
Reviewed profiles cover 320, 360, 393, 430, and approximately 853 dp; 100%,
130%, 150%, and 200% font scales; light and dark themes; keyboard-open Login,
Calendar editor, and Profile fields; native Android date and time pickers;
Agenda/Week/Month; feed/detail; Profile/settings and Google states; destructive
confirmation/action reachability; and reduced motion with all three animation
scales set to 0.

Ordinary Android Back returned from announcement detail to the feed in the same
PID (`6978`) and from Calendar detail to the event list in the same PID (`8099`).
This is not predictive-Back evidence. At 320 dp / 200% text, feed filters,
Calendar records, and the irreversible destructive action remained vertically
scroll-reachable without accepted horizontal clipping.

The native review found and repaired one real warm-theme defect: Android's
ripple-backed Button could retain the previous mode's background. Remounting the
shared native control by `theme.mode` makes the semantic foreground/background
pair transition atomically. Final pixel checks recorded light `#4338CA` and dark
`#A5B4FC` after warm mode changes.

The final runtime scan reports zero fatal/React errors and zero sensitive-value
matches. Cleanup restored physical 720 x 1280, density 320, font scale 1.0, and
the exact original `null` values for window, transition, and animator scales;
removed the ADB reverse; uninstalled the debug package; verified ports 8081 and
27017 clear; and shut down the AVD. The release-performance run separately
restored its exact device/package/artifact state as recorded above.

## Known limitations

- Full cross-platform native visual acceptance is not claimed. Windows has no
  Xcode/iOS simulator and cannot prove iOS build/launch, VoiceOver, Dynamic Type,
  bold text, native swipe-back, Liquid Glass, or Reduce Transparency runtime.
- TalkBack is unavailable on the authorized AVD. API 24 cannot prove Android 13
  notification permission/channel behavior or modern predictive Back.
- The tablet profile is an emulator display/density override rather than a
  physical tablet/foldable; portrait is the declared supported orientation.
- No authorized live Google Calendar, FCM, APNs, authenticated backend/content,
  production account, provider, calendar, credential, or data was accessed.
- No Maestro/Detox/Appium installed authenticated E2E suite, automated native
  screenshot-regression runner, shipped observability, or production-device
  performance distribution exists.
- `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact: the repository still has no
  applicable mobile-native lint script, configuration, or dependency.
- `App.tsx` remains a large orchestrator with dormant compatibility JSX and raw
  styles. Reachable routed screens use semantic modules, but broad decomposition
  is still MN-010 architecture debt.

## Regressions checked

The complete native Jest, complete API, and full root suites cover Phase 1–10
auth/session recovery, hierarchy clearing, trusted content/safe URLs,
notifications, Home/feed, Google owner/late-operation protections, Calendar
date-only/range behavior, personal-exam CRUD/persistence/account isolation,
Profile/settings, recent authentication, destructive flows, navigation Back,
and synthetic preview gates. Both TypeScript graphs and both web regression
builds and the bounded Android native matrix pass. Final whitespace/NUL,
sensitive-log, credential, Firestore/outbound/TLS, fake-social, forbidden-test,
raw-color, and Phase 12 scope scans pass. The one existing SMTP warning says
only that a recovery message was not sent and logs no credential or payload.

## Working-tree status and next-phase handoff

At final pre-commit audit, the worktree contains only the intended
tracked/untracked Phase 11 patch plus the separately recorded unrelated
untracked files. The final repository check must confirm one scoped local
commit and a clean tracked worktree/index while preserving every unrelated
untracked path.

Phase 12 implementation scan: no Phase 12 implementation;
`PHASE_12_NOT_STARTED`. Its final reconciliation must begin only from an
accepted Phase 11 commit and must inherit the explicit iOS, TalkBack,
modern-Android, provider, lint, E2E, physical-device, dormant-`App.tsx`, and
performance-scope limitations above rather than converting them into passes.
