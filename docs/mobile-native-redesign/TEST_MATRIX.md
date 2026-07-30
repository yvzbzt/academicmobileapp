# Mobile Native Test and Evidence Matrix

Baseline date: 29 July 2026
Baseline branch/HEAD: `agent/google-play-readiness-20260724` / `cbd0067b03c3cf7286270df25164a556c55b55b9`

## Evidence classes

| Evidence | What it proves | What it does not prove |
|---|---|---|
| TypeScript check | The checked project type graph compiles under current declarations | Runtime behavior, visual layout, native linking |
| Vitest unit/API tests | Tested domain/service/helper contracts behave in Node | `App.tsx` rendering, native permissions, native navigation |
| Expo Android export | Metro can resolve and produce an Android/Hermes bundle and assets | APK assembly, install, launch, native module configuration, UI acceptance |
| Vite admin/mobile web build | Current repository CI web clients bundle | Native UI or native runtime behavior |
| Android/iOS native launch | App installs/starts on the target runtime | Complete visual/accessibility acceptance without state matrix |
| Native screenshots | A named build/state rendered on a native platform | Functional correctness outside the captured state |
| Expo Web screenshot | Responsive web appearance only | **Never accepted as native visual evidence** |

## Baseline environment

- Host: Windows, Europe/Istanbul.
- Node: `v22.14.0`.
- npm: `10.9.2`.
- Package topology: two independent npm install roots and lockfiles (root and `apps/mobile-native`), both lockfile version 3; no npm `workspaces` declaration.
- Native runtime: Expo package `54.0.35` installed (Expo CLI reports `54.0.25`), React Native `0.81.5`, React `19.1.0`, TypeScript `5.9.3`.
- Root test/build tools: Vitest `3.2.6`, Playwright `1.61.1`, TypeScript `5.9.3`, tsx `4.22.4`.
- Android SDK is configured. ADB `1.0.41` / `36.0.2` exists, but no device is attached. Android emulator binary and AVD directory are absent.
- iOS simulator is unavailable on Windows.

## Existing scripts and tooling

| Area | Existing command/tool | Baseline status |
|---|---|---|
| Root TypeScript | `npm.cmd run typecheck` | Exists; excludes `apps/mobile-native/**` by root tsconfig |
| Native TypeScript | `npm.cmd run typecheck:mobile:native` | Exists; proxies to native `tsc --noEmit` |
| Root tests | `npm.cmd test` | Exists; Vitest excludes `tests/e2e/**` |
| Lint | None | No root/native lint script, ESLint dependency, or lint config found |
| Native unit/component tests | None | No native test script or tests under `apps/mobile-native` |
| Native helper unit tests | Root Vitest | 15 tests across Google Calendar and dormant native-calendar helpers |
| API tests | Root Vitest | 20 API files / 132 tests |
| Native bundle smoke | Expo CLI export | No package script; safe command established in Phase 0 |
| Native Android build/launch | `npm.cmd run android:mobile:native` | Build+install+launch command exists; not runnable without device/emulator and may generate ignored native project output |
| Native iOS build/launch | `npm.cmd run ios:mobile:native` | Requires macOS/Xcode; unavailable here |
| Web E2E | Playwright desktop Chromium | Five hosted/live/browser specs; not native evidence |
| Native E2E | None | No Maestro or Detox |
| Component test stack | None | No React Native Testing Library/react-test-renderer configuration |
| Storybook | None | No dependency/configuration |
| Native screenshot regression | None | Playwright screenshot-on-failure is web-only |

Transitive Jest packages inside the Expo dependency lockfile do not constitute an installed/configured Jest test stack.

## Commands executed in Phase 0

