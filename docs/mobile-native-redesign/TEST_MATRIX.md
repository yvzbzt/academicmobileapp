# Mobile Native Test and Evidence Matrix

Historical baseline date: 29 July 2026
Historical baseline branch/HEAD: `agent/google-play-readiness-20260724` / `cbd0067b03c3cf7286270df25164a556c55b55b9`

The dated Phase 0–8 ledgers below are preserved historical evidence. Their counts and statements such as “next phase not started” apply only to the named checkpoint. The **Current Phase 1–8 remediation ledger — 4 August 2026** at the end is authoritative for the current suite and supersedes conflicting current-state wording without rewriting the old results.

## Evidence classes

| Evidence | What it proves | What it does not prove |
|---|---|---|
| TypeScript check | The checked project type graph compiles under current declarations | Runtime behavior, visual layout, native linking |
| Vitest unit/API tests | Tested domain/service/helper contracts behave in Node | `App.tsx` rendering, native permissions, native navigation |
| Jest Expo + React Native Testing Library | Rendered React Native semantics, interaction states, and React Navigation state changes behave in the Jest host | Native OS layout/material, permission prompts, predictive gestures, provider SDK UI, or visual acceptance |
| Expo Android export | Metro can resolve and produce an Android/Hermes bundle and assets | APK assembly, install, launch, native module configuration, UI acceptance |
| Vite admin/mobile web build | Current repository CI web clients bundle | Native UI or native runtime behavior |
| Android/iOS native launch | App installs/starts on the target runtime | Complete visual/accessibility acceptance without state matrix |
| Native screenshots | A named build/state rendered on a native platform | Functional correctness outside the captured state |
| Android release feed harness | A non-debuggable, Metro-independent release APK rendered the deterministic 100-record fixture within the recorded `framestats` threshold on the named device/renderer | Production-device distributions, iOS, modern Android hardware, shipped telemetry, or unrelated screens |
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

### Phase 1 R1C1 Firestore database removal coverage

R1C1 deletes the two Firestore database infrastructure files and the seven repository adapters. Production in-memory repositories remain present but runtime-unreachable until R1C2. Firebase Authentication, FCM, Hosting, Google Sign-In/OAuth, and their required packages/configuration remain in place.

| Contract | Deterministic evidence | Deferred boundary |
|---|---|---|
| Mongo runtime wiring | Five legacy-selector variants retain exactly one direct Mongo class for each of the seven repository tokens; isolated Nest resolution returns every expected Mongo implementation | R1D owns reconnect and durable persistence smoke evidence |
| Persistence-source removal | A recursive `apps/api/src/**/*.ts` test rejects any retired database term in a source path or file body; the required external source/test scan returns no match | Transitive packages in the unchanged lockfile are not runtime adapters |
| R1B compatibility | User suggestions and followed scopes remain delegated to `MongoUserDataRepository`; real isolated-Mongo create/read, concurrent idempotency, and cleanup tests remain green | No migration or production-data inspection |
| A1 compatibility | Mongo legacy user/refresh/recovery records normalize missing generation to `0`; nine Mongo stale-writer cases preserve a concurrently advanced generation; issuance/login/refresh/recovery tests stay green | Increment/enforcement and atomic reset remain Task A2 |
| Retained Firebase services | Dynamic module-resolution tests load the Firebase Authentication verifier and FCM sender without initializing credentials; production source retains the official auth and messaging imports | No Firebase service is invoked against production |

#### Removed test and replacement ledger

| Removed adapter-only execution | Count | Shared replacement |
|---|---:|---|
| Legacy generation normalization and admin field-update case | 1 | Existing Mongo user/refresh/recovery normalization plus hostile-generation exclusion case |
| Verification, Google identity, admin, profile, password, academic, personal-data clear, admin deletion, and account deletion stale-writer rows | 9 | Nine one-for-one Mongo stale-writer rows plus the existing in-memory writer contract |
| Academic selection field-delete case | 1 | Strengthened Mongo `$set`/`$unset` result assertions plus existing in-memory descendant-clearing behavior |

The old deleted-service wiring sentinel was converted in place to the recursive source scan, so it is not a removed business-rule test. Two module-resolution cases were added for retained Firebase Authentication and FCM imports. Removing 11 adapter-only executions, adding nine Mongo writer executions, and adding two retained-service executions keeps the baseline at 32 files / 299 tests.

#### R1C1 final validation ledger — 30 July 2026

| Exact command or check | Result |
|---|---|
| `npx.cmd vitest run apps/api/tests/auth-credential-generation.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/mongodb-runtime-wiring.test.ts` | PASS, 3 files / 35 tests |
| `npx.cmd vitest run apps/api/tests/mongodb-runtime-wiring.test.ts apps/api/tests/operations.test.ts apps/api/tests/auth-credential-generation.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/auth-application.service.test.ts apps/api/tests/password-recovery.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/mongo-user-data.repository.test.ts apps/api/tests/auth-http-contract.integration.test.ts --configLoader runner` | PASS, 9 files / 115 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 26 files / 216 tests |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0; no native source changed |
| `npx.cmd vitest run --configLoader runner` | PASS, 32 files / 299 tests; baseline preserved exactly |
| `npm.cmd run build:admin` | PASS, 1,742 modules |
| `npm.cmd run build:mobile` | PASS, 1,754 modules |
| Required Firestore database persistence scan over `apps/api/src apps/api/tests` | PASS: no matches |
| Retained `firebase-admin/auth` / `firebase-admin/messaging` scan over `apps/api/src` | PASS: exactly the Google identity verifier and FCM sender imports |
| Expanded production-source sensitive-log scan | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` |
| `git diff --check` | PASS, no whitespace errors; expected LF-to-CRLF notices only |

No package/lockfile, migration, deployment, production-data, native application, A2, Task B, Phase 2, or UI change is included in R1C1.

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

## Phase 2 content-trust evidence — senior re-audit 31 July 2026

| Contract | Deterministic evidence | Acceptance boundary |
|---|---|---|
| Entity decoding and display sanitation | Named (`&raquo;`, `&amp;`, `&nbsp;`, `&deg;`), deeply nested, decimal, hexadecimal, Turkish/Latin entities, markup/control removal, and residual entity-syntax removal | Byte-exact raw titles remain persistence-only audit fields; unknown entity syntax cannot leak to display titles |
| Navigation/chrome rejection | Required Turkish labels plus menu, breadcrumb, sidebar, footer, arrows, listing labels, compound pagination, and `6 of 10 --` prefix removal across HTML, JSON, RSS, Atom, API, and native normalization | Rejected/quarantined rows fail closed; four-digit academic-year prefixes are retained |
| Timestamp honesty | Publication, source update, discovery, and fetch fields; update-only markup; arbitrary title-date rejection; source-scoped listing-date convention; invalid/ambiguous date rejection; persisted source health; no crawl fallback | Discovery/fetch may be shown only as operational metadata, never publication copy |
| URL and source trust | HTTP/HTTPS only; credentials, unsafe ports/schemes, loopback/private/link-local IPv4 and IPv6-mapped hosts rejected; official `edu.tr`/`gov.tr` source authority and redirect validation | Source record, scope, source ID, status, trust state, and official domain must all agree |
| Canonicalization and duplicates | Tracking removal, query ordering, host/`www` equivalence, path/query case preservation, source-authored-time winner over later discovery/fetch, deterministic canonical survivor | Legacy unique indexes remain supported by collision-safe reconciliation projections |
| Source-specific parsing | `yok.html`, `ankara-university.html`, and `generic.html` fixtures plus source-specific and explicit generic fallback auto-dispatch | No live source or production crawl is claimed by fixture tests |
| Persistence and API | Trust/canonical schema/index assertions; quarantined direct-insert defaults; explicit trusted-only Mongo/in-memory reads; source-authoritative DTOs; persisted degraded/failed state in fresh-cache/YÖK/Summer envelopes | API tests call controllers/services with test repositories; they are not deployed HTTP/Mongo integration evidence |
| Reconciliation | CLI parsing/database-name guards, BSON/string timestamp shape, exact raw-title preservation, missing/untrusted-source repair, runtime catalog/YÖK scope authority, real apply-helper preimage/`updatedAt` conflicts, all-status collision handling, deterministic idempotence | No database was connected; main keeps the source-before-item write barrier; apply remains optimistic and non-transactional |
| Native presentation | Entity decoding, honest timestamp labels, unsafe-link containment, path-case duplicate semantics, partial/stale state, retained data after refresh error, Summer dual refresh/source status, non-pressable URL-less content | Pure helper/source tests plus current signed-out runtime launch; authenticated content visual QA is blocked under MN-032 |
| Regression boundaries | Agenda/Announcements, YÖK, Summer School, calendar source reads, source discovery, auth/password recovery, FCM-related tests, and Google Calendar sync tests | Authentication, recovery, push delivery, OAuth, and Google Calendar behavior were not changed |

### Phase 2 final validation ledger — senior re-audit 31 July 2026

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| `npx.cmd vitest run apps/api/tests/announcement-content-trust.test.ts apps/api/tests/announcement-content-reconciliation.test.ts apps/api/tests/announcements-ingestion.test.ts apps/api/tests/announcements-api.test.ts apps/api/tests/calendar.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/database-indexes.test.ts tests/unit/mobile-native-content-trust.test.ts --configLoader runner` | PASS, 8 files / 135 tests | Focused trust, parser fixtures/dispatch, persistence, API/Summer source health, executable reconciliation helpers, and native compatibility normalization |
| `npm.cmd run typecheck` | PASS, exit 0 | Workspace/API/shared/script TypeScript, including the reconciliation CLI |
| `npm.cmd run typecheck:mobile:native` | PASS, exit 0 | Mobile-native TypeScript graph |
| `npm.cmd test -- --configLoader runner` | PASS, 36 files / 400 tests | Exceeds the required 32-file / 299-test baseline by 4 files / 101 tests |
| `npm.cmd run build:admin` | PASS outside the restricted filesystem view, 1,742 modules | Final admin web bundle |
| `npm.cmd run build:mobile` | PASS outside the restricted filesystem view, 1,754 modules | Final responsive mobile web bundle; not native visual evidence |
| `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android` | PASS outside the restricted Android SDK view, `BUILD SUCCESSFUL` in 50 s; 174 tasks | Current native debug APK; SDK location/XML and Gradle deprecation notices remain environment/toolchain warnings |
| Controlled `npx.cmd tsx scripts/reconcile-announcement-content.ts --unknown-option` harness | PASS: command exited 1 with `CONTENT_RECONCILIATION_ARGUMENT_INVALID`; harness reported `CLI_NO_DATABASE_SMOKE=PASS` | Argument parsing stopped before environment lookup or database connection |
| Initial Phase 2 APK install + offline local Metro + `uiautomator` hierarchy + fatal-log filter on `AcademicPhase1Low` | PASS for build/install/start/hydration/signed-out Turkish Login; no fatal React/native error matched. The senior-hardening source reassembled but was not relaunched because no emulator was attached | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` for authenticated content states: no authorized local API/session fixture; no production data used |
| Expanded Phase 2 production-source sensitive-log scan | PASS: count-only reconciliation summaries and controlled error codes only; no credential/token/password/authorization payload logging | `MONGODB_URI` is read but never printed |
| `git diff --check` and final cached-diff check | PASS, no whitespace errors; expected LF-to-CRLF notices only | Repeated after documentation and before commit |

## Phase 3 integration evidence — final validation 31 July 2026

The final tree was validated from the required starting commit `d722f9092c1d500e0145214b2b57a08d1a8191d9`. Pure Vitest coverage and the API 24 smoke do not prove API 26+ channel behavior, API 33+ permission UI, FCM/APNs delivery, Google account chooser behavior, or remote provider mutations; those boundaries remain explicit below.

