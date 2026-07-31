# Phase 04 — Routed Adaptive Design Foundation

Status: Implementation complete; validation and local commit recorded in the terminal handoff.
Date: 31 July 2026
Branch: `agent/google-play-readiness-20260724`
Required starting SHA: `b74bdcc8da7657c2886cf35f6a9b4f2dedbe29d8`

The execution brief moved internal route mechanics into Phase 4 and superseded the earlier planning line “No new app shell yet.” This phase implements the native route architecture and four-destination mechanics. It does not perform the Phase 5 visual shell redesign or redesign complete screens.

## Scope completed

- Replaced conditional visible-screen switching and the six-button bottom bar with React Navigation 7 native stacks and four bottom tabs.
- Added typed/pure route, guard, deep-link, intent-priority, tab-history, Back, and iOS-swipe policy contracts.
- Preserved Phase 1–3 session hydration, verification/password-recovery state, account-generation ownership, cancellation, notification exact-record validation, Google lifecycle, logout, data deletion, and account deletion above the route boundary.
- Added strict static deep links, signed-out memory resumption, notification-first post-auth detail routing, guarded request dispatch, and a non-echoing unknown fallback.
- Split route mechanics, one route-request hook, semantic design-system modules, deterministic test fixtures, and a transitional shared `Section` component from the legacy app body. Existing auth/content/notification/Google/session modules remain focused feature/service boundaries.
- Implemented semantic light/dark themes, system appearance, platform adaptation, shared primitives, safe-area/readable-width screens, and navigation/control material surfaces.
- Added accessible `BottomSheet` and virtualized `SelectField` boundaries plus a deterministic primitive inventory behind a development-only, production-inaccessible preview gate.
- Selected one isolated native component-test stack and retained Vitest for pure/API contracts.

## Final route structure

```text
RootStack
├─ BootstrapLoading
├─ BootstrapError
├─ AuthFlow
│  ├─ Login
│  ├─ Register
│  ├─ Verification
│  ├─ PasswordRecoveryRequest
│  └─ PasswordRecoveryConfirm
├─ OnboardingFlow
│  └─ ProfileConfirmation
├─ Authenticated
│  └─ MainTabs (backBehavior=history)
│     ├─ HomeTab → Home
│     ├─ AnnouncementsTab
│     │  ├─ Announcements
│     │  ├─ SummerSchool
│     │  ├─ YokAnnouncements
│     │  └─ AnnouncementDetail({ announcementId })
│     ├─ CalendarTab
│     │  ├─ Calendar
│     │  └─ CalendarEventDetail({ eventId })
│     └─ ProfileTab
│        ├─ Profile
│        ├─ AcademicProfileSettings
│        ├─ NotificationSettings
│        ├─ GoogleCalendarSettings
│        └─ AccountDataSettings
└─ UnknownRoute
```

Auth/onboarding do not enter tab history. Protected requests wait until the authenticated route tree exists. Route params hold safe identifiers only; no token, secret, full record, or persisted navigation snapshot was added. Summer School and YÖK retain their existing feature state inside Announcements; Google Calendar remains Calendar-owned; settings remain Profile-owned.

## Runtime ownership and boundaries

| Boundary | Responsibility |
|---|---|
| `src/navigation/AppNavigator.tsx` | Concrete native stack/tab adapter, root gating, one-shot requests, tab history, header/swipe configuration, safe-area screens, unknown route |
| `src/navigation/routes.ts`, `route-resolution.ts`, `deep-link.ts`, `route-intent.ts`, `back-policy.ts` | Pure typed route and policy contracts. Only the route types/safe-ID/deep-link boundary are runtime-connected; resolution/intent/back helpers are deterministic policy models rather than a claim that they replace React Navigation internals |
| `src/navigation/useAppRouteRequest.ts` | Transient feature-to-navigator request envelope; intentionally no persistence |
| `src/design-system/*` | Semantic tokens, theme/accessibility hooks, platform selection, adaptive surfaces, and shared primitives |
| `src/components/Section.tsx` | Transitional semantic component boundary for largely unchanged Phase 1–3 body content |
| Existing `src/auth`, `content`, `notifications`, `google-calendar`, `session-integrity` | Existing business, trust, storage, provider, and owner-generation behavior; not moved into navigation |
| `App.tsx` | Still owns substantial feature orchestration and legacy screen JSX/styles; MN-010 and full theme migration remain open |