| # | Exact command | Result | Evidence/notes |
|---:|---|---|---|
| 1 | `npm.cmd run typecheck:mobile:native` | PASS, exit 0, 21.291 s | Native TypeScript baseline |
| 2 | `npm.cmd run typecheck` | PASS, exit 0, 37.582 s | Root/API/shared TypeScript baseline; native excluded |
| 3 | `npm.cmd test` | First sandbox attempt blocked, exit 1, 5.200 s | Environment-only esbuild error: sandbox denied reading parent/config; no test executed |
| 4 | `npm.cmd test` (approved outside sandbox, unchanged source) | PASS, exit 0, 35.143 s | 24/24 files and 171/171 tests; Vitest internal duration 32.81 s |
| 5 | `npm.cmd run build:admin` (approved outside sandbox) | PASS, exit 0 | Vite 7.3.6; 1,742 modules; build reported 9.86 s; responsive admin web only |
| 6 | `npm.cmd run build:mobile` | First sandbox attempt blocked, exit 1, 3.8 s | Environment-only esbuild local-config access failure |
| 7 | `npm.cmd run build:mobile` (approved outside sandbox, unchanged source) | PASS, exit 0, 20.2 s | Vite 7.3.6; 1,754 modules; build reported 18.08 s; responsive web only |
| 8 | `./node_modules/.bin/expo.cmd export --platform android --output-dir C:\tmp\academicmobileapp-phase0-android-export --max-workers 2` from `apps/mobile-native` | First sandbox attempt blocked, exit 1, 2.986 s | Environment-only `EPERM` creating the temp output directory |
| 9 | Same Expo export command (approved outside sandbox, unchanged source) | PASS, exit 0, 93.916 s | Android/Hermes bundle; 671 modules; 21 files / 6,382,644 bytes in `C:\tmp`; no publish |
| 10 | `C:\Users\buyuk\AppData\Local\Android\Sdk\platform-tools\adb.exe devices -l` | PASS, exit 0, 0.053 s | Device list empty |

The sandbox-only esbuild/temporary-directory failures are execution-environment limitations, not product failures. Each relevant command passed without code changes when rerun with the required filesystem access.

## Baseline test composition

