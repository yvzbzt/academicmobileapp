# Mobile Native Known Issues

Historical baseline date: 29 July 2026. Severity reflects user trust, privacy, data integrity, accessibility, and release risk—not implementation effort.

The baseline tables and dated Phase 1–8 dispositions below are checkpoint evidence. Their present-tense issue wording describes the named historical snapshot and must not be read as the current source state. The **Current Phase 1–8 remediation disposition — 4 August 2026** section at the end is authoritative when an older entry conflicts with it. In particular, Firestore database persistence and the six-tab phone shell are historical only: MongoDB is the sole runtime database and the authenticated phone shell has four destinations.

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

## Phase 5 disposition — adaptive four-destination app shell 31 July 2026

| ID | Phase 5 status | Evidence / remaining boundary |
|---|---|---|
| MN-010 | Further reduced; remains open | The four-tab definition, responsive shell contract, reusable top bar, and navigation behavior are isolated from `App.tsx`. The application monolith still owns substantial feature orchestration, legacy screen JSX, and styles; later screen phases must continue incremental extraction. |
| MN-011 | Phase 5 shell and Android native matrix resolved; legacy screen-body controls remain | Phone primary navigation is exactly Ana Sayfa, Duyurular, Takvim, and Profil. Summer School and the YÖK procedures capability (`YokAnnouncements`) remain nested under Duyurular. Selected state is semantic and non-color-only; shell actions use a 48×48 logical-unit minimum on both platforms. The reviewed [`AcademicPhase1Low` Android 7 / API 24 / x86_64 matrix](./evidence/phase-05-native/README.md) contains 13 PNG/XML pairs: all four 360 dp selected states, 320 dp at font 1.0 and the corrected font 2.0, YÖK ordinary Back, nested re-selection to root, root scroll re-selection to top, and the explicit development-only dark renderer. The filtered log is clean and environment cleanup is verified. Existing legacy controls inside unchanged screen bodies remain later-phase work. |
| MN-012 | Open and unchanged | Phase 5 changes the shell, not feed architecture. Transitional screen bodies still use existing scrolling content; Phase 8 owns long-feed virtualization and was not started. |
| MN-013 | Shell-chrome migration advanced; complete screen migration remains open | The new top bar and primary navigation use semantic light/dark and platform material tokens. Preserved screen bodies still contain hard-coded legacy colors, so whole-screen dark-mode acceptance remains Phase 11. |
| MN-019 | Semantic shell coverage and reviewed native matrix expanded; automated E2E/screenshot harness remains open | Pure and Jest-renderer tests cover the exact map, selected state, material choice, top-bar actions/wrapping, re-selection/root scroll, independent stacks, nested Back, nested Summer/YÖK, and protected destinations. The Phase 5 evidence adds 13 manually reviewed native PNG/XML pairs, but no Maestro/Detox or automated native screenshot regression was added. |
| MN-020 | Open with explicit tooling boundary | `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. TypeScript, tests, whitespace, and sensitive-log scans are separate evidence and are not relabelled as lint. |
| MN-022 | Resolved within the approved protected-route scope | The four tab roots plus nested Summer School, YÖK, settings, and verified detail destinations retain exact allowlisted routing, auth gating, one-shot request handling, owner-bound notification validation, and non-echoing fallback. Broad arbitrary route/query normalization remains intentionally unsupported. |
| MN-024 | Open by supported compatibility decision | Phase 5 verifies ordinary nested Back and tab-history behavior in deterministic tests but does not enable predictive Back. React Navigation's current integration still requires the callback opt-out; API 24 cannot prove predictive callbacks or animation. |
| MN-029 | Phase 5 bottom-navigation 320 dp/font-2 limitation resolved; broader accessibility acceptance remains open | The initial native font-2 capture exposed the default roughly 49 dp bar, an ellipsized `Ana Sayfa`, and label geometry entering the system-navigation area. The shell now uses an 80 dp Android content bar plus the bottom system inset and a 1.20 compact large-text cap while retaining all full accessible names. The final 320 dp/font-2 PNG/XML pair shows all four labels complete, separated, and free of wrapping, clipping, ellipsis, or overlap. TalkBack remains unavailable, the API 24 system clock clips at 200%, and full-screen large-text acceptance remains open. |
| MN-032 | Open evidence limitation, unchanged | Phase 5 preserves screen bodies and still has no authorized authenticated content fixture; shell tests do not prove loading/empty/partial/stale/error content-screen visuals. |
| MN-033 | Open evidence limitation, unchanged | API 24 cannot prove API 26+ channels, API 33 notification permission, predictive Back, iOS build, or provider delivery. Phase 5 shell evidence must not be used to close these gaps. |
| MN-034 | Open evidence limitation, unchanged | No authorized non-production Google/Firebase provider fixture was supplied; live chooser/mutation/revoke/delivery remains unclaimed. |

Phase 5 does not start Phase 6 or redesign Home, Announcements, Calendar, Profile, Summer School, or YÖK content. It adds professional shell presentation, reusable adaptive top chrome, and deliberate navigation behavior while retaining all Phase 1–4 business, trust, integration, and persistence boundaries.

The reviewed [Phase 5 native evidence](./evidence/phase-05-native/README.md) resolves the MN-011 shell/native matrix and the MN-029 bottom-navigation 320 dp/font-2 limitation on Android 7 / API 24 / x86_64. It does not close MN-024 or MN-033 and does not prove Windows/iOS runtime, predictive Back, API 33 notification permission, provider behavior, TalkBack, tablet/rail, OS-controlled dark switching, or full-screen large-text acceptance.

## Phase 6 disposition — authentication and academic onboarding 1 August 2026

| ID | Phase 6 status | Evidence / remaining boundary |
|---|---|---|
| MN-008 | Resolved and regression-protected | The extracted Registration screen and pure validation contract require exactly 10 password characters and a matching confirmation, in parity with the API. Semantic renderer tests distinguish missing, too-short, and mismatched values; no eight-character copy/readiness path remains on the routed Phase 6 surface. |
| MN-009 | Resolved for Phase 6 auth/onboarding surfaces; broader app issue remains | Login, Registration, Verification, all three recovery stages, and Academic Onboarding render persistent field-linked errors plus semantic dismissible feedback instead of depending on the legacy top-of-scroll 3.5-second message pattern. Preserved later-phase content screens still need their own feedback migration and acceptance. |
| MN-010 | Further reduced; remains open | Auth form/presentation ownership is extracted to `AuthScreens.tsx`; validation/cascade/responsive policy is isolated in `auth-ui.ts`; the synthetic evidence surface is separate from production orchestration. `App.tsx` still coordinates the real requests, session ownership, academic data loading, cleanup, and substantial later-phase screen bodies, so the monolith is not claimed closed. |
| MN-013 | Phase 6 surfaces migrated; whole-app acceptance remains open | Extracted auth/onboarding screens use Phase 4 semantic light/dark tokens and primitives. The Android matrix includes explicit light and development-dark rendering, but this is not OS theme-switch acceptance and preserved content screens still own legacy hard-coded presentation pending later phases. |
| MN-016 | Resolved for academic onboarding; legacy profile/settings ownership remains | The onboarding selectors render loading, empty/no-result, error, retry, expanded, and selected states. University/faculty/department changes explicitly clear descendants, and only one complete-replacement `/me/university` payload is saved. Phase 10 still owns final Profile/settings selector presentation. |
| MN-019 | Deterministic and manual native evidence expanded; installed-app E2E/screenshot automation remains open | Focused pure coverage passes 4 files / 112 tests; the extracted screens pass 24 semantic renderer tests; the synthetic preview passes 3 tests; complete native Jest passes 11 suites / 79 tests / 0 snapshots. The reviewed Android evidence contains 20 PNG/XML pairs, but there is still no Maestro/Detox/Appium runner or automated native screenshot-regression workflow. |
| MN-020 | Open with explicit tooling boundary | `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. TypeScript, tests, builds, artifact hashes, whitespace checks, and targeted scans are separate evidence and are not called lint. |
| MN-024 | Open by supported compatibility decision | Phase 6 does not enable predictive Back. The selected React Navigation integration retains `android:enableOnBackInvokedCallback=false`; the sole API 24 AVD cannot demonstrate predictive callbacks or animation. Ordinary route Back and dirty-onboarding confirmation tests are not predictive-Back acceptance. |
| MN-029 | Phase 6 deterministic/Android layout evidence expanded; screen-reader acceptance remains open | Native renderer tests cover a complete registration structure at 320 dp/font scale 2.0. The native matrix adds exact 320 dp Login, IME focus transfer with the keyboard open, complementary 200%-font scroll positions, and labelled UIAutomator hierarchies. TalkBack is unavailable on the authorized API 24 image, UIAutomator is not a screen reader, and no full all-screen large-text acceptance is claimed. |
| MN-032 | Open and unchanged | Phase 6 changes signed-out auth/onboarding presentation, not authenticated content fixtures or content-screen visuals. Synthetic `.invalid` preview data must not be used as authenticated production-content evidence. |
| MN-033 | Open evidence limitation; Android synthetic presentation passes | The API 24/x86_64 `AcademicPhase1Low` matrix proves only native rendering and the documented preview interactions. API 24 cannot prove predictive Back or modern permission/channel behavior. Windows has no Xcode/iOS runtime or simulator, so no iOS build, keyboard, Dynamic Type, VoiceOver, swipe-back, or visual acceptance is claimed. |
| MN-034 | Open evidence limitation | The preview intentionally disables Google and imports no provider module. Deterministic cancellation/unavailable semantics do not prove the real native chooser, account selection, provider failure, or incomplete-Google-profile handoff; those require an authorized non-production client/account fixture. |

