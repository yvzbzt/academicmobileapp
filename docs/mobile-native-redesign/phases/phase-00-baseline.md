# Phase 00 — Baseline, Checkpoint, Design Contract, and Test Inventory

Status: Complete

Completed: 29 July 2026

Scope: Phase 0 only; no redesign or product behavior was implemented.

## Summary

Phase 0 established a safe repository checkpoint, documented the actual Expo native architecture and all ten logical views, accepted the four-destination information architecture and cross-platform design contract, created the complete permanent documentation structure, and ran every relevant locally executable baseline check.

No app/API source, dependency, package lock, backend contract, production infrastructure, or deployment state was changed. Existing untracked user work was preserved.

Runnable type checks, all 171 Vitest tests, both current Vite web builds, and an Android/Hermes Expo bundle export passed. Native launch and screenshots could not be executed: `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` because there is no attached Android device, Android emulator binary/AVD is absent, and iOS simulation is unavailable on Windows.

## Repository checkpoint

| Item | Baseline |
|---|---|
| Repository | `C:\Users\buyuk\academicmobileapp` |
| Branch | `agent/google-play-readiness-20260724` |
| HEAD | `cbd0067b03c3cf7286270df25164a556c55b55b9` |
| Upstream | `origin/agent/google-play-readiness-20260724`, ahead 0 / behind 0 at inspection |
| Package manager | npm `10.9.2` on Node `v22.14.0` |
| Package topology | Independent root and `apps/mobile-native` npm roots; lockfile v3; no npm workspaces declaration |
| Tracked/staged changes at start | None |
| Existing untracked work | Preserved; listed under Working tree |
| Root/native instructions | No `AGENTS.md` found; no new one was necessary |

The branch was inspected in place. It was not reset to an audit commit.

## Scope completed

- Inspected branch, HEAD, upstream, worktree, package topology, scripts, dependencies, CI, existing tests, and toolchain.
- Confirmed the actual native entry point, runtime shell, navigation model, state ownership, persistence, API client, Google Calendar, notification, content-rendering, and styling architecture.
- Mapped Login, Registration, Verification, Profile Confirmation, Home, Calendar, Summer School, YÖK, Agenda, and Profile plus loading/empty/error/integration states.
- Defined the target Home, Announcements, Calendar, Profile information architecture without deleting Summer School or YÖK capability.
- Accepted semantic brand, typography, spacing, radius, feed anatomy, platform adaptation, accessibility, responsive, and prohibited-pattern contracts.
- Inventoried current test/tool gaps and established evidence categories/gates for later phases.
- Created all required redesign documentation and future phase charters.
- Ran relevant non-publishing checks and distinguished product results from sandbox/environment blockers.

## Actual native architecture

### Entry and shell

- `apps/mobile-native/package.json` points `main` to `index.ts`.
- `apps/mobile-native/index.ts` registers the default export from `App.tsx` through Expo.
- `App.tsx` is 4,224 lines. Its `App` component (`626–3024`) owns API orchestration, persistence, auth/session lifecycle, all logical screens, six-tab navigation, integration state, and rendering. A monolithic `StyleSheet.create` occupies `3026–4224`.
- There is no React Navigation, Expo Router, route tree, reducer/context store, external state store, or deep-link consumer.
- `authMode`, `authStage`, `session`, and `activeTab` conditionally select the visible logical view.
- Authenticated content is mounted in one vertical `ScrollView`; the six absolute bottom-navigation items directly set `activeTab`.

### Runtime/config baseline

- Expo SDK package `54.0.35` installed (CLI `54.0.25`), React Native `0.81.5`, React `19.1.0`.
- `app.json` fixes portrait orientation and light mode, disables the New Architecture, enables Android edge-to-edge, and disables predictive back.
- The tracked project has no `ios/` directory. The local generated `android/` directory is ignored and contains no tracked files.
- Scheme `academicpulse` is declared but not consumed.

### State and persistence

`App.tsx` owns 43 `useState` declarations and the refresh/selection refs. Native uses Expo SecureStore; a web fallback uses localStorage. Storage wrappers absorb failures.

| Key | Data | Baseline risk |
|---|---|---|
| `native_session` | Full access/refresh session and user payload | Storage delete failure is silent; late refresh can repersist state |
| `native_device_id` | Auth-session device identifier | Install-global and reused across accounts; not a push token |
| `native_manual_exams` | Exam titles/dates | Not user-scoped; restore races initial empty persistence |
| `native_google_calendar_connection` | Owner, Google email, last-sync result | Cold-restore owner check only; not cleared on refresh failure |

Phase 1 owns the integrity repair. Phase 0 made no behavioral change.

### API client/contracts