| Contract | Deterministic evidence now present | Acceptance boundary |
|---|---|---|
| Notification consent and lifecycle | Default-disabled preference; inspect-without-prompt hydration; explicit enable intent; granted/denied/permanently-denied/unavailable/error states; active only with preference + permission + backend registration; disable/detach; resume-time revocation; serialized token rotation; stale-owner rejection | Native helpers use mocked adapters; no API 33+ permission dialog or real provider token is claimed |
| Installation ownership and privacy | Domain-separated device-ID hash; same-installation token rotation; active owner/token conflicts; idempotent current-device detach; token-free registration DTO and delivery audit; logout/data/self/admin cleanup | Repository integration is isolated Mongo test evidence, not production data or deployment evidence |
| Delivery outcomes and destination | Atomic UUID-fenced worker claims/recovery lease, immediate pre-send registration re-read, provider success/failure distinction, invalid-token disablement, preference/scope/quiet-hour gates, generic provider-visible text, Android channel selection, versioned exact destination, pending signed-out target, wrong/stale-owner rejection, exact trusted-record revalidation beyond collection caps, unavailable-without-fallback | No real FCM/APNs send or notification shade/tap capture is claimed |
| Google restore and identity | Owner-scoped v3 record, stable Google account ID, live SDK token/account plus Calendar API verification, safe legacy migration, duplicate mapping rejection, stale operation guard | Mock Calendar REST and lifecycle providers do not prove a native chooser or real Google account |
| Google preflight and timestamps | Profile, network, current calendar, and trusted announcement checks precede authorization; no-content stops; `publishedAt`/`sourceUpdatedAt` only; discovery/fetch time excluded | Native network and authorization UI still require device evidence |
| Google mutation and partial safety | Create/update/delete/verify mappings, idempotent no-mutation match, deletion eligibility only for complete source families, exact reconciliation of remotely mapped IDs omitted by capped collections, partial failures and retained mappings, owned managed-event removal, personal-event protection | Remote Calendar mutation/removal/revoke requires an authorized non-production fixture |
| Google user choices and account cleanup | Keep/remove/cancel before account change; disconnect-retain and revoke-retain preserve a disconnected ledger for later same-account cleanup; account-switch keep intentionally abandons the old ledger; remove-and-disconnect clears it; logout retains remote grant/events by policy; data/account deletion orders ledger-known managed removal before revoke and reports controlled cleanup failures | Provider cleanup cannot be accepted until exercised against a test account; an intentionally abandoned old-account set requires reconnecting that Google account |
| Dormant native device calendar | Existing pure helper tests remain available | No `App.tsx` import, native dependency/adapter, permission, UI, or runtime synchronization; it is not a product feature |

### Phase 3 final validation ledger

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| `npx.cmd vitest run tests/unit/mobile-native-notification-lifecycle.test.ts tests/unit/mobile-native-notification-destination.test.ts tests/unit/mobile-native-notification-adapter.test.ts tests/unit/google-calendar-sync.test.ts tests/unit/google-calendar-lifecycle.test.ts apps/api/tests/notifications.test.ts apps/api/tests/operations.test.ts apps/api/tests/mongo-notification.repository.test.ts apps/api/tests/announcements-api.test.ts apps/api/tests/calendar.test.ts --configLoader runner` | PASS, 10 files / 155 tests, 19.93 s Vitest duration | Focused permission/token/rotation/detach/tap/channel, delivery/claim/ownership, exact destination, and Google lifecycle/sync coverage with provider fakes plus isolated Mongo |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 30 files / 310 tests, 24.43 s Vitest duration | Complete API suite; one non-failing Mongoose `new` option deprecation warning |
| `npm.cmd run typecheck` | PASS, exit 0 | Workspace/API/shared/script TypeScript |
| `npm.cmd run typecheck:mobile:native` | PASS, exit 0 | Final `App.tsx`, native module boundary, notification lifecycle, and Google lifecycle TypeScript graph |
| `npm.cmd test -- --configLoader runner` | PASS, 41 files / 495 tests, 24.54 s Vitest duration | Exceeds the required Phase 2 baseline of 36 files / 400 tests by 5 files / 95 tests |
| `npm.cmd run build:admin` | PASS outside the restricted filesystem view, 1,742 modules, 2.40 s Vite build | The first sandboxed attempt failed because esbuild could not read the parent/config path; the approved local rerun passed. Web build is not native evidence |
| `npm.cmd run build:mobile` | PASS outside the restricted filesystem view, 1,754 modules, 3.24 s Vite build | Responsive mobile web regression bundle; not native integration evidence |
| `.\node_modules\.bin\expo.cmd config --type public --json` from `apps/mobile-native` | PASS, exit 0 | Confirms Expo SDK 54 public config, `newArchEnabled: true`, scheme, package, and Firebase/Notifications plugins without exposing provider secrets |
| `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android` | Final PASS, exit 0 in 100.4 s; 39,267,789-byte APK | First attempt correctly exposed React Native Firebase 26's New Architecture requirement. After committing `newArchEnabled: true`, the architecture-switch attempt exposed stale Google Sign-In incremental codegen; `:react-native-google-signin_google-signin:compileDebugJavaWithJavac --rerun-tasks` passed, then the identical final assembly passed. Build/link evidence only |
| Merged Android manifest and APK metadata inspection | PASS | Package `com.anssoft.akademiktakvim`, version `0.1.1`/12, min 24/target 36; POST_NOTIFICATIONS, Firebase messaging components, notification components, disabled FCM auto-init, and default-channel metadata are present |
| Android install/cold launch/strict signed-out notification handoff/fatal filter on `AcademicPhase1Low` | PASS within API 24 boundary | APK install `Success`; MainActivity launch PASS; Metro bundled 962 modules with Fabric active; Login/Register rendered; complete strict URL was accepted; encrypted pending-notification key appeared; process remained alive; fatal filter returned no match. See [`evidence/phase-03-native`](./evidence/phase-03-native/README.md) |
| Android notification permission/channels and real FCM delivery | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` | Sole AVD is API 24, below channels (26) and runtime notification permission (33); no authorized non-production Firebase/APNs sender/token path was supplied |
| Google account chooser plus live create/update/delete/remove/revoke | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` | No authorized non-production Google account/calendar fixture; production access was prohibited and not used |
| iOS build, permission, APNs/FCM token, tap, and Google chooser | `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED` | Windows host has no Xcode/simulator; no authorized `GoogleService-Info.plist` or APNs/provider credentials are present; no iOS acceptance is claimed |
| Final added-line sensitive-log scan and `git diff --check` / cached-diff check | PASS | No added application log statement contains token/authorization/password/credential/payload data; no whitespace errors; expected Windows LF-to-CRLF notices only |

`MOBILE_NATIVE_LINT: NOT AVAILABLE` remains unchanged: no lint script, applicable ESLint dependency, or lint configuration exists. Phase 3 does not start the Phase 4 test/tooling decision.

## Phase 4 routed adaptive foundation evidence — 31 July 2026

Phase 4 started from `b74bdcc8da7657c2886cf35f6a9b4f2dedbe29d8`. Root Vitest remains the pure/API runner; native renderer tests are isolated under `apps/mobile-native/tests` and excluded in `vitest.config.ts`.

### Tooling and fixture decision

| Concern | Phase 4 decision |
|---|---|
| Native component runner | Jest `29.7.0` + `jest-expo` `54.0.17` + React Native Testing Library `13.3.3`; no second component runner or snapshot workflow |
| Navigation | React Navigation native `7.3.14`, native stack `7.18.6`, bottom tabs `7.18.14`, screens `4.16.0` |
| Appearance/material | `expo-system-ui` `6.0.9`; `expo-glass-effect` `0.1.10` behind platform/API/Reduce Transparency eligibility |
| Deterministic fixtures | One provider supplies non-secret signed-in/out session, API, Google/notification integration, iOS/Android, light/dark, 320/common widths, font scale, Reduce Motion, and Reduce Transparency state |
| Visual evidence convention | [`apps/mobile-native/tests/README.md`](../../apps/mobile-native/tests/README.md) defines native-only filenames, `C:\tmp` raw storage, curated phase evidence storage, metadata, and personal/provider/credential redaction. Phase 4 adds a reviewed manual Android matrix, not screenshot assertions or an approval-baseline workflow |

### Phase 4 coverage inventory

| Layer | Files/tests | Covered contract | Boundary |
|---|---:|---|---|
| Pure design foundation | 1 / 12 | Semantic contrast, light/dark resolution, gutters, elevation, touch targets, Liquid Glass/opaque and bottom/rail selection | No render/native material claim |
| Pure route foundation | 1 / 32 | Typed families, hydration/auth guards, recovery context, strict links, unknown fallback, owner-generation intent priority/dedupe, tab history, ordinary/predictive-preview policy, iOS swipe eligibility | `route-resolution`, `route-intent`, and `back-policy` are policy contracts; runtime is React Navigation + the live App bridge |
| Native renderer | 8 / 36 | Primitive default/pressed/disabled/busy/success/error/selected/accessibility, fields/feedback/states, virtualized selection, modal sheet dismissal/locking/material, deterministic preview/fixtures, adaptive surfaces, four real tabs, nested detail/back, request gating/dedupe, malformed/unknown fallback | Jest-host rendering, not OS visual acceptance |

### Phase 4 validation ledger

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| `npx.cmd vitest run tests/unit/mobile-native-route-foundation.test.ts tests/unit/mobile-native-design-foundation.test.ts --configLoader runner` | PASS, 2 files / 44 tests | Focused pure route/token/platform foundation |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS, 8 suites / 36 tests / 0 snapshots | Semantic RNTL, sheet/selection/preview, and navigator rendering; no native OS claim |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 30 files / 310 tests; one non-failing Mongoose `new` deprecation warning | Complete API regression; Phase 4 changes no API behavior |
| `npm.cmd run typecheck` | PASS, exit 0 | Workspace/API/shared TypeScript |
| `npm.cmd run typecheck:mobile:native` | PASS, exit 0 | Native app, navigator, design system, fixtures, and tests TypeScript |
| First concurrent final `npm.cmd test -- --configLoader runner` while Gradle plus three other validation jobs ran | HOST-CONTENTION TIMEOUT: 42/43 files and 538/539 tests passed; one existing SMTP/account-deletion test exceeded its 5 s limit at 5.174 s, with no assertion failure | Disclosed failed attempt; source was unchanged before the sequential rerun |
| Sequential `npm.cmd test -- --configLoader runner` | PASS, 43 files / 539 tests, 36.18 s Vitest duration | Final regression; above the required 41 / 495 baseline by 2 files / 44 tests. The previously timed-out test passed in 3.331 s |
| `npm.cmd run build:admin` | Final PASS outside the restricted filesystem view, 1,742 modules, 6.95 s Vite build | Admin web regression only; restricted-view esbuild/config access is an execution-environment boundary |
| `npm.cmd run build:mobile` | Final PASS outside the restricted filesystem view, 1,754 modules, 8.49 s Vite build | The preceding restricted-view attempt was denied config access before bundling; identical approved rerun passed. Mobile web is not native evidence |
| `.\node_modules\.bin\expo.cmd config --type public --json` from `apps/mobile-native` | PASS | SDK 54, automatic appearance, New Architecture, scheme, package, edge-to-edge, predictive opt-out, system-UI/Firebase/notification plugins; public config only |
| `.\node_modules\.bin\expo.cmd install --check` from `apps/mobile-native` | Advisory exit 1: installed Expo `54.0.35`, latest expected `~54.0.36` | Phase 4 explicitly forbids an Expo upgrade; no shared package version regressed, and assembly/launch passed. This advisory is not relabelled as a passing check |
| Final `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon --console=plain` from `apps/mobile-native/android` | PASS, `BUILD SUCCESSFUL in 1m 20s`, 245 tasks (7 executed/238 up-to-date); 56,804,991-byte x86_64-only APK; SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D` | Final native compile/link evidence; debug signing, no release/publish claim. An earlier full-stacktrace build also passed; Metro-served JS changes correctly left the native artifact byte-identical |
| API 24 `AcademicPhase1Low` install/launch/ordinary Back smoke | PASS: Android 7.0/API 24/x86_64, min 24/target 36; `com.anssoft.akademiktakvim/.MainActivity`; Login → Şifre Kurtarma → `KEYCODE_BACK` → Login kept PID 3589 and the resumed activity; filtered log contained `Running main` and no React Native/AndroidRuntime error | Proves ordinary system Back across a real no-account auth-stack transition without credentials/production data; API 24 cannot exercise predictive callbacks/animation. Raw local captures/XML/log are under `C:\tmp\phase4-*` and are not claimed as a curated visual matrix |
| `EXPO_PUBLIC_PHASE4_DESIGN_PREVIEW=1` Metro launch plus ADB/UIAutomator/screencap matrix at temporary 640×1136/320 dpi | PASS: actions, fields, virtualized selector states, chips/segments, content/feedback/skeleton/error states, bottom trigger, and open modal sheet matched UIAutomator probes; six curated screenshots reviewed; filtered log has no React Native/Expo/AndroidRuntime error | [`phase-04-native`](./evidence/phase-04-native/README.md) records hashes and boundaries. Dual `__DEV__` gating makes the preview production-inaccessible; this is Android/API 24 manual evidence, not an automated screenshot baseline |
| ADB font-scale 2.0 preview observation at the same temporary 320 dp viewport | OBSERVED: application title/body wrap vertically without horizontal clipping or blank/error; API 24 system clock clips at the far right | One curated observation only; no full large-text, authenticated-screen, or system-UI acceptance claim |
| Phase 4 test skip/focus/empty-assertion audit | PASS across new pure/native tests and the migrated auth-recovery contract | No `.only`, skip, empty test body, zero assertion plan, blind snapshot, or vacuous boolean assertion found |
| Phase 4 scoped trailing-whitespace scan plus final `git diff --cached --check` | PASS, no matches or whitespace errors | Includes every staged tracked and newly created Phase 4 file; unrelated pre-existing untracked files remain outside the index |
| Phase 4 runtime/test logging, credential-like literal, and staged added-line sensitive-log scans | PASS, no matches | No new console/print call or credential-bearing log statement; test fixtures contain no real credential or production data |

The selected React Navigation version requires `android:enableOnBackInvokedCallback="false"`; merged/generated configuration retains that opt-out. `previewAndroidBack` is an immutable policy contract, not evidence of an OS predictive animation. iOS remains unavailable on Windows. MN-032/MN-033/MN-034 retain the authenticated content, higher-API notification/predictive, iOS, and real provider/account evidence limits.

`MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact: there is no applicable lint script, dependency, or configuration. TypeScript, test, whitespace, and sensitive-log results are not called lint.