| Layer | Files/tests | Result | Native relevance |
|---|---:|---|---|
| API | 20 files / 132 tests | PASS | Auth, users, calendar, announcements, notifications, persistence and service contracts |
| Native helper logic | 2 files / 15 tests | PASS | `google-calendar-sync` and dormant `native-calendar-sync`; no rendering/native SDK runtime |
| Other root unit | 2 files / 24 tests | PASS | Calendar ingestion and university-source discovery |
| Native `App` component | 0 files / 0 tests | MISSING | No auth/screen/navigation/accessibility rendering coverage |
| Native flow/E2E | 0 | MISSING | No install/launch/permission/back/deep-link automation |
| Native screenshots | 0 current baseline captures | BLOCKED | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` |

The five Playwright E2E files were intentionally not executed: they target hosted/live services, website retrieval, or the responsive Vite client. `e2e:live` can alter Cloud Run/bootstrap state and is outside this no-production-mutation phase. None supplies native evidence.

## Native visual QA baseline

| Platform | Launch target | Screenshot status | Result |
|---|---|---|---|
| Android | No attached device; emulator binary and AVD absent | Cannot launch/capture | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` |
| iOS | Windows host, no Xcode/simulator | Cannot launch/capture | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` |

Pre-existing APK/AAB files at repository root do not prove that current HEAD launched on 29 July 2026 and are not accepted as current visual evidence.

## Phase 1 final-closure Android environment

The Phase 0 environment rows above are historical baseline evidence at `cbd0067`. The final-closure environment was installed and verified separately:

| Item | Configured/installed evidence | Effective runtime evidence | Closure state |
|---|---|---|---|
| Host/toolchain | Windows 11 Pro build 26200; i7-1165G7 4C/8T; Node `v22.14.0`; npm `10.9.2`; Temurin Java `21.0.7+6-LTS`; winget `v1.29.280`; SDK root `C:\Users\buyuk\AppData\Local\Android\Sdk` | Closure-time capacity while QA ran: 16,461,264 kB total / 1,623,144 kB free RAM; `C:` 510,655,012,864 total / 72,134,201,344 free bytes | RECORDED; values are post-install, not reconstructed pre-install capacity |
| Android Studio | Official Google Android Studio Stable; winget `Google.AndroidStudio` version `2026.1.2.10`; product build `AI-261.25134.95.2612.15822958` | Installed; Android Studio is not kept open during command-line QA | PASS |
| SDK tools | Platform-Tools/ADB `36.0.2`; command-line tools revision 22 at SDK-recognized `cmdline-tools/latest-2`; Emulator `36.6.11` | The `latest-2` directory causes a non-fatal inconsistent-location warning because the older directory already occupied `latest` | PASS with recorded warning |
| System image | Exactly one Google APIs x86_64 image: API 24 revision 27; no Google Play, ARM, TV, Wear, or Automotive image | `ro.build.version.sdk=24`, ABI x86_64 | PASS |
| AVD count/name | Exactly one AVD: `AcademicPhase1Low` | Exactly one AVD remains | PASS |
| CPU/RAM | 2 cores; 1,536 MB configured | 2 cores; `/proc/meminfo` reports 1,533,960 kB | PASS |
| Display | 720 × 1280, 320 dpi, approximately 360 dp | `wm size` 720 × 1280; `wm density` 320 | PASS |
| Heap/data selected-image exception | Requested/prelaunch: 256 MB heap, 2,047 MB data | Post-boot config: 256 MB heap / 6,442,450,944-byte data; runtime: 384 MB heap / approximately 5.8 GB `/data` | Requested budget NOT MET; documented exception only. The separate hard ≤2-core/≤2,048-MB-RAM gate passes after API36/34/30/28/24 attempts |
| Peripheral/resource policy | Host GPU; front/back camera, audio, and device frame off; hardware keyboard and Quick Boot on | WHPX `10.0.26200` installed and usable; no software-emulation claim | PASS |
| First boot | Headless command-line launch on the single AVD | Cold boot completed in 42.3 seconds | PASS |
| Visible standalone run | Same launch options without `-no-window` | Quick Boot 4.5 seconds; ADB healthy | PASS |

API 36, 34, 30, and 28 Google APIs x86_64 images were tried sequentially on the same AVD name and removed before the next attempt. They forced still-higher effective heap and/or data values. API 24 is the final and only installed image; the current app's `minSdkVersion` is 24. Configured and effective values are deliberately reported separately.

## Phase 1 automated evidence (pre-final-closure snapshot)

The table below records the earlier Phase 1 integrity snapshot before password-recovery implementation and Android environment setup. Those passes remain regression evidence, but they are not a substitute for the final post-recovery rerun recorded later in this document.

| # | Exact command | Result | Evidence/notes |
|---:|---|---|---|
| 1 | `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0 | Final native TypeScript graph. |
| 2 | `npm.cmd run typecheck` | PASS, exit 0 | Final root/API/shared TypeScript graph; native remains separately checked by row 1. |
| 3 | `npx.cmd vitest run tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts tests/unit/google-calendar-sync.test.ts --configLoader runner` | PASS, 3 files / 40 tests | Resend/recovery, password parity, hydration root state/order, owner-scoped storage, stale completion, observable cleanup, concrete mutation/tombstone guards, and Google abort propagation. |
| 4 | `npx.cmd vitest run --configLoader runner apps/api/tests/auth-application.service.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/email-verification-sender.test.ts apps/api/tests/operations.test.ts apps/api/tests/users-and-guards.test.ts` | PASS, 6 files / 51 tests | Controlled auth contract, real loopback Nest HTTP serialization/rotation, hierarchy replacement across adapters, rate limiting, and secret-free fallback logging. |
| 5 | `npx.cmd vitest run --configLoader runner` | PASS, 28 files / 220 tests | Final root regression suite. |
| 6 | `npm.cmd run build:admin -- --configLoader runner` | PASS, 1,742 modules | Final admin web regression build; not native visual evidence. |
| 7 | `npm.cmd run build:mobile -- --configLoader runner` | PASS, 1,754 modules | Final responsive web regression build; not native visual evidence. |
| 8 | `npx.cmd expo export --platform android --output-dir C:\tmp\academicmobileapp-phase1-android-export-final-20260729-1152` from `apps/mobile-native` | First sandbox attempt: FAIL (`EPERM` creating output); approved rerun: PASS, 674 modules / 19 assets / 2.37 MB HBC | Environment-only access failure followed by successful Android/Hermes export. |
| 9 | `npx.cmd expo export --platform android --output-dir C:\tmp\academicmobileapp-phase1-android-export-final-20260729-1201` from `apps/mobile-native` | PASS, 674 modules / 19 assets / 2.37 MB HBC | Final post-patch Android/Hermes bundle exported outside the repository; no publish, install, launch, or screenshot. |
| 10 | `git diff --check` | PASS, exit 0 | No whitespace errors; Git emitted only expected LF-to-CRLF working-copy notices. |
| 11 | Targeted sensitive-log scan (exact PowerShell below) | PASS, no matches | Production-source scan; ripgrep no-match exit 1 was handled as a successful empty result. |

