# Phase 06 — Authentication and Academic Onboarding UI

Status: Complete as reconciled on 4 August 2026; installed live-account E2E, iOS runtime, TalkBack, and predictive-Back acceptance remain explicitly unclaimed.
Date: 1 August 2026
Branch: `agent/google-play-readiness-20260724`
Phase 6 starting HEAD: `abdf0cc427039ddd324ef5964902c12839927d6b`
Original implementation commit: `00e03ace0a05d9ee3dcdbfe8903cc5d6d34ebccb`
Completed-phase reconciliation commit: `2e3664546f628a19c6fa929b9ee9469e5322f9a8`
Reconciled: 4 August 2026

## Authoritative reconciliation — 4 August 2026

The routed auth/onboarding implementation from `00e03ace0a05d9ee3dcdbfe8903cc5d6d34ebccb` remains current. Commit `2e3664546f628a19c6fa929b9ee9469e5322f9a8` makes two bounded, visible corrections while preserving the Phase 1 security and Phase 6 route/payload contracts.

- Registration now visibly begins the established onboarding sequence with `1 / 3 · Hesap`; the existing `2 / 3` verification and `3 / 3` academic-profile markers remain intact.
- Login submission now owns refs for both fields and calls the real first-invalid input's `focus()` method: invalid email focuses **E-posta adresi**, while a valid email with a missing password focuses **Şifre**. The renderer tests spy on the actual input focus calls, rather than inferring focus from error-text order.

The validation and Android synthetic-preview records below are historical evidence for the original Phase 6 run. Statements there that Phase 7 or Home work had not started are time-bound handoff statements, not current repository status.

Phase 6 replaces the legacy auth/onboarding presentation with focused, routed, accessible native forms built from the Phase 4 design system. It preserves the Phase 1 authentication, verification, recovery, session, cleanup, and persistence contracts and the Phase 4–5 route/shell boundaries. It does not change API business behavior, provider configuration, storage schemas, or authenticated content screens. At this original 1 August checkpoint, Phase 7 had not started.

## Scope completed

- Extracted `LoginScreen`, `RegistrationScreen`, `VerificationScreen`, three password-recovery screens, and `AcademicOnboardingScreen` from the application orchestrator into `src/auth/AuthScreens.tsx`.
- Removed the giant marketing hero from routed auth/onboarding presentation and kept the experience content-first, Turkish-first, and form-width bounded.
- Added persistent labels, semantic roles and state, inline field errors, dismissible feedback, busy/disabled behavior, password visibility actions, return-key progression, focus-to-first-invalid behavior, and keyboard-safe scrolling.
- Kept Login and Registration as separate protected route-tree destinations rather than a visual toggle hidden inside one route.
- Enforced exact client/API registration parity: full name, normalized email, password, password confirmation, and a minimum password length of 10 characters.
- Kept verification at exactly four numeric digits, masked the destination email, rendered expiry and resend cooldown truthfully, and retained edit-email/recovery actions.
- Split password recovery into request, exact six-digit code, and new-password confirmation stages; expiry/resend timing remains real and account-existence-neutral copy is preserved.
- Made university the only required academic field. Faculty, department, and class level remain optional, disabled until their parent is selected, and explicitly clear when a parent changes or is cleared.
- Added searchable, virtualized academic selectors with loading, empty, query-no-result, error, retry, expanded, and selected semantics.
- Added a final academic review/save step, dirty-draft Back confirmation, and the resumed verified-email password requirement.
- Converged email and Google users whose profile lacks a university on the same academic onboarding route. Authenticated context hydration is fail-closed so Home is not shown before `/me` and account context are ready.
- Kept all new user-facing copy Turkish-first. Phase 6 does not introduce an i18n catalog or translation framework; later localization work must extract the strings without changing these behavior contracts.
- Added a development-only, synthetic preview surface with 13 stable scenarios for native presentation evidence. It has no API, provider, SecureStore, persistence, notification, or production-data dependency.
- Expanded pure, native-renderer, route, recovery, session-integrity, and regression coverage without adding snapshots, a second component runner, or a native E2E framework.

## Final route structure

```text
RootStack
├─ BootstrapLoading / BootstrapError
├─ AuthFlow
│  ├─ Login
│  ├─ Register
│  ├─ Verification
│  ├─ PasswordRecoveryRequest
│  ├─ PasswordRecoveryCode
│  └─ PasswordRecoveryConfirm
├─ OnboardingFlow
│  └─ AcademicOnboarding
├─ Authenticated
│  └─ Phase 5 four-tab shell
└─ UnknownRoute
```

