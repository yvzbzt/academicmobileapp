# Phase 05 — Adaptive Native App Shell

Status: Implementation, native evidence, and final validation complete; the local scoped commit is recorded in the terminal handoff.
Date: 31 July 2026
Branch: `agent/google-play-readiness-20260724`
Required starting SHA: `abbf1b721fc632f75e6ce5cad91b20434f6af2bf`

Phase 5 turns the routed Phase 4 foundation into the authenticated native app-shell presentation. It keeps the existing React Navigation route graph, guards, one-shot requests, safe identifiers, and feature ownership while presenting exactly four primary destinations with adaptive native chrome. It does not redesign the Home, Announcements, Calendar, Profile, auth, onboarding, Summer School, or YÖK screen bodies. Phase 6 is not started.

## Scope completed

- Centralized the four primary destination definitions, Turkish labels, root ownership, and selected/unselected icons in a pure `app-shell.ts` contract.
- Presented exactly `Ana Sayfa`, `Duyurular`, `Takvim`, and `Profil`; Summer School and YÖK remain reachable inside the Announcements stack and are not primary tabs.
- Added `AdaptiveTopBar` as the reusable authenticated native-stack header with wrapping title/supporting copy and named leading/trailing actions.
- Replaced generic shell chrome with semantic light/dark navigation surfaces, iOS-eligible Liquid Glass with an opaque fallback, and Android Material tonal/ripple treatment.
- Preserved independent tab-stack history and `backBehavior="history"`; selected nested-tab reselect returns to its root, while selected root reselect scrolls the routed content to the top without pushing history.
- Retained hydration/auth/onboarding gating, guarded one-shot protected navigation, strict deep-link validation, unknown fallback, notification-owner validation, and operation-locked Back behavior from Phases 1–4.
- Assigned safe-area ownership across the top bar, routed screen content, phone bottom bar, and Android large-width rail so navigation edges are neither doubled nor omitted.
- Added bounded visible tab-label scaling with complete accessible names and selected state, platform minimum targets, non-color-only selected icon treatment, and wrapping compact-width header layout.
- Added no badge, unread count, or synthetic social state; the shell displays no count without an owning real application state.
- Added a deterministic, synthetic, production-inaccessible Phase 5 native evidence surface behind `__DEV__` plus the explicit `EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW=1` gate.
- Expanded pure and native renderer coverage without adding snapshots, a second component runner, dependencies, API behavior, or persistent state.

## Final route and shell structure

```text
RootStack
├─ BootstrapLoading / BootstrapError
├─ AuthFlow
├─ OnboardingFlow
├─ Authenticated
│  └─ MainTabs (backBehavior=history)
│     ├─ HomeTab — Ana Sayfa
│     │  └─ Home
│     ├─ AnnouncementsTab — Duyurular
│     │  ├─ Announcements
│     │  ├─ SummerSchool
│     │  ├─ YokAnnouncements
│     │  └─ AnnouncementDetail({ announcementId })
│     ├─ CalendarTab — Takvim
│     │  ├─ Calendar
│     │  └─ CalendarEventDetail({ eventId })
│     └─ ProfileTab — Profil
│        ├─ Profile
│        ├─ AcademicProfileSettings
│        ├─ NotificationSettings
│        ├─ GoogleCalendarSettings
│        └─ AccountDataSettings
└─ UnknownRoute
```

The tab definition is the single source for ordering, display/accessibility labels, root routes, and icon pairs. There is no six-destination phone bar. Auth and onboarding never enter tab history. Safe route parameters still carry identifiers only; navigation state is not persisted. Logout, session invalidation, data deletion, and account deletion retain their established owner-generation cleanup and return-to-auth behavior rather than preserving an authenticated shell.

## Runtime ownership and boundaries