```powershell
$scanPattern = '(VERIFY_EMAIL_CODE\s|ACCOUNT_DELETION_CODE\s|PASSWORD_RECOVERY_CODE\s|logger\.(log|warn|error|debug).*(\$\{input\.(email|userEmail|fullName|code|password|newPassword|passwordConfirmation|universityId|facultyName|departmentName)\}|accessToken|refreshToken|verificationCode|previewVerificationToken|recoveryCode|previewRecoveryCode|recoveryToken|examTitle)|console\.(log|warn|error|info).*\b(email|userEmail|fullName|password|newPassword|passwordConfirmation|accessToken|refreshToken|verificationCode|previewVerificationToken|recoveryCode|previewRecoveryCode|recoveryToken|examTitle|facultyName|departmentName)\b)'
rg -n $scanPattern apps/api/src apps/mobile-native
if ($LASTEXITCODE -eq 1) { Write-Output 'SENSITIVE_LOG_SCAN_NO_MATCHES'; exit 0 }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

### Phase 1 tests added or materially extended

| Contract | Automated evidence | Remaining evidence |
|---|---|---|
| Correct resend endpoint; relaunch recovery stores no password/code; expiry/cooldown survives | `mobile-native-auth-recovery.test.ts`; auth application and HTTP contract tests | PASS: native registration→Verification, relaunch blank-code/no-password restore, resend timing reset, second relaunch |
| Password recovery request is generic; code is secure/expiring/single-use; older request invalidates; password parity/mismatch, old/new Login, and refresh revocation | `password-recovery.test.ts`; auth HTTP/sender/schema/index tests; native recovery/session tests; [`runtime-auth-contract.md`](./evidence/phase-01-native/runtime-auth-contract.md) | PASS: native known/unknown presentation, invalid/reset/old-new path, visibility, explicit Back/Cancel, and two held-session revocations exercised; server expiry remains seeded automated evidence |
| Verification success is distinct from later Login failure | Native auth recovery source-contract test; real HTTP verification/login sequence | PASS: native verified confirmation remained visible before the later stale-password Login returned the compound verified-but-login-failed copy |
| Controlled errors distinguish credentials, unverified email, invalid/expired verification, expired/invalid session, disabled account, and 429 | Native classifier tests; auth service tests; real HTTP response assertions | PASS within fixture boundary: wrong credentials, unverified Login, invalid verification, expired recovery UI, and expired session observed natively; server-expired verification, disabled-account, and 429 branches remain deterministic automated contract evidence |
| Client/API password minimum is 10 JavaScript UTF-16 code units and input strings are not trimmed | Native parity/source-contract test; HTTP spaced-password round trip; shared API constant | PASS: hardware-keyboard focus/submit and native Login/Register hide→show→hide semantics/labels; password-manager integration not exercised |
| Hydration never exposes stable Login/Home; device ID precedes refresh | Hydration helper and concrete-source ordering assertions | PASS: signed-out no-Home flash; signed-in force-stop/relaunch bundle/loading→Home with no Login flash |
| Manual exams do not suffer startup empty-write loss and cannot cross account owners | v2 key/envelope/migration/guard tests plus concrete-source assertions | PASS: A relaunch persistence and A/B/A isolation on one AVD |
| Late refresh/content/preference/Google settlement is rejected after close/switch | Account-generation tests, concrete-source assertions, Google abort-signal tests | PASS for logout wait/relaunch and A/B/A settlement; individual native Google callback timing remains automated-only |
| University/faculty replacement clears descendants and validates parents | In-memory, Firestore, Mongo, service, admin-path, and real HTTP tests | Deployed-adapter smoke intentionally not run |
| Logout/deletion cleanup failure is observable and bounded | Cleanup helper timeout/failure tests plus concrete tombstone/cleanup source assertions | Automated PASS; forced SecureStore failure was not injected into the installed app |
| No password, token, code, email, or personal exam content is logged by repaired paths | Email-sender logger spy and controlled-result non-leak assertions | Native startup logcat filter PASS with zero sensitive-pattern hits; see [`startup-logcat.md`](./evidence/phase-01-native/startup-logcat.md) |

### Phase 1 Task A1 credential-generation coverage

Task A1 adds backend persistence and stale-writer coverage only; it does not change native behavior. The complete run increased the established 29-file/240-test regression baseline to 30 files/265 tests.

| Contract | Required deterministic evidence | Deferred boundary |
|---|---|---|
| Legacy compatibility | User, refresh-token, and password-recovery records missing `credentialGeneration` read as `0`; newly created users initialize `0` | No production migration is run |
| Issuance stamping | Login/Google/refresh session creation stamps the current user generation on a new refresh record; an eligible recovery request stamps it on the new recovery record | Mismatch checks remain Task A2 |
| Profile and academic writers | Profile and hierarchy updates preserve a newer stored generation; university/faculty changes still delete omitted descendants in Firestore, Mongo, and in-memory adapters | Generation is not incremented in A1 |
| Identity and administrative writers | Email verification, Google identity, admin update, password update, admin deletion, personal-data clearing, and account deletion cannot erase or decrease a newer generation | Atomic reset completion remains Task A2 |
| Firestore persistence | User changes are field-level updates; clearing uses explicit delete sentinels; tests prove descendant clearing and generation preservation | No Firestore index change |
| Mongo persistence | User changes remain partial `$set`/`$unset`; general update input cannot write `credentialGeneration`; legacy output normalization returns `0` | No Mongo index or migration change |
| In-memory scheduling | User mutations use the current map entry synchronously, and deterministic delayed/concurrent coverage proves a stale read cannot restore an older generation | This is adapter safety, not cross-process transaction evidence |
| Auth compatibility | Existing login, refresh rotation/reuse, verification, and password-recovery request/confirmation behavior remains unchanged | Access JWT contents and validation are unaffected |

#### Task A1 final validation ledger — 30 July 2026

| Command | Result |
|---|---|
| `npm.cmd test -- --run apps/api/tests/auth-credential-generation.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/auth-application.service.test.ts apps/api/tests/password-recovery.test.ts --configLoader runner` | PASS, 5 files / 62 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 24 files / 182 tests |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0; no native source changed |
| `npm.cmd test` | Environment-blocked before test startup: sandbox denied esbuild access to the parent directory/config; no product test failed |
| `npm.cmd test -- --configLoader runner` | PASS, 30 files / 265 tests; exceeds the 29/240 baseline |
| `npx.cmd vitest run --configLoader runner` | Independent PASS, 30 files / 265 tests |
| Expanded production-source sensitive-log scan | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` |
| `git diff --check` | PASS, no whitespace errors; expected LF-to-CRLF notices only |