## Phase 5 adaptive app-shell evidence — 31 July 2026

The Phase 5 tree was implemented from required starting commit `abbf1b721fc632f75e6ce5cad91b20434f6af2bf` on branch `agent/google-play-readiness-20260724`. Phase 5 changes authenticated shell presentation and interaction only: Phase 4 route guards, strict links, one-shot requests, independent native stacks, and business/service ownership remain intact. Phase 6 and all complete screen-body redesigns are not started.

### Phase 5 implementation coverage

| Layer | Files/tests | Covered contract | Boundary |
|---|---:|---|---|
| Pure app-shell contract | 1 / 4 new tests; final focused scope 3 / 48 with the Phase 4 route/design contracts | Exactly four ordered Turkish tabs, stable tab-to-root ownership, distinct selected/unselected icons, compact-width density, platform label sizes, and bounded large-text fallback | Pure data/layout resolution only; no React Native render or OS material claim |
| Focused native shell renderer | 2 / 18 | Reusable top-bar title/subtitle/action semantics and wrapping; opaque/Liquid-Glass eligibility; Android ripple; exact four-tab map and selected state; tab switching/history; nested Summer School/YÖK; reselect-to-root, reselect-scroll-to-top, locked and ordinary nested Back, guarded requests, malformed/unknown fallback | Jest Expo + React Native Testing Library host rendering; not native OS visual or gesture acceptance |
| Complete native renderer | 9 / 48 / 0 snapshots | Phase 4 primitives/fixtures plus the Phase 5 shell and navigator | No snapshot approval workflow and no claim that iOS or Android system chrome ran natively |
| Complete API regression | 30 / 310 | Existing auth/session, content trust, notifications, Google Calendar, persistence, cleanup, and API behavior | Phase 5 adds no API, repository, schema, storage, or provider behavior |
| Native shell visual/flow matrix | PASS, 13 reviewed 720×1280 PNGs plus 13 same-basename UIAutomator XML hierarchies | Four 360 dp light selected states, approximately 320 dp/font 1.0 and corrected font 2.0 navigation, YÖK nested Back, nested/root reselect, explicit dev dark renderer, filtered log, and verified teardown | Android 7.0/API 24/x86_64 `AcademicPhase1Low`; hashes and exact boundaries are indexed in [`phase-05-native`](./evidence/phase-05-native/README.md) |

### Phase 5 validation ledger

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| Implementation-stage `npx.cmd vitest run tests/unit/mobile-native-app-shell.test.ts tests/unit/mobile-native-route-foundation.test.ts tests/unit/mobile-native-design-foundation.test.ts --configLoader runner` while `AdaptiveTopBar` was temporarily exported from `src/navigation/index.ts` | FAILED BEFORE TEST COLLECTION: Node/Vitest traversed the React Native UI graph and could not parse React Native Flow syntax | Disclosed source-boundary/tooling failure. The UI export was removed from the pure navigation barrel; `app-shell.ts` remains the pure export and native consumers import `AdaptiveTopBar` directly |
| Final `npx.cmd vitest run tests/unit/mobile-native-app-shell.test.ts tests/unit/mobile-native-route-foundation.test.ts tests/unit/mobile-native-design-foundation.test.ts --configLoader runner` | PASS, 3 files / 48 tests | Identical focused pure scope after the source-boundary correction |
| Implementation-stage focused native run after adding locked-header coverage | FAILED, 1 of 18 tests: the new test opened a detail route as the initial nested state, so the Jest native-stack adapter exposed no Back action for that state | Test setup was corrected to render the Announcements root before requesting its detail. Production code was unchanged between this setup failure and the identical final focused scope |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/navigation/AppNavigator.test.tsx tests/navigation/AdaptiveTopBar.test.tsx` | Final PASS, 2 suites / 18 tests / 0 snapshots, 11.807 s | Focused rendered top-bar and live navigator semantics/interactions, including locked custom-header Back; no OS visual claim |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | Final PASS, 9 suites / 48 tests / 0 snapshots, 17.673 s | Complete native Jest/RNTL regression after the native large-text and locked-Back corrections |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 30 files / 310 tests, 22.03 s Vitest duration; one non-failing Mongoose `new` deprecation warning | Complete API regression; no Phase 5 API behavior changed |
| `npm.cmd run typecheck` | Final PASS, exit 0, 13.9 s wall time | Final workspace/API/shared TypeScript graph |
| `npm.cmd run typecheck:mobile:native` | Final PASS, exit 0, 12.1 s wall time | Final native shell, navigator, evidence surface, and test TypeScript graph |
| `npm.cmd test -- --configLoader runner` | Final PASS, 44 files / 543 tests, 23.94 s Vitest duration (25.8 s wall); one non-failing Mongoose `new` deprecation warning | Final regression; above the Phase 4 final 43-file / 539-test result by 1 file / 4 tests |
| `npm.cmd run build:admin` | Final approved PASS, 1,742 modules, 6.01 s Vite build | The restricted attempt was denied esbuild/config read access before bundling; the approved identical rerun passed. Admin web is not native evidence |
| `npm.cmd run build:mobile` | Final approved PASS, 1,754 modules, 8.74 s Vite build | The restricted attempt was denied the same esbuild/config read access before bundling; the approved identical rerun passed. Mobile web is not native evidence |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon --console=plain` from `apps/mobile-native/android` | Final approved PASS, `BUILD SUCCESSFUL in 1m 12s`, 245 tasks (7 executed/238 up-to-date); 56,804,991-byte APK; SHA-256 `A5228B4361C7799AF895659161A71CE0C81F74FD55D5C02BFA1993DCA65D8E7D` | First restricted attempt hid the Android SDK and was denied the report path. This is debug compile/link evidence, not release or native visual evidence; the byte-identical artifact is expected because development JavaScript is Metro-served |
| Initial current-source API 24 capture at approximately 320 dp/font scale 2.0 | FAILED visual review: the 49 dp bar left labels reaching the system area and `Ana Sayfa` was ellipsized | Disclosed implementation-stage native failure. Navigation content height was corrected to 80 dp plus the bottom system inset and compact large-text cap to 1.20; the failed capture is not final acceptance evidence |
| Final current-source Android Phase 5 install/launch and shell matrix | PASS on Android 7.0/API 24/x86_64 `AcademicPhase1Low`: 13 reviewed 720×1280 PNGs + 13 paired XML hierarchies; all four 360 dp light states exposed exactly one selected tab; 320 dp/font 1.0 labels fit; corrected font 2.0 exposed all four full labels with bar `[0,881][640,1040]` and label bottom 1013, leaving 13.5 dp; YÖK `KEYCODE_BACK`, selected nested-tab reselect, rows 7–10/root-scroll reselect, explicit dev dark rendering, clean filtered log, and teardown passed | [`phase-05-native`](./evidence/phase-05-native/README.md) indexes every screenshot/hash, hierarchy, exact command, and limitation. This is shell-only API 24 evidence, not iOS, TalkBack, full-screen large-text, tablet/rail, provider/content, API 33+, channel, or predictive-Back acceptance |
| Final scoped whitespace, skip/focus/empty-assertion, sensitive-log/credential-like literal, staged-scope, evidence-table, and cached-diff audits | PASS: no whitespace/test-quality/log/color matches; 13 evidence rows matched their PNG bytes/SHA-256/XML pairs; exactly 44 intended paths staged; zero unstaged tracked paths; unrelated untracked files excluded; cached diff check passed | Repeated after final documentation reconciliation; lint remains separately unavailable |

### Phase 5 Android native evidence

The final evidence set contains 13 reviewed 720×1280 PNGs and 13 same-basename UIAutomator XML hierarchies from Android 7.0/API 24/x86_64 AVD `AcademicPhase1Low`. The four normal 360 dp light captures each expose exactly one selected destination. The approximately 320 dp/font 1.0 capture keeps all four labels complete and separated. The first font-2 capture failed because a 49 dp bar allowed labels into the system area and ellipsized `Ana Sayfa`; after the shell changed to an 80 dp navigation content area plus system inset and a compact 1.20 cap, the complete matrix was recaptured. In the final font-2 hierarchy, `Ana Sayfa`, `Duyurular`, `Takvim`, and `Profil` are all complete, the navigation bounds are `[0,881][640,1040]`, and the label bottom at 1013 leaves 27 px / 13.5 dp before the bar boundary.

`KEYCODE_BACK` returned the synthetic nested YÖK route to the Duyurular root. Pressing the already-selected Duyurular tab from nested YÖK also returned to the root. After bound-derived swipes exposed rows 7–10, pressing the selected root tab restored the root marker and top position. The explicit development dark override rendered readable dark content/shell surfaces with light status icons; API 24 reported no `cmd uimode` implementation, so this is renderer evidence rather than OS theme-switch acceptance.

The final filtered log contains eight lines and zero case-insensitive fatal, React Native/Expo/AndroidRuntime error, unable-to-load-script, or Metro-connection matches. Cleanup was verified: font scale 1.0 and display size/density restored, ADB reverse removed, app/Phase 5 Metro/emulator stopped, and both `adb devices -l` and port 8081 were empty. The [hash/evidence index](./evidence/phase-05-native/README.md) records exact commands and artifacts. The font-2 result is bottom-navigation acceptance only; the API 24 system clock still clips. TalkBack was not run, Windows blocks iOS runtime evidence, API 24 cannot prove predictive Back/API 33 permissions/API 26+ channels, and the synthetic preview proves no production content or provider behavior.

The implementation-stage pure-run failure was caused by module ownership, not a product assertion: exporting a React Native component through the barrel used by Node-only policy tests pulled React Native Flow source into Vitest. The final boundary exports only `app-shell.ts` from that pure barrel; `AdaptiveTopBar` is a direct native import. The identical three-file command then passed all 48 tests.

The exact primary map is `Ana Sayfa` → `Home`, `Duyurular` → `Announcements`, `Takvim` → `Calendar`, and `Profil` → `Profile`. Summer School and `YokAnnouncements` stay inside the Announcements stack. Each tab preserves an independent native-stack history; `backBehavior="history"` governs tab-level ordinary Back, a selected nested-tab press returns to its root, and a selected root press scrolls its routed `ScrollView` to the top without creating history.

`AdaptiveTopBar` owns wrapping title/subtitle text and named leading/trailing actions; an operation lock disables its custom Back action. Shell chrome uses semantic light/dark roles. Eligible iOS navigation chrome may use Liquid Glass, with opaque tonal fallback when the component/runtime is unavailable or Reduce Transparency is enabled. Android uses Material tonal chrome, ripple feedback, a selected icon pill plus filled icon, outline unselected icons, bottom navigation on phones, and the existing rail policy at large width. Phone labels remain one line at 11 pt on iOS or 12 sp on Android. The ordinary multiplier cap is 1.35; below 375 logical units a larger request selects the 1.20 compact cap and an 80 dp Android navigation content area plus bottom system inset while the complete accessible name and selected state remain exposed. These deterministic and renderer contracts do not replace iOS, screen-reader, full cross-platform large-text, or API 33+ predictive-Back acceptance.

`MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact: there is no root/native lint script, applicable ESLint dependency, or lint configuration. Tests, TypeScript, builds, and final audits are separate evidence and are not relabelled as lint.

## Phase 6 authentication and academic-onboarding evidence — 1 August 2026

Phase 6 migrates only Login, Registration, Verification, password recovery, and initial academic onboarding onto the routed Phase 4 design-system foundation. Existing endpoint/payload, session-owner, pending-verification, recovery, cleanup, and provider contracts remain intact. The development evidence surface is selected only by `__DEV__` plus `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW=1`, contains synthetic `.invalid` identities, imports no API/storage/provider module, and is production-inaccessible. Phase 7 is not started.

### Phase 6 implementation coverage

| Layer | Files/tests | Covered contract | Boundary |
|---|---:|---|---|
| Focused pure policy | 4 / 112 | Login/registration validation, exact 4/6-digit codes, masking, academic cascade/payload/class-level rules, dirty state, responsive 320 dp/font-2 policy, retained recovery/session/route contracts, cleanup boundaries | Node/Vitest policy and source contract; no native renderer claim |
| Extracted native screens | 1 / 24 / 0 snapshots | Validation order/focus, IME submission, busy/disabled state, Google cancellation feedback, password visibility, all auth routes, timers, three recovery stages, academic selector/loading/empty/error/retry/cascade/review/save/dirty Back, semantic state, 320 dp/font-2 reachability | Jest Expo + React Native Testing Library; no installed OS/provider/backend claim |
| Development preview | 1 / 3 / 0 snapshots | Import/network/storage isolation, all 13 synthetic scenarios, stable named-scenario boot | Real extracted components against preview-local `.invalid` data; not production or live E2E |
| Complete native component regression | 11 / 79 / 0 snapshots | Phase 4 primitives/fixtures, Phase 5 shell/navigation, and Phase 6 auth/onboarding | One Jest/RNTL component stack; no screen-reader or live-provider acceptance |
| Complete API regression | 30 / 310 | Existing auth, verification, recovery, session, profile, repository, notification, Google Calendar, content-trust, and cleanup behavior | Phase 6 makes no API/schema/repository change |
| Android native presentation matrix | 20 reviewed PNGs + 20 same-state XML hierarchies | Light/dark Login and Registration, verification cooldown, three recovery stages and return-to-Login success, academic selector/review/success, exact 320 dp, IME focus transfer, and 200% Login scroll positions | API 24/x86_64 `AcademicPhase1Low`, synthetic development preview; no API/provider/session persistence or automated screenshot baseline |

### Phase 6 requirement matrix

| Requirement | Pure/component result | Native/runtime result | Final Phase 6 disposition |
|---|---|---|---|
| Focused Login without giant hero | PASS: routed `LoginScreen`, persistent labels, form-width layout, no routed hero | PASS in reviewed 360 dp light/dark and exact 320 dp synthetic captures | Implemented; native presentation accepted for the synthetic state |
| Email/password validation and error order | PASS: normalized email, non-empty password, first-invalid ordering, field-linked error and feedback semantics | Labelled fields visible in paired Android hierarchies | Implemented; no live invalid-server/account fixture claimed |
| IME Next and keyboard safety | PASS: email return moves focus to password; password submits only when ready | PASS at exact 320 dp: keyboard stays open and UIAutomator focus changes from email to password | Android synthetic interaction accepted; iOS keyboard remains blocked |
| Busy/duplicate submission | PASS: email, Google, and secondary actions expose busy/disabled semantics and reject duplicate actions | Loading state covered by preview tests, not retained as a curated screenshot | Deterministically accepted; no slow live-network device E2E |
| Password visibility | PASS: labelled action preserves the typed password | Password control exposed in Android hierarchy | Implemented; native secure-entry semantics represented, not credential entry |
| Forgot password, verification recovery, and registration actions | PASS: all actions semantically reachable and route to separate screens | Login action captures reviewed at 360 dp light/dark and exact 320 dp | Implemented |
| Google unavailable/cancel/error | PASS for controlled unavailable and cancellation feedback/semantics | Provider-unavailable synthetic state rendered; real chooser not run | MN-034 remains open; deterministic UI is not provider acceptance |
| Registration four fields and min-10 parity | PASS: full name/email/password/confirmation, exact min 10, mismatch, focus and ready IME | Light/dark 360 dp Registration reviewed; 320 dp/font-2 structure covered by renderer | Implemented; no live email creation E2E |
| Verification mask, exact four digits, expiry/cooldown/resend/edit | PASS for numeric filtering, completeness, masked email, expiry, disabled cooldown, fresh resend, edit email | 360 dp light verification/cooldown capture reviewed | Implemented; no mail delivery or live verification E2E |
| Verification relaunch recovery without secret persistence | PASS in retained recovery/session contract: persisted record is email plus expiry/cooldown only | Not rerun as a current installed-app relaunch flow | Contract accepted; installed current-source relaunch E2E remains open under MN-019 |
| Recovery request without account enumeration | PASS: validation and account-neutral success presentation | 360 dp request capture reviewed | Implemented; no production address or live email used |
| Recovery exact six-digit code, expiry, resend, Back/Cancel | PASS | 360 dp code capture reviewed | Implemented; live email/backend E2E remains open |
| Recovery matching min-10 password and return to Login | PASS | 360 dp confirmation and synthetic success-return-to-Login captures reviewed | Presentation accepted; no live reset→fresh-login acceptance |
| Required university and optional academic descendants | PASS: university required, descendants disabled/optional until parent exists | 360 dp onboarding start reviewed | Implemented |
| Search/virtualization/loading/empty/no-result/error/retry | PASS: semantic combobox/list states, filtering, no-result, loading, error, retry | Open 360 dp university selector reviewed; loading/error remain deterministic renderer/preview states | Implemented; no live academic-data failure injection on device |
| Parent-child clearing and class-level derivation | PASS: explicit university/faculty/department clears; only API-supported class levels; stale descendants omitted | Not represented as backend mutation in synthetic preview | Contract accepted; no partial-write claim |
| Final review and one complete-replacement academic save | PASS: review, dirty Back alert, one save callback, resumed-email password requirement; application issues one `/me/university` PATCH | Review/action and synthetic success captures reviewed | Implemented; no live PATCH/session E2E |
| Email and Google incomplete profiles converge before Home | PASS in route/session contracts: context bootstrap is fail-closed and onboarding is a signed-in incomplete-profile route | No real Google fixture and no installed live-account flow | Deterministic contract accepted; MN-019/MN-034 native E2E remains open |
| Exact 320 dp | PASS in responsive policy and renderer structure | PASS for Login default/actions/keyboard at exact 720 px / 360 dpi | Login accepted; not every Phase 6 state at 320 dp |
| 200% font scale | PASS without disabling system scaling | PASS for complementary exact-320-dp Login top and scrolled-primary captures at `font_scale=2.0` | Login scroll reachability accepted; no complete all-screen large-text claim |
| Dark mode | PASS through semantic theme roles | Explicit development-dark Login/actions/Registration reviewed beside light counterparts | Renderer accepted; not OS-controlled switching or complete-app dark acceptance |
| Offline/connection failure presentation | PASS for stable busy/error feedback inputs and fail-closed authenticated-context bootstrap | Synthetic Login/onboarding error states exist; no installed-app radio-off or failed live request was run | Deterministic presentation accepted; live offline recovery remains unclaimed |
| Server validation/error presentation | PASS for ordered local field errors, controlled endpoint feedback, expiry/cooldown, and retry states | Synthetic Login error and onboarding error states are covered by the preview test; no live invalid-server response was captured | Deterministic presentation accepted; backend behavior remains covered separately by API tests |
| Screen-reader order | DETERMINISTIC ONLY: semantic role/name/state queries cover the intended structure; runtime traversal order is not proven | BLOCKED: TalkBack unavailable on the sole API 24 image; UIAutomator is not a screen reader | MN-029 remains open; no TalkBack/VoiceOver claim |
| Android predictive Back | Ordinary Back/dirty-draft policies are tested | BLOCKED: API 24 cannot expose predictive callbacks/animation; callback opt-out retained | MN-024 remains open |
| iOS native screenshots/keyboard/VoiceOver | Code and semantic renderer contracts compile/pass | BLOCKED: Windows has no Xcode, iOS runtime, or simulator | MN-033 remains open; no iOS acceptance |
| Four required installed-app native E2Es | Endpoint/route/session components and API regressions pass | NOT AUTOMATED/RUN: repository has no Maestro/Detox/Appium and no authorized disposable email/Google provider fixture | Email registration→Home, Google incomplete→onboarding, unverified recovery, and reset→fresh-login remain open under MN-019/MN-034 |

### Phase 6 validation ledger

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| `npm.cmd test -- tests/unit/mobile-native-auth-onboarding.test.ts tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts tests/unit/mobile-native-route-foundation.test.ts --configLoader runner` | PASS, 4 files / 112 tests, 1.50 s | Focused pure/auth/session/route contracts |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/auth/AuthScreens.test.tsx` | PASS, 1 suite / 24 tests / 0 snapshots | Extracted screens through semantic native renderer |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/auth/AuthOnboardingPreview.test.tsx` | PASS, 1 suite / 3 tests / 0 snapshots | Synthetic preview isolation and scenario matrix |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | Final PASS, 11 suites / 79 tests / 0 snapshots, 55.369 s | Complete native Jest/RNTL regression |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | Final PASS, 30 files / 310 tests, 45.15 s Vitest duration (52.6 s wall); one non-failing Mongoose `new` deprecation warning | Complete API regression; no Phase 6 API behavior changed |
| `npm.cmd run typecheck` | Final PASS, 29.4 s | Complete workspace/API/shared TypeScript graph |
| `npm.cmd --prefix apps/mobile-native run typecheck` | Final PASS, 7.4 s | Native auth/onboarding, navigator, preview, and tests |
| `npm.cmd test -- --configLoader runner` | Final PASS, 45 files / 581 tests, 33.09 s | Above Phase 5's final 44 / 543 result |
| `npm.cmd run build:admin` | Final PASS, 1,742 modules, 10.15 s; main JS 250.51 kB / gzip 73.89 kB | Admin web regression, not native evidence |
| `npm.cmd run build:mobile` | Final PASS, 1,754 modules, 14.58 s; main JS 349.18 kB / gzip 104.25 kB | Mobile web regression, not native evidence |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | Final PASS, `BUILD SUCCESSFUL in 1m 32s`, 245 tasks (7 executed/238 up-to-date); 56,804,991-byte APK; SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7` | Debug x86_64 compile/link; Metro-served JS, no release/publish claim |
| `adb install -r -d app-debug.apk`, `adb reverse tcp:8081 tcp:8081`, and `adb shell am start -n com.anssoft.akademiktakvim/.MainActivity` | Final PASS: install `Success`; MainActivity exposed the `Tekrar hoş geldin` header at `[152,382][688,442]`; emulator restored to density 320/font scale 1.0 | Final current-artifact install/launch smoke against the local synthetic Metro preview; no live API/provider account |
| Phase 6 Android evidence integrity | PASS: exactly 20 720×1280 PNGs and 20 same-basename XML hierarchies, all PNGs reviewed at original resolution and all 40 artifacts indexed by SHA-256 | [`phase-06-native`](./evidence/phase-06-native/README.md); API 24 synthetic development preview only |
| Phase 6 native E2E framework/provider audit | OPEN: no Maestro/Detox/Appium; no authorized disposable email inbox or non-production Google account/client fixture | Deterministic/API/presentation evidence cannot be relabelled as live installed-app E2E |

The preview now exposes 13 stable IDs: `login`, `login-loading`, `login-error`, `register`, `verification-cooldown`, `recovery-request`, `recovery-code`, `recovery-confirm`, `recovery-success`, `onboarding`, `onboarding-loading`, `onboarding-error`, and `onboarding-success`. Recovery success is a Login surface with explicit success feedback, matching the production route destination without invoking the recovery endpoint in evidence mode.

`MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact: no root/native lint script, applicable ESLint dependency, or lint configuration exists. TypeScript, tests, builds, artifact integrity, whitespace checks, and targeted sensitive-log/credential scans are separate checks and are not called lint.

The Android matrix is native rendering of the real extracted components but synthetic application state. It must not be used to claim backend, email, provider, SecureStore, account-switch, session-restoration, or production-data acceptance. Windows/iOS, TalkBack, modern predictive Back, and the four required live native E2Es remain explicit blockers. No Phase 7 implementation or test is included.

## Required coverage by phase

| Scenario family | Unit/contract | Component | Native flow | Native visual | Owning phase |
|---|:---:|:---:|:---:|:---:|---:|
| Resend, verification abandonment, refresh/logout ordering, account switch | Required | Required | Required | Required | 1 |
| Academic parent-child clearing and account-scoped manual exams | Required | Required | Required | Relevant states | 1 |
| Sanitized content, timestamp semantics, URL allowlist | Required | Required | Handoff | Long/error states | 2 |
| Google connect/sync/change/disconnect/revoke/remove | Required | Required | Device/account permission | All outcomes | 3 |
| Notification permission/token/device/deletion | Required | Required | Real device | All permission states | 3 |
| Tokens and primary component states | Contrast/unit | Semantic queries | N/A | iOS + Android | 4 |
| Auth guard, four tabs, back, deep links, restoration mechanics | Required | Required | Required | Foundation smoke in Phase 4; visual shell acceptance in Phase 5 | 4 / 5 |
| Auth forms and recovery | Contract | Semantic queries | Required | Keyboard/320 dp/large text | 6 |
| Home states and destinations | Required | Required | Smoke | All data states | 7 |
| Feed virtualization/filter/content actions | Required | Required | Scroll/handoff | Long feed/source states | 8 |
| Calendar dates/manual CRUD/integration states | Required | Required | Required | Platform date UI | 9 |
| Profile selectors/settings/deletion | Required | Required | Required | Sheets/dialogs/states | 10 |
| Dark mode, text scale, screen reader, reduced motion/transparency, tablet, predictive back | Relevant | Required | Required | Complete matrix | 11 |
| Full regression and release evidence | All | All | All | All | 12 |

## Test-framework decision

Accepted in Phase 4: Jest Expo + React Native Testing Library is the single native component stack. Semantic accessibility queries are required; `testID` is limited to a material-boundary probe that has no user semantic. Vitest remains the pure/API runner. No alternative component runner, Maestro, Detox, Storybook, or snapshot-approval workflow was added.

## Phase 7 Home matrix

| Contract | Coverage |
|---|---|
| Incomplete profile and state exclusivity | Pure resolver plus semantic component states |
| Retained data on refresh failure; partial/stale/offline | Pure availability resolver plus retained-content renderer case |
| Local calendar-day Today selection and nearest future item | Pure time-zone-sensitive, date-only, and spanning-period fixtures |
| Trusted-only content, publication/update semantics, recent order/limit | Explicit-trust presentation gate, content normalization, and pure/component assertions |
| Announcement detail, Announcements tab, Calendar/settings actions | Full-row and labelled-button renderer interaction tests |
| No duplicate primary-tab shortcut cards | Reachable Home renderer absence assertions |
| 320 dp and 200% font scale | Single-column/gutter pure contract plus wrapping renderer assertions |
| Accessibility | Headings, full row labels, logical source/title/date/action order, explicit busy state |
| iOS/Android adaptation | Semantic theme selection; opaque Home content; shared platform primitives |
| Synthetic native states | `incomplete`, `loading`, `populated`, `empty`, `stale`, `error`, `long-title`; light/dark selected by environment |

Focused commands are `npm.cmd test -- tests/unit/mobile-native-home.test.ts --configLoader runner`, `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/home/HomeDailyBrief.test.tsx`, and the equivalent preview test path. Final full-suite/build/native results are recorded in the Phase 7 report.

Final Phase 7 acceptance results: focused Home pure coverage 1 file / 8 tests; complete native Jest 13 suites / 96 tests / 0 snapshots; API 30 files / 310 tests; full regression 46 files / 589 tests (above the 45/581 Phase 6 baseline); workspace/native TypeScript, admin/mobile builds, and Android x86_64 assembly passed. The final whitespace, sensitive-log, and forbidden-test-modifier scans are recorded in the acceptance handoff. Native artifacts, including the reconciled loading-state pair, are indexed in [`evidence/phase-07-native`](./evidence/phase-07-native/README.md).

## Phase 8 trusted Announcements feed matrix

| Contract | Coverage added |
|---|---|
| Trusted-only feed gate | Pure cases for explicit trust, item/source/scope identity, normalized text, canonical/link equivalence, official institutional authority, unsafe/missing URLs, and source-less fallback rejection; component absence assertions for rejected/source-less/unsafe rows |
| Stable identity, deduplication, and chronology | Canonical URL key/deduplication cases, duplicate API-ID case, deterministic source-family merge, publication/source-update newest-first order, and explicit discovery/fetch exclusion |
| Search and debounce | Turkish dotted/dotless I/diacritic folding across title/summary/source, multi-token matching, 300 ms component debounce, no-results recovery, and source scan prohibiting search logging/persistence |
| Content/source filters | Separate **İçerik türü** and **Akademik kapsam ve kaynak** groups; combined announcement/news/event and university/faculty/department/YÖK/Yaz Okulu cases; selected accessibility state and filter-result summary |
| One virtualized feed | Renderer assertion for exactly one `FlatList`, stable key data, root scroll-to-top registration, bounded initial/batch/window settings, pull-to-refresh, and no routed `ScrollView` wrapper for Announcements/detail |
| State exclusivity and retention | Pure dominant-state table for initial loading, background refresh, populated, empty, no-results, stale, partial, offline, recoverable error, pagination loading/failure; component cases for single busy semantics, empty/error separation, retained rows, and native network-derived offline state |
| Controlled loading | Pure 20/40/60/80/100 ceiling/has-more policy plus renderer end-reached, loading suppression, retained pagination failure, and retry cases |
| YÖK and Summer School | Source-family filtering, dedicated nested-destination actions, synthetic source-specific scenarios, full-row detail entry, and retained exact Announcements-stack route ownership |
| Detail trust and content | Normalized title/source/summary, source domain disclosure, separate publication/update labels, invalid/untrusted/unsafe/mismatched-source fail-closed states, loading/error exclusivity, and 320 dp/200% markers; any requested detail ID is identity-bound to a matching cached trusted item or exact `/announcements/my/trusted/:id` result, with direct and notification-origin routes both failing closed |
| Real actions only | Native Share payload uses normalized title plus specific canonical URL; official handoff uses the specific safe URL and contains unsupported/failure locally; explicit absence of Save/read/calendar/attachment/fake-social controls |
| Platform and responsive selection | Android/iOS semantic markers, opaque feed/detail surfaces even when iOS material is eligible, 48 dp contract, one column, 16-unit compact gutter, wrapped filter groups, 720-unit readable width, and long Turkish fixture |
| Accessibility | Screen/filter headings, search role/label, selected filter state, feed/detail busy state, full-row name/order, nested-destination names, destination domain disclosure, decorative skeleton suppression, and controlled error copy |
| Synthetic native harness | Stable 15-scenario inventory, deterministic 100-record long feed, dual development gate, reserved `preview.edu.tr`/YÖK URLs, API/storage/provider import prohibition, detail→Back feed-state retention, and contained official-handoff fixture |
| Forbidden test/product behavior | No snapshot acceptance, `.skip`, `.only`, empty assertion, blind update, raw secret/error display, fake likes/comments/reposts/connections, or invented capability action |

### Phase 8 validation ledger

Final validation ran from the reconciled Phase 8 worktree at pre-commit HEAD `d96dff5a3b1e6ac87ae095061946347285c0f44d`. The current test runner discovered 47 files / 621 tests, one file and 32 tests above the accepted Phase 7 result immediately above; no older fixed count was substituted.

| Exact command/check | Result |
|---|---|
| `npm.cmd test -- tests/unit/mobile-native-content-feed.test.ts tests/unit/mobile-native-content-trust.test.ts tests/unit/mobile-native-route-foundation.test.ts --configLoader runner` | PASS, 3 files / 95 tests, 1.63 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/announcements/AnnouncementsFeed.test.tsx tests/announcements/AnnouncementDetail.test.tsx tests/announcements/ContentFeedPreview.test.tsx` | PASS, 3 suites / 51 tests / 0 snapshots, 30.306 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/announcements/AnnouncementsFeed.test.tsx tests/announcements/AnnouncementDetail.test.tsx tests/announcements/ContentFeedPreview.test.tsx tests/navigation/AppNavigator.test.tsx` | PASS, 4 suites / 65 tests / 0 snapshots, 30.378 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS, 16 suites / 147 tests / 0 snapshots, 74.227 s |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 30 files / 310 tests, 28.69 s; existing non-failing Mongoose `new` deprecation warning only |
| `npm.cmd test -- --configLoader runner` | PASS, 47 files / 621 tests, 38.80 s; Phase 7 was 46/589 (+1 file / +32 tests) |
| `npm.cmd run typecheck` | PASS, workspace TypeScript |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, native TypeScript |
| `npm.cmd run build:admin` | PASS, 1,742 modules; 250.51 kB main JS; 4.22 s |
| `npm.cmd run build:mobile` | PASS, 1,754 modules; 349.18 kB main JS; 7.94 s |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | PASS: installed evidence build in 1m48s, then final incremental verification after request-ownership fixes in 1m7s; both reported 245 tasks (7 executed / 238 up-to-date) and the same 56,804,991-byte APK with SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7` |
| `adb install -r -d app-debug.apk` and Android feed/detail smoke on `emulator-5554` | PASS; install returned `Success`; 20 reviewed original-resolution PNG/XML pairs, interaction proofs, live-Metro clean log, and restoration record |
| `git diff --check` | PASS |
| Forbidden modifiers, snapshots, vacuous tests, search log/persistence, credential/production literals, unsafe preview URL, raw diagnostic search, credential diagnostic, and fatal runtime scans | PASS, no prohibited match |
| Mobile-native lint inventory | `MOBILE_NATIVE_LINT: NOT AVAILABLE`; no lint script/config/dependency was invented, and other checks are not relabelled as lint |

### Phase 8 native evidence results

The dual-gated preview supplies synthetic `populated`, `search-results`, `no-results`, `active-filters`, `partial`, `stale`, `offline`, `error`, `pagination-error`, `detail`, `yok`, `summer-school`, `official-source-handoff`, `long-title`, and `long-feed` states. Native review ran on `emulator-5554` / `AcademicPhase1Low`, Android 7.0 / API 24 / x86_64, at 720×1280 physical pixels. Normal density 320 produced 360 dp at font scale 1.0; the exact compact case used density 360 for 320 dp at font scale 2.0.

The 20 visually reviewed original-resolution PNG/XML pairs cover populated light/dark feeds; search result, in-app detail, same-process Android Back, and retained feed scroll; no-results; active filters; retained partial/stale banners; YÖK feed/detail; Summer School feed/detail; contained official handoff with the same PID and resumed app; exact compact dark long-title feed/detail with the official-source action reachable; and the 100-record long feed at top and after scrolling to rows 023/024. All artifacts are 720×1280, basename pairing passed, and hashes are stored in [`raw/integrity-index.txt`](./evidence/phase-08-native/raw/integrity-index.txt).

The live-Metro runtime scan passed with no fatal/TypeError/runtime-error pattern. Two expected `Cannot connect to Metro` warnings emitted only after intentional development-server teardown are transparently preserved and classified separately; the teardown fatal-exception scan also passed. Debug-emulator `gfxinfo` is observational only: 547 total frames, 528 janky (96.53%), p50 26 ms, p90 42 ms, p95 46 ms, p99 61 ms. No release/performance threshold or production-runtime claim is made from that result.

Restoration passed at 720×1280, density 320, font scale 1.0, with no ADB reverse, no port-8081 listener, and no app PID; the emulator was deliberately retained. `accessibility_enabled=0` and no TalkBack service was available, so UIAutomator is not screen-reader acceptance. Synthetic UI evidence does not prove live API/session/provider behavior or production data. Windows cannot supply iOS build/runtime, Dynamic Type, VoiceOver, native Share, or Liquid Glass acceptance; API 24 cannot prove predictive Back. Phase 9 was not started.

## Current Phase 1–8 remediation ledger — 4 August 2026

### Provenance and historical boundary

- Accepted Phase 8 baseline: `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`.
- Package 1: `641d7bee8a1cd539179769069a22b5c3220e8a6d` (`fix(auth): close phase-one security gaps`).
- Package 2: `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` (`fix(api): complete trusted dates and notification delivery`).
- Package 3: `2e3664546f628a19c6fa929b9ee9469e5322f9a8` (`fix(mobile-native): reconcile completed phase behavior`).
- Package 4: `fd54f63669f0ef18230dfe0e9df64281310ac5a7` (`docs(mobile-native): reconcile phases one through eight`).