The route resolver derives the visible auth route from the application auth stage. Invalid direct attempts to enter a later recovery stage fall back to the request stage unless the required in-memory recovery record exists. Authenticated users without a university remain signed in but are routed to `AcademicOnboarding`; they do not enter tab history or briefly render Home.

## Form and state contracts

### Login and Google authentication

- Login requires a normalized valid email and a non-empty password. Email IME progression moves to password; password submission occurs only when ready.
- Busy state prevents duplicate email/password, Google, recovery, verification-recovery, and registration actions and exposes semantic busy/disabled state.
- Password visibility changes do not clear or replace the typed value.
- Google unavailable, in-progress, cancelled, disabled-account, invalid-token, and generic error paths retain the existing controlled behavior and safe copy.
- Email login and Google login both activate the owner-bound session and call `bootstrapAuthenticatedContext`. That function now returns `false` on stale ownership, `/me` failure, invalid/inactive profile, or lost account ownership; callers do not reveal Home on failure.
- Real Google chooser/account-provider acceptance is not claimed because no authorized non-production Google client/account fixture was supplied.

### Registration and verification

- Registration owns four labelled fields: full name, email, password, and password confirmation. The minimum is exactly 10 characters and confirmation mismatch has its own field error.
- `POST /auth/register` still receives only the established registration payload. Academic fields are not sent before verification.
- The pending-verification record stores only normalized email plus server-derived verification expiry/cooldown. Password and verification code are not persisted.
- Verification accepts exactly four ASCII digits, uses the established verify and resend endpoints, renders the masked email and real timers, blocks early resend/expired submit, and lets the user edit the email.
- Successful verification does not manufacture a session. It clears the pending verification record and moves to academic onboarding; an email user supplies the account password at the final reviewed save.

### Password recovery

- Recovery is three routed surfaces: account-neutral request, exact six-digit code, and matching minimum-10-character new password/confirmation.
- The request response remains deliberately non-enumerating. Code expiry and resend cooldown use the established server timing values.
- Recovery email, timing, code, new password, confirmation, and success state are held in memory only. No recovery code or password is added to SecureStore or another persistent record.
- Back and Cancel clear later-stage password fields as appropriate. A successful reset returns to Login and requires a fresh login with the new password.

### Academic onboarding

- University is required. Faculty, department, and class level are optional and are omitted from the payload when not selected.
- Changing university clears faculty, department, and class level. Changing or clearing faculty clears department and class level. Changing or clearing department clears class level.
- Class levels are derived from the API-supported department metadata and map only to the existing `1 | 2 | 3 | 4 | 5 | 6` contract; no invented level or placeholder ID is submitted.
- The final save issues one authenticated `PATCH /me/university` with the complete reviewed selection. It does not issue a cascade of partial writes that could retain stale descendants.
- A newly verified email user first creates the session with the entered password, restores the reviewed draft after owner activation, performs the one replacement PATCH, and then bootstraps authenticated context. A signed-in Google or restored-session user uses the same screen and PATCH without requesting a password.
- If final context bootstrap fails, the app remains in hydration/error handling and does not proceed to Home.

## UI, accessibility, and responsive contract

- Phase 4 `Screen`, `Card`, `TextField`, `SelectField`, `Button`, feedback, and semantic theme primitives own auth/onboarding layout. No second color or component system was introduced.
- Field labels remain visible independently of placeholder/value. Errors are attached to their fields and also summarized through semantic feedback where useful.
- Password visibility and other trailing actions preserve labelled interactive targets. Busy actions expose accessibility state; selector triggers expose combobox, expanded, busy, and selected-value semantics.
- Forms use a bounded readable width, keyboard-safe scrolling, and platform keyboard behavior. The pure responsive contract keeps approximately 320 dp layouts compact while leaving text system-scalable at font scale 2.0.
- Native-renderer coverage verifies that the complete registration form remains structurally reachable at 320 dp and 200% font scale. This deterministic result is not a screen-reader, physical keyboard, or complete installed-app large-text acceptance claim.
- Light and dark semantic rendering are available. The development preview can select either theme deterministically; it does not prove OS-controlled theme switching.

## Development-only evidence surface

`AuthOnboardingPreview` renders the real extracted screens against local synthetic state. Selection requires both `__DEV__` and `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW=1`, so a production build cannot expose it. Optional variables are:

- `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_SCENARIO=<scenario>` for a stable direct capture with controls hidden;
- `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW_THEME=dark` for deterministic dark rendering; any other value selects light.