### Phase 1 R1A MongoDB-only runtime coverage

R1A changes runtime composition only. Firestore and in-memory adapters remain available to existing adapter-focused tests but cannot be selected or instantiated through `AppModule`.

| Contract | Deterministic evidence | Deferred boundary |
|---|---|---|
| Seven direct bindings | Exactly one direct `useClass` binding maps each auth, catalog, calendar, announcement, PDF, notification, and audit token to its Mongo implementation; isolated Nest resolution returns each expected class | Adapter deletion/relocation remains R1C |
| Selector immunity | Missing, `memory`, `mongo`, `firestore`, and invalid legacy `REPOSITORY_MODE` values do not alter configuration or repository bindings; no repository selector factory remains | Obsolete historical references outside active runtime configuration remain R1C |
| Startup validation | Missing, empty, or whitespace `MONGODB_URI` fails with the mode-neutral startup error; a plausible URI passes validation without connecting | No migration or live-database access |
| Readiness | Mongo ping runs for every legacy selector value; unavailability reports `mongodb/down` and `degraded`; active dependencies contain no Firestore check | Redis queue/rate-limit selection is unchanged |
| Bootstrap | The Firestore-specific branch and refresh flag are absent; deterministic generic seeding remains idempotent | Firestore adapter source remains until R1C |
| A1 compatibility | Generation normalization, issuance stamping, stale-writer safety, login, refresh, verification, and password-recovery tests remain green | Increment/enforcement and atomic reset remain Task A2 |

#### R1A final validation ledger — 30 July 2026