The strict notification flow persists only its existing non-secret owner/exact-ID record. After authentication it still calls the exact trusted announcement/calendar endpoint. A wrong/stale owner or unavailable record cannot navigate. A verified target wins over default Home and its durable record is cleared only after the authenticated navigator accepts the request. Static protected links wait only in memory until authentication. Logout/session invalidation clears outstanding navigation requests with the same account-generation boundary.

## Design-token and primitive contract

`tokens.ts` owns semantic background, text, border, action, status, and state colors; typography; spacing; radii; elevation/shadow; motion; safe-area spacing; readable widths; platform touch targets; and light/dark themes. New route/design/component foundation code consumes semantic roles rather than screen-meaning hex values.

Created primitives:

- `Button`, `IconButton`;
- `TextField`, `PasswordField`, `SearchField`, `SelectField`;
- `Card`, `ListItem`, `Chip`, `SegmentedControl`;
- `Banner`, `Toast`, `Skeleton`, `EmptyState`, `ErrorState`;
- `BottomSheet`, `Screen`, `NavigationSurface` for picker, modal sheet, navigation bar, tab bar, toolbar, sheet, and floating-control boundaries.

The provider observes system appearance, Reduce Motion, and Reduce Transparency with fail-safe reduced/opaque defaults. `app.json` uses `userInterfaceStyle: automatic` and the `expo-system-ui` plugin. Deterministic fixtures include non-secret session, API, Google/notification integration, platform, theme, width, font scale, motion, and transparency states. `DesignSystemPreview` is reachable only when `__DEV__` and `EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW=1` are both true; it is not a product route. Screenshot naming, raw/curated storage, metadata, and redaction rules are in `apps/mobile-native/tests/README.md`.

## Platform implementation and evidence truth

### iOS

- Native-stack child routes permit swipe-back unless an owning operation locks navigation.
- Touch targets resolve to at least 44 pt.
- `expo-glass-effect` is restricted to `NavigationSurface` chrome. iOS, Liquid Glass component availability, runtime API availability, and Reduce Transparency off are all required. The fallback is opaque semantic chrome; content cards/forms never become glass.
- Windows has no Xcode/iOS simulator, so no iOS build, gesture, Dynamic Type, or Liquid Glass visual acceptance is claimed.

### Android

- Edge-to-edge configuration, safe-area insets, 48 dp targets, native ripple, tonal surfaces, four bottom destinations, and the tested large-width rail policy are present.
- React Navigation owns ordinary stack/tab system Back; tabs use history. A busy feature registers a consuming Back handler so an in-flight operation is not abandoned.
- React Navigation currently requires `android:enableOnBackInvokedCallback=false`. `predictiveBackGestureEnabled` deliberately remains false. Ordinary Back passed on API 24; predictive callbacks/animation cannot be tested there and are not claimed. The pure preview policy is not OS integration.

## Dependencies and configuration

Added runtime dependencies: React Navigation native/native-stack/bottom-tabs, `react-native-screens`, `expo-glass-effect`, and `expo-system-ui`. Added development dependencies: Jest 29, `jest-expo` 54, React Native Testing Library 13.3, Jest types, and the React 19.1-compatible test renderer required by the selected stack. Root Vitest excludes `apps/mobile-native/tests/**`; `test:mobile:native` is the explicit native command.

Expo and React Native were not upgraded. `expo install --check` currently advises that installed Expo `54.0.35` trails the latest expected `~54.0.36`; Phase 4 leaves the baseline SDK range/version unchanged as required. Public Expo config, native assembly, install, and launch pass.

## API, persistence, migration, and rollback

There is no API, database, business-rule, content-trust, notification-delivery, Google lifecycle, Firestore, SecureStore-schema, or production-data change. Navigation state and theme preference are not persisted.