Phase 6 native presentation evidence uses only the `__DEV__` plus `EXPO_PUBLIC_PHASE6_AUTH_PREVIEW=1` synthetic surface and `.invalid` identities. Its 20 reviewed 720×1280 PNGs have same-basename UIAutomator XML pairs and are indexed with SHA-256 hashes in [`phase-06-native`](./evidence/phase-06-native/README.md). This evidence does not contact an API or provider and does not close live registration→verification→onboarding→Home, unverified-account recovery, password reset→fresh login, or Google incomplete-profile native E2E.

Final Phase 6 deterministic validation passes focused pure contracts at 4 files / 112 tests, complete native Jest at 11 suites / 79 tests / 0 snapshots, complete API regression at 30 files / 310 tests, and the full root regression at 45 files / 581 tests. Workspace/native TypeScript and admin/mobile web builds pass. Android x86_64 debug assembly passed in 1m32s with 245 tasks (7 executed/238 up-to-date); the 56,804,991-byte debug APK has SHA-256 `72B5EB3EE7AE19777BF1CF1FB6D9E2929EE4C37B0A83076DDA95C2548992F4B7`. Phase 7 is not started.

### Remaining Phase 1 limitations

- `DELETE /me` and `DELETE /me/data` have no backend recent-authentication/reauthentication challenge. The client cannot manufacture this guarantee; add it only with a server contract (MN-026).
- If logout cannot reach the server, the device is cleared but refresh-token revocation remains unconfirmed and is shown as such. This is an honest availability limitation, not silent success.
- At Phase 1 closure, Google-managed events and the OAuth grant still survived disconnect/logout/deletion. Phase 3 supersedes that implementation gap with explicit retain/remove/revoke choices and deletion cleanup; the non-abortable provider prompt, already-accepted remote mutation boundary, and native-provider evidence limitations remain documented under MN-006/MN-034.
- Rate-limit correctness behind a reverse proxy depends on deployment-level trusted-proxy/client-IP configuration, which was intentionally not changed or deployed in Phase 1 (MN-027).
- Recovery response-body equality does not equalize latency, and confirmation is not one transaction across code consumption/password/session/invalidation writes (MN-030/MN-031).
- The Phase 1 snapshot had no React Native component-test runner. Phase 4 supersedes that component gap with Jest Expo + React Native Testing Library; native end-to-end and screenshot-regression harnesses remain absent under MN-019.
- Android native tooling is available and hardware accelerated. Phase 5 supersedes the former bottom-navigation wrapping limitation with the corrected 320 dp/font-2 native recapture. TalkBack and full-screen large-text acceptance remain open under MN-029, including the API 24 system-clock clipping and preserved legacy screen-body/placeholder limitations.
- The selected image's effective 384 MB heap and approximately 5.8 GB data partition exceed the requested approximate 256 MB/maximum 4 GB budget. The prelaunch data request was 2,047 MB, but post-boot `config.ini` normalized it to 6,442,450,944 bytes (MN-028).

