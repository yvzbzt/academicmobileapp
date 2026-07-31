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
| MN-032 | Phase 2 content screens lack current native visual acceptance because the authorized QA run had no local authenticated content API fixture; production-data access was prohibited | Current-source APK/Metro launch reached the signed-out Turkish Login surface; content loading/empty/partial/stale/error screens require an authenticated fixture | Rerun Phase 2 content-state visual/accessibility checks when an authorized local fixture is available |

| MN-033 | Phase 3 notification native/provider acceptance is incomplete: the sole authorized Android AVD is API 24, so it cannot exercise API 26+ notification channels or the API 33+ runtime notification-permission prompt; iOS cannot be built on this Windows host and has no authorized `GoogleService-Info.plist` | `AcademicPhase1Low` runtime/API level; `app.json`; native Firebase configuration inventory | Rerun on authorized API 33+ Android and macOS/Xcode iOS targets with non-production Firebase/APNs configuration |
| MN-034 | Real Google account chooser, live Calendar mutation/removal/revoke, and FCM provider delivery have no authorized non-production account/provider fixture; production credentials and data are out of scope | Phase 3 native/provider evidence boundary | Rerun with explicit non-production Google/Firebase credentials and test accounts; do not substitute production access |

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

## Phase 2 disposition — senior re-audit 31 July 2026

| ID | Phase 2 status | Evidence / remaining boundary |
|---|---|---|
| MN-014 | Resolved in ingestion, persistence, API, shared contract, and native presentation | Deep entity decoding/residual removal, exact captured raw-title audit preservation, pagination-prefix handling, strict timestamp provenance, official-source validation, authoritative-time canonical duplicate handling, trusted-only reads, and DTO suppression have deterministic fixtures/tests. Crawl/discovery and arbitrary title dates are never generic publication fallbacks. |
| MN-015 | Resolved in code and automated tests | Native handoff revalidates credential-free official HTTP/HTTPS URLs, rejects private/unsafe targets, checks device support, catches `Linking` failures, and reports controlled feedback. |
| MN-016 | Content-state portion resolved | Content loading, error, empty/no-results, partial, stale, retained-after-error, and retry states are explicit. Fresh cached items cannot hide persisted degraded/failed source state, including YÖK and Summer School. Phase 10 still owns the broader selector visual redesign. |
| MN-018 | Content-integrity portion resolved | Summer refresh reloads both the Summer response and visible calendar ownership; URL-less records are non-pressable and explicitly say no official link is available. Phase 8/9 still own later visual/feed work. |
| MN-032 | Open evidence limitation | The initial Phase 2 APK built, installed, loaded its Metro bundle, settled hydration, and exposed labelled Turkish login controls without a fatal React/native error. The senior-hardening source reassembled successfully but was not relaunched because no emulator was attached. No authorized local authenticated content fixture existed, and production access was prohibited, so no content-screen visual or screen-reader acceptance is claimed. |

### Remaining Phase 2 limitations

- No database, including production, was accessed or reconciled. The command was verified through pure planning tests, direct executable apply-helper conflict tests, runtime catalog/YÖK authority tests, and a controlled invalid-argument/no-database smoke.
- Reconciliation is optimistic per document, not transactional. An apply can partially complete before a conflict; create and verify a backup, use an authorized non-production clone first, treat exit code 2 as partial/conflicted, rerun dry-run, and repeat until zero mutations.
- Exact database-name confirmation prevents accidental name mismatch but does not prove an environment is non-production.
- Existing array announcement endpoints remain for compatibility. The native app uses additive trusted collection envelopes; direct controller/service tests verify the envelope, but no live deployed Nest/Mongo endpoint was contacted.
- Native compatibility parsing tolerates an absent additive `officialSourceUrl`; the API's explicit trusted source record remains the authority and always emits it in the trusted DTO.
- Pure native helper/source-wiring tests cover entity decoding, timestamp labels, URL containment, partial/stale/error behavior, Summer refresh ownership, and URL-less cards. They are not rendered content-component or screen-reader evidence; MN-019 and MN-032 remain visible.
- `VISIBLE_NATIVE_QA_ENVIRONMENT_BLOCKED`: the initial Phase 2 app launched on `AcademicPhase1Low`; the senior-hardening source passed native assembly but was not relaunched because no emulator was attached. Representative authenticated loading/empty/partial/stale/error content screens still cannot be reached without an authorized local API/session fixture. Production data and credentials were not used.