The 13 scenario IDs are `login`, `login-loading`, `login-error`, `register`, `verification-cooldown`, `recovery-request`, `recovery-code`, `recovery-confirm`, `recovery-success`, `onboarding`, `onboarding-loading`, `onboarding-error`, and `onboarding-success`. All identity-like values use the reserved `.invalid` domain. Actions mutate preview-local state only; the preview imports no API, storage, Google, notification, or provider module and performs no network request.

The Android screenshots in [`phase-06-native`](../evidence/phase-06-native/README.md) are native emulator rendering of this synthetic preview. They are useful presentation evidence, but they do not prove live registration, mail delivery, Google chooser behavior, backend mutation, session persistence, or production data.

## API, persistence, and security boundaries

- No endpoint, DTO, repository, database schema/index, provider lifecycle, notification-delivery rule, content-trust rule, or owner-generation cleanup contract changed.
- Registration, verification/resend, login/Google login, password recovery, `/me`, and `/me/university` retain their existing request shapes and controlled error mapping.
- The existing owner-bound session record and pending-verification key remain the only relevant persisted auth records. Phase 6 adds no key or migration.
- Verification persistence is non-secret. Passwords, verification codes, recovery codes, confirmation values, and synthetic preview state are never persisted or logged.
- No production API, account, email inbox, provider, database, credential, token, or user data was accessed for implementation or evidence.
- Rollback is code-only and requires no data transformation: revert the Phase 6 working-tree changes and rebuild the native app. Existing Phase 1–5 records remain compatible.

## Test coverage

- Pure Vitest coverage exercises login/registration validation, exact code lengths, email masking, academic cascade clearing, payload construction, dirty-state detection, class-level derivation, and 320 dp/font-scale-2 responsive policy together with the retained recovery, session-integrity, and route-foundation contracts.
- `AuthScreens.test.tsx` contributes 24 semantic renderer tests across all seven screens: validation order and IME focus, busy state, Google cancellation, password visibility, route actions, resend/expiry, recovery, academic selector states/cascades/review/save, dirty Back confirmation, accessibility state, and 320 dp/font-scale-2 structure.
- `AuthOnboardingPreview.test.tsx` contributes 3 tests proving the import/network/storage boundary, all 13 synthetic scenarios, and stable named-scenario boot.
- The full native Jest/RNTL result is 11 suites / 79 tests / 0 snapshots. Vitest remains the pure/API runner.
- No `.skip`, `.only`, blind snapshot update, Maestro, Detox, Appium, or native screenshot-regression harness was added.

## Historical Phase 6 validation ledger

| Check | Result | Evidence boundary |
|---|---|---|
| Focused Phase 6 pure contracts | PASS, 4 files / 112 tests, 1.50 s | Auth/onboarding, recovery, session-integrity, and route-foundation policy; no native renderer claim |
| Focused extracted auth screens | PASS, 1 suite / 24 tests / 0 snapshots | Jest Expo + React Native Testing Library semantic rendering; no OS/provider claim |
| Focused synthetic preview | PASS, 1 suite / 3 tests / 0 snapshots | Real extracted screens against local synthetic state; no API/storage/provider behavior |
| Complete native Jest/RNTL | Final PASS, 11 suites / 79 tests / 0 snapshots, 55.369 s | Complete native component regression; no installed-app E2E claim |
| Complete API tests | Final PASS, 30 files / 310 tests, 45.15 s Vitest duration (52.6 s wall); one non-failing Mongoose `new` deprecation warning | Existing API regression; Phase 6 changes no API behavior |
| Workspace TypeScript | Final PASS, 29.4 s | Complete workspace TypeScript graph |
| Mobile-native TypeScript | Final PASS, 7.4 s | Native implementation, preview, and tests |
| Full root regression | Final PASS, 45 files / 581 tests, 33.09 s | Above Phase 5's 44-file / 543-test result |
| Admin web build | Final PASS, 1,742 modules, 10.15 s; main JS 250.51 kB, gzip 73.89 kB | Web regression only, not native evidence |
| Mobile web build | Final PASS, 1,754 modules, 14.58 s; main JS 349.18 kB, gzip 104.25 kB | Web regression only, not native evidence |
| Android x86_64 debug assembly | Final PASS, `BUILD SUCCESSFUL in 1m 32s`, 245 tasks (7 executed/238 up-to-date); 56,804,991-byte debug APK; SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7` | Native compile/link artifact, debug signed and Metro-served; no release/publish claim |
| Final Android install/launch | PASS: `adb install -r -d` returned `Success`; `com.anssoft.akademiktakvim/.MainActivity` exposed `Tekrar hoş geldin`; density/font were restored to 320/1.0 | Current debug artifact plus local synthetic Metro preview; no live API/provider account |
| Android Phase 6 presentation matrix | PASS, 20 reviewed 720×1280 PNGs + 20 same-state UIAutomator XML hierarchies | [`phase-06-native`](../evidence/phase-06-native/README.md); synthetic `__DEV__` preview on the sole API 24 AVD, not live-account E2E |
| Mobile-native lint | `MOBILE_NATIVE_LINT: NOT AVAILABLE` | No root/native lint script, applicable ESLint dependency, or lint configuration exists |

### Exact deterministic command ledger

```powershell
npm.cmd test -- tests/unit/mobile-native-auth-onboarding.test.ts tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts tests/unit/mobile-native-route-foundation.test.ts --configLoader runner
npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/auth/AuthScreens.test.tsx
npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/auth/AuthOnboardingPreview.test.tsx
npm.cmd --prefix apps/mobile-native run test:native -- --runInBand
npx.cmd vitest run apps/api/tests --configLoader runner
npm.cmd run typecheck
npm.cmd --prefix apps/mobile-native run typecheck
npm.cmd test -- --configLoader runner
npm.cmd run build:admin
npm.cmd run build:mobile

