# Phase 09 — Calendar and Personal Exams

Status: Complete on the bounded Android/automated evidence described below. Phase 10 was not started.

## Scope completed

- Calendar now opens in **Ajanda** and offers explicit **Ajanda**, **Hafta**, and **Ay** views over one trusted presentation model.
- Academic events preserve date-only values and inclusive ranges. A clock time appears only for records that already contain an instant; the UI never manufactures one for an all-day academic date.
- Event rows identify type with icon, Turkish text, and color, and open an in-app detail surface that discloses source and date semantics.
- Personal exams support owner-scoped create, edit, and delete. Date and time are chosen with native system pickers, validation is explicit, and the existing per-owner SecureStore persistence and account-generation guards remain authoritative across relaunch and account switching.
- The oversized Google Calendar explanation was replaced by a compact status card. Connect, sync, switch-account, disconnect-retain, managed-event removal, revoke, partial-success, owner, cancellation, and late-operation protections remain owned by the Phase 3 lifecycle.
- Loading, populated, empty, stale, partial, offline, refreshing, and recoverable-error presentation is mutually exclusive. Retained useful data remains visible in stale/partial/offline/refreshing states.
- The Calendar and Calendar detail routes are full-bleed list/detail surfaces. Native-stack Back returns from detail to the mounted Calendar state; the Home calendar entry routes to Calendar instead of duplicating creation UI.

## Files changed

- `apps/mobile-native/App.tsx`: Calendar orchestration, owner-guarded personal-exam mutations, detail selection, and compact Google presentation.
- `apps/mobile-native/src/calendar/`: calendar model, Agenda/Week/Month experience, detail, personal-exam editor, native picker wrapper, and synthetic preview.
- `apps/mobile-native/src/design-system/primitives/Content.tsx`: busy card semantics and responsive vertical segmented-control support.
- `apps/mobile-native/src/navigation/AppNavigator.tsx`: full-bleed Calendar/detail route ownership.
- `apps/mobile-native/app.json`, `package.json`, and `package-lock.json`: Expo-compatible native date/time picker registration and dependency.
- `apps/mobile-native/jest.setup.ts`, `apps/mobile-native/tests/calendar/`, and `tests/unit/mobile-native-calendar.test.ts`: deterministic model/component coverage.
- Phase 9 report, design/platform/inventory/decision/known-issue/test-matrix documents, and `evidence/phase-09-native/`.

## Design and architecture decisions

- `calendar-model.ts` is the deterministic presentation boundary. It normalizes view periods, classification, date labels, sorting, and dominant availability without changing an API DTO.
- Agenda is the default and shows current/future planning items grouped by Europe/Istanbul calendar day. Week is a seven-day summary plus accessible item list. Month uses a stable 42-cell grid plus an accessible list so cell density never makes events unreachable.
- Academic and personal items share scanning structure but not ownership. Academic rows are read-only trusted content; only owner-matching personal exams expose edit/delete.
- Compact width or large text selects a vertical view control. The editor is scrollable inside a bottom sheet so native picker launch, cancel, and submit remain reachable at 320 dp and 200% font scale.
- The preview is accepted evidence tooling only when both `__DEV__` and `EXPO_PUBLIC_PHASE9_CALENDAR_PREVIEW=1` are true. It uses synthetic local fixtures and imports no API, storage, or provider module.

## API and data contracts

No endpoint, API DTO, Mongo schema, authentication rule, notification contract, Google provider mutation contract, production configuration, or migration changed.

The existing `manual-exams` SecureStore record remains versioned and owner-scoped. Hydration discards owner-unknown legacy rows; account switching uses the active owner and account generation; stale asynchronous completions cannot write into a later owner. Create, update, and delete all go through the same guarded persistence path. Relaunch and A→B→A restoration are covered by pure tests.

Phase 3 Google lifecycle code remains in place. Remote writes still target only app-managed records whose private marker and Academic Calendar owner ID match. Personal Google Calendar events are never candidates for update or deletion. Retained mappings, partial outcomes, disconnect choices, reauthorization cleanup, revoke, and late-operation guards are unchanged.

## Tests added

- 19 pure Phase 9 cases cover Agenda default, university-scope filtering, date-only and inclusive-range rendering, Europe/Istanbul boundaries, event classification, week/month periods, 42-cell month output, dominant states, native-picker validation, owner-scoped CRUD persistence, relaunch, and A→B→A switching.
- 20 native renderer cases across three suites cover Agenda/Week/Month, all availability states, compact Google status, text/icon classification, detail/source semantics, personal editor and CRUD actions, native picker ownership, accessibility state, Back callback behavior, compact/large-text structure, dark presentation, and preview gating.
- Existing Google synchronization/lifecycle and native calendar synchronization suites remain in the complete regressions.

## Exact commands and results