| Boundary | Phase 5 responsibility |
|---|---|
| `src/navigation/app-shell.ts` | Pure four-tab definition and deterministic compact-width/font-scale presentation contract |
| `src/navigation/AdaptiveTopBar.tsx` | Reusable safe-area top chrome, wrapping title/subtitle, accessible leading/trailing actions, and platform material selection |
| `src/navigation/AppNavigator.tsx` | Shared shell header, tab/rail presentation, semantic selected state, independent stack history, reselect-to-root/root-scroll behavior, and routed safe-area split |
| `src/design-system/surfaces.tsx` | Exposes the routed `ScrollView` ref needed by navigator-owned `useScrollToTop`; existing semantic screen/navigation material behavior remains intact |
| `src/navigation/AppShellPreview.tsx` | Synthetic, non-secret shell flow for native evidence; no production content, session, provider, or account data |
| `App.tsx` | Development-only preview gate and otherwise the preserved feature orchestration/screen-body boundary |
| Existing `src/navigation` policies and Phase 1–3 feature/service modules | Typed routes, auth/restore/intent/back policy, content trust, notification ownership, Google lifecycle, persistence, and cleanup behavior; not reimplemented by the shell |

`src/navigation/index.ts` exports the pure `app-shell.ts` contract but not `AdaptiveTopBar`. Native consumers import the React Native component directly. This preserves the Node-only policy-test boundary and prevents pure tests from traversing React Native UI modules.

## Navigation behavior and state truth

- Each tab owns a separate native stack. Switching tabs preserves the nested route in the tab being left.
- Ordinary Back first follows the active nested stack and then React Navigation tab history. At the first tab root with no history, the shell does not manufacture a route.
- Pressing the already selected tab while it is nested pops that stack to its root. Pressing it at the root invokes `useScrollToTop` and scrolls the routed `ScrollView` to `{ y: 0, animated: true }`; repeated presses do not add Back history.
- Summer School and `YokAnnouncements` remain selected as `Duyurular`, preserving feature reachability without promoting either capability to a fifth or sixth tab.
- Protected requests still wait through hydration and authentication, are handled once after the authenticated navigator exists, and reject unsafe detail identifiers to the non-echoing unknown route.
- Navigation locking disables the custom top-bar Back action and still prevents gesture/hardware abandonment of an owning in-flight operation. Phase 5 does not enable Android predictive Back.

## App-shell design and accessibility contract

`AdaptiveTopBar` receives a title, optional subtitle/context, an optional named leading action, and named trailing actions. Title and supporting text scale and wrap. Below 375 logical units it selects compact density, the compact semantic title role, a 16-unit gutter, and wrapping action layout; at 375 and above it uses the regular contract. The header owns top/left/right safe-area insets for authenticated scenes.

The tab labels are one visual line at 11 pt on iOS or 12 sp on Android. The ordinary multiplier cap is 1.35; below 375 logical units a larger request selects a 1.20 compact cap. Android reserves 80 dp of bottom-navigation content height plus the bottom system inset, while every tab retains its full Turkish accessible name and selected state. Top-bar actions are at least 48×48 logical units on both platforms, and tab items are at least 48 high. Focus is not conveyed by color alone: selected items use a filled icon, unselected items use the paired outline icon, and Android also uses the semantic selected-state pill.

Component tests query roles and accessible names, verify selected state, action labels/hints, disabled semantics, target sizes, wrapping, and platform feedback, and use zero snapshots. Deterministic 320 dp/font-scale 2.0 resolution is complemented by the final API 24 bottom-navigation matrix below; neither is screen-reader or full-screen large-text acceptance.

## Platform implementation and evidence truth

### iOS

- The shared top bar and tab surface use iOS labels/highlight behavior and retain native-stack swipe eligibility on ordinary unlocked child routes.
- `NavigationSurface` may render Liquid Glass only on iOS when component availability, runtime API availability, and Reduce Transparency all allow it. The fallback is opaque semantic tonal chrome.
- Shell actions remain at least 48×48 even though the broader design-system minimum is 44 pt.
- Windows has no Xcode or iOS simulator. No iOS build, gesture, Dynamic Type, VoiceOver, or Liquid Glass runtime/visual acceptance is claimed.