Set-Location apps/mobile-native/android
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon
```

## Native and end-to-end evidence boundaries

- The only available Android target is `AcademicPhase1Low`, Android 7.0/API 24/x86_64. It can render the app and exercise ordinary Back. API 24 cannot demonstrate Android predictive-Back callbacks or animation.
- The selected React Navigation integration retains `android:enableOnBackInvokedCallback="false"` / the supported predictive-back opt-out. Phase 6 does not relabel ordinary Back as predictive-Back acceptance.
- TalkBack is unavailable on the authorized API 24 image. UIAutomator labels/hierarchies and semantic component queries do not constitute TalkBack traversal acceptance.
- The Windows host has no Xcode, iOS runtime, or simulator. No iOS build, keyboard, Dynamic Type, VoiceOver, swipe-back, or visual acceptance is claimed.
- No authorized non-production Google provider/account fixture exists, so real Google chooser, cancellation at the native provider boundary, account selection, and incomplete-profile handoff remain unexercised natively.
- The repository has no Maestro, Detox, Appium, or other installed-app native E2E runner. The required live email registration→verification→onboarding→Home, Google incomplete-profile→onboarding, unverified-user recovery, and password-reset→fresh-login scenarios remain unautomated.
- Synthetic preview screenshots are presentation evidence only. They must not be used to close live email/provider/backend/session E2E or screen-reader acceptance.

## Files changed by Phase 6

- Auth/onboarding implementation: `apps/mobile-native/src/auth/auth-ui.ts`, `AuthScreens.tsx`, `AuthOnboardingPreview.tsx`, and `apps/mobile-native/App.tsx`.
- Route integration and retained preview/navigation adaptations: `src/navigation/routes.ts`, `route-resolution.ts`, `route-intent.ts`, `AppNavigator.tsx`, and `AppShellPreview.tsx`.
- Reused design-system support: the existing field, selector, button, icon-button, bottom-sheet, and surface primitives; no second design system.
- Tests: `tests/unit/mobile-native-auth-onboarding.test.ts`, retained/expanded auth-recovery and route-foundation tests, `apps/mobile-native/tests/auth/AuthScreens.test.tsx`, `AuthOnboardingPreview.test.tsx`, and affected design-system/navigation regressions.
- Documentation and native evidence: the Phase 6 documentation set and [`docs/mobile-native-redesign/evidence/phase-06-native/**`](../evidence/phase-06-native/README.md).

No Phase 6 package, dependency, lockfile, API, database, provider configuration, platform permission, deployment, publish, or production-data change was made.

## Remaining blockers and historical handoff

- Run installed-app native E2E with authorized disposable email delivery and Google provider/account fixtures before claiming the four required live flows.
- Rerun the visual/accessibility matrix on macOS/Xcode iOS and on an authorized Android image/device with TalkBack and modern predictive Back support.
- Keep MN-024, MN-029, MN-033, and MN-034 open until those platform/provider gates are satisfied. Keep MN-019 open for native E2E/screenshot automation and MN-020 open for the absent lint toolchain.
- Broader whole-app dark mode, complete large-text/screen-reader quality, and content-screen redesign remain later authorized phases.

At the original Phase 6 handoff, this phase stopped at auth and academic onboarding and had not touched Home. Phase 7 was subsequently implemented and reconciled in its own scoped commits; that later work does not change Phase 6 ownership.