## Phase 7 status — historical accepted snapshot

| Issue | Phase 7 result |
|---|---|
| MN-010 | Further reduced: Home presentation and pure policy moved to `src/home`; `App.tsx` still owns orchestration and later legacy screen bodies. |
| MN-012 | Resolved for Home only through one non-nested `FlatList`; the full Announcements feed remains Phase 8 scope. |
| MN-013 | Resolved for Home semantic light/dark presentation; untouched later screens still prevent whole-app acceptance. |
| MN-017 | Manual exam creation remains reachable on Calendar and owner-scoped; edit/delete remains Phase 9. |
| MN-019 | Home gains focused pure/semantic renderer tests and a synthetic native preview; no Maestro/Detox/Appium or automated screenshot regression was added. |
| MN-020 | `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains open; TypeScript, tests, builds, whitespace, and scans are reported separately. |
| MN-029 | Deterministic 320 dp/font-scale-2 Home contract exists. TalkBack and complete installed-app screen-reader acceptance remain unavailable. |
| MN-032 | Phase 7 uses a development-only synthetic trusted fixture for native presentation; no production data or authorized authenticated backend fixture is used. |
| MN-033 | Android API 24 evidence cannot prove API 33 behavior; Windows still cannot provide iOS runtime or VoiceOver acceptance. |

The development preview is dual-gated by `__DEV__` and `EXPO_PUBLIC_PHASE7_HOME_PREVIEW=1`. Its `incomplete`, `populated`, `empty`, `stale`, `error`, and `long-title` scenarios import no API, persistence, provider, or production-data module.

## Phase 8 status — historical 2 August snapshot

| Issue | Phase 8 result / remaining boundary |
|---|---|
| MN-009 | Resolved for the Announcements feed/detail surfaces. Initial error, no-results, stale/partial/offline retained content, pagination failure, share failure, and official-handoff failure use persistent semantic states/banners with fixed non-raw copy and explicit recovery where available. Preserved later-phase screen bodies may still use the legacy global-message pattern. |
| MN-010 | Further reduced; remains open. Feed normalization/state policy moved to `src/announcements/feed-model.ts`; Announcements, detail, and the synthetic preview are extracted presentation boundaries. `App.tsx` still owns request/session orchestration, limit progression, selected-detail memory, and substantial Calendar/Profile legacy JSX. |
| MN-012 | Resolved for the primary Announcements experience. Announcements now owns one full-bleed `FlatList` with stable canonical keys, refresh, controlled incremental loading, footer states, and root scroll-to-top registration. Detail owns a bounded reading `ScrollView`; neither is nested in the navigator's transitional `ScrollView`. This does not redesign later Calendar/Profile collections. |
| MN-013 | Advanced for Phase 8 surfaces; whole-app acceptance remains open. Feed/detail use semantic light/dark tokens and opaque reading surfaces. Eligible iOS Liquid Glass remains navigation/control chrome only. Later legacy screen bodies and complete OS-theme/accessibility acceptance remain Phase 11. |
| MN-014 | Phase 2 resolution is regression-protected at the Phase 8 renderer boundary. Explicit trust, source/scope identity, normalized source/title/summary, safe official authority, and publication/source-update semantics are rechecked; crawl/fetch timestamps and parser/audit fields are not rendered. Any requested detail ID must match a cached trusted item or exact `/announcements/my/trusted/:id` result; direct and notification-origin routes both fail closed. |
| MN-015 | Phase 2 resolution is regression-protected in detail and application handoff. The specific canonical item URL is revalidated against the official institutional authority; unsupported/rejected handoff retains the detail route and returns controlled copy. |
| MN-018 | Phase 2 integrity behavior is preserved. Compatible trusted Summer School announcements enter the unified feed and in-app detail, while requirements/options/dates remain on the existing nested Summer School route. Its refresh still owns the Summer/calendar combination and URL-less data is not coerced into a feed item. |
| MN-019 | Deterministic and manual native evidence expanded; installed-app E2E/screenshot automation remains open. Focused pure coverage passed 3 files / 95 tests; focused feed/detail/preview Jest passed 3 suites / 51 tests / 0 snapshots; complete native Jest passed 16 / 147 / 0. The 20 visually reviewed Android PNG/XML pairs cover the Phase 8 feed/detail matrix. No Maestro/Detox/Appium or automated screenshot-regression runner was introduced. |
| MN-020 | Open with the exact tooling boundary `MOBILE_NATIVE_LINT: NOT AVAILABLE`. TypeScript, tests, builds, whitespace, sensitive-log, credential, and forbidden-modifier scans must be reported separately and never relabelled as lint. |
| MN-021 | Open by scope. Phase 8 adds no analytics or shipped performance telemetry. Raw search text is memory-only and excluded from logs/persistence. The debug-emulator long-feed observation (547 frames, 96.53% janky, p50 26 ms / p90 42 / p95 46 / p99 61) is disclosed evidence only, with no release threshold or production-runtime claim. |
| MN-024 | Open by supported compatibility decision. Ordinary detail-to-feed Android Back passed on API 24 with the same process ID and retained feed state/scroll. Predictive Back remains disabled and API 24 cannot prove API 33+ callbacks/animations. |
| MN-029 | Phase 8 Android compact/large-text presentation passed; screen-reader acceptance remains open. The reviewed density-360 / 320 dp / font-scale-2 dark feed/detail set shows the full long Turkish institution/title, vertical reachability, no horizontal clipping, and a reachable official-source action. `accessibility_enabled=0` and TalkBack was unavailable; UIAutomator is not screen-reader traversal evidence. |
| MN-032 | Phase 8 synthetic content-presentation acceptance passed without production or authenticated backend data. Twenty reviewed 720×1280 PNG/XML pairs cover the required feed/detail states and interactions. The dual-gated harness cannot prove live endpoint/session/source behavior, and no live authenticated fixture or production data is claimed. |
| MN-033 | Android Phase 8 presentation and ordinary Back passed on API 24/x86_64. Windows still cannot build/run iOS or VoiceOver, and API 24 cannot prove predictive Back or modern notification behavior; those platform limitations remain open. |

Phase 8 changes no backend contract, persistence, authentication, notification, Google Calendar lifecycle, provider configuration, or production data. The preview is selected only when both `__DEV__` and `EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW=1` are true and contains only synthetic `preview.edu.tr`/YÖK records. Final validation passed focused root 3 files / 95 tests, focused native 3 / 51 / 0, complete native 16 / 147 / 0, API 30 / 310, and full root 47 / 621 (+1 file / +32 tests over Phase 7), plus both TypeScript checks, admin/mobile builds, Android x86_64 assembly/install, whitespace, and all targeted hygiene scans. The 20 reviewed Android artifact pairs, hashes, runtime-log disclosure, `gfxinfo` observation, and restoration proof are indexed in [`evidence/phase-08-native`](./evidence/phase-08-native/README.md). `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. Phase 9 was not started.