Firestore database persistence and the visible six-tab phone shell appear above only in dated historical ledgers. The current API runtime is Mongo-only and the authenticated phone shell has exactly Home, Announcements, Calendar, and Profile.

### Current focused coverage

| Package | Exact focused command or current file set | Current count and covered contract |
|---|---|---|
| 1 — API security | `npx.cmd vitest run apps/api/tests/password-recovery-generation-security.test.ts apps/api/tests/recent-authentication.test.ts apps/api/tests/trusted-proxy-rate-limit.test.ts apps/api/tests/password-recovery.test.ts apps/api/tests/users-and-guards.test.ts --configLoader runner` | 5 files / 47 tests: generation commit/enforcement, concurrency/idempotency/failure boundaries, purpose-specific single-use recent auth, practical recovery parity, trusted proxy, stale access/refresh/recovery rejection |
| 1 — clients | `npx.cmd vitest run tests/unit/mobile-firebase-config.test.ts tests/unit/mobile-native-recent-authentication.test.ts --configLoader runner` and `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/auth/RecentAuthenticationPanel.test.tsx` | Root 2 files / 8 tests plus native 1 suite / 3 tests / 0 snapshots: fail-closed Firebase config and fresh purpose-specific native credential/proof submission |
| 2 — trusted delivery | `npx.cmd vitest run apps/api/tests/safe-outbound-request.test.ts apps/api/tests/announcement-content-identity.test.ts apps/api/tests/notification-announcement-production.test.ts apps/api/tests/notification-calendar-reconciliation.test.ts apps/api/tests/notification-job-durability.test.ts apps/api/tests/notification-worker-lifecycle.test.ts apps/api/tests/mongo-notification.repository.test.ts --configLoader runner` | 7 files / 38 tests: actual resolved destination/redirect validation, fingerprint relationships, ingestion→job, retirement/revalidation, duplicate/restart/retry/fencing/shutdown |
| 2 — temporal/native | `npx.cmd vitest run tests/unit/announcement-date-only-api-native.test.ts tests/unit/academic-temporal-contract.test.ts tests/unit/calendar-ingestion.test.ts tests/unit/google-calendar-sync.test.ts tests/unit/mobile-native-content-trust.test.ts --configLoader runner` | 5 files / 71 tests: date-only/inclusive-range ingestion, Istanbul API-to-native presentation, timestamp compatibility, trusted content identity |
| 3 — native behavior | `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/navigation/AppNavigator.test.tsx tests/auth/AuthScreens.test.tsx tests/home/HomeDailyBrief.test.tsx tests/announcements/ContentFeedPreview.test.tsx` | PASS — 4 suites / 60 static declarations / 74 runtime cases / 0 snapshots, Jest duration 27.167 s: selected-root virtualized-list reselect, switch retention, insets, real actions, step marker, actual focus, priority/recent/integration/no-data states, 100-record harness |
| 3 — pure behavior/performance | `npx.cmd vitest run tests/unit/mobile-native-home.test.ts tests/unit/mobile-native-feed-performance.test.ts --configLoader runner` | 2 files / 21 tests: qualified important selection, independent recent items, no-data resolver, `framestats` parser/nearest-rank/threshold evaluation |

### Current complete suite counts

These final post-review runs include the five final-blocker corrections from accepted baseline `fd54f63669f0ef18230dfe0e9df64281310ac5a7`:

| Exact command | Current result |
|---|---|
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests, Vitest duration 36.62 s |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — 17 suites / 158 tests / 0 snapshots, Jest duration 59.532 s |
| `npm.cmd test -- --configLoader runner` | PASS — 69 files / 801 tests, Vitest duration 38.30 s |

The current non-counted build/type gates remain:

```powershell
npm.cmd run typecheck
npm.cmd --prefix apps/mobile-native run typecheck
npm.cmd run build:admin
npm.cmd run build:mobile
Set-Location apps/mobile-native/android
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon
```

Final non-counted gates passed: workspace TypeScript and mobile-native TypeScript; admin Vite build (1,742 modules, 6.85 s); mobile-web Vite build (1,755 modules, 8.42 s); and Android x86_64 `assembleDebug` (`BUILD SUCCESSFUL` in 2m35s, 245 tasks). The initial sandboxed Vite/Gradle attempts could not see parent paths or the Android SDK; identical approved local reruns passed. TypeScript/build success is not converted into a test count or called lint.

### Final blocker focused evidence

| Blocker | Exact command or scope | Fresh result |
|---|---|---|
| Single-use recent authentication | `npx.cmd vitest run apps/api/tests/recent-authentication.test.ts apps/api/tests/users-and-guards.test.ts apps/api/tests/auth-http-contract.integration.test.ts --configLoader runner` plus `npx.cmd vitest run tests/unit/mobile-native-recent-authentication.test.ts --configLoader runner` | PASS — API 3 files / 22 tests in 6.39 s; native unit 1 file / 5 tests in 2.57 s |
| Safe outbound boundary and named call sites | `npx.cmd vitest run apps/api/tests/safe-outbound-request.test.ts apps/api/tests/outbound-call-sites.test.ts apps/api/tests/server-outbound-inventory.test.ts --configLoader runner` | PASS — 3 files / 42 tests in 2.95 s; affected ingestion/network regression also passed 5 files / 53 tests in 3.34 s |
| Durable notification attempt fence | Notification delivery-attempt, worker lifecycle/durability/reconciliation/production, Mongo, operations, schema, and index focused set | PASS — 10 files / 114 tests in 9.97 s, including real-Mongo concurrency/recovery and long-fan-out lease timing |
| Historical/current documentation | `npx.cmd vitest run tests/unit/phase-1-8-documentation-consistency.test.ts --configLoader runner` | PASS — 1 file / 7 tests in 829 ms; authoritative historical banners, four-tab/current architecture, Mongo-only persistence, fixed security, and Package 3 count assertions |

### Release-mode Phase 8 feed performance

The repository-owned command is:

```powershell
npm.cmd run measure:mobile-native:feed-release
```

It sets `NODE_ENV=production`, builds `assembleRelease` from `index.feed-performance.ts` for x86_64 only, verifies that the APK is non-debuggable and Metro-independent, verifies the embedded 100-record marker, performs one warm scroll, and captures five measured `adb shell dumpsys gfxinfo com.anssoft.akademiktakvim framestats` trials. Acceptance requires every trial to contain at least 100 valid frames, aggregate nearest-rank p90 ≤32 ms, aggregate p95 ≤50 ms, and zero frames at or above 700 ms.

| Run | Renderer/environment | Frames | Aggregate | Disposition |
|---|---|---:|---|---|
| Initial control | API 24 x86_64 AVD explicitly using SwiftShader | 592 (`120/112/120/120/120`) | p90 `70.649202 ms`; p95 `77.171868 ms`; zero frozen | FAIL; renderer-bound evidence, not a proven feed bottleneck |
| Rejected experiment | Same SwiftShader environment; temporary `4/3/window 3/75 ms` plus Android clipping | 598 (`120/120/118/120/120`) | p90 `73.497194 ms`; p95 `82.665697 ms`; zero frozen | FAIL and worse; every experimental FlatList setting was reverted |
| Accepted final | API 24 / `AcademicPhase1Low`, 720×1280, 320 dpi, font scale 1.0, host Intel OpenGL renderer | 600 (`120` in each trial) | p90 `24.928167 ms`; p95 `35.777763 ms`; zero frozen | PASS with the original Phase 8 FlatList settings |

The accepted fresh release APK was 29,407,480 bytes, x86_64-only, non-debuggable, required no Metro server, and had SHA-256 `ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`. The runner executed 391 Gradle tasks, observed the harness marker, uninstalled the benchmark package, removed the alternate-entry APK and temporary hierarchy, restored the pre-existing release artifact, and did not change display settings or add ADB reverse. The committed evidence is `apps/mobile-native/performance/release-evidence.json`.

This proves only the named local release environment. It does not close iOS, modern physical Android, tablet/rail, TalkBack/VoiceOver, provider, installed authenticated E2E, or shipped performance-telemetry evidence.

### Complete remediation hygiene gates

The final gate uses the following current commands/checks after the documentation commit:

| Gate | Exact command/check | Acceptance |
|---|---|---|
| Whitespace | `git diff --check fd54f63669f0ef18230dfe0e9df64281310ac5a7..HEAD` | No whitespace error |
| Sensitive logs | `git grep -n -E "(console|logger)\.(log|warn|error|debug).*(password|accessToken|refreshToken|verificationCode|recoveryCode|deviceToken|contentBody)" -- apps/api/src apps/mobile-native apps/mobile/src` | No uncontrolled secret/content diagnostic |
| Credential literals | `git grep -n -E "AIza[0-9A-Za-z_-]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" -- . ":!package-lock.json" ":!apps/mobile-native/package-lock.json"` | No committed credential literal; required Firebase values come from environment |
| Firestore persistence | `git grep -n -i -E "FirestoreRepository|FirestoreDatabase|firebase-admin/firestore|from .*firestore" -- apps/api/src` | No API database-persistence path; retained Firebase Authentication/FCM is not Firestore |
| Direct server fetch | `npx.cmd vitest run apps/api/tests/server-outbound-inventory.test.ts --configLoader runner` | No executable API `fetch` outside the approved safe boundary |
| Invalid TLS | Source scan plus the server outbound inventory test | No certificate-bypass option, retry, environment switch, or process-wide TLS override |
| Focus modifiers | `git grep -n -E "\.(skip|only|todo)\s*\(" -- "*.test.ts" "*.test.tsx" "*.spec.ts" "*.spec.tsx"` | No committed `.skip`, `.only`, or `.todo` |
| Snapshots | `git grep -n -E "toMatch(Snapshot|InlineSnapshot)" -- "*.test.ts" "*.test.tsx" "*.spec.ts" "*.spec.tsx"` plus tracked `.snap` inventory | No snapshot acceptance or tracked snapshot file |
| Empty/vacuous tests | Review test callbacks plus `git grep -n -E "expect\((true|false)\)\.toBe\((true|false)\)" -- "*.test.ts" "*.test.tsx" "*.spec.ts" "*.spec.tsx"` | No empty assertion or constant-truth acceptance; named focused suites contain behavioral assertions |
| Fake social vocabulary | `rg -n -i "\b(likes?|comments?|reposts?|followers?|following|connections)\b" apps/mobile-native/src apps/mobile-native/App.tsx` | No fake social action/counter introduced; Google Calendar's technical singular `connection` records are not social UI |
| Phase 9 implementation | `git diff --name-only fd54f63669f0ef18230dfe0e9df64281310ac5a7..HEAD -- apps/api apps/mobile-native apps/mobile tests scripts` plus scoped diff review | No Phase 9 manual-exam edit/delete or native date-picker implementation |

`MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. The untracked Phase 9–12 planning reports and raw prompts are not test evidence, are not staged automatically, and do not constitute implementation. Phase 9 was not started.

## Phase 9 Calendar and personal-exam evidence — 5 August 2026

### Phase 9 requirement matrix

| Contract | Evidence |
|---|---|
| Agenda/Week/Month | Pure view-period/grouping tests; renderer view selection; native 360 dp and tablet Agenda/Week/Month captures; Agenda is the initial selected state |
| Trusted temporal semantics | Date-only, inclusive-range, timestamp, DST-offset, and Europe/Istanbul regressions; academic detail/native captures show all-day/range labels without a clock |
| Personal-exam CRUD/persistence | Pure owner-store create/update/delete, relaunch, stale-owner, and A→B→A tests; component create/edit/delete actions; native bottom sheet, Android pickers, detail, edit, native delete alert, and deletion captures |
| Google lifecycle preservation | Existing Google sync/lifecycle suites in the full regression plus unchanged Phase 3 handlers/storage; compact status component/native partial-state evidence; remote mutation remains app-marker and owner gated |
| Availability truth | Dominant-state pure tests, component cases, and native loading/populated/empty/stale/partial/offline/refreshing/error/Google-partial captures with retained-data behavior |
| Detail and Back | Academic/personal component detail tests; native detail→system Back with the same PID and retained Calendar screen |
| Platform/responsive | Android Material-compatible tonal/ripple/bottom-sheet/native-picker path; 48 dp hierarchy bounds; exact 320 dp/font-scale-2, 360 dp light/dark, and approximately 853 dp tablet evidence |
| Accessibility | Text+icon+color classification; selected, busy, expanded, invalid, disabled, and error semantics; wrapping/reachable large-text actions; TalkBack/VoiceOver limitation disclosed |
| Synthetic safety | Dual development gate, allowlisted scenarios/deep links, local reserved fixtures, and no API/storage/provider import; no production access |

### Phase 9 validation ledger

| Exact command/check | Result |
|---|---|
| `npm.cmd test -- tests/unit/mobile-native-calendar.test.ts --configLoader runner` | PASS — 1 file / 19 tests |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/calendar/CalendarExperience.test.tsx tests/calendar/CalendarEventDetail.test.tsx tests/calendar/CalendarPreview.test.tsx` | PASS — 3 suites / 20 tests / 0 snapshots |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — 20 suites / 178 tests / 0 snapshots |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests |
| `npm.cmd test -- --configLoader runner` | PASS — 70 files / 820 tests |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run build:admin` | PASS — 1,742 modules; 250.51 kB main JS / 73.89 kB gzip |
| `npm.cmd run build:mobile` | PASS — 1,755 modules; 349.76 kB main JS / 104.37 kB gzip |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` | PASS — final incremental verification 1m22s, 268 tasks (7 executed / 261 up-to-date); 56,804,991-byte APK; SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD` |
| Android install/Calendar/personal-exam smoke | PASS — 33 original-resolution PNG/XML pairs, clean final runtime scan, restored device profile |
| Mobile-native lint inventory | `MOBILE_NATIVE_LINT: NOT AVAILABLE` |

Initial sandboxed Vite/Gradle attempts could not see required parent paths or the Android SDK; identical approved reruns passed. Final hygiene results and exact scans are stored with the native evidence.

### Phase 9 native evidence results

Native review ran on `emulator-5554` / `AcademicPhase1Low`, Android 7.0 / API 24 / x86_64. Phone captures are 720×1280; density 320 gives 360 dp at font scale 1.0. The exact compact case used density 360 for 320 dp at font scale 2.0. Temporary tablet captures are 1280×1920 at density 240, approximately 853 dp wide.

Thirty-three visually reviewed screenshot/XML pairs cover default Agenda, Week, Month, academic detail and Back retention, personal create/edit/delete and native dialogs, every requested availability state, compact Google partial state, dark mode, long Turkish content, large-text reachability, and tablet Agenda/Month. Pairing and hashes are in [`evidence/phase-09-native/raw/integrity-index.txt`](./evidence/phase-09-native/raw/integrity-index.txt). The final runtime scan has no fatal/TypeError/runtime-error match. Device restoration passed at 720×1280, density 320, font scale 1.0, without ADB reverse, port-8081 listener, or app PID; the AVD was retained.

TalkBack was unavailable (`accessibility_enabled=0`), Windows cannot provide iOS/Xcode/VoiceOver/Liquid Glass evidence, and API 24 cannot prove predictive Back. Synthetic preview evidence does not prove live authentication, SecureStore relaunch, account switching, or Google provider operations. No production account/provider/data was accessed. Phase 10 was not started.

## Phase 9 acceptance-repair ledger — 5 August 2026

This ledger supersedes only the accepted Phase 9 claims about personal-exam integration-test depth, cancellation coverage, and leap-year edge coverage. All other Phase 1–9 contracts and the historical ledgers above remain unchanged.

| Required repair gate | Exact command/evidence | Fresh result |
|---|---|---|
| Real personal-exam production integration | `npm.cmd test -- tests/unit/mobile-native-personal-exam-integration.test.ts --configLoader runner` | PASS — 1 file / 1 test; real runtime mutation, owner envelope, hydration/relaunch, A/B/A, and delayed-A rejection |
| Calendar/leap model | `npm.cmd test -- tests/unit/mobile-native-calendar.test.ts --configLoader runner` | PASS — 1 file / 25 tests; February 29, 42 cells, adjacent months, seven-day week, navigation, selection, date-only/range, and non-leap behavior |
| Focused native Phase 9 | `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/calendar/CalendarExperience.test.tsx tests/calendar/CalendarEventDetail.test.tsx tests/calendar/CalendarPreview.test.tsx tests/calendar/PersonalExamCancellation.test.tsx` | PASS — 4 suites / 24 tests / 0 snapshots; create/edit/date/time cancellation is runtime-adapter backed |
| Complete native Jest | `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — 21 suites / 182 tests / 0 snapshots |
| Complete API | `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests; dedicated localhost Mongo fixture |
| Full root regression | `npm.cmd test -- --configLoader runner` | PASS — 71 files / 827 tests |
| Documentation consistency | `npm.cmd test -- tests/unit/phase-1-8-documentation-consistency.test.ts --configLoader runner` | PASS — 1 file / 7 tests after documentation updates |
| TypeScript | `npm.cmd run typecheck`; `npm.cmd --prefix apps/mobile-native run typecheck` | PASS / PASS |
| Web regression builds | `npm.cmd run build:admin`; `npm.cmd run build:mobile` | PASS — 1,742 and 1,755 modules respectively |
| Android x86_64 debug | `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` | PASS — 1m29s; 268 tasks; APK 56,804,991 bytes; SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD` |
| Native repair smoke | Fresh APK on `AcademicPhase1Low`, API 24 / x86_64 | PASS — Agenda/Week/Month, date/time dialog cancel, editor cancel, same-process retention, clean runtime scan; restored profile and local-process cleanup |
| Hygiene and scope | Whitespace, sensitive log, credential, `.skip/.only/.todo`, snapshot, empty/vacuous, Firestore, fake-social, Phase 10 diff scans | PASS; `MOBILE_NATIVE_LINT: NOT AVAILABLE` |

The successful API runs used only a temporary `127.0.0.1` Mongo fixture. The initial no-Mongo run and sandbox-limited Vite attempts are environment diagnostics, not passes. No remote service or production data was accessed. Phase 10 was not started.

## Phase 10 Profile and settings evidence — 5 August 2026

This is the Phase 10 verification ledger. The automated results and bounded Android visual/runtime review below are fresh Phase 10 runs. Repository-state checks that must follow documentation reconciliation are reported by the final acceptance handoff rather than inferred from an earlier diff.

### Phase 10 requirement matrix

| Contract | Required evidence |
|---|---|
| Profile hierarchy and truth | Root/model tests for the fixed section order, authoritative `/me` name/email on Profile, and the same authoritative email on Account; renderer checks that academic, notification, Google, and account controls are routed rather than duplicated; absence scan for appearance/help/legal dead rows and fake profile/social content |
| Academic editor | Hierarchy clearing, required university, search/virtualization, loading/no-result/error/retry/expanded/selected/invalid states, one Save, failed-save dirty retry, authoritative server response, shared discard guard for explicit Cancel/header/Android Back/navigation removal, and keyboard-safe route |
| Notification truth | All permission/registration/preference combinations; stored preference explicitly Açık/Kapalı independent of save state; active only when every gate passes; duplicate-safe Open Settings busy/rejection; supported mode/categories; clean/dirty/saving/saved/error; no token or unsupported reminder/quiet-hours UI |
| Google lifecycle | Disconnected/checking/connected/expired/syncing/partial/error presentation; account/last sync/current mapping count/warning; retained disconnected ledger/actions; externally owned busy state; surviving-heading focus after managed removal; unchanged Phase 3 owner/partial/late-operation and personal-event protections |
| Account management | Authoritative `/me` identity; separate logout/data-delete/account-delete; collapsed danger area; keyboard-safe content; consequences, cancel, focus return, busy/duplicate guard, fixed error; one semantic owning-route feedback surface; purpose-bound single-use recent-authentication tests |
| Platform/responsive | Android Material 3-compatible opaque tonal/ripple/sheet/dialog/edge-to-edge path; iOS navigation-only glass policy; 48 dp targets; exact 320 dp at font scale 2.0; phone light/dark; tablet readable width; reachable actions |
| Accessibility | Logical reading order; selected, busy, expanded/collapsed, invalid, dirty/saved, disabled, and error semantics; status text/icon independent of color; sheet/dialog focus return; TalkBack/VoiceOver limitations disclosed |
| Synthetic safety and scope | Dual `__DEV__` + Phase 10 environment gate, allowlisted local scenarios, reserved fixtures, no API/SecureStore/provider import; no Phase 11 implementation and no production account/data access |

### Phase 10 validation ledger

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| Focused Phase 10 pure/model and contract tests: `tests/unit/mobile-native-profile-settings.test.ts`, `tests/unit/mobile-native-recent-authentication.test.ts`, `tests/unit/mobile-native-notification-lifecycle.test.ts`, `tests/unit/google-calendar-lifecycle.test.ts`, `tests/unit/google-calendar-sync.test.ts` | PASS — 5 files / 80 tests | Covers hierarchy, academic commit, notification truth, Google lifecycle/personal-event exclusion, recent-auth purpose/single-use behavior, and scope |
| Focused native `--runTestsByPath`: `ProfileSettings.test.tsx`, `ProfileSettingsPreview.test.tsx`, `AppNavigator.test.tsx`, `selection-sheet.test.tsx`, `AuthScreens.test.tsx` | PASS — 5 suites / 71 tests / 0 snapshots | Covers authoritative Profile/Account identity wiring, preference truth, dirty retry/Cancel guard, duplicate-safe Settings rejection, route-feedback ownership, retained Google ledger/actions/busy/focus, keyboard-safe routes, selector/auth semantics; no provider or OS claim |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — 23 suites / 206 tests / 0 snapshots | Complete native Jest regression |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests | Used only the dedicated temporary `127.0.0.1` Mongo fixture; no remote service or production data |
| `npm.cmd test -- --configLoader runner` | PASS — 72 files / 841 tests | Full root regression |
| `npm.cmd run typecheck` | PASS | Workspace TypeScript |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS | Mobile-native TypeScript |
| `npm.cmd run build:admin` | PASS — 1,742 modules; JS 250.51 kB / 73.89 kB gzip; 5.14 s | Admin regression build; web output is not native evidence |
| `npm.cmd run build:mobile` | PASS — 1,755 modules; JS 349.76 kB / 104.37 kB gzip; 7.92 s | Mobile-web regression build; web output is not native evidence |
| `./gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | PASS — 1 m 11 s; 268 tasks (7 executed, 261 up-to-date); fresh reinstall PASS | APK 56,804,991 bytes; SHA-256 `57DC2F1BDCD7D7C3B02429EF260DF29A3EEEBCC374C55B90D34334793FEFAAFD`; unchanged because debug JS is Metro-served; only known SDK XML/location, Gradle deprecation, and `NODE_ENV` warnings |
| Android Profile/settings smoke on the authorized local x86_64 AVD | PASS — 44 original-resolution PNGs + 44 basename-matched XML exports; 88 integrity-index rows | Phone light/dark, exact 320 dp at font scale 2.0, simulated tablet, reachable 48 dp controls, ordinary Back from Notifications to Profile in PID 11098, no filtered fatal/runtime matches, and restored size/density/font settings |
| `git diff --check` plus sensitive-log, credential, forbidden-test-modifier, snapshot/vacuous, Firestore, fake-social, and Phase 11 scope scans | PASS — no prohibited match; 77 scoped text artifacts also had zero trailing-whitespace or NUL findings | The Phase 11 phrase appears only in the negative guard test that asserts those markers are absent from production; the production scan itself has zero matches. `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact |

### Native evidence inventory

The dual-gated synthetic preview and its focused tests cover the allowlisted complete/incomplete summary, academic editor, notification truth, Google lifecycle, account/danger, confirmation, and error scenarios without a live dependency. [`evidence/phase-10-native`](./evidence/phase-10-native/README.md) indexes 44 original-resolution PNGs and 44 basename-matched UIAutomator XML exports; [`integrity-index.csv`](./evidence/phase-10-native/raw/integrity-index.csv) records all 88 artifact rows with hashes and byte counts. Reviewed profiles are phone light, phone dark, exact 320 dp at font scale 2.0, and a temporary approximately 853 dp simulated tablet. Hierarchies establish nonzero reachable action bounds and measured 48 dp Back, Settings, and notification-switch targets. The ordinary Back smoke returned from Notifications to Profile in the same process, PID 11098. The 772-line, 78,370-byte app-process log has no match in the final fatal/AndroidRuntime/React Native `TypeError`, `ReferenceError`, invariant, unhandled, or unable-to-load filter, and the device size, density, and font scale were restored.