| Exact command | Result |
|---|---|
| `npx.cmd vitest run apps/api/tests/mongodb-runtime-wiring.test.ts apps/api/tests/operations.test.ts apps/api/tests/auth-credential-generation.test.ts apps/api/tests/auth-application.service.test.ts apps/api/tests/password-recovery.test.ts apps/api/tests/mongoose-schemas.test.ts --configLoader runner` | PASS, 6 files / 100 tests |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 25 files / 203 tests |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0; no native source changed |
| `npx.cmd vitest run --configLoader runner` | PASS, 31 files / 286 tests; exceeds the 30/265 checkpoint baseline |
| `npm.cmd run build:admin` | PASS outside the restricted sandbox, 1,742 modules |
| `npm.cmd run build:mobile` | Initial restricted-sandbox esbuild parent-directory denial; approved identical rerun PASS, 1,754 modules |
| Expanded production-source sensitive-log scan | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` |
| `git diff --check` | PASS, no whitespace errors; expected LF-to-CRLF notices only |

### Phase 1 R1B Mongo user-data persistence coverage

R1B replaces only the two `UsersService` process-local user-data arrays. The production adapter is Mongo-backed. Deterministic repository tests exercise behavior through Mongoose model doubles, service/HTTP tests use a fixture under `apps/api/tests/support`, and one focused integration case exercises real schemas, indexes, create/read, concurrent upsert, and cleanup against the existing local/CI Mongo 7 service. The integration case guards and drops only `academic_user_data_r1b_test_<pid>`; it is not reconnect, process-restart, or durable-disk evidence, which remains R1D.

| Contract | Deterministic evidence | Deferred boundary |
|---|---|---|
| Focused runtime binding | `UserDataRepository` resolves directly to `MongoUserDataRepository`; the seven existing R1A bindings remain direct Mongo classes with no selector factory | Firestore/in-memory adapter removal remains R1C |
| Suggestion persistence | A real isolated-Mongo create/read proves serialization and timestamps; model-double coverage retains owner, submitter email, hierarchy names, education level, pending status, and newest-first pending/approved/rejected lists | Reconnect/full live persistence smoke remains R1D |
| Existing review transitions | Approval and rejection update the persisted status and existing `reviewedAt` field while preserving the existing catalog and response behavior | No new review rules or notifications |
| Private-data authorization | The existing student route creates only for its authenticated owner, while the suggestion list/review routes retain their `super_admin` gate | No new student suggestion-read endpoint |
| Followed-scope semantics | Real Mongo enforces one record during an eight-way concurrent upsert and persists the private normalized key; model-double coverage proves university/faculty/department distinctions, empty-descendant normalization, response privacy, and oldest-first listing | No new follow endpoint or product behavior |
| Lifecycle cleanup | Personal-data clearing, both self-account-deletion branches, and admin deletion remove both collections for the target owner without deleting another owner's records | Historical process-memory records cannot be migrated |
| Service lifetime | A rebuilt `UsersService` sees data retained by the same repository, and source assertions show no suggestion/follow array remains authoritative | This is not process-restart or reconnect evidence |
| Schema and indexes | Both collection schemas retain the current fields; status/time and owner indexes support review/cleanup, and a unique owner/normalized-scope index enforces follow idempotency | No migration is run |
| A1 compatibility | Credential-generation normalization, issuance stamping, and stale-writer tests remain unchanged and green | Generation advancement/enforcement remains Task A2 |

#### R1B final validation ledger — 30 July 2026

| Exact command | Result |
|---|---|
| `npx.cmd vitest run apps/api/tests/mongo-user-data.repository.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/public-pages.controller.test.ts apps/api/tests/users-and-guards.test.ts apps/api/tests/mongodb-runtime-wiring.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/database-indexes.test.ts --configLoader runner` | PASS, 7 files / 47 tests |
| `npx.cmd vitest run apps/api/tests/mongodb-runtime-wiring.test.ts apps/api/tests/operations.test.ts --configLoader runner` | PASS, 2 files / 42 tests |
| `npx.cmd vitest run apps/api/tests/auth-credential-generation.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/auth-application.service.test.ts apps/api/tests/password-recovery.test.ts --configLoader runner` | PASS, 5 files / 64 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 26 files / 216 tests |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0; no native source changed |
| `npx.cmd vitest run --configLoader runner` | PASS, 32 files / 299 tests; exceeds the 31-file/286-test R1A baseline |
| `npm.cmd run build:admin` | PASS outside the restricted sandbox, 1,742 modules |
| `npm.cmd run build:mobile` | Initial restricted-sandbox Vite/esbuild parent-directory denial; approved identical rerun PASS, 1,754 modules |
| Expanded production-source sensitive-log scan | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` |
| `git diff --check` | PASS, no whitespace errors; expected LF-to-CRLF notices only |

### Earlier Phase 1 reconciliation before password-recovery closure

