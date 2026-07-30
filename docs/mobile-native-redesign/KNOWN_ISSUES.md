# Mobile Native Known Issues

Baseline date: 29 July 2026. Severity reflects user trust, privacy, data integrity, accessibility, and release risk—not implementation effort.

## P0 — trust, account ownership, or destructive-integrity risk

| ID | Issue | Evidence | Intended owner |
|---|---|---|---|
| MN-001 | Logout/session-expiry cleanup leaves manual exams, academic fields, credentials/caches, and potentially Google identity across app accounts | `App.tsx:978–985`, `1358–1420`; activity report sections 6–7 | Phase 1 |
| MN-002 | In-flight refresh/content/Google operations are not account-generation owned and may complete after logout/deletion/switching | `App.tsx:987–1018`, `1569–1574`, `1613`, `1654`, `1739–1835` | Phase 1 |
| MN-003 | Verification immediately creates a refresh session; leaving profile confirmation discards its client handle without revocation | `App.tsx:1279–1356` plus auth session creation | Phase 1 |
| MN-004 | “Resend code” repeats registration rather than using the existing resend endpoint | `App.tsx:1237–1277`; `auth.controller.ts:21–24` | Phase 1 |
| MN-005 | Changing university/faculty clears children locally but current partial repository updates retain stale server faculty/department IDs | `App.tsx:1538–1623`; auth repositories' academic-selection updates | Phase 1/API contract fix |
| MN-006 | Google-managed events and OAuth grant survive logout, data deletion, account deletion, and account change; no disconnect/remove-all flow. Native authorization cannot be force-aborted, and cancellation cannot roll back mutations already accepted by Google. | Google integration in `App.tsx`; `google-calendar-sync.ts` | Phase 3 |
| MN-007 | Notification UI claims enabled preferences without OS permission, push-token acquisition, device registration, or local scheduling | `App.tsx:1710–1715`, `1853–1900`; native dependencies | Phase 3 |
| MN-026 | Account and personal-data deletion have no backend recent-authentication/reauthentication proof | `DELETE /me`, `DELETE /me/data`; no challenge/token field in the API contract | Backend security contract before release |
| MN-031 | Password reset atomically consumes only the recovery record; password update, refresh-session revocation, and remaining-record invalidation are separate writes, so a later failure can leave partial completion | `auth-application.service.ts:207–220`; repository consume implementations | Backend transaction/saga or idempotent reconciliation before release |

## P1 — broken primary flow, accessibility, or content-trust risk

| ID | Issue | Evidence | Intended owner |
|---|---|---|---|
| MN-008 | Registration says eight password characters while API requires ten; client readiness has no length check | `App.tsx:2053–2059`; `auth.dto.ts:12–14` | Phase 1/6 |
| MN-009 | Auth/verification errors can be mislabeled as session expiry; most lower-page results appear in a top banner that disappears after 3.5 seconds | `App.tsx:829–833`, error mapper, `1968–1972` | Phase 1/4/6 |
| MN-010 | One 4,224-line component owns routes, state, API calls, persistence, content rendering, and 1,199 lines of styles | `apps/mobile-native/App.tsx` | Phases 1–5, incremental extraction only |
| MN-011 | Six bottom destinations produce 9 dp labels; current `iconButton` is 38×38; accessibility target sizes are not systematic | `App.tsx:4167–4175`, `4185–4223` | Phase 4/5 |
| MN-012 | Main and horizontal feeds use `ScrollView`; no `FlatList`/`SectionList` exists | `App.tsx:1956–1959`, `2654`, imports | Phase 4/8 |
| MN-013 | App is forced light and uses hard-coded colors; no semantic tokens, dark mode, Reduce Motion, or Reduce Transparency behavior | `app.json`; `StyleSheet.create` in `App.tsx` | Phase 4/11 |
| MN-014 | Content can expose raw HTML entities, ambiguous crawler timestamps, or source URLs without a centralized trust/sanitization presentation contract | current announcement rendering and source-derived audit | Phase 2 |
| MN-015 | External link handler has no exception guard; server/crawler URLs need scheme allowlisting before UI handoff | `App.tsx:1902–1924` | Phase 2 |
| MN-016 | Faculty/department load errors are held in state but not rendered; selectors have no no-results state | `App.tsx:1516–1535`, `2862–2912` | Phase 2/10 |
| MN-017 | Manual exams are device-global, restoration can race an initial empty write, and records cannot be edited/deleted | `App.tsx:825–827`, `926–936`, `1928–1950` | Phase 1/9 |
| MN-018 | Summer refresh does not refresh the calendar state used for visible Summer dates; URL-less cards remain pressable no-ops | `App.tsx:735–737`, `1697–1708`, `2531–2590` | Phase 2/8/9 |
| MN-027 | Auth rate limiting keys by the request IP exposed to Nest; correct per-client identity behind Cloud Run or another reverse proxy depends on an explicitly trusted proxy configuration | `rate-limit.guard.ts`; deployment proxy configuration is outside this no-infrastructure phase | Deployment security gate |
| MN-030 | Password-recovery production status/body fields match for known and unknown addresses, but request latency is not equalized; eligible known requests can await persistence and SMTP, allowing timing-based account inference | `auth-application.service.ts:144–175`; no latency equalization | Backend security hardening before release |