- `apiRequest` is an in-component JSON `fetch` wrapper with bearer headers and one coalesced refresh/retry after 401.
- Base URL order is explicit environment override, Metro host, platform development fallback, then `https://academic-api.anssoft.com.tr`.
- Native response/request shapes are handwritten inside `App.tsx`; the native package does not import the limited shared contracts.
- Direct touchpoints include auth register/login/Google/verify/refresh/logout; `/me` read/delete/data-delete/university; catalog reads; Calendar/my/upcoming/summer; Announcements/my/YÖK; and notification preference GET/PATCH.
- Contract defects are recorded in `KNOWN_ISSUES.md`: resend uses register, password copy disagrees with the API, verification creates an early session, and parent-selection partial updates retain child IDs.

### Google Calendar

- Google Sign-In is active for app login and Calendar consent.
- Calendar sync is direct from the app to the selected Google primary calendar using the `calendar.events` scope.
- `src/google-calendar/google-calendar-sync.ts` lists app-managed events, creates/updates/deletes/re-verifies them, and tags private owner/source/fingerprint metadata.
- No disconnect/revoke/remove-all or target-calendar selection is reachable.
- `src/native-calendar/*` is a dormant abstraction with helper tests but no active import, concrete platform adapter, permission configuration, or required package dependency.

### Notifications

- Native currently loads and patches preference JSON only.
- There is no OS permission request, push-token acquisition, `/devices/register`, notification handler, local scheduler, or `/notification-alarms` call.
- Current README/device-registration claims are therefore misleading and assigned to Phase 3.

### Content and styling

- Agenda derives filters/groups with `useMemo`; all feeds/selectors/categories render through `.map` within `ScrollView`.
- No `FlatList`, `SectionList`, or `VirtualizedList` exists.
- Content has no centralized HTML decoding/timestamp trust/scheme-allowlist presentation layer.
- Styling uses literal colors/sizes in one style sheet; no semantic tokens, dark theme, `useWindowDimensions`, readable-width cap, or platform-specific components exist.
- The current bottom navigation has six items and 9-point labels; several icon/text/filter controls are below permanent target sizes.

## Screen inventory and target mapping

| Current view | Target ownership |
|---|---|
| Login | Auth stack — Login |
| Registration | Auth stack — Registration |
| Verification | Auth stack — Verification/recovery |
| Pending profile confirmation | Onboarding confirmation |
| Home | Home tab |
| Calendar | Calendar tab |
| Summer School | Announcements source/filter plus Calendar dates |
| YÖK | Announcements source/filter |
| Agenda | Announcements tab |
| Profile | Profile tab |

Loading, empty, error, partial, and Google connected/disconnected/syncing states are documented in `../SCREEN_INVENTORY.md`. No feature was removed.

## Design and architecture decisions

- Existing app evolves incrementally; trust repairs precede visual phases.
- Phone target is four destinations: Home, Announcements, Calendar, Profile.
- Content hierarchy is source → true time meaning → title → optional summary/media → metadata → real compact actions.
- Brand is academic indigo (`action.primary #4338CA`) with semantic light/dark roles; LinkedIn blue/trade dress is prohibited.
- Main content stays opaque. Supported iOS material is limited to navigation/control chrome with Reduce Transparency fallback.
- Android follows Material 3 Expressive, edge-to-edge, tonal state, ripple, sheet, and predictive-back-compatible structure.
- Long feeds/selectors require virtualization.
- Target size, contrast, Dynamic Type/font scaling, 320 dp, dark mode, tablet/readable width, and reduced motion/transparency are binding component constraints.
- Phase 4 chooses one component-test framework; Phase 0 added no framework/dependency.

Full rationale is in `../DECISIONS.md`, `../DESIGN_SYSTEM.md`, and `../PLATFORM_ADAPTATION.md`.

## API/data contract changes

None. Phase 0 was documentation and evidence only.

## Files changed

Only new documentation under `docs/mobile-native-redesign/`:

- `README.md`
- `DECISIONS.md`
- `DESIGN_SYSTEM.md`
- `PLATFORM_ADAPTATION.md`
- `SCREEN_INVENTORY.md`
- `TEST_MATRIX.md`
- `KNOWN_ISSUES.md`
- `phases/phase-00-baseline.md`
- Phase charter files `phases/phase-01-*.md` through `phases/phase-12-*.md`

No source, test, config, dependency, or lockfile was edited.

## Tests added

None. Phase 0 documents the current absence of native component/flow tooling; framework selection belongs to Phase 4.

## Exact commands and results