## Current Phase 1–8 remediation disposition — 4 August 2026

This section supersedes conflicting open/current wording above. The accepted Phase 8 baseline is `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`; remediation is Package 1 `641d7bee8a1cd539179769069a22b5c3220e8a6d`, Package 2 `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`, and Package 3 `2e3664546f628a19c6fa929b9ee9469e5322f9a8`.

### Fixed current defects

| Issue/finding | Current disposition | Evidence boundary |
|---|---|---|
| MN-026 | Resolved in Package 1 | Both destructive endpoints require a five-minute owner- and credential-generation-bound server proof created from the account's real password or Google method. A client dialog alone is never authority. |
| MN-027 | Resolved for checked-in topology and code | Only configured trusted-proxy CIDRs may supply forwarding data, and the single-Caddy-hop policy uses the right-most forwarded address. Direct, trusted, multi-hop, and spoofed-header tests pass. A future deployment-topology change requires revalidation. |
| MN-030 | Resolved for the committed practical-work-parity contract | Known, unknown, and cooldown requests retain identical public fields, comparable lookup/hash/repository work, no path-specific synchronous SMTP, a response floor, and bounded asynchronous provider work. This is deterministic application evidence, not an internet-wide statistical timing proof. |
| MN-031 | Resolved | Password replacement, one generation increment, accepted-attempt completion, and password-bound idempotency are one standalone-Mongo user-document compare-and-set. Older access/refresh/recovery material becomes logically invalid at that commit; physical cleanup cannot restore it. |
| MN-014 / MN-015 | Resolved and strengthened in Package 2 | Every outbound hop validates and connects through approved DNS results with strict TLS; parser layout invariants, normalized fingerprints, canonical URLs, source relationships, and native handoff checks fail closed. |
| MN-012 | Resolved for completed Home and primary Announcements surfaces | Both primary content experiences use non-nested virtualized lists with integrated root reselect behavior. Later Calendar/Profile presentation work is not folded into this issue. |
| MN-019 component-test portion | Resolved since Phase 4 and expanded through Package 3 | Jest Expo + React Native Testing Library and pure Vitest contracts cover components, navigation, focus, state restoration, and performance evaluation without snapshots. Installed native E2E and automated screenshot regression remain open separately. |
| Date-only/range correctness (no original MN ID) | Resolved in Package 2 | Date-only and inclusive-range fields survive parser/PDF ingestion, Mongo, trusted DTOs, Home, feed/detail, ICS/Google compatibility, and a Europe/Istanbul API-to-native regression without inventing a time or shifting a day. |
| Automatic notification production (no original MN ID) | Resolved in Package 2 | Eligible trusted ingestion creates/updates durable Mongo jobs; autonomous fenced dispatch, restart/retry, exact pre-send destination validation, stale retirement, health, and controlled shutdown are covered. |
| Phase 5–7 bounded mobile regressions (no original MN ID) | Resolved in Package 3 | Integrated root-list reselect/retention/insets, visible onboarding step 1, actual invalid-email focus, qualified importance, independent recent content, integration-only Home, and offline/partial no-data states are covered. |
| Phase 8 release-performance acceptance | Resolved within the recorded local environment | A production-mode non-debuggable x86_64 release run on API 24 at 720×1280/320 dpi with the host Intel renderer produced 600 frames, p90 `24.928167 ms`, p95 `35.777763 ms`, and zero frames ≥700 ms; APK SHA-256 is `ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`. |