| Command | Final result |
|---|---|
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npx.cmd vitest run --configLoader runner` | PASS, 28 files / 220 tests |
| `npm.cmd run build:admin -- --configLoader runner` | PASS, 1,742 modules |
| `npm.cmd run build:mobile -- --configLoader runner` | PASS, 1,754 modules |
| Final Android Expo export to a new `C:\tmp` directory | PASS after approved retry, 674 modules / 19 assets / 2.37 MB HBC |
| `git diff --check` and sensitive-log source scan | PASS; no whitespace errors and no targeted sensitive-log patterns matched |

An initial plain `npm` TypeScript invocation was blocked by the Windows PowerShell execution policy at `npm.ps1`; the equivalent explicit `npm.cmd` commands above then ran and passed. This was a shell-policy failure before the project command executed, not a TypeScript failure.

No React Native component runner, Maestro, Detox, or screenshot harness was introduced. Therefore the component/native-flow columns required by Phase 1 remain environment/tooling gaps even when the pure helper, source-contract, API, TypeScript, and bundle checks pass.

## Phase 1 password-recovery and closure command ledger

These are the verified post-recovery closure results. Earlier sandbox, wrong-directory, and resource-contention attempts remain disclosed below, but no earlier failure is silently promoted: each required final check has its own passing rerun.

| Exact command | Result | Evidence boundary |
|---|---|---|
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0, 16.8 s | Final native TypeScript graph |
| `npm.cmd run typecheck` | PASS, exit 0, 24.6 s | Final workspace/API/shared TypeScript graph |
| `npm.cmd test -- --run tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts` | PASS, 2 files / 42 tests | Native recovery validation, controlled mapping, Back/Cancel, and source contracts; no rendered native-runtime claim |
| `npx.cmd vitest run tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts tests/unit/google-calendar-sync.test.ts --configLoader runner` | PASS, 3 files / 49 tests | Native auth/session plus Google cancellation and stale-completion contracts |
| `npx.cmd vitest run --configLoader runner apps/api/tests/auth-application.service.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/email-verification-sender.test.ts apps/api/tests/operations.test.ts apps/api/tests/users-and-guards.test.ts` | PASS, 6 files / 51 tests | Controlled auth/HTTP/hierarchy/rate-limit/diagnostic contracts |
| `npm.cmd test -- apps/api/tests/password-recovery.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/email-verification-sender.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/database-indexes.test.ts --configLoader runner` | PASS, 5 files / 24 tests | Recovery service/HTTP, sender privacy, schema, and index contracts |
| `npm.cmd test -- apps/api/tests/password-recovery.test.ts --configLoader runner` | PASS, 1 file / 9 tests | Production secret fail-closed, public-field parity, digest-only persistence/account cleanup, rate limit, invalid/expired/single-use/older-code behavior, password parity/mismatch, old/new password, refresh revocation, and secret-free logs/results |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 23 files / 157 tests | Final default-timeout API suite; supersedes the disclosed resource-contended 154/157 attempt |
| `npm.cmd test` | PASS, 29 files / 240 tests | Final default full regression suite |
| `npx.cmd vitest run --configLoader runner` | PASS, 29 files / 240 tests | Independent full runner-form confirmation |
| `npm.cmd run build:admin` and `npm.cmd run build:admin -- --configLoader runner` | PASS, 1,742 modules in each form | Admin web regression build; not native visual evidence |
| `npm.cmd run build:mobile` and `npm.cmd run build:mobile -- --configLoader runner` | PASS, 1,754 modules in each form | Responsive web regression build; not native visual evidence |
| `npx.cmd expo export --platform android --output-dir C:\tmp\academicmobileapp-phase1-android-export-final-20260729-172829` from repository root | Initial sandbox mkdir `EPERM`; identical approved rerun PASS, exit 0: 674 modules / 19 assets / 2.39 MB HBC | Final post-recovery Android/Hermes bundle; no publish |
| `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\academicmobileapp-phase0-android-export-rerun-20260729-172829 --max-workers 2` from `apps/mobile-native` | PASS, 674 modules / 19 assets / 2.39 MB HBC | Exact Phase 0 command-shape rerun against final source |
| `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android` | PASS, 388.1 seconds | Fresh current-source x86_64 debug APK assembly; debug signing only; first root-directory attempt never entered Gradle |
| `git diff --check` | PASS, exit 0 | No whitespace errors; expected line-ending notices only |
| Expanded production-source sensitive-log scan | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` | No configured sensitive diagnostic pattern matched |

`MOBILE_NATIVE_LINT: NOT AVAILABLE`

Reason: neither the root nor `apps/mobile-native` package exposes a lint script; no applicable ESLint dependency or lint configuration exists. TypeScript success is reported only as TypeScript success. Phase 1 does not introduce a broad lint migration.

## Phase 1 native visual QA