Rollback is code/config/dependency only: revert the scoped Phase 4 commit and rebuild the native binary to restore the old conditional shell. Phase 1–3 owner-scoped records remain readable without transformation. New static links fail safely on an old build; the strict Phase 3 notification record remains compatible. No migration, deployment, publish, push, provider mutation, or production access is required.

## Tests added

- `tests/unit/mobile-native-route-foundation.test.ts`: 32 pure route/guard/link/intent/back tests.
- `tests/unit/mobile-native-design-foundation.test.ts`: 12 pure token/theme/platform tests.
- `apps/mobile-native/tests/design-system/*`: semantic primitive and adaptive-surface tests.
- `selection-sheet.test.tsx` and `preview.test.tsx`: selector/sheet accessibility, virtualization boundary, dismissal locking, platform treatment, and deterministic preview coverage.
- `apps/mobile-native/tests/navigation/AppNavigator.test.tsx`: real four-tab, request, detail/back, gating, malformed, and unknown behavior.
- `apps/mobile-native/tests/fixtures/native-test-environment.test.tsx`: deterministic cross-state fixture provider.
- The Phase 1 auth-recovery source contract now follows the navigator-owned Back boundary without reducing its expanded test count.

No test is skipped/focused; there are no empty assertions or blind snapshots.

## Validation ledger

| Check | Result |
|---|---|
| Focused Phase 4 pure tests | PASS, 2 files / 44 tests |
| Native Jest/RNTL | PASS, 8 suites / 36 tests / 0 snapshots |
| Complete API tests | PASS, 30 files / 310 tests |
| Workspace TypeScript | PASS |
| Mobile-native TypeScript | PASS |
| Full regression | Final sequential PASS, 43 files / 539 tests, 36.18 s; exceeds 41 / 495 baseline. A disclosed concurrent attempt first timed out one existing 5 s API test under Gradle/validation load at 5.174 s; unchanged sequential rerun passed it in 3.331 s |
| Admin build | Final PASS outside the restricted filesystem view, 1,742 modules, 6.95 s Vite build |
| Mobile web build | Final PASS outside the restricted filesystem view, 1,754 modules, 8.49 s Vite build; preceding restricted-view config read was blocked before bundling |
| Expo public config | PASS: automatic theme, edge-to-edge, scheme/package, New Architecture, predictive opt-out, required plugins |
| Final Android x86_64 debug assembly | PASS in 1m20s, 245 tasks (7 executed/238 up-to-date); 56,804,991-byte x86_64-only APK; SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D` |
| Android install/launch/Back | PASS on `AcademicPhase1Low`, Android 7.0/API 24/x86_64, package/activity `com.anssoft.akademiktakvim/.MainActivity`: Login → Şifre Kurtarma → hardware Back → Login, PID 3589/activity retained, no filtered React Native/AndroidRuntime error |
| Android primitive visual matrix | PASS within scope: development-only preview at temporary 320 dp, six reviewed/hashed light screenshots covering action, field, selection/content, feedback, and sheet states; UIAutomator probes passed; filtered log clean. See [`phase-04-native`](../evidence/phase-04-native/README.md) |
| Font-scale 2.0 preview observation | Application text wrapped vertically without horizontal clipping/blank state; API 24 system clock clipped at the far right, so full large-text acceptance remains open |
| Skip/focus/empty assertion audit | PASS |
| Scoped trailing-whitespace scan and final cached-diff whitespace check | PASS, no matches or errors |
| Runtime/test log, credential-like literal, and staged added-line sensitive-log scans | PASS, no matches; no real credential or production data used |

### Exact command ledger

The root and native validation commands were:

```powershell
npx.cmd vitest run tests/unit/mobile-native-route-foundation.test.ts tests/unit/mobile-native-design-foundation.test.ts --configLoader runner
npm.cmd --prefix apps/mobile-native run test:native -- --runInBand
npx.cmd vitest run apps/api/tests --configLoader runner
npm.cmd run typecheck
npm.cmd run typecheck:mobile:native
npm.cmd test -- --configLoader runner
npm.cmd run build:admin
npm.cmd run build:mobile

Set-Location apps/mobile-native
.\node_modules\.bin\expo.cmd config --type public --json
.\node_modules\.bin\expo.cmd install --check