## P2 — maintainability, test, and evidence gaps

| ID | Issue | Evidence | Intended owner |
|---|---|---|---|
| MN-019 | No native unit/component test script, React Native Testing Library, Maestro, Detox, Storybook, or screenshot harness | `apps/mobile-native/package.json`; repository test inventory | Phase 4 |
| MN-020 | `MOBILE_NATIVE_LINT: NOT AVAILABLE`: no root/native lint script, applicable ESLint dependency, or lint configuration exists | root and `apps/mobile-native` package scripts/config inventory | Phase 4 or repository tooling decision |
| MN-021 | No analytics/page-view/crash/performance instrumentation exists | native dependencies and `App.tsx` | Separate approved observability scope |
| MN-022 | Declared `academicpulse` URL scheme has no deep-link listener/route handling | `app.json`; `App.tsx` | Phase 5 |
| MN-023 | Dormant `src/native-calendar` subsystem is not wired into `App` and its platform dependency is absent; README claims device-token registration that native code does not perform | native source/package/README | Phase 3 documentation/code reconciliation |
| MN-024 | Android predictive back is explicitly disabled | `app.json` | Phase 5/11 after navigator implementation |
| MN-025 | Phase 0 had no native launch target; Phase 1 now has an accelerated Android AVD, current-source build/install, required flow evidence, and the complete 200%-font surface set | official Studio/SDK/AVD evidence and native-QA register | Resolved in Phase 1 closure |
| MN-028 | The final API 24 Google APIs image/emulator overrides the requested 256 MB heap / 2,047 MB data: post-boot config is 256 MB / 6,442,450,944-byte data and runtime is 384 MB / approximately 5.8 GB `/data` | prelaunch request, post-boot `config.ini`, `getprop dalvik.vm.heapsize`, and `df -h /data`; API 36/34/30/28 attempts also exceeded the budget | Phase 1 closure environment limitation |
| MN-029 | Required Android flows and 360/320/full six-surface 200%-font evidence pass; Home nav labels wrap/truncate at 2.0 and TalkBack is unavailable with an exact blocker record, so no screen-reader acceptance is claimed | `evidence/phase-01-native/native-qa-results.md`; `evidence/phase-01-native/talkback-blocker.md` | Large-font navigation presentation: Phase 4/5; TalkBack rerun when an image/service is available |

## Baseline disposition

Phase 0 documents these issues but repairs none. Later phase reports must reference issue IDs, add regression evidence, and close an issue only when behavior and required native evidence both pass.

## Phase 1 disposition — 29 July 2026