| Platform/check | Environment/result | Closure state |
|---|---|---|
| Android environment | Official Stable Studio, accelerated API 24 x86_64 Google APIs image, and exactly one `AcademicPhase1Low` AVD are available | PASS |
| Current debug build | x86_64 `app:assembleDebug` passed in 388.1 seconds | PASS |
| APK install/package/activity/no-immediate-crash | Install `Success`; expected debuggable `com.anssoft.akademiktakvim` `0.1.1`/12 (min24/target36); MainActivity 1,083 ms; exact fatal/native-module/React-JS filter in [`startup-logcat.md`](./evidence/phase-01-native/startup-logcat.md) returned section headers only | PASS |
| Authentication/hydration/verification recovery | Signed-out/in hydration, verification relaunch/resend, unverified Login, invalid/expired presentation, Login/Register visibility, and verification-success→later-Login-failure exercised | PASS within the prompt's expired-token fixture qualification; exact rows NQ-01–NQ-08 |
| Password recovery including invalid attempt, success, old-password rejection, new-password Login, and refresh revocation | Generic known/unknown presentation, visibility, explicit Back/Cancel cleanup, invalid/reset/old-new flow, and two held-session revocations exercised | PASS; exact rows NQ-09–NQ-16 |
| Two-account manual-exam isolation and relaunch persistence | A exam survived relaunch; B saw no A and added B; return to A showed only A | PASS |
| Academic descendant clearing after server reload/relaunch | University replacement and faculty replacement cleared descendants/class in API response and after native relaunch | PASS |
| Logout/late-response/relaunch safety | Protected content absent immediately, after 5 s, and after signed-out relaunch | PASS |
| 360 dp, temporary 320 dp, and 200% font-scale captures | 360 PASS; 320 Login/Register/Recovery PASS; font 2.0 Login/Register/Verification/Password Recovery/Home/Profile-academic PASS for reachability; Home nav labels wrap/truncate | PASS with documented large-font navigation-label limitation |
| TalkBack | `pm list packages` found no TalkBack/accessibility package, services are null/disabled, and the TalkBack activity cannot resolve; exact output in [`talkback-blocker.md`](./evidence/phase-01-native/talkback-blocker.md) | BLOCKED on selected image; closure criterion PASS because the exact blocker is documented; no screen-reader acceptance claimed |
| iOS | Windows host; no Xcode/simulator or connected iOS workflow | Not part of this authorized Android closure; no iOS evidence claimed |

No Expo Web image or pre-existing APK/AAB is substituted for native evidence. Native flow acceptance is limited to the exact PASS rows; TalkBack remains unavailable with its exact blocker, and the large-font wrapping limitations remain disclosed.

Text evidence index: [`evidence/phase-01-native/README.md`](./evidence/phase-01-native/README.md). Native result register: [`evidence/phase-01-native/native-qa-results.md`](./evidence/phase-01-native/native-qa-results.md).

## Required coverage by phase

| Scenario family | Unit/contract | Component | Native flow | Native visual | Owning phase |
|---|:---:|:---:|:---:|:---:|---:|
| Resend, verification abandonment, refresh/logout ordering, account switch | Required | Required | Required | Required | 1 |
| Academic parent-child clearing and account-scoped manual exams | Required | Required | Required | Relevant states | 1 |
| Sanitized content, timestamp semantics, URL allowlist | Required | Required | Handoff | Long/error states | 2 |
| Google connect/sync/change/disconnect/revoke/remove | Required | Required | Device/account permission | All outcomes | 3 |
| Notification permission/token/device/deletion | Required | Required | Real device | All permission states | 3 |
| Tokens and primary component states | Contrast/unit | Semantic queries | N/A | iOS + Android | 4 |
| Auth guard, four tabs, back, deep links, restoration | Required | Required | Required | Phone/tablet chrome | 5 |
| Auth forms and recovery | Contract | Semantic queries | Required | Keyboard/320 dp/large text | 6 |
| Home states and destinations | Required | Required | Smoke | All data states | 7 |
| Feed virtualization/filter/content actions | Required | Required | Scroll/handoff | Long feed/source states | 8 |
| Calendar dates/manual CRUD/integration states | Required | Required | Required | Platform date UI | 9 |
| Profile selectors/settings/deletion | Required | Required | Required | Sheets/dialogs/states | 10 |
| Dark mode, text scale, screen reader, reduced motion/transparency, tablet, predictive back | Relevant | Required | Required | Complete matrix | 11 |
| Full regression and release evidence | All | All | All | All | 12 |

## Test-framework decision gate

Phase 4 must select one native component-test stack compatible with Expo 54 / React Native 0.81.5 and justify any dependency changes. Prefer semantic accessibility queries; use `testID` only when semantics cannot identify the target. Do not add Jest, an alternative runner, Maestro, Detox, and Storybook simultaneously.