The 31 July senior re-audit closed implementation/evidence gaps for compound pagination, residual entities, arbitrary title-date inference, exact raw-title retention, persisted source health, generic fallback dispatch, and missing/untrusted-source reconciliation. MN-032 remains an evidence limitation, not a claim of authenticated content-screen visual acceptance.

## Phase 3 disposition — final validation 31 July 2026

| ID | Phase 3 status | Evidence / remaining boundary |
|---|---|---|
| MN-006 | Resolved in implementation and deterministic contract tests; provider-native acceptance remains MN-034 | Google state is now `disconnected`, `checking`, `connected`, `expired`, `syncing`, `partial`, or `error`. Restore requires a live account/token plus Calendar API verification. Sync preflight precedes authorization; complete source families alone may delete; capped collection omissions are reconciled through exact trusted-record endpoints before deletion; mappings are owner-scoped and reverified. Account change offers keep/remove/cancel. Ordinary disconnect/revoke retains a disconnected ledger for later same-account cleanup; choosing keep during account switch intentionally abandons the old-account ledger and requires reconnecting that account for later removal. Logout retains remote events/grant by policy, while data/account deletion attempts ledger-known managed-event removal followed by revoke and reports retryable cleanup targets. Personal events are not mutation candidates. |
| MN-007 | Resolved in implementation and deterministic API/native-helper tests; OS/provider acceptance remains MN-033/MN-034 | Preferences default disabled. Explicit enablement requests OS permission, obtains an FCM token, registers the hashed installation, and reports active only when permission and backend registration both succeed. Rotation, disable/detach, app-resume revocation reconciliation, provider failure, invalid-token disablement, account cleanup, generic provider-visible text, atomic worker claims, pre-send registration revalidation, and token-free audit/response contracts are represented. |
| MN-022 | Notification handoff portion resolved; general navigation/deep-link architecture remains Phase 5 | The declared scheme now accepts only the strict versioned notification destination contract. It owner-binds pending signed-out taps and revalidates one exact trusted record after authentication. API 24 native smoke accepted the complete strict URI and created the encrypted pending-destination key while keeping Login/Register visible. This is not a general route tree or broad deep-link implementation. |
| MN-023 | Resolved by explicit non-product retention boundary and README reconciliation | `src/native-calendar` remains pure dormant reference code. It is not imported by `App.tsx`, has no platform calendar dependency/adapter, requests no permission, exposes no UI, and performs no runtime sync. |
| MN-033 | Open evidence limitation; Android build/launch/handoff passed | The New Architecture x86_64 debug APK built, installed, launched on API 24, rendered Login/Register, accepted the complete strict notification URI, and stored its signed-out target without a fatal log match. API 24 still cannot demonstrate Android notification channels or the Android 13+ runtime prompt. Windows has no Xcode/iOS simulator, the repository has no authorized iOS `GoogleService-Info.plist`, and no authorized non-production APNs/FCM delivery path was exercised. |
| MN-034 | Open evidence limitation | Deterministic Google lifecycle/REST tests do not prove the native chooser or real remote mutation/revoke. Those require an authorized non-production Google account, Calendar content fixture, and provider configuration; none was used in this phase snapshot. |

Final Phase 3 validation passed: focused integration tests 10 files / 155 tests, complete API tests 30 / 310, full regression 41 / 495, workspace and native TypeScript, admin/mobile web builds, New Architecture Android x86_64 assembly, API 24 install/launch/strict signed-out handoff, whitespace checks, and the added-line sensitive-log scan. The remaining MN-033/MN-034 rows are exact OS/provider/account evidence limitations, not unreported implementation failures.

## Phase 4 disposition — routed adaptive foundation 31 July 2026