### Android

- Phones use Material tonal bottom navigation with native ripple, filled/outline icon state, and a fixed semantic selected-icon pill. Android widths at or above the existing 840-unit navigation-rail breakpoint place the same four destinations in a Material rail.
- Focused and unfocused icons retain the same optical size; the selected tab is not enlarged relative to its peers.
- Android remains edge to edge. The rail owns the left navigation edge on large layouts; routed content owns right/bottom, and the top bar owns the scene top. Phone content owns left/right while the bottom tab bar owns bottom.
- Ordinary nested and tab-history Back remains supported. An owning operation lock disables the custom top-bar Back action as well as gesture/hardware abandonment. `predictiveBackGestureEnabled` and `android:enableOnBackInvokedCallback` remain opted out for compatibility with the selected React Navigation integration.
- Final x86_64 debug assembly passed in 1m12s: 245 tasks (7 executed/238 up-to-date), 56,804,991 bytes, SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D`. The first restricted attempt could not see the Android SDK and was denied the Gradle report path. Because development JavaScript is Metro-served, the artifact remaining byte-identical to the prior native assembly is expected.
- Native evidence passed on Android 7.0/API 24/x86_64 AVD `AcademicPhase1Low`: 13 reviewed 720×1280 PNGs and 13 same-basename UIAutomator XML hierarchies. The four 360 dp light captures each expose exactly one selected destination; the approximately 320 dp/font 1.0 capture keeps all four labels complete and separated.
- The first approximately 320 dp/font-2 implementation capture failed visual review: the 49 dp navigation bar let labels reach the system area and ellipsized `Ana Sayfa`. The shell was corrected to an 80 dp navigation content area plus bottom system inset and a compact 1.20 large-text cap, and the full affected validation was rerun. The final font-2 hierarchy exposes all four full labels; bar bounds are `[0,881][640,1040]`, the label bottom is 1013, and 27 px / 13.5 dp remains before the bar boundary.
- `KEYCODE_BACK` returned nested YÖK to the Duyurular root. Pressing the selected Duyurular tab from nested YÖK also returned to root. After bound-derived swipes exposed rows 7–10, pressing the selected root tab restored the root marker and top position.
- The explicit development dark override rendered readable dark surfaces and light status icons. API 24 has no `cmd uimode` implementation, so this proves the native dark preview renderer rather than OS-controlled theme switching.
- The final filtered log has eight lines and zero fatal, React Native/Expo/AndroidRuntime error, script-load, or Metro-connection matches. Cleanup was verified: font scale/system display restored, ADB reverse removed, app/Phase 5 Metro/emulator stopped, and ADB plus port 8081 empty. The exact commands, all screenshot hashes, paired hierarchies, and review ledger are in [`phase-05-native`](../evidence/phase-05-native/README.md).

This Android acceptance is shell-scoped. The 200% result covers bottom-navigation label fit only; the API 24 system clock clips. TalkBack was not run, tablet/rail and authenticated production-content/provider flows were not exercised, and API 24 cannot prove predictive Back, API 33 notification permission, or API 26+ channels. Windows still blocks all native iOS evidence.

## Development evidence surface

`AppShellPreview` supplies synthetic root content for all four destinations, nested Summer School/YÖK and detail/settings actions, enough rows to exercise scrolling and reselect, and no real credential, user record, provider token, or production content. It is selected only when both `__DEV__` and `EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW=1` are true. An optional `EXPO_PUBLIC_PHASE5_APP_SHELL_PREVIEW_THEME=light|dark` makes theme evidence deterministic. This preview is not a product route and cannot be selected by a production build.

## Dependencies and configuration

Phase 5 adds no package, native module, test runner, lockfile, Expo configuration, Android manifest/property, URL scheme, or platform permission. It continues to use the Phase 4 React Navigation 7, React Native Screens, Expo System UI, Expo Glass Effect, Jest Expo, and React Native Testing Library decisions. The existing Android edge-to-edge and predictive-Back opt-out configuration remains unchanged.

## API, persistence, migration, and rollback

There is no API endpoint, database schema/index, repository, business rule, content-trust contract, notification-delivery rule, Google lifecycle, Firestore behavior, SecureStore schema/key, or production-data change. Navigation state, shell theme, and preview state are not newly persisted. No migration, deployment, publish, provider mutation, production access, or remote write is required.

Rollback is code-only: revert the scoped Phase 5 commit and rebuild the native application to restore the Phase 4 shell presentation. Phase 1–4 owner-scoped records, static links, pending strict notification destinations, and provider mappings remain compatible and require no transformation.

## Tests added and expanded

- `tests/unit/mobile-native-app-shell.test.ts`: 4 pure tests for the exact tab map/icon pairs and deterministic compact/regular/font-scale layout contract.
- `apps/mobile-native/tests/navigation/AdaptiveTopBar.test.tsx`: 5 rendered tests for title/subtitle/actions, wrapping/compact density, accessible target/disabled behavior, Liquid Glass eligibility/fallback, and Android ripple.
- `apps/mobile-native/tests/navigation/AppNavigator.test.tsx`: expanded to 13 tests covering exact four-tab presentation, selected state, independent histories, Summer School/YÖK ownership, nested Back, locked custom-header Back, selected nested-tab reselect, repeated root reselect/scroll, protected one-shot requests, and malformed/unknown fallback.
- Complete native Jest now passes 9 suites / 48 tests / 0 snapshots. The focused shell pair passes 2 suites / 18 tests / 0 snapshots.
- The complete API and root suites verify that existing auth/session/recovery/account deletion, content trust, notifications, Google Calendar, persistence, and cleanup contracts remain intact.

The intended suites add no snapshot approval workflow; pure policies remain in Vitest while rendered React Native components remain in Jest Expo/RNTL. Final skip/focus/empty-assertion, sensitive-log, whitespace, staged-scope, and cached-diff scans passed.

### Disclosed implementation-stage test-boundary failure

During implementation, `AdaptiveTopBar` was temporarily exported through `src/navigation/index.ts`. The focused pure command then failed before test collection because Node/Vitest followed that barrel into React Native modules and encountered React Native Flow syntax. The correction was to remove the UI component export, keep only the pure `app-shell.ts` export in the barrel, and import `AdaptiveTopBar` directly from native code. The identical three-file pure scope then passed 3 files / 48 tests. This failure is retained in the ledger rather than relabelled as a pass.

The first focused native run after adding locked-header coverage had one failing semantic query because the new test opened a detail route as the initial nested state, for which the Jest native-stack adapter exposed no Back action. The test setup was corrected to render the Announcements root before requesting its detail; production code did not change between that setup failure and the final 18/18 focused pass.

## Validation ledger

| Check | Result |
|---|---|
| Focused Phase 5 plus retained Phase 4 pure contracts | PASS, 3 files / 48 tests after the disclosed source-boundary correction |
| Focused native shell | Final PASS, 2 suites / 18 tests / 0 snapshots, 11.807 s |
| Complete native Jest/RNTL | Final PASS, 9 suites / 48 tests / 0 snapshots, 17.673 s |
| Complete API tests | PASS, 30 files / 310 tests, 22.03 s; one non-failing Mongoose `new` deprecation warning |
| Workspace TypeScript | Final PASS, exit 0, 13.9 s wall time |
| Mobile-native TypeScript | Final PASS, exit 0, 12.1 s wall time |
| Full regression | Final PASS, 44 files / 543 tests, 23.94 s Vitest duration (25.8 s wall); above Phase 4's 43 / 539 final result; one non-failing Mongoose `new` deprecation warning |
| Admin build | Final approved PASS, 1,742 modules / 6.01 s after the restricted esbuild/config read denial |
| Mobile web build | Final approved PASS, 1,754 modules / 8.74 s after the same restricted esbuild/config read denial |
| Android x86_64 debug assembly | Final approved PASS, 1m12s, 245 tasks (7 executed/238 up-to-date), 56,804,991 bytes, SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D` |
| Initial approximately 320 dp/font-2 native capture | FAILED visual review: 49 dp bar, labels reached the system area, and `Ana Sayfa` was ellipsized; corrected to 80 dp content + system inset and compact cap 1.20 before the complete recapture |
| Final current-source native Android shell matrix | PASS on Android 7.0/API 24/x86_64 `AcademicPhase1Low`: 13 reviewed 720×1280 PNGs + 13 XML pairs; four selected states, 320 dp/font 1 and corrected font 2, nested Back/reselect/root-scroll, dev dark, clean log, and verified cleanup. See [`phase-05-native`](../evidence/phase-05-native/README.md) |
| Final whitespace, test-quality, sensitive-log, staged-scope, evidence-table, and cached-diff audits | PASS: no configured matches/errors; 13 evidence rows validated; exactly 44 intended paths staged, zero unstaged tracked paths, unrelated untracked files excluded |