| Command or check | Result |
|---|---|
| `npm.cmd test -- tests/unit/mobile-native-calendar.test.ts --configLoader runner` | PASS — 1 file / 19 tests |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/calendar/CalendarExperience.test.tsx tests/calendar/CalendarEventDetail.test.tsx tests/calendar/CalendarPreview.test.tsx` | PASS — 3 suites / 20 tests / 0 snapshots |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — 20 suites / 178 tests / 0 snapshots |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests |
| `npm.cmd test -- --configLoader runner` | PASS — 70 files / 820 tests |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run build:admin` | PASS — 1,742 modules; 250.51 kB main JS (73.89 kB gzip) |
| `npm.cmd run build:mobile` | PASS — 1,755 modules; 349.76 kB main JS (104.37 kB gzip) |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | PASS — final incremental run 1m22s, 268 tasks (7 executed / 261 up-to-date) |
| Android install/launch and Calendar/personal-exam smoke matrix on `emulator-5554` | PASS — 33 reviewed PNG/XML pairs; final same-process runtime scan clean |
| Mobile-native lint inventory | `MOBILE_NATIVE_LINT: NOT AVAILABLE`; no tool was invented or relabelled as lint |

The first sandboxed admin/mobile builds and Android assembly could not see required parent configuration/SDK paths. Identical approved local reruns passed. The Android build emitted only the existing Expo `NODE_ENV` notice, Android SDK command-line/version notice, long CMake object-path notice, and Gradle deprecation notices.

## Native screenshots and visual QA

Native evidence is indexed in [`../evidence/phase-09-native/README.md`](../evidence/phase-09-native/README.md). The Android 7.0 / API 24 / x86_64 AVD supplied 33 original-resolution screenshot/hierarchy pairs across:

- 360 dp light Agenda, Week, Month, academic detail, Back retention, native date/time dialogs, create/edit/delete, all availability states, and Google partial status;
- 360 dp dark Agenda;
- exact 320 dp at font scale 2.0, including long Turkish content and reachable editor/detail actions;
- a temporary approximately 853 dp tablet viewport for Agenda and Month.