| ID | Phase 4 status | Evidence / remaining boundary |
|---|---|---|
| MN-009 | Partially resolved; remains open | New `Banner`/`Toast` primitives provide semantic feedback and announcement behavior, but the preserved screen body still uses the legacy top-of-scroll 3.5-second global-message pattern. Phase 6 and later screen migrations own placement and duration acceptance. |
| MN-010 | Partially resolved; remains open | Route graph, pure route policies, one request hook, semantic design-system modules, test fixtures, and a transitional `Section` component are extracted. Existing auth/content/notification/Google/session modules remain focused service/domain boundaries. `App.tsx` still owns substantial orchestration, screen JSX, and legacy styles; later screen phases must continue extraction rather than claiming the monolith is closed. |
| MN-011 | Navigation portion resolved; legacy controls remain | The hand-rolled six-button/9 dp bar is replaced by four React Navigation destinations with semantic labels and platform-adaptive bottom/rail chrome. New primitives enforce 44 pt iOS / 48 dp Android targets. Pre-foundation screen-body controls, including legacy compact icon styles, remain for later migration. |
| MN-012 | Open | Phase 4 intentionally preserves screen bodies. The main feed still lives inside transitional scrolling content; Phase 8 owns virtualization and is not started. |
| MN-013 | Foundation resolved; screen migration remains open | Automatic system appearance, semantic light/dark tokens, reduced-motion/transparency hooks, and adaptive surfaces exist and new route/primitive code uses them. The unchanged `App.tsx` body retains hard-coded light colors, so complete dark-screen acceptance remains Phase 11. |
| MN-019 | Native component-stack portion resolved; flow/screenshot harness remains open | One Jest Expo + React Native Testing Library stack runs semantic primitive, sheet/selector, preview, surface, fixture-provider, and real-navigator tests. A reviewed manual Android primitive matrix exists, but Maestro/Detox and automated native screenshot regression remain absent and are not claimed. |
| MN-020 | Open with explicit tooling boundary | `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. No lint script/config/dependency was invented; TypeScript, tests, whitespace, and targeted scans are reported separately. |
| MN-022 | Approved Phase 4 route scope resolved | The strict Phase 3 notification URL remains owner/exact-record guarded. Exact static tab, Summer School, YÖK, and settings URLs now resolve through the live navigator; protected routes wait for authentication and malformed/unapproved destinations reach a non-echoing fallback. Arbitrary routes and query variants intentionally remain rejected. |
| MN-024 | Open by supported compatibility decision | React Navigation 7 currently requires `android:enableOnBackInvokedCallback=false`; app config retains `predictiveBackGestureEnabled:false`. Ordinary Android system Back, nested stack Back, and tab history are tested. API 24 cannot prove predictive callbacks/animation; enablement waits for upstream support and API 33+ Phase 11 evidence. |
| MN-029 | Old six-tab label defect removed; full large-text acceptance remains open | Native tabs no longer use 9 dp labels. Deterministic 320 dp/2.0 font-scale fixtures exist. A development-preview observation at temporary 320 dp/font 2.0 wrapped application copy vertically without horizontal clipping, but the API 24 system clock clipped; Phase 4 does not claim a complete authenticated large-text or screen-reader native matrix. |
| MN-032 | Open evidence limitation | Route and primitive rendering tests do not provide authenticated content-state visual acceptance; no production data was accessed. |
| MN-033 | Open evidence limitation | Phase 4 does not change the API 24 inability to prove API 26+ channels, API 33+ notification permission, predictive callbacks, iOS build, or provider delivery. |
| MN-034 | Open evidence limitation | No authorized non-production Google/Firebase provider fixture was supplied; live chooser/mutation/revoke/delivery remains unclaimed. |

Phase 5 was not started: no LinkedIn-inspired feed, wholesale screen redesign, or later-phase shell styling was implemented. Phase 4 changes only mechanics, semantic foundation, shared primitives, transitional route-specific settings ownership, and their tests.

### Remaining Phase 1 limitations

- `DELETE /me` and `DELETE /me/data` have no backend recent-authentication/reauthentication challenge. The client cannot manufacture this guarantee; add it only with a server contract (MN-026).
- If logout cannot reach the server, the device is cleared but refresh-token revocation remains unconfirmed and is shown as such. This is an honest availability limitation, not silent success.
- At Phase 1 closure, Google-managed events and the OAuth grant still survived disconnect/logout/deletion. Phase 3 supersedes that implementation gap with explicit retain/remove/revoke choices and deletion cleanup; the non-abortable provider prompt, already-accepted remote mutation boundary, and native-provider evidence limitations remain documented under MN-006/MN-034.
- Rate-limit correctness behind a reverse proxy depends on deployment-level trusted-proxy/client-IP configuration, which was intentionally not changed or deployed in Phase 1 (MN-027).
- Recovery response-body equality does not equalize latency, and confirmation is not one transaction across code consumption/password/session/invalidation writes (MN-030/MN-031).
- The Phase 1 snapshot had no React Native component-test runner. Phase 4 supersedes that component gap with Jest Expo + React Native Testing Library; native end-to-end and screenshot-regression harnesses remain absent under MN-019.
- Android native tooling is available and hardware accelerated. Required flow/width/font evidence passes; the 2.0 navigation/placeholder wrapping and exact TalkBack unavailability remain disclosed under MN-029.
- The selected image's effective 384 MB heap and approximately 5.8 GB data partition exceed the requested approximate 256 MB/maximum 4 GB budget. The prelaunch data request was 2,047 MB, but post-boot `config.ini` normalized it to 6,442,450,944 bytes (MN-028).