| Command | Result |
|---|---|
| `npm.cmd run typecheck:mobile:native` | PASS, exit 0, 21.291 s |
| `npm.cmd run typecheck` | PASS, exit 0, 37.582 s |
| `npm.cmd test` | Initial sandbox esbuild access block; approved unchanged rerun PASS, 24 files / 171 tests, exit 0, 35.143 s |
| `npm.cmd run build:admin` | Approved non-publishing Vite build PASS; 1,742 modules; 9.86 s internal build |
| `npm.cmd run build:mobile` | Initial sandbox esbuild access block; approved unchanged rerun PASS; 1,754 modules; 18.08 s internal build |
| `apps/mobile-native/node_modules/.bin/expo.cmd export --platform android --output-dir C:\tmp\academicmobileapp-phase0-android-export --max-workers 2` | Initial sandbox temp-dir block; approved unchanged rerun PASS; 671 modules, 21 files, 6,382,644 bytes; no publish |
| `C:\Users\buyuk\AppData\Local\Android\Sdk\platform-tools\adb.exe devices -l` | Exit 0; no attached devices |

Vitest composition: 20 API files / 132 tests, two native helper files / 15 tests, two other root unit files / 24 tests. All passed. The sandbox failures happened before the relevant test/build could execute and are environmental, not product failures.

Full tooling/evidence interpretation is in `../TEST_MATRIX.md`.

## Native screenshots and visual QA

No Phase 0 native screenshots were captured.

`VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`

- Android: SDK/ADB exist, but device list is empty; emulator binary and AVD are absent.
- iOS: Windows cannot run the iOS simulator/Xcode.
- Expo Web was deliberately not used as substitute evidence.
- Existing APK/AAB artifacts are pre-existing and do not prove current HEAD launched in this baseline.

The successful Expo Android export proves JavaScript/Hermes bundle resolution only, not native install, launch, permission, or visual acceptance.

## Accessibility checks

Phase 0 performed source-level inspection only; runtime screen-reader/large-text/native checks are blocked with native QA.

Confirmed baseline gaps:

- six-tab 9-point labels,
- controls below 44 pt / 48 dp targets,
- hard-coded light theme,
- no semantic component-state contract,
- no native component/accessibility tests,
- no Dynamic Type/readable-width strategy,
- transient/offscreen error feedback,
- no Reduce Motion/Reduce Transparency handling.

The permanent contract now requires 4.5:1 normal-text contrast, 3:1 meaningful non-text/control contrast, semantic queries, target sizes, scaling, dark mode, 320 dp and tablet layouts.

## Known limitations and pre-existing failures

- No product-code/test failure was found in the checks that could run.
- Native runtime/visual acceptance remains blocked by environment.
- No lint command exists.
- No `App` component tests, native E2E, Storybook, or native screenshot regression tool exists.
- Playwright is desktop-web only; live E2E was not run because it targets hosted services and one script can mutate Cloud Run/bootstrap state.
- Major pre-existing behavioral issues are enumerated in `../KNOWN_ISSUES.md`; Phase 0 intentionally repaired none.
- Ignored/generated native project files and an ignored stale device-calendar checklist are not authoritative tracked configuration/evidence.

## Regressions checked

- Native and root TypeScript graphs still pass.
- All current API/domain/helper Vitest tests pass.
- Admin and responsive web clients still bundle as required by current repository CI.
- Native Metro/Hermes dependency graph exports for Android.
- No tracked product file changed, so Phase 0 introduced no runtime UI/API behavior change.

Native install/launch, Google native dialogs, OS permissions, device back behavior, and visual states were not regression-tested because no launch target exists.

## Working tree

At Phase 0 start, there were no tracked or staged changes. Existing untracked work was preserved:

- `anssoftlogo.svg`
- `apps/mobile-native/assets/anssoftlogo.svg`
- `data/missing-announcement-links-academic-units.csv`
- `data/missing-announcement-links-by-university.csv`
- `data/missing-announcement-links-universities.csv`
- `docs/19-mobile-native-current-state-ui-ux-audit.md`
- `docs/20-mobile-native-in-app-user-activity-report.md`
- `docs/missing-announcement-links-report.md`
- `prompts/`

Phase 0 adds the untracked `docs/mobile-native-redesign/` documentation directory. No existing untracked item was altered or deleted by this phase.

## Phase 1 handoff

Start Phase 1 from the current working tree; do not reset to HEAD or discard the existing untracked assets/reports/prompts.

Recommended first slice:

1. Establish an explicit hydration/session-owner boundary with tests.
2. Fix refresh/logout/account-switch cancellation and cleanup.
3. User-scope manual exams and make restore/persist ordering deterministic.
4. Repair resend/recovery and the verification-created orphan session.
5. Align password validation and clear academic child IDs in all repositories with contract tests.

Phase 1 must avoid broad visual work and must not start Phase 2 automatically.