TalkBack was disabled, so hierarchy exports are not traversal evidence. This synthetic/native presentation evidence cannot prove a live authenticated relaunch/account-switch flow, SecureStore persistence, an OS notification prompt on Android 13, FCM/APNs delivery, a real Google chooser/calendar mutation/revoke, native dirty-guard behavior, iOS/VoiceOver/Dynamic Type/Liquid Glass, or predictive Back. The production dirty leave guard is covered by automated renderer/navigation tests. The tablet is an emulator `wm` override, not a physical device. No production account, calendar, provider, credential, or data was used. Phase 11 was not started.

## Phase 11 cross-platform quality evidence — 6 August 2026

This ledger begins at the accepted Phase 10 baseline
`8dbe5e1efdb0c5fab665345188228ff66a0f84f6`. Phase 11 implementation,
automated/release-feed validation, final Android debug assembly, the
installed-app screenshot/XML/log matrix, documentation consistency, and final
hygiene scans are complete. The historical Phase 10 sentence above remains
accurate only for its own checkpoint.

### Phase 11 requirement matrix

| Contract | Verified evidence and boundary |
|---|---|
| Accessibility and focus | Root and native renderer tests cover roles/labels; selected, checked, disabled, busy, expanded, invalid, and error states; route-title, sheet, invalid-field, save/result focus; live feed/Calendar/result announcements; switch labeling; decorative hiding; and non-color selection/classification. TalkBack/VoiceOver runtime acceptance is not claimed. |
| Contrast and semantic color | Automated token checks require at least 4.5:1 for audited normal text and 3:1 for meaningful control/focus/status/disabled boundaries in light and dark. Raw colors under `apps/mobile-native/src` are confined to `tokens.ts`. Dormant raw compatibility styles in `App.tsx` remain documented MN-010 debt; the final diff scan must prove no new `App.tsx` palette. |
| Responsive/large text | Deterministic policy and reviewed native evidence cover 320, 360, 393, 430, and approximately 853 dp at 100%, 130%, 150%, and 200% font: readable maximum widths, safe single-column collapse, stacked compact controls, no horizontal-scroll policy, reachable actions, 48 dp Android targets, and tablet gutters/adaptive navigation. |
| Dark mode/platform adaptation | Reachable routes use semantic light/dark tokens and React Navigation theme mapping; system states and dark splash are covered. Android keeps opaque Material-compatible tonal surfaces and ordinary Back. iOS Liquid Glass remains navigation/control chrome only with opaque fallback; Windows provides code/renderer evidence only. |
| Motion/reduced effects | Deterministic tests retain restrained motion, simplify nonessential sheet/result behavior for Reduce Motion, select opaque fallback for Reduce Transparency, and reject Three.js. Android native evidence covers all three animation scales at 0; native iOS Reduce Transparency remains unavailable. |
| Virtualization and trust | Home, Announcements, Calendar, YÖK, Summer School, and long selectors use `FlatList`/`SectionList` boundaries without speculative clipping/batch tuning. Official links remain canonicalized before handoff; academic date-only/range semantics remain unchanged. |
| Release feed performance | Fresh non-debuggable x86_64 Hermes/Fabric release build, deterministic 100-record fixture, one activity-start timing, five measured trials, exact device configuration/restoration, and explicit thresholds passed on the authorized API 24 AVD. This is not a release-timing distribution for unrelated screens or iOS. |
| Contract/scope preservation | Complete API/native/root regression plus TypeScript/build gates preserve Phase 1–10 contracts. No endpoint, schema, repository, auth/session, notification/provider, Google ownership/lifecycle, personal-exam persistence, or production-data contract changed. Phase 12 was not started. |

### Phase 11 automated validation ledger

| Exact command or check | Final result | Evidence boundary |
|---|---|---|
| `npx.cmd vitest run tests/unit/mobile-native-cross-platform-quality.test.ts tests/unit/mobile-native-design-foundation.test.ts tests/unit/mobile-native-feed-performance.test.ts tests/unit/mobile-native-content-trust.test.ts tests/unit/mobile-native-notification-adapter.test.ts --configLoader runner` | PASS — 5 files / 77 tests | Contrast, responsive/font matrix, reduced effects, hard-coded color boundary, virtualization, semantic/focus and safe-link contracts |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand --runTestsByPath tests/quality/CrossPlatformQuality.test.tsx tests/design-system/actions.test.tsx tests/design-system/feedback.test.tsx tests/design-system/fields-content.test.tsx tests/design-system/selection-sheet.test.tsx tests/design-system/theme-surfaces.test.tsx tests/navigation/AdaptiveTopBar.test.tsx tests/navigation/AppNavigator.test.tsx tests/auth/AuthScreens.test.tsx tests/announcements/AnnouncementsFeed.test.tsx tests/announcements/SourceDestinationScreens.test.tsx tests/calendar/CalendarExperience.test.tsx tests/calendar/CalendarEventDetail.test.tsx tests/calendar/PersonalExamCancellation.test.tsx tests/profile/ProfileSettings.test.tsx` | PASS — final rerun: 15 suites / 155 tests / 0 snapshots | Focused Phase 11 renderer/interaction evidence; includes truthful Summer state/count and repeated validation-focus repairs; no native OS or assistive-technology claim |
| `npm.cmd --prefix apps/mobile-native run test:native -- --runInBand` | PASS — final rerun: 25 suites / 227 tests / 0 snapshots | Complete native Jest; increased from Phase 10's 23 suites / 206 tests |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS — 45 files / 445 tests | Dedicated temporary `127.0.0.1` Mongo fixture only; stopped after the run; no remote service/data |
| `npm.cmd test -- --configLoader runner` | PASS — 73 files / 854 tests | Full regression; increased from Phase 10's 72 files / 841 tests |
| `npx.cmd vitest run tests/unit/mobile-native-auth-recovery.test.ts --configLoader runner` | PASS — 1 file / 20 tests | The first full run identified the obsolete inline-live-region static assertion; production behavior did not regress |
| `npm.cmd test -- tests/unit/phase-1-8-documentation-consistency.test.ts --configLoader runner` | PASS — 1 file / 7 tests | Final documentation consistency |
| `npx.cmd vitest run apps/api/tests/server-outbound-inventory.test.ts --configLoader runner` | PASS — 1 file / 2 tests | Approved server outbound boundary unchanged |
| `npm.cmd run typecheck` | PASS | Workspace TypeScript |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS | Mobile-native TypeScript |
| `npm.cmd run build:admin -- --configLoader runner` | PASS — final rerun: 1,742 modules; JS 250.51 kB / 73.89 kB gzip; 10.66 s | Web regression build, not native evidence |
| `npm.cmd run build:mobile -- --configLoader runner` | PASS — final rerun: 1,755 modules; JS 349.76 kB / 104.37 kB gzip; 14.14 s | Mobile-web regression build, not native evidence |
| `$env:FEED_PERFORMANCE_EPHEMERAL_DEVICE='1'; npm.cmd run measure:mobile-native:feed-release` | PASS — 430 Gradle tasks in 8 min 03 s; 29,525,380-byte APK; SHA-256 `6f32ed35453881073664c516792b69fae2a6af82e18109a7535fce92be2ede63` | Non-debuggable/no-Metro x86_64 Hermes/Fabric release harness on `AcademicPhase1Low`, API 24; the guard authorized replacing only the disposable local package |
| `.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon` from `apps/mobile-native/android` | PASS — 43 s; 268 tasks (7 executed / 261 up-to-date); APK 56,804,991 bytes; SHA-256 `FA93D03F277DB169564B09CC4E389D146D0D0E6911C7CA0774372DFB8A0A1BCA` | Final x86_64 debug assembly; install `Success`; package version `0.1.1`, versionCode `12`, ABI x86_64 |
| Android installed-app native matrix | PASS — 32 original-resolution PNGs + 32 basename-paired XML exports; 97 integrity rows; index SHA-256 `AD1F872742FCD8819A25B61CBC8EE22F90234EA03BAA44EB32C96D629F2AA419` | 320/360/393/430/~853 dp, 100/130/150/200% font, light/dark, keyboards, native date/time pickers, same-PID feed/Calendar Back, destructive reachability, reduced-motion scales 0, clean runtime/sensitive scan, and exact cleanup |
| Documentation consistency and final hygiene/scope scans | PASS — `git diff --check`; 113 intended text artifacts with zero trailing-whitespace or NUL findings; zero prohibited credential, Firestore, TLS-bypass, fake-social, forbidden modifier/snapshot/empty/vacuous-test, screen-local raw-color, or Phase 12 implementation matches | The one existing SMTP warning states only that a recovery message was not sent and contains no secret/payload. Six semantic raw-color changes are confined to `tokens.ts`; no raw color was added to `App.tsx`. Ports 8081/27017 were clear and no ADB device remained attached. Phase 12 implementation scan: no Phase 12 implementation; `PHASE_12_NOT_STARTED`. |
| Mobile-native lint inventory | `MOBILE_NATIVE_LINT: NOT AVAILABLE` | No applicable lint script, configuration, or dependency; TypeScript is not relabelled as lint |

The first sandboxed admin/mobile-web attempts were blocked before compilation by
restricted parent-config reads. Identical unchanged-source reruns with the
required filesystem access passed. These are environment diagnostics, not
product failures.

### Release performance evidence

The accepted run used `emulator-5554` / `AcademicPhase1Low`, Android 7.0 /
API 24 / x86_64, 720 × 1280 at 320 dpi and font scale 1.0, host OpenGL,
animation scales 1.0, Hermes, Fabric/new architecture, a non-debuggable APK, and
no Metro. The single activity-start sample was ThisTime 630 ms, TotalTime 630
ms, and WaitTime 660 ms; it is not a startup percentile.

Each of five trials produced 120 valid frames (600 aggregate). Aggregate p90
was 18.965375 ms, p95 was 19.595379 ms, and frozen frames were 0. Acceptance
required at least 100 frames per trial, p90 <= 32 ms, p95 <= 50 ms, and no frame
at or above 700 ms. The exact prior size/density/font/animation settings,
pre-existing release artifact, and package state were restored; the benchmark
package and alternate-entry APK were removed, and no ADB reverse was added.
[`performance/release-evidence.json`](../../apps/mobile-native/performance/release-evidence.json)
is the canonical machine-readable record.

The harness measures one activity start and the synthetic 100-record
Announcements feed. Shell, Home, Agenda/Week/Month, personal-exam editor,
selectors, Profile, iOS, physical-device, and fleet timings remain unmeasured.

### Native evidence and platform limitations

[`evidence/phase-11-native`](./evidence/phase-11-native/README.md) indexes the 32
PNG/XML pairs and raw build, package, device, Back, theme-transition, runtime,
integrity, and cleanup records. The native matrix covers 320, 360, 393, 430, and
approximately 853 dp; 100%, 130%, 150%, and 200% font; light/dark; keyboard-open
forms; Agenda/Week/Month and native date/time pickers; Profile/settings and
Google states; destructive reachability; and reduced motion with all three
animation scales at 0.

Ordinary Back returned from feed and Calendar details in their original
processes. Native warm theme switching exposed a stale Android ripple-backed
Button background; the shared Button now remounts its native control by semantic
mode. Final pixel checks record `#4338CA` after the light transition and
`#A5B4FC` after the dark transition.

The final runtime scan found zero fatal/React errors and zero sensitive-value
matches. Cleanup restored physical 720 x 1280, density 320, font scale 1.0, and
the exact original `null` animation settings; removed the ADB reverse;
uninstalled the debug package; verified ports 8081/27017 clear; and shut down
the AVD. The index contains 97 rows and has SHA-256
`AD1F872742FCD8819A25B61CBC8EE22F90234EA03BAA44EB32C96D629F2AA419`.

Windows cannot build/run iOS, VoiceOver, Dynamic Type, bold text, native
swipe-back, Liquid Glass, or Reduce Transparency; full two-platform native
visual acceptance is therefore not claimed. TalkBack is unavailable on the
authorized image, and UIAutomator is not screen-reader traversal. API 24 cannot
prove Android 13 notification permission/channel behavior or modern predictive
Back. The tablet profile is an emulator display override, portrait remains the
declared orientation, and no physical tablet/foldable evidence exists.

No authorized live Google Calendar, FCM, APNs, authenticated backend/content,
production account, provider, calendar, credential, or data was accessed. No
installed authenticated Maestro/Detox/Appium E2E, automated native screenshot
regression, shipped observability, mobile-native lint, or production fleet
performance evidence exists. Phase 12 was not started.