The restricted web-build attempts were denied access to the esbuild/config path before bundling; the identical approved reruns are the reported passes. The first restricted Android attempt hid the SDK and was denied access to the Gradle report path; the identical approved assembly is the reported pass. These environment failures are not product test failures and are not omitted.

### Exact command ledger

```powershell
npx.cmd vitest run tests/unit/mobile-native-app-shell.test.ts tests/unit/mobile-native-route-foundation.test.ts tests/unit/mobile-native-design-foundation.test.ts --configLoader runner
npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/navigation/AppNavigator.test.tsx tests/navigation/AdaptiveTopBar.test.tsx
npm.cmd --prefix apps/mobile-native run test:native -- --runInBand
npx.cmd vitest run apps/api/tests --configLoader runner
npm.cmd run typecheck
npm.cmd run typecheck:mobile:native
npm.cmd test -- --configLoader runner
npm.cmd run build:admin
npm.cmd run build:mobile

Set-Location apps/mobile-native/android
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon --console=plain
```

`MOBILE_NATIVE_LINT: NOT AVAILABLE`: neither the root nor `apps/mobile-native` exposes a lint script, applicable ESLint dependency, or lint configuration. TypeScript, tests, builds, whitespace checks, and sensitive-log scans are separate evidence and are not called lint.