| ID | Phase 1 status | Evidence / remaining boundary |
|---|---|---|
| MN-001 | Required logout path resolved; failure-injection evidence remains automated | Logout/account deletion must first durably overwrite `native_session` with a tombstone. Only then is the account generation invalidated and UI state cleared. Native logout removed content immediately, after five seconds, and after relaunch. A native SecureStore tombstone-failure injection was not run; automated failure/retry tests cover it. |
| MN-002 | Resolved in code and automated tests | `AccountGenerationGuard`, registered `AbortController`s, stale settlement checks, a serialized storage queue, cleanup lock, tracked-mutation barrier, bounded requests, and Google sync signal propagation reject late refresh/content/preference/Google settlement. |
| MN-003 | Resolved | `/auth/verify-email` no longer triggers Login inside the verification handler. Verification success is shown first; session creation occurs only in the later login action. Relaunch recovery never stores the password. |
| MN-004 | Resolved | Native resend uses `POST /auth/resend-verification-code`; expiry/cooldown are retained and rendered. Client contract and API success/cooldown tests cover it. |
| MN-005 | Resolved in all adapters | Mongo uses `$unset`; Firestore uses field-level updates with explicit deletes; in-memory replaces the current map value without omitted descendants. Repository tests cover university and faculty changes; service tests retain parent-child validation. |
| MN-008 | Resolved | Native and API import/export a tested 10-character minimum contract; registration copy/readiness match and both password fields have a 48-unit labelled visibility control. |
| MN-009 | Partially resolved | Auth errors now use endpoint-aware controlled codes and never surface raw payloads. The existing top-of-scroll, 3.5-second global-message pattern remains for broader Phase 4/6 feedback redesign. |
| MN-017 | Integrity portion resolved | Manual exams use owner-bound v2 keys/envelopes; persistence starts only after owner hydration; owner-unknown legacy content is discarded. Edit/delete product functionality remains Phase 9. |
| MN-025 | Resolved | Official Studio Stable, Emulator 36.6.11, API 24 Google APIs x86_64, WHPX, and exactly one `AcademicPhase1Low` AVD exist. Build/install/startup, signed-out/in hydration, auth/recovery, isolation, hierarchy, logout, 360/320, and the six-surface 200%-font checks pass. |
| MN-028 | Disclosed selected-image limitation | The AVD stays within the hard two-core/1,536 MB RAM limit and renders at 720 × 1280/320 dpi. API 24 normalizes the requested 2,047 MB data to 6,442,450,944 bytes and reports a 384 MB heap/~5.8 GB `/data`; API36/34/30/28 were no better. This does not independently block closure under the selected-image exception, but remains visible evidence. |
| MN-029 | Required evidence complete with disclosed limitations | Native verification-success→later-Login-failure, distinct unverified/invalid/session outcomes, unknown recovery presentation, recovery visibility/Back/Cancel, and two-session revocation are evidenced. The six-surface 200% set remains reachable, but Home nav labels wrap/truncate and recovery password placeholders truncate. TalkBack is exactly unavailable, satisfying the “tested or blocker documented” rule without claiming screen-reader acceptance. |
| MN-026 | Open backend gap | Phase 1 documents the missing recent-auth contract; it cannot create a trustworthy client-only substitute. |
| MN-027 | Open deployment gap | Controlled 429 responses are implemented, but proxy trust/client-IP behavior must be verified in the deployment environment before rate-limit isolation is accepted. |
| MN-030 | Open backend timing gap | Production response status/body fields are equal and tested, but latency parity is neither implemented nor claimed. Treat timing-based recovery enumeration as unresolved. |
| MN-031 | Open backend atomicity gap | Conditional code consumption is atomic per adapter; password replacement, all-session revocation, and remaining-record invalidation are not one transaction. A failed later write needs reconciliation. |

### Password-recovery closure disposition

The previously absent forgot/reset-password activity is now implemented across API, persistence adapters, sender, contracts, native screens, and tests. Production status/body fields are equal for valid known/unknown email requests, the six-digit code is expiring/single-use/digest-only, older active material is invalidated, password parity and confirmation are enforced, and a fully successful reset revokes refresh sessions. Login now exposes `Şifremi unuttum`; the native flow includes request, confirm, resend, independent visibility controls, validation, controlled errors, loading, Back, cancel, success, and secret cleanup. MN-030 and MN-031 preserve the timing and multi-write partial-failure boundaries.

Implementation-stage evidence passed 24/24 focused API/schema tests, 9/9 password-recovery tests, 2 files/42 focused native tests, and both workspace/native TypeScript checks. The installed emulator and same-runtime session proof then covered known/unknown presentation, invalid/resend/visibility/Back/Cancel/reset/success/old-new Login, and revocation of two held refresh sessions. Server-expired verification/recovery branches remain deterministic seeded evidence where runtime time injection is unavailable. MN-029 retains only the 2.0 wrapping limitations and exact TalkBack unavailability; no screen-reader acceptance is claimed.

### Phase 1 Task A1 security-remediation disposition — 30 July 2026

Task A1 adds a backward-compatible `credentialGeneration` substrate to user, refresh-token, and password-recovery records. Missing legacy values read as `0`; new users initialize `0`; and newly issued refresh and recovery records copy the user's current generation. Firestore existing-user writers now use field updates plus explicit deletions, Mongo user updates remain partial and strip general attempts to write the generation, and in-memory mutations use the current map entry synchronously. These changes protect a newer stored generation from profile, academic, verification, Google-identity, admin, password, clear-data, and deletion-related stale writers while retaining academic descendant clearing.

This checkpoint deliberately does not increment or enforce the generation, change access JWTs, or make password reset atomic. MN-031 therefore remains open with the same consume-before-password/session/invalidation order. MN-030 also remains open: known and unknown requests still have unequal work and SMTP timing. No production migration, index, environment, Task B, native application, or Phase 2 change is part of A1.

### Phase 1 R1A MongoDB-runtime disposition — 30 July 2026

All seven API repository tokens now bind directly to Mongo classes. The API no longer reads `REPOSITORY_MODE`, cannot select Firestore or in-memory persistence through legacy selector values, requires `MONGODB_URI` for every startup, always reports Mongo readiness, and uses only the generic catalog bootstrap path.