The final debug APK is 56,804,991 bytes with SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD`. Screenshot/XML basename pairing passed. The device was restored to 720×1280, density 320, font scale 1.0, with no ADB reverse, no Metro listener, and no app process; the emulator was retained.

## Accessibility checks

- Renderer tests assert selected, busy, expanded, invalid, disabled, and error semantics where applicable.
- Event type is conveyed by icon and Turkish text in addition to color.
- Android interactive targets resolve to at least 48 dp and use native ripple through shared primitives.
- The 320 dp/font-scale-2 native pass confirms wrapping, vertical view selection, editor scrolling, and reachable cancel/submit and edit/delete actions.
- UIAutomator hierarchies confirm labels and bounds but are not screen-reader evidence. TalkBack was unavailable (`accessibility_enabled=0`), so traversal/order acceptance remains open.

## Regressions checked

- Phase 1–8 complete root and native suites.
- Complete API suite, including trusted date/range delivery and notification production.
- Existing Google Calendar sync/lifecycle tests: connect/restore, sync idempotency, switching, cleanup, revoke, partial failure, ownership, stale-operation protection, and personal-event exclusion.
- Workspace/native TypeScript, admin/mobile builds, Android x86_64 assembly, native launch/Back, and final runtime error scan.
- Whitespace, sensitive-log, credential, forbidden-test-modifier/snapshot/vacuous-test, Firestore, fake-social, and Phase 10 scope scans are recorded in the final matrix/evidence ledger.

## Known limitations

- Windows cannot provide an iOS build, simulator, Dynamic Type, VoiceOver, or native Liquid Glass acceptance. Eligible iOS glass remains confined to the already established navigation/control boundary with opaque fallback.
- The authorized API 24 AVD proves ordinary Android Back, not API 33+ predictive Back.
- TalkBack is unavailable on the AVD. Semantic tests and UIAutomator inspection do not replace screen-reader acceptance.
- Synthetic local fixtures do not prove a live authenticated relaunch/account-switch session or a real Google chooser/calendar mutation/revoke flow. No production account, calendar, provider, or data was accessed.
- There is no installed Maestro/Detox/Appium flow and no mobile-native lint command.
- `npm install` reports the repository's existing audit state of 17 vulnerabilities (15 moderate, 2 high); no unrelated dependency remediation was attempted in this visual phase.

## Next-phase handoff

Phase 10 was not started. A later authorized phase may consume the existing Calendar route and shared primitives but must not reinterpret Phase 9's date-only, owner, Google-managed-event, or evidence boundaries. iOS/VoiceOver, TalkBack, modern predictive Back, and live-provider acceptance remain explicit later quality gates.

## Git and working-tree record

- Branch: `agent/google-play-readiness-20260724`.
- Accepted baseline and starting/pre-commit HEAD: `7f7a3cab9dacdb70a188b2d7620571f72fd42855`.
- Baseline ancestor check: PASS; it was exactly HEAD and there were no later commits before Phase 9 changes.
- Initial tracked worktree/index: clean. Unrelated untracked logos, missing-link reports/data, later-phase planning files, and prompts were preserved.
- At report authoring: only the scoped Phase 9 implementation, tests, documentation, dependency metadata, and evidence were intended for the required local commit; the final commit ID and post-commit status belong in the execution handoff.

## Acceptance repair — real CRUD, cancellation, and leap-year coverage

This repair started from accepted Phase 9 commit `b8f77c85b4506bd67d7c9b6c6292baedc25a8996`, which was exactly HEAD. The tracked worktree and index were clean, there were no later commits, and unrelated untracked files were preserved. This was not a Phase 9 restart and Phase 10 was not started.

### Focused production extraction

`src/calendar/personal-exam-runtime.ts` is now the single production boundary used by `App.tsx` for personal-exam hydration, validation, create, update, delete, owner-envelope serialization, queued persistence, cleanup restoration, and stale account-generation rejection. Its adapter deliberately matches the asynchronous `getItemAsync` / `setItemAsync` / `deleteItemAsync` shape used by SecureStore. React still owns presentation state; the focused runtime replaces only the formerly nested, untestable personal-exam state/persistence logic. No API, DTO, Google Calendar, notification, authentication, provider, or migration contract changed.

The production integration test uses a deterministic SecureStore-compatible adapter and executes the required sequence without manual array simulation: User A create, real owner-envelope persist, relaunch restore, edit/persist, second relaunch restore, delete/persist, third relaunch empty restore, User B isolation, User B's independent create/persist, return to User A, and a delayed User A restore plus stale mutation rejection after User B activates. The final assertions prove that neither User B's runtime state nor User B's stored envelope changes.

### Cancellation and leap-year closure

- New-exam cancel goes through a callback backed by the production runtime and proves no append, no SecureStore-adapter write, and no visible-list change.
- Edit cancel proves the original record remains unchanged, no write occurs, and a fresh runtime relaunch restores the original envelope.
- Android native date-picker and time-picker dismissal callbacks leave their respective draft values unselected and perform no runtime/storage mutation.
- Leap-year coverage proves a 42-cell February 2024 grid with February 29 exactly once and correct January/March cells, a seven-day week spanning February 29, January→February→March and reverse navigation, a valid system-selected February 29, stable date-only February 29 with no timestamp/UTC day shift, an inclusive February 28–March 1 range on every civil day, and correct non-leap February behavior.

### Acceptance-repair validation ledger

| Exact command/check | Fresh result |
|---|---|
| `npm.cmd test -- tests/unit/mobile-native-personal-exam-integration.test.ts --configLoader runner` | PASS — 1 file / 1 production integration test |
| `npm.cmd test -- tests/unit/mobile-native-calendar.test.ts --configLoader runner` | PASS — 1 file / 25 model tests |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/calendar/CalendarExperience.test.tsx tests/calendar/CalendarEventDetail.test.tsx tests/calendar/CalendarPreview.test.tsx tests/calendar/PersonalExamCancellation.test.tsx` | PASS — 4 suites / 24 tests / 0 snapshots |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — 21 suites / 182 tests / 0 snapshots |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests against a dedicated localhost Mongo fixture |
| `npm.cmd test -- --configLoader runner` | PASS — 71 files / 827 tests |
| `npm.cmd test -- tests/unit/phase-1-8-documentation-consistency.test.ts --configLoader runner` | PASS — 1 file / 7 tests after documentation updates |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run build:admin` | PASS — 1,742 modules; 250.51 kB main JS / 73.89 kB gzip |
| `npm.cmd run build:mobile` | PASS — 1,755 modules; 349.76 kB main JS / 104.37 kB gzip |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` | PASS — 1m29s; 268 tasks (7 executed / 261 up-to-date); 56,804,991-byte APK; SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD` |
| Android API 24 / x86_64 Calendar and personal-exam repair smoke | PASS — fresh APK install; Agenda/Week/Month selection; Android date/time dialog cancel; editor cancel; same PID `3605`; zero filtered fatal/runtime matches; device restored to 720×1280, density 320, font scale 1.0, no ADB reverse, Metro listener, or app process |

The first API attempt correctly failed because the installed local Mongo service was stopped; no tests were counted from that attempt. A dedicated `127.0.0.1:27017` fixture under `C:\tmp` was then used for both successful complete runs and removed afterward. Initial sandboxed Vite attempts could not read their configuration paths; identical approved local builds passed. The Android assembly emitted only the already documented Expo `NODE_ENV`, Android SDK location/XML-version, and Gradle deprecation notices.

Final whitespace, sensitive-log, credential-literal, forbidden modifier, snapshot, empty/vacuous, Firestore, fake-social, and Phase 10 scope scans passed and remain separate from the unavailable lint gate. `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact.

### Remaining evidence limits

Windows still cannot provide an iOS build/simulator, Dynamic Type, VoiceOver, or Liquid Glass runtime acceptance. The API 24 AVD cannot prove predictive Back, and TalkBack remains unavailable. The repair's deterministic adapter exercises the exact production runtime and envelope contract, but a synthetic preview/native smoke does not prove a live authenticated SecureStore account-switch session or a live Google provider flow. No production account, calendar, provider, backend, or data was accessed. Phase 3 Google lifecycle behavior and the rule that personal Google Calendar events are never mutated remain unchanged and regression-covered.