## Accessibility checks

- Pure contracts enforce the exact four full Turkish labels, platform 11/12-unit visual sizes, one-line navigation slots, the ordinary 1.35 cap, the compact 1.20 large-text cap, and the Android 80 dp content-height contract.
- Renderer tests locate tabs/top-bar actions through roles and full accessible names, assert selected/unselected semantics, and verify disabled action state and at least 48×48 shell action targets.
- Selection uses filled/outline icon shapes and Android's semantic selected pill in addition to color. No active icon is scaled larger, and no unsupported badge/count is displayed.
- Top-bar title and supporting copy remain scaling/wrapping text; compact width changes density and action layout rather than clipping the title to preserve one row.
- Final API 24 native evidence accepts all four bottom-navigation labels at approximately 320 dp/font scale 2.0 after the disclosed 49 dp failure and 80 dp/1.20 correction. The final labels end 13.5 dp before the navigation boundary. This is not full-screen large-text acceptance; the API 24 system clock still clips.
- TalkBack was not run. VoiceOver, iOS Dynamic Type, native keyboard/switch control, complete large-text, and native tablet/rail acceptance remain unclaimed.

## Regression boundaries checked

- Complete API and full root suites pass above the Phase 4 file/test baseline.
- Workspace and native TypeScript pass against the final shell/evidence source.
- Admin and mobile web bundles still build; neither is used as native shell visual evidence.
- The Android debug APK compiles/links. It is debug-signed and Metro-served; no release artifact, store readiness, publish, or deployment is claimed.
- Auth/session/account cleanup, strict content presentation, notification registration/destination, Google Calendar lifecycle/sync, and owner-scoped persistence remain covered by their existing suites and unchanged at runtime.
- No production API, provider account, remote calendar, push provider, production database, or production data was contacted for Phase 5.