The attempted `initialNumToRender=4`, `maxToRenderPerBatch=3`, `windowSize=3`, `updateCellsBatchingPeriod=75`, and Android clipping experiment worsened the SwiftShader measurement and was fully reverted. The original Phase 8 FlatList settings remain current. The failed environment is retained as evidence and is not presented as a shipped optimization or proven product bottleneck.

### Intentionally deferred implementation/tooling work

| Issue | Current boundary |
|---|---|
| MN-010 | `App.tsx` remains a substantial orchestrator. Only small repair-related extractions were authorized; broad decomposition is later architecture work. |
| MN-013 | Completed Phase 4–8 surfaces use semantic themes, but whole-app dark-mode and accessibility acceptance remains later cross-platform quality work. |
| MN-017 | Owner-safe manual-exam creation is retained. Edit/delete and native date-picker interaction remain Phase 9 and were not started. |
| MN-020 | `MOBILE_NATIVE_LINT: NOT AVAILABLE` remains exact. TypeScript, tests, builds, and scans are not relabelled as lint. |
| MN-021 | The repository has a release measurement harness but no approved shipped analytics/crash/performance telemetry or consent model. |
| MN-024 | Predictive Back remains disabled under the selected navigator compatibility policy. Ordinary Back coverage is not predictive-Back acceptance. |