Firestore and in-memory adapters remain in the source tree but are unreachable from runtime composition; their physical removal or test-only relocation remains R1C. At the R1A checkpoint, R1B still owned repository behavior reconciliation and user-data review; the disposition below records that scoped follow-up. R1A ran no migration and accessed no production data. Firebase Authentication, Google Sign-In/OAuth, FCM, Hosting, and their required Firebase dependencies remain unchanged, as do A1 generation behavior and all Task A2/Task B boundaries.

### Phase 1 R1B Mongo user-data disposition — 30 July 2026

Academic-unit suggestions and followed academic scopes are no longer authoritative process-local arrays. A focused repository contract now delegates both families to Mongo, preserves the existing suggestion review and academic-scope behavior, and makes repeated follows for the same owner and normalized scope idempotent. The seven R1A runtime repository bindings remain Mongo-only; R1B adds the focused Mongo user-data binding without restoring a runtime selector.

Personal-data clearing, self-account deletion whether or not the caller requests the broader data-clearing branch, and administrative account deletion now remove both user-data families. Another owner's suggestions and follows are preserved by owner-scoped deletion. The former arrays were ephemeral and provide no trustworthy migration source, so no migration was designed or run and no production data was accessed.

R1B's deterministic behavior evidence uses Mongoose model doubles and a test-only repository fixture. A separate focused integration case uses the existing local/CI Mongo 7 service and a guarded PID-named database to prove real schema/index initialization, suggestion create/read, concurrent follow idempotency, stored private-key behavior, and cleanup; it drops only that test database before and after the case. This is not a live-daemon reconnect, API-process restart, or durable-disk persistence smoke. Firestore adapter/config/test/document removal remains R1C; Mongo reconnect and full live persistence smoke verification remains R1D. No deployment, production-data access, dependency/lockfile, native application, Task A2, Task B, Phase 2, or UI change is included.

### Phase 1 R1C1 Firestore-removal disposition — 30 July 2026

R1C1 supersedes the R1A/R1B statements that Firestore database adapters remain in the source tree. The API database service, shared database utilities, and all seven Firestore repository implementations are deleted. A recursive production-source test and the required external static scan find no Firestore database persistence import, filename, service, or repository. All seven runtime repository tokens still resolve directly to Mongo, and R1B suggestions/followed scopes remain Mongo-backed.

Exactly eleven adapter-only test executions were removed: one academic descendant-clearing case, one legacy-generation/admin-update case, and nine stale-writer rows covering verification, Google identity, admin, profile, password, academic selection, personal-data clearing, admin deletion, and account deletion. The shared rules remain covered by strengthened Mongo academic field-operator assertions, Mongo legacy normalization, nine one-for-one Mongo stale-writer cases, and existing in-memory contract cases. Two retained-service module-resolution cases keep the suite at 32 files / 299 tests.

Firebase Authentication, Google Sign-In/OAuth, FCM, Hosting, `FirebaseAdminService`, `firebase`, `firebase-admin`, and their configuration remain supported. Package files are intentionally unchanged; retained Firebase dependencies may continue to bring Firestore-related transitive packages without exposing a runtime database adapter. No migration, deployment, publish, push, or production-data access occurred. R1C2 still owns relocation of runtime-unreachable in-memory repositories, and R1D still owns reconnect/durable Mongo verification. A2, Task B, Phase 2, and UI work remain unstarted.

### Remaining Phase 1 limitations

- `DELETE /me` and `DELETE /me/data` have no backend recent-authentication/reauthentication challenge. The client cannot manufacture this guarantee; add it only with a server contract (MN-026).
- If logout cannot reach the server, the device is cleared but refresh-token revocation remains unconfirmed and is shown as such. This is an honest availability limitation, not silent success.
- Google-managed events and the OAuth grant still survive disconnect/logout/deletion. The native authorization prompt is not force-abortable, and Google mutations accepted before cancellation may be partial. Account-isolation settlement races are guarded here; remote cleanup/revoke/reconciliation UX remains MN-006 / Phase 3.
- Rate-limit correctness behind a reverse proxy depends on deployment-level trusted-proxy/client-IP configuration, which was intentionally not changed or deployed in Phase 1 (MN-027).
- Recovery response-body equality does not equalize latency, and confirmation is not one transaction across code consumption/password/session/invalidation writes (MN-030/MN-031).
- No React Native component-test runner or native flow harness is installed. Pure helper/source-contract/API tests pass, but semantic rendered-flow automation remains MN-019 / Phase 4.
- Android native tooling is available and hardware accelerated. Required flow/width/font evidence passes; the 2.0 navigation/placeholder wrapping and exact TalkBack unavailability remain disclosed under MN-029.
- The selected image's effective 384 MB heap and approximately 5.8 GB data partition exceed the requested approximate 256 MB/maximum 4 GB budget. The prelaunch data request was 2,047 MB, but post-boot `config.ini` normalized it to 6,442,450,944 bytes (MN-028).