## Files changed

- Shell implementation: `apps/mobile-native/src/navigation/app-shell.ts`, `AdaptiveTopBar.tsx`, `AppShellPreview.tsx`, `AppNavigator.tsx`, and `src/navigation/index.ts`.
- Supporting native boundary: `apps/mobile-native/src/design-system/surfaces.tsx` and the development-only gate in `apps/mobile-native/App.tsx`.
- Tests: `tests/unit/mobile-native-app-shell.test.ts`, `apps/mobile-native/tests/navigation/AdaptiveTopBar.test.tsx`, and the expanded `AppNavigator.test.tsx`.
- Native evidence: [`docs/mobile-native-redesign/evidence/phase-05-native/**`](../evidence/phase-05-native/README.md), containing 13 reviewed PNGs, 13 paired UIAutomator hierarchies, hashes, commands, boundaries, and teardown results.
- Required documentation: `DESIGN_SYSTEM.md`, `PLATFORM_ADAPTATION.md`, `SCREEN_INVENTORY.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_MATRIX.md`, and this report.

No Phase 5 package/dependency, Expo/native configuration, API, database, or production-data file changed. Pre-existing unrelated logos, content-link audit artifacts, future-phase planning files, root redesign README/baseline report, and prompt artifacts remain outside the Phase 5 scope.

## Remaining blockers and follow-up gates

- Final repository whitespace, test-quality, configured sensitive-log, staged-scope, evidence-table, and cached-diff audits passed. The index contains exactly 44 intended Phase 5 paths and no unstaged tracked path; unrelated untracked files remain outside it.
- Windows cannot produce an iOS build/simulator run, swipe-back/Dynamic Type/VoiceOver evidence, or Liquid Glass runtime acceptance.
- Predictive Back remains disabled; React Navigation compatibility plus API 33+ callback/animation evidence is still required before enablement.
- API 24 cannot prove Android 13+ notification permission, API 26+ notification-channel behavior, or predictive Back.
- TalkBack traversal was not run. UIAutomator proves exposed labels, bounds, and selected state but is not screen-reader acceptance.
- No authorized authenticated content/provider fixture exists for full content-state visuals, real Google chooser/Calendar mutation/revoke, or FCM/APNs delivery.
- Legacy screen bodies still own hard-coded styling, large component orchestration, non-virtualized feeds, and later-phase UI. Home/feed, auth/onboarding, Calendar, Profile/settings, and complete dark/large-text/tablet quality remain in Phases 6–11.
- No native E2E or automated screenshot-regression harness was introduced, and native lint tooling remains unavailable.

Phase 6 was not started. There is no LinkedIn-inspired feed, complete auth/onboarding redesign, full Home/Announcements/Calendar/Profile redesign, backend refactor, Firestore restoration, deployment, publish, push, store submission, or production-data access in this phase.

## Next-phase handoff

After the single scoped Phase 5 commit is recorded, a separately authorized Phase 6 may redesign auth/onboarding UI on top of this shell/design foundation. It must not reopen Phase 1–4 account-generation, recovery, content-trust, notification, Google lifecycle, safe-route, or persistence rules. Phase 6 remains unstarted by this work.

## Git handoff

At the pre-commit gate, branch `agent/google-play-readiness-20260724` still had HEAD `abbf1b721fc632f75e6ce5cad91b20434f6af2bf`, exactly the required start. The index contained exactly 44 reviewed Phase 5 paths, no intended path was unstaged, cached-diff/scan checks passed, and unrelated untracked files remained outside the index. No push is authorized or performed.

One local scoped commit is created after those checks. Its SHA and post-commit status belong in the terminal handoff because a commit cannot contain its own SHA. The commit is not amended or pushed.