### Evidence and environment limitations

| Issue | Current boundary |
|---|---|
| MN-019 remaining portion | No Maestro, Detox, or Appium installed authenticated E2E runner and no automated native screenshot-regression workflow. Semantic renderer tests and manually reviewed evidence do not close this. |
| MN-028 | The authorized API 24 AVD's effective heap/data values still exceed the originally requested approximation; the disclosed environment record remains accurate. |
| MN-029 | TalkBack is unavailable on the authorized image. UIAutomator is not screen-reader traversal evidence, and complete all-screen large-text acceptance remains open. |
| MN-032 | Synthetic trusted fixtures cover Phase 7–8 presentation, but no authorized live authenticated backend/content fixture acceptance is claimed. |
| MN-033 | Windows supplies no Xcode/iOS runtime, VoiceOver, or native iOS material/share result. API 24 cannot prove modern notification permission/channels or predictive Back. |
| MN-034 | No authorized non-production Google Calendar/FCM/APNs provider account supplied live chooser, mutation, revoke, or delivery acceptance. |
| Tablet/rail | Deterministic width/rail contracts exist, but no physical or emulator tablet/foldable native acceptance was completed. |
| Release performance | The accepted result is local API 24 emulator evidence using the host Intel renderer. It does not prove iOS, modern physical Android, production-device distributions, or shipped telemetry. |

### Unsupported findings

Raw article bodies, numeric parser-quality scores, a production content reconciliation/migration, Firestore restoration, a new Redis/BullMQ/replica-set requirement, invented Home/feed actions or badges, fake social mechanics, wholesale screen recreation, and a new native E2E framework are not supported by the committed Phase 1–8 contracts and were not implemented.

Phase 9 was not started. Untracked Phase 9–12 planning documents do not constitute implementation.