Set-Location android
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon --console=plain
```

The ordinary Android Back smoke used the final APK and these principal ADB commands:

```powershell
$adb = 'C:\Users\buyuk\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$apk = 'C:\Users\buyuk\academicmobileapp\apps\mobile-native\android\app\build\outputs\apk\debug\app-debug.apk'
& $adb -s emulator-5554 install -r -t $apk
& $adb -s emulator-5554 reverse tcp:8081 tcp:8081
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
& $adb -s emulator-5554 shell am start -W -n com.anssoft.akademiktakvim/.MainActivity
& $adb -s emulator-5554 shell input tap 360 1160
& $adb -s emulator-5554 shell input keyevent KEYCODE_BACK
& $adb -s emulator-5554 shell uiautomator dump /sdcard/phase4-after-back.xml
& $adb -s emulator-5554 shell screencap -p /sdcard/phase4-after-back.png
```

The development-preview matrix used:

```powershell
& $adb -s emulator-5554 shell wm size 640x1136
& $adb -s emulator-5554 shell wm density 320
& $adb -s emulator-5554 shell settings put system font_scale 1.0
$env:EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW = '1'
Set-Location C:\Users\buyuk\academicmobileapp\apps\mobile-native
npx.cmd expo start --dev-client --localhost --port 8081
& $adb -s emulator-5554 shell uiautomator dump /sdcard/phase4-preview-NAME.xml
& $adb -s emulator-5554 shell screencap -p /sdcard/phase4-preview-NAME.png
& $adb -s emulator-5554 shell settings put system font_scale 2.0
& $adb -s emulator-5554 shell wm size reset
& $adb -s emulator-5554 shell wm density reset
& $adb -s emulator-5554 reverse --remove tcp:8081
& $adb -s emulator-5554 shell am force-stop com.anssoft.akademiktakvim
& $adb -s emulator-5554 emu kill
```

`NAME` was executed separately for `top`, `fields`, `selection`, `feedback`, `bottom`, and `sheet`; the exact swipe/tap, capture/pull, font-2, filtered-log, restoration, screenshot hashes, and final stopped-state ledger is preserved in [`phase-04-native`](../evidence/phase-04-native/README.md). Final repository audits used `git diff --cached --check`, a scoped trailing-whitespace `rg` scan, a staged added-line logging/credential scan, and a `.only`/skip/vacuous-assertion `rg` scan; their exact results are recorded above and in `TEST_MATRIX.md`.

Component tests prove rendered semantics/interactions in Jest, not OS visual acceptance. The API 24 launch proves ordinary Android Back only. The reviewed Android primitive matrix proves only the named development-preview states at 320 dp; Phase 4 does not claim an iOS set, authenticated-screen matrix, tablet/rail visual acceptance, screen-reader acceptance, full large-text acceptance, notification/provider UI, or predictive animation.

`MOBILE_NATIVE_LINT: NOT AVAILABLE`: no lint script, applicable ESLint dependency, or lint configuration exists. TypeScript and scans are reported as their own evidence, never as lint.

## Accessibility checks

- Component tests locate controls through roles and accessible names and assert disabled, busy, selected, announcement/live-region, password-visibility, and actionable error/empty semantics.
- Shared controls resolve platform minimum targets (44 pt iOS / 48 dp Android), stable loading labels, non-color disabled state, focus borders, Android ripple, and iOS highlight/pressed feedback.
- Theme fixtures exercise light/dark, 320 dp, readable-width, Reduce Motion, and Reduce Transparency selection and encode a deterministic 2.0 font-scale scenario; they do not inject or prove native font layout.
- The Android/API 24 preview was visually inspected at a temporary 320 dp viewport. Font 1.0 states showed expected wrapping and touch-target separation; the bounded font 2.0 observation wrapped application copy vertically but exposed system-clock clipping, so it is not full acceptance.
- No TalkBack/VoiceOver, full Dynamic Type, keyboard, switch-control, native tablet, or iOS material acceptance is claimed. Those remain later native evidence gates.

## Regression boundaries checked

- The complete 30-file API suite and 43-file root suite cover the existing auth/recovery/session, content trust, notification lifecycle/destination, Google lifecycle/sync, calendar, persistence, and cleanup contracts.
- The migrated auth-recovery source contract follows navigator-owned Back/gesture handling and retains all existing cases.
- No API endpoint, repository, storage key/envelope, notification delivery worker, exact trusted-record endpoint, Google provider policy, or dormant device-calendar activation changed.
- Admin and mobile web bundles still build; neither is used as native visual evidence.
- Android assembly/launch uses only the authorized local AVD and signed-out local route state. No production API, provider account, or production data was contacted.

## Files changed

- Native app/config/dependencies: `App.tsx`, `app.json`, native `package.json`/lockfile, root `package.json`, `vitest.config.ts`.
- Routes/components: `src/navigation/*`, `src/components/Section.tsx`.
- Design foundation: `src/design-system/*` and `src/design-system/primitives/*`.
- Tests/tooling: native Jest config/setup, `apps/mobile-native/tests/**`, development-only design preview, both new root foundation tests, migrated auth-recovery contract, native-test README.
- Native evidence: `docs/mobile-native-redesign/evidence/phase-04-native/**` with six reviewed screenshots and a permanent evidence index.
- Required documentation: `DESIGN_SYSTEM.md`, `PLATFORM_ADAPTATION.md`, `SCREEN_INVENTORY.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_MATRIX.md`, and this report.

Unrelated pre-existing logos, content-link audit CSV/report files, redesign planning files outside the seven required documents, and prompt artifacts were preserved and excluded from the Phase 4 commit.

## Remaining blockers and follow-up gates

- MN-009: the legacy top-of-scroll 3.5-second global-message presentation remains until its owning screen migrations.
- MN-010: `App.tsx` remains large; later screen phases must continue component/feature extraction.
- MN-012/MN-013: feed virtualization and complete legacy screen theme migration remain open.
- MN-019: native end-to-end and screenshot-regression harnesses remain absent even though the native component stack is established.
- MN-020: lint tooling remains unavailable.
- MN-024: predictive Back remains explicitly opted out until supported navigator/API 33+ evidence exists.
- MN-032: authenticated content visual acceptance still needs an authorized local fixture.
- MN-033: API 24 cannot exercise Android 26+ channels, Android 13+ notification permission, or predictive callbacks; Windows/iOS/provider configuration limits remain.
- MN-034: no authorized non-production Google/Firebase account/provider fixture exists for chooser, real Calendar mutations/removal/revoke, or real FCM/APNs delivery.

Phase 5 was not started. There is no LinkedIn-inspired feed, wholesale visual shell redesign, complete screen redesign, backend refactor, Firestore restoration, deployment, publish, push, or production-data access.

## Next-phase handoff

If separately authorized, Phase 5 can consume the four-tab route tree, semantic tokens, adaptive navigation surfaces, and shared primitives to redesign shell presentation. It must not reopen Phase 1–3 owner-generation, content-trust, notification, or Google lifecycle rules, and it must retain the predictive-Back and native-evidence boundaries recorded here. Phase 5 has not been started by this commit.

## Git handoff

At the pre-commit gate, branch `agent/google-play-readiness-20260724` still had HEAD `b74bdcc8da7657c2886cf35f6a9b4f2dedbe29d8`, exactly the required start. The index contained 59 reviewed Phase 4 paths and no Phase 4 path was unstaged. `git diff --cached --check`, the staged sensitive-log scan, and the exact scope comparison passed.

The following 17 pre-existing unrelated untracked status entries were preserved outside the index and remain after the scoped commit:

- `anssoftlogo.svg` and `apps/mobile-native/assets/anssoftlogo.svg`;
- the three `data/missing-announcement-links-*.csv` files and `docs/missing-announcement-links-report.md`;
- `docs/mobile-native-redesign/README.md` and `phases/phase-00-baseline.md`;
- `phases/phase-05-app-shell.md` through `phases/phase-12-final-reconciliation.md`;
- `prompts/`.

One local scoped commit is created only after all required checks and cached-diff scans pass. Its SHA and post-commit status are reported in the terminal handoff because a commit cannot contain its own SHA. The commit is not amended or pushed.
