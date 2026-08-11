# Phase 01 — Authentication, Session, Storage, and Academic-Profile Integrity

Status date: 2026-08-07\
Status: Reconciled current through Final Correctness Repair 1 and the accepted Phase 2–12 descendants. The runtime remains MongoDB-only; the original Phase 1 milestone and evidence ledger are preserved below as historical provenance.

## Reconciled current state — 2026-08-04

The accepted Phase 8 baseline `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9` was repaired by `641d7bee8a1cd539179769069a22b5c3220e8a6d` (`fix(auth): close phase-one security gaps`). The later Phase 2 and Phase 3 repair commits are linear descendants and do not reopen these security decisions.

**Phase 12 provenance correction — 2026-08-06.** The final direct Phase 1 blocker repair is `1dd36d1811949ba3ff166e982a8b72bda014c5ef` (`fix(api): close recent-auth and outbound-network gaps`). It completes the purpose-specific, digest-only, single-use recent-authentication boundary described here, including atomic consumption and the corresponding API/native contract coverage. The earlier `641d7bee8a1cd539179769069a22b5c3220e8a6d` repair remains part of the accepted lineage rather than being superseded or rewritten.

**Final Correctness Repair 1 boundary — 2026-08-07.** The trusted-proxy contract now makes every accepted IPv6 prefix enforceable instead of treating only `/128` as matchable. This scoped correction leaves the accepted Phase 1 authentication, session, generation, recovery, recent-authentication, storage, and Mongo-only decisions unchanged.

- Missing legacy credential generations still normalize to `0`. Access tokens, refresh records, and password-recovery records carry the current generation; protected access, refresh rotation, and recovery confirmation all reject a stale generation.
- Password reset now uses a standalone-Mongo-compatible compare-and-set on the user document. The accepted token hash, expected generation, new password hash, completion operation key, and one-step generation advance form the durable security boundary. Hash failure performs no write; concurrent records cannot both commit; a response-loss retry with the same operation is deterministic; a different proposed password is not reported as a success. Generation advancement immediately invalidates older credentials even if best-effort physical cleanup later fails.
- `POST /auth/recent-authentication` verifies the account's actual password or a fresh Google ID token and issues a five-minute proof bound to the owner, current credential generation, one explicit deletion purpose, and a cryptographically random `jti`. Mongo stores only the `jti` digest with owner/generation/purpose and creation/expiry/consumption times. `RecentAuthGuard` atomically consumes that record before `DELETE /me/data` or `DELETE /me` can run, so a proof is single-use, cannot cross endpoints, and admits only one concurrent request. The native destructive flows request a new purpose-specific proof for each operation instead of treating a client confirmation dialog as authentication. Because consumption precedes controller work, a later deletion failure leaves the proof consumed and the retry requires fresh reauthentication.
- Password-recovery request responses now have the same production status and public fields for known, unknown, and cooldown cases. Each path performs comparable token, hash, lookup, and timing work; production applies a 350 ms public response floor. Eligible email delivery is scheduled asynchronously without being awaited by the public response, is wrapped by a 12-second delivery timeout, and uses bounded SMTP connection/greeting/socket timeouts.
- Client IP resolution trusts only explicit `TRUSTED_PROXY_CIDRS`. IPv4 behavior remains unchanged; IPv6 addresses and configured networks are normalized to 16 bytes and prefix-masked for every `/0` through `/128` boundary, including compressed/expanded and hexadecimal-case equivalents. IPv4-mapped IPv6 socket spellings resolve to normalized IPv4 client identity while trust matching accepts either the corresponding IPv4 CIDR or mapped-IPv6 CIDR. Invalid addresses, scoped addresses, and prefixes outside the family boundary fail environment validation, so configuration cannot silently accept an unenforceable range. The checked-in Hetzner/Caddy topology still declares exactly one trusted proxy hop, uses only the right-most forwarded client value from that trusted peer, and ignores spoofed forwarding headers received directly or from an untrusted peer. A duplicate header field or any malformed/empty chain entry fails closed to the direct socket peer rather than partially accepting the chain.
- The legacy mobile-web Firebase `AIza...` fallback is removed. Firebase web configuration is environment-only and fails clearly without printing the key.
- Firestore persistence remains removed from runtime composition. No Redis, BullMQ, Mongo replica-set requirement, production migration, deployment, or production-data access was introduced by the repair.

### Current provenance

| Scope | Commit | Reconciled meaning |
|---|---|---|
| Historical final Phase 1 checkpoint | `18a93d4ecca5ef810ccd4f6f208cdb2774638afb` | Original Phase 1/R1C1 milestone retained below |
| Accepted Phase 8 baseline | `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9` | Starting point for the bounded remediation |
| Phase 1 security repair | `641d7bee8a1cd539179769069a22b5c3220e8a6d` | Generation enforcement, reset CAS/idempotency, recent authentication, recovery parity, trusted-proxy policy, and Firebase fallback removal |
| Final Phase 1 blocker repair | `1dd36d1811949ba3ff166e982a8b72bda014c5ef` | Completes purpose-bound recent-auth proof issuance, digest persistence, atomic single-use consumption, and caller coverage |
| Phase 2 repair descendant | `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` | Preserves the repaired authentication boundary |
| Phase 3 repair descendant | `2e3664546f628a19c6fa929b9ee9469e5322f9a8` | Preserves the repaired authentication boundary through the mobile reconciliation |

### Final Correctness Repair 1 scope and evidence boundary

- IPv6 trusted-proxy CIDRs use normalized 16-byte comparison with whole-byte and remaining-bit masks. `/0`, `/32`, `/48`, `/64`, `/127`, and `/128` therefore have their actual prefix meaning; `/0` remains an intentionally broad deployment choice rather than a matcher exception.
- Trust is granted from the direct socket peer only. The approved production shape remains one Caddy hop and one right-most forwarded client; the repair does not add recursive proxy walking or let an untrusted direct caller elevate a supplied `X-Forwarded-For` value.
- Malformed forwarding data fails closed without salvaging a partial chain. A future multi-proxy topology requires a separately reviewed hop policy and configuration.
- This repair changes runtime matching and validation only. It performs no migration, reconciliation, deployment, provider access, production MongoDB access, or existing-record mutation. Exact Repair 1 verification results belong to the appended authoritative ledger in `TEST_MATRIX.md`; none of the historical results below is rewritten as new evidence.

## Historical Phase 1 milestone record

**Historical snapshot boundary.** The remainder of this report records the original 30 July 2026 Phase 1/R1A–R1C1 closure and its then-current limitations. Statements below that say a later task was unstarted, or that recent authentication, proxy trust, recovery timing, or reset atomicity remained open, are historical snapshot claims superseded by the 4 August reconciliation above. Original milestone SHAs, command results, and evidence boundaries are intentionally retained.

Scope gate: Phase 1 only. Phase 2 has not started.

## Outcome

Phase 1 repairs the trust boundary around registration recovery, password recovery, session restoration and rotation, owner-scoped persistence, asynchronous account ownership, logout/deletion, and academic hierarchy replacement. It adds only the minimum Turkish-first UI states required to explain loading, verification/password recovery, password visibility, resend timing, verification/login separation, and failed cleanup.

No new navigation shell, UI framework, analytics SDK, content-trust work, deployment, publish, push, or production mutation was performed. The broad visual redesign remains deferred to its numbered phases.

## Scope completed

1. **Email verification recovery**
   - Resend now calls `POST /auth/resend-verification-code`, not registration.
   - `native_pending_email_verification` persists normalized email, verification expiry, and optional resend cooldown only. Password and verification code are never stored.
   - Cold start restores the verification screen and countdown; Login exposes a reachable “E-postamı doğrula” recovery action.
   - Successful verification is shown before any later Login/session result. After relaunch, the user must enter the password because it was intentionally not retained.
2. **Endpoint-aware auth errors**
   - API auth failures use controlled `errorCode` values and a stable envelope.
   - Native mapping uses endpoint context and fixed Turkish messages; raw response bodies are never rendered.
3. **Password contract**
   - Native and API enforce the existing backend minimum of 10 JavaScript UTF-16 code units through explicit constants.
   - Password input strings are not trimmed before submission, and registration confirmation remains required.
   - Login and registration have labelled show/hide controls.
   - Login exposes `Şifremi unuttum`; the complete request/confirm API and native flow is implemented rather than a dead link.
4. **Hydration gate**
   - Root state is explicitly `loading`, `error`, or `ready`; Login/Home cannot be stable while hydration is incomplete.
   - Device identity is restored or created before refresh-token rotation.
   - The stored session is validated and refreshed before readiness; owner-scoped exams/Google metadata and authenticated context then restore.
   - Unexpected startup/storage/network failures render a recoverable retry surface rather than a false logged-out state.
5. **User-scoped local data**
   - Manual exams use owner-derived v2 keys and validated owner envelopes.
   - Persistence begins only after owner restoration, preventing the initial empty array from overwriting stored exams.
   - Owner-unknown legacy exams are discarded rather than assigned to whichever account signs in first.
   - Google connection metadata is owner-scoped; legacy metadata migrates only when its embedded owner matches.
6. **Session ownership and cancellation**
   - An account generation contains owner ID plus generation. All relevant completions recheck it before state or storage mutation.
   - Authenticated requests register abort controllers; Google Calendar REST requests receive the signal.
   - SecureStore and Google native SDK operations are serialized; an SDK epoch rejects stale native completions.
   - API requests have a 15-second default timeout through response-body consumption. Refresh rotation is single-flight and cannot queue a live session behind cleanup.
7. **Logout and deletion integrity**
   - Logout/account deletion first durably overwrite `native_session` with a non-secret tombstone. UI invalidation occurs only after that write succeeds.
   - If the tombstone write fails, the account remains visibly active and the user can retry; the flow does not claim success.
   - Once durable invalidation succeeds, late requests cannot reactivate the account. Server revocation/deletion uncertainty and remaining local cleanup failures are surfaced by controlled target, never raw exception.
   - Data deletion blocks new authenticated mutations, waits for tracked preference/academic mutations, then invalidates the old generation after server success before resetting the same owner.
   - Logout, session expiry, account deletion, and successful personal-data deletion clear pending-verification memory/storage as well; storage failure is included in observable cleanup and retry.
8. **Academic hierarchy integrity**
   - University changes clear faculty, department, and class level; faculty changes clear department and class level.
   - Mongo uses `$unset`; Firestore uses field-level updates with explicit deletes; in-memory storage removes omitted descendants.
   - User and admin update paths validate the complete parent-child hierarchy and use replacement semantics.
   - Native no longer sends an invented `classLevel: 2`.
9. **Secret-free diagnostics**
   - Missing-SMTP development fallbacks no longer log email addresses or verification/deletion codes.
   - Cleanup and auth classification results retain only controlled codes/target identifiers.
10. **Password recovery**
   - In production, `POST /auth/password-recovery/request` returns the same public status/body fields for known and unknown syntactically valid email addresses. Non-production fixtures may receive different random preview/decoy values; production does not.
   - Six-digit codes use `crypto.randomInt`, expire after 600 seconds, have a 60-second resend cooldown, and are stored only as email-domain-separated HMAC-SHA-256 digests.
   - A newly accepted request invalidates older active recovery material. Confirmation consumes the current code atomically once, then sequentially replaces the password, revokes refresh sessions, and invalidates remaining material; those later writes are not one transaction.
   - Password minimum and confirmation match the registration contract. Invalid/expired code, mismatch, invalid password, and rate limit use controlled error codes.
   - Native request and confirmation screens include invalid/loading/cooldown/expired/success states, independent new-password visibility controls, explicit Back/Cancel behavior, Android hardware Back handling, and complete in-memory secret cleanup.
   - Recovery code/new-password material is never persisted or logged. Process-death recovery intentionally returns to Login rather than restoring a recovery secret.

## Files changed for Phase 1

The repository already contained unrelated modified and untracked work. This list records the Phase 1 scope identified from `git diff --name-status`, untracked additions, and direct inspection; no unrelated file was reset or removed.

### Runtime and contracts

- `.env.example`
- `README.md`
- `apps/api/src/common/guards/rate-limit.guard.ts`
- `apps/api/src/config/environment-validation.ts`
- `apps/api/src/contracts/endpoint-catalog.ts`
- `apps/api/src/database/collection-indexes.ts`
- `apps/api/src/database/mongoose-schemas.ts`
- `apps/api/src/modules/auth/auth.constants.ts` (new)
- `apps/api/src/modules/auth/auth-application.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/auth.dto.ts`
- `apps/api/src/modules/auth/auth.types.ts`
- `apps/api/src/modules/auth/email-verification-sender.service.ts`
- `apps/api/src/modules/auth/firestore-auth.repository.ts`
- `apps/api/src/modules/auth/in-memory-auth.repository.ts`
- `apps/api/src/modules/auth/mongo-auth.repository.ts`
- `apps/api/src/modules/auth/token.service.ts`
- `apps/api/src/modules/users/users.service.ts`
- `apps/mobile-native/App.tsx`
- `apps/mobile-native/src/auth/auth-recovery.ts` (new)
- `apps/mobile-native/src/auth/session-integrity.ts` (new)
- `apps/mobile-native/src/session-integrity/manual-exam-storage.ts` (new)
- `apps/mobile-native/src/google-calendar/google-calendar-sync.ts`

### Tests

- `apps/api/tests/auth-application.service.test.ts`
- `apps/api/tests/auth-academic-selection-repositories.test.ts` (new)
- `apps/api/tests/auth-http-contract.integration.test.ts` (new)
- `apps/api/tests/database-indexes.test.ts`
- `apps/api/tests/email-verification-sender.test.ts`
- `apps/api/tests/mongoose-schemas.test.ts`
- `apps/api/tests/operations.test.ts`
- `apps/api/tests/password-recovery.test.ts` (new)
- `apps/api/tests/users-and-guards.test.ts`
- `tests/unit/mobile-native-auth-recovery.test.ts` (new)
- `tests/unit/mobile-native-session-integrity.test.ts` (new)
- `tests/unit/google-calendar-sync.test.ts`

### Documentation and reports

- `docs/04-security-hardening.md`
- `docs/15-firebase-deploy.md`
- `docs/19-mobile-native-current-state-ui-ux-audit.md`
- `docs/20-mobile-native-in-app-user-activity-report.md`
- `docs/mobile-native-redesign/README.md`
- `docs/mobile-native-redesign/DECISIONS.md`
- `docs/mobile-native-redesign/TEST_MATRIX.md`
- `docs/mobile-native-redesign/KNOWN_ISSUES.md`
- `docs/mobile-native-redesign/phases/phase-01-auth-session-integrity.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/README.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/android-environment.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/artifact-manifest.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/capture-hashes.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/native-qa-results.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/startup-logcat.md`
- `docs/mobile-native-redesign/evidence/phase-01-native/talkback-blocker.md`

## Design and architecture decisions

- D-013 stores resumable verification state without secrets.
- D-014 binds async completion to owner plus generation.
- D-015 discards owner-unknown legacy exams.
- D-016 maps controlled API auth codes to fixed copy.
- D-017 makes the durable session tombstone the logout/account-deletion commit point; UI invalidation follows it.
- D-018 makes academic selection a validated replacement contract.
- D-019 makes hydration an explicit root boundary with device-first refresh.
- D-020 bounds API work and serializes session/storage mutation.
- D-021 adds a cleanup lock and authenticated-mutation barrier.
- D-022 defines production public-field parity, expiring single-use password recovery, and a memory-only native secret boundary while preserving the latency/transaction limitations.
- D-023 records configured and effective Android-emulator values separately so image overrides remain visible.

Minimal flow UI additions preserve the current app architecture. They do not establish Phase 4 tokens or Phase 6 visual acceptance.

## API and data-contract changes

### Controlled auth response contract

Auth failures introduced or normalized in this phase use:

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "errorCode": "AUTH_INVALID_CREDENTIALS",
  "message": "Invalid credentials."
}
```

The controlled codes are:

- `AUTH_INVALID_CREDENTIALS`
- `AUTH_EMAIL_NOT_VERIFIED`
- `AUTH_VERIFICATION_CODE_INVALID`
- `AUTH_VERIFICATION_CODE_EXPIRED`
- `AUTH_VERIFICATION_REQUEST_INVALID`
- `AUTH_VERIFICATION_TOKEN_INVALID`
- `AUTH_VERIFICATION_TOKEN_EXPIRED`
- `AUTH_SESSION_INVALID`
- `AUTH_SESSION_EXPIRED`
- `AUTH_ACCOUNT_DISABLED`
- `AUTH_PASSWORD_RECOVERY_CODE_INVALID`
- `AUTH_PASSWORD_RECOVERY_CODE_EXPIRED`
- `AUTH_PASSWORD_CONFIRMATION_MISMATCH`
- `AUTH_PASSWORD_INVALID`
- `AUTH_RATE_LIMITED`

For resend cooldown, HTTP 429 additionally returns `resendAvailableAt` and `details.resendAvailableAt`. These are server timing data, not secrets. Existing `message` remains for compatibility, but the native app never displays it directly for auth operations.

### Endpoint behavior

| Endpoint/contract | Phase 1 behavior |
|---|---|
| `POST /auth/register` | Password minimum is 10; password confirmation must match; email normalization is locale-independent lowercase; verification timing is returned. |
| `POST /auth/resend-verification-code` | Added to the strict public endpoint catalog. Unknown request, cooldown, and valid resend are distinct controlled outcomes. |
| `POST /auth/password-recovery/request` | Accepts `{ email }`; valid known and unknown cases receive the same production status/body fields with 600-second expiry and 60-second resend values. Accepted known-account requests invalidate older active material; a strict IP limiter and account cooldown apply. Latency is not equalized. Non-production preview/decoy values are never a production contract. |
| `POST /auth/password-recovery/confirm` | Accepts `{ email, code, newPassword, passwordConfirmation }`; conditionally consumes current recovery material atomically, then sequentially replaces the password, revokes existing refresh sessions, invalidates remaining material, and returns `{ status: "password_reset" }` only after all steps succeed. The full sequence is not one transaction. |
| `POST /auth/verify-email` | Verification returns a verified identity result; the native handler does not silently convert it into Login/session success. |
| `POST /auth/login` | Invalid credentials, unverified email, and disabled account are distinct. Password bytes are verified as submitted. |
| `POST /auth/google` | Added to the strict public endpoint catalog; disabled account is preserved as a controlled outcome. |
| `POST /auth/refresh-token` | Invalid/reused versus expired session outcomes are controlled and distinct; refresh still rotates tokens. |
| Auth 429 responses | Strict auth rate limiting returns `AUTH_RATE_LIMITED`. Client isolation still depends on trusted proxy/IP configuration in deployment. |
| `PATCH /me/university` | Validated replacement: omitted descendants are removed instead of retained. |
| Admin academic update path | Uses the same descendant-clearing and parent-child validation semantics. |

No endpoint was removed. No production infrastructure was changed or deployed.

### Local persistence and migration

| Key/record | Phase 1 contract | Migration/cleanup |
|---|---|---|
| `native_session` | Validated session JSON or non-secret `native_session_invalidated_v1` tombstone | Tombstone overwrites tokens before UI invalidation; cold start treats it as logged out and best-effort removes it. |
| `native_device_id` | Non-empty device ID | Must be ready before refresh-token use. |
| `native_pending_email_verification` | `{ email, verificationExpiresAt, resendAvailableAt? }` | Invalid records are deleted; password/code/token are absent. Terminal logout/session-expiry/account deletion and successful personal-data deletion clear it through observable cleanup. |
| Password-recovery UI state | Normalized email, expiry/cooldown record, six-digit code, new password, and confirmation in React memory only | No SecureStore/localStorage key exists. Completion, cancellation, Back-to-request, and return to Login clear secrets; process death does not restore recovery material. |
| `native_manual_exams_v2_<encoded-owner>` | `{ schemaVersion: 2, ownerId, exams, updatedAt }` with validated exam fields | Wrong-owner/invalid records are never exposed and are removed. |
| `native_manual_exams` | Legacy global array with no owner proof | Deleted and deliberately not migrated; user receives controlled information. |
| `native_google_calendar_connection_v2_<encoded-owner>` | Owner ID, account email, sync timestamp/result | Legacy global record migrates only when its embedded owner matches; otherwise it is discarded. |

## Task A1 security-remediation addendum — credential-generation substrate

Task A1 adds `credentialGeneration` to backend user, refresh-token, and password-recovery records. Repository reads normalize a missing legacy field to `0`, every new user starts at `0`, and refresh/recovery issuance copies the current user's value. No production migration is required or run.

Generation-safe existing-user writers are:

- email verification, Google identity, administrative update, profile update, password update, and academic hierarchy replacement;
- personal-data clearing, admin deletion, and account deletion/anonymization;
- Firestore field-level updates with explicit deletions for omitted academic descendants and cleared personal fields, replacing unsafe full-document writes;
- Mongo partial `$set`/`$unset` updates with `credentialGeneration` stripped from general update input; and
- in-memory mutations that synchronously read and replace the current map entry, eliminating the prior read/await/write stale-object window.

University and faculty replacement still clears all omitted descendants. Task A1 does not increment a generation or reject refresh/recovery records whose snapshot differs, and it does not change the password-reset execution order. Generation advancement, mismatch enforcement, and atomic reset completion are intentionally deferred to Task A2. Existing access JWTs are unaffected. No index, environment, native-app, Task B, or Phase 2 change is included.

### Task A1 validation ledger

| Command | Result |
|---|---|
| Focused generation/repository/schema/auth/recovery suite | PASS, 5 files / 62 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 24 files / 182 tests |
| Workspace and native TypeScript checks | PASS, exit 0 for both |
| `npm.cmd test -- --configLoader runner` | PASS, 30 files / 265 tests; exceeds the 29/240 checkpoint baseline |
| `npx.cmd vitest run --configLoader runner` | Independent PASS, 30 files / 265 tests |
| Whitespace and expanded production-source sensitive-log checks | PASS; no whitespace errors and `SENSITIVE_LOG_SCAN_NO_MATCHES` |

The plain `npm.cmd test` form was blocked before Vitest startup because the sandbox denied esbuild access to the parent directory/config. The unchanged runner-loader form passed twice, so this is recorded as an environment-only startup limitation rather than a failed product test.

## R1A addendum — MongoDB-only runtime repository wiring

R1A removes runtime repository selection without deleting adapters. `AppModule` now binds the seven repository families directly:

| Runtime token | Sole runtime implementation |
|---|---|
| `AuthRepository` | `MongoAuthRepository` |
| `CatalogRepository` | `MongoCatalogRepository` |
| `CalendarRepository` | `MongoCalendarRepository` |
| `AnnouncementRepository` | `MongoAnnouncementRepository` |
| `PdfRepository` | `MongoPdfRepository` |
| `NotificationRepository` | `MongoNotificationRepository` |
| `AuditRepository` | `MongoAuditRepository` |

`RepositoryMode`, `repositoryMode`, and active `REPOSITORY_MODE` declarations are removed. API startup now requires a nonblank `MONGODB_URI` regardless of legacy selector input. Readiness always checks Mongo and exposes no active Firestore dependency. Catalog bootstrap retains the shared idempotent seed algorithm but no longer imports or branches on the Firestore adapter.

Firestore and in-memory repository files remain physically present for R1C, but `AppModule` cannot reach them. No repository contract, Mongo adapter behavior, A1 generation semantics, dependency, migration, native source, or production data changed. Firebase Authentication, Google Sign-In/OAuth, FCM, Hosting, `firebase`, and `firebase-admin` are preserved. At the R1A checkpoint, R1B still owned behavior/user-data reconciliation; the addendum below records that scoped follow-up. R1C owns adapter/config/test/document cleanup. Task A2, Task B, Phase 2, and UI work remain unstarted.

### R1A validation ledger

| Command | Result |
|---|---|
| Focused wiring/operations/A1 auth regression suite | PASS, 6 files / 100 tests |
| `npx.cmd vitest run apps/api/tests --configLoader runner` | PASS, 25 files / 203 tests |
| Workspace and native TypeScript checks | PASS, exit 0 for both |
| `npx.cmd vitest run --configLoader runner` | PASS, 31 files / 286 tests; exceeds the 30/265 checkpoint baseline |
| `npm.cmd run build:admin` | PASS, 1,742 modules |
| `npm.cmd run build:mobile` | Initial restricted-sandbox esbuild denial; approved identical rerun PASS, 1,754 modules |
| Whitespace and expanded production-source sensitive-log checks | PASS; no whitespace errors and `SENSITIVE_LOG_SCAN_NO_MATCHES` |

## R1B addendum — Mongo persistence for user academic data

R1B introduces a focused `UserDataRepository` for the two user-owned data families that `UsersService` previously held in process-local arrays. `AppModule` binds that token directly to `MongoUserDataRepository`; the seven repository bindings established by R1A remain direct Mongo bindings and no runtime repository selector returns.

The existing API contract is unchanged. Students still create academic-unit suggestions and create/list followed scopes through the same routes and shapes. Suggestion listing and review remain `super_admin` operations. Approval/rejection rules, catalog side effects, response serialization, and university/faculty/department validation are preserved. No follow-removal endpoint or other product behavior was added.

### Collections and indexes

| Collection | Persisted existing behavior | Required indexes |
|---|---|---|
| `academic_unit_suggestions` | ID, owner ID, submitter email, university ID, faculty name, optional department name, education level, pending/approved/rejected status, creation time, and optional existing review time | `academic_unit_suggestions_status_created` on status/descending creation time; `academic_unit_suggestions_user` on owner ID |
| `followed_academic_scopes` | ID, owner ID, university ID, optional faculty/department IDs, hidden normalized-scope key, and creation time | Unique `followed_academic_scopes_user_scope_unique` on owner/normalized key; `followed_academic_scopes_user_created` on owner/ascending creation time |

The normalized key treats absent/empty optional descendants consistently, so repeating the same owner and academic scope is idempotent while university-only, faculty, and department scopes remain distinct. Suggestion queues retain newest-first order; followed scopes retain oldest-first order.

### Lifecycle, compatibility, and migration

| Operation | R1B cleanup behavior |
|---|---|
| `DELETE /me/data` | Deletes the authenticated owner's suggestions and followed scopes in addition to the pre-existing profile/preference cleanup |
| `DELETE /me` with default/true `deleteData` | Reuses personal-data clearing, then completes existing token/account deletion |
| `DELETE /me` with `deleteData: false` | Still deletes both user-data collections before the existing token/account deletion |
| Administrative user deletion | Deletes both user-data collections before the existing administrative account deletion |

Owner-scoped cleanup preserves other users' records. The former arrays existed only for one API-process lifetime and are not a reliable persistent source, so R1B creates or runs no migration for them. No production data was accessed. Existing routes, DTOs, response fields, authorization rules, native source, dependencies, lockfile, environment contract, A1 `credentialGeneration`, access JWT behavior, and the seven R1A repository families remain compatible.

### R1B implementation files

Runtime and persistence:

- `apps/api/src/app.module.ts`
- `apps/api/src/database/collection-indexes.ts`
- `apps/api/src/database/mongoose-schemas.ts`
- `apps/api/src/modules/users/mongo-user-data.repository.ts`
- `apps/api/src/modules/users/user-data.types.ts`
- `apps/api/src/modules/users/users.service.ts`

Deterministic tests and test-only fixtures:

- `apps/api/tests/auth-http-contract.integration.test.ts`
- `apps/api/tests/database-indexes.test.ts`
- `apps/api/tests/mongo-user-data.repository.test.ts`
- `apps/api/tests/mongodb-runtime-wiring.test.ts`
- `apps/api/tests/mongoose-schemas.test.ts`
- `apps/api/tests/public-pages.controller.test.ts`
- `apps/api/tests/users-and-guards.test.ts`
- `apps/api/tests/support/mongo-user-data-model.fixture.ts`
- `apps/api/tests/support/test-user-data.repository.ts`

Documentation:

- `docs/mobile-native-redesign/DECISIONS.md`
- `docs/mobile-native-redesign/KNOWN_ISSUES.md`
- `docs/mobile-native-redesign/TEST_MATRIX.md`
- `docs/mobile-native-redesign/phases/phase-01-auth-session-integrity.md`

### R1B evidence boundary and final validation ledger

The Mongo repository tests use deterministic Mongoose model doubles, and service/HTTP tests use the test fixture under `apps/api/tests/support`. A focused integration case additionally initializes the real schemas/indexes and proves suggestion create/read, eight-way concurrent follow idempotency, stored private-key behavior, and cleanup against the existing local/CI Mongo 7 service. It guards and drops only the PID-named `academic_user_data_r1b_test_<pid>` database. Rebuilding `UsersService` against one shared model context demonstrates that service-local arrays are no longer authoritative, but neither case is a Mongo reconnect, API-process restart, or durable-disk persistence smoke. Firestore adapter/config/test/document removal remains R1C; Mongo reconnect and full live persistence smoke verification remains R1D.

| Exact command or check | Result |
|---|---|
| `npx.cmd vitest run apps/api/tests/mongo-user-data.repository.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/public-pages.controller.test.ts apps/api/tests/users-and-guards.test.ts apps/api/tests/mongodb-runtime-wiring.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/database-indexes.test.ts --configLoader runner` | PASS, 7 files / 47 tests |
| `npx.cmd vitest run apps/api/tests/mongodb-runtime-wiring.test.ts apps/api/tests/operations.test.ts --configLoader runner` | PASS, 2 files / 42 tests |
| `npx.cmd vitest run apps/api/tests/auth-credential-generation.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/auth-application.service.test.ts apps/api/tests/password-recovery.test.ts --configLoader runner` | PASS, 5 files / 64 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 26 files / 216 tests |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0; no native source changed |
| `npx.cmd vitest run --configLoader runner` | PASS, 32 files / 299 tests; exceeds the 31-file/286-test baseline |
| `npm.cmd run build:admin` | PASS outside the restricted sandbox, 1,742 modules |
| `npm.cmd run build:mobile` | Initial restricted-sandbox Vite/esbuild parent-directory denial; approved identical rerun PASS, 1,754 modules |
| Expanded production-source sensitive-log scan (exact PowerShell later in this report) | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` |
| `git diff --check` | PASS, no whitespace errors; expected LF-to-CRLF notices only |

No deployment, publish, push, migration, production-data access, Android emulator, Task A2, Task B, Phase 2, or UI work is included in R1B.

## R1C1 addendum — Firestore database persistence removal

R1C1 removes the runtime-unreachable Firestore database source retained after R1A. Mongo remains the sole runtime database for auth/users, catalog, calendars, announcements, PDF processing, notifications, audit logs, suggestions, and followed scopes. `AppModule` required no composition change because those bindings were already direct Mongo classes.

Deleted database infrastructure and adapters:

- `apps/api/src/database/firestore.service.ts`
- `apps/api/src/database/firestore-utils.ts`
- `apps/api/src/modules/auth/firestore-auth.repository.ts`
- `apps/api/src/modules/catalog/firestore-catalog.repository.ts`
- `apps/api/src/modules/calendars/firestore-calendar.repository.ts`
- `apps/api/src/modules/announcements/firestore-announcement.repository.ts`
- `apps/api/src/modules/pdf/firestore-pdf.repository.ts`
- `apps/api/src/modules/notifications/firestore-notification.repository.ts`
- `apps/api/src/modules/audit/firestore-audit.repository.ts`

No other production source imported or instantiated those classes. The final static scan over API source and tests has no Firestore database persistence match. A recursive wiring test also scans every production TypeScript path and body for the retired database term, while the existing legacy-selector rows continue proving that old `REPOSITORY_MODE` values cannot change direct Mongo bindings.

### R1C1 test replacement and compatibility boundary

Exactly eleven adapter-only executions were removed: one legacy-generation/admin-update case, nine stale-writer rows, and one academic descendant-clearing case. Nine new Mongo stale-writer rows replace the writer cases one-for-one. The existing Mongo legacy normalization test remains authoritative, and the Mongo academic test now proves `$set`/`$unset` operations preserve `credentialGeneration` and unrelated stored data. Existing in-memory contract cases remain unchanged. Two explicit dynamic-import cases prove that the retained Firebase Authentication verifier and FCM sender still resolve. The full count therefore remains 32 files / 299 tests.

The A1 contract is unchanged: missing Mongo generation values read as `0`, issued refresh/recovery records retain their current-generation stamp, writers cannot decrease a newer stored generation, access JWTs are unaffected, and generation advance/enforcement remain Task A2. R1B suggestions and followed scopes remain Mongo-backed and their isolated real-Mongo test remains green.

Firebase Authentication, `FirebaseAdminService`, Google Sign-In/OAuth, FCM, Hosting, `firebase`, `firebase-admin`, related environment values, `firebase.json`, and `.firebaserc` are retained. Package and lock files are unchanged; Firestore-related transitive packages required by retained Firebase packages are not runtime database support.

No data migration was designed or run, no historical Firestore-only data was inspected, and no deployment or production access occurred. Reverting this scoped commit is the code rollback path, but it would restore unsupported adapters rather than reconcile data. Production in-memory repository files remain runtime-unreachable and move only in R1C2. R1D still owns Mongo reconnect and durable persistence smoke evidence. Task A2, Task B, Phase 2, and UI work remain unstarted.

### R1C1 validation ledger

| Exact command or check | Result |
|---|---|
| Focused generation/academic/wiring suite | PASS, 3 files / 35 tests |
| Affected auth/repository/R1B suite | PASS, 9 files / 115 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | PASS, 26 files / 216 tests |
| Workspace and native TypeScript checks | PASS, exit 0 for both |
| `npx.cmd vitest run --configLoader runner` | PASS, 32 files / 299 tests |
| `npm.cmd run build:admin` | PASS, 1,742 modules |
| `npm.cmd run build:mobile` | PASS, 1,754 modules |
| Required removal scan and retained Firebase import scan | PASS: no retired persistence matches; auth and messaging imports retained |
| Whitespace and expanded production-source sensitive-log checks | PASS; no whitespace errors and `SENSITIVE_LOG_SCAN_NO_MATCHES` |

## Tests added and updated

The coverage-to-file map and exact command ledger are in [TEST_MATRIX.md](../TEST_MATRIX.md). Added or extended coverage includes every Phase 1-required family:

- correct resend endpoint and cooldown;
- verification success followed by separate Login failure;
- recovery after relaunch without password restoration;
- controlled auth-code distinctions and raw-payload suppression;
- password minimum parity and untrimmed password HTTP round trip;
- hydration surface and device-before-refresh ordering;
- manual-exam startup race, v2 envelope validation, and two-account isolation;
- late refresh/content/preference/Google settlement rejection;
- observable and bounded cleanup failure;
- university/faculty descendant clearing in Mongo, Firestore, in-memory, user, admin, and loopback HTTP paths;
- absence of password/token/code/email/personal-exam content from repaired logs/results.
- known and unknown password-recovery requests returning the same production status/body fields (not a latency-parity claim);
- production fail-closed recovery-pepper validation, digest-only persistence, and account-deletion cleanup;
- recovery request rate limiting, invalid/expired material, single-use consumption, and older-request invalidation;
- frontend/backend password parity and confirmation mismatch;
- old-password rejection, new-password acceptance, and refresh-session revocation after reset;
- absence of recovery code/password/email values from recovery logs and returned controlled failures.
- missing user/refresh/recovery generations normalizing to `0` and new users initializing at `0`;
- refresh and password-recovery issuance stamping the current user generation;
- profile, academic, Google-identity, admin, clear-data, password, and deletion-related writes preserving a newer generation;
- Firestore explicit descendant deletion after replacing full-document writes; and
- deterministic in-memory delayed/concurrent mutation safety.

No React Native component test stack was installed. The native-focused Vitest tests exercise extracted pure contracts and concrete source-order assertions; they do not claim rendered-component or native SDK execution.

## Final-closure Android environment

| Item | Recorded closure evidence |
|---|---|
| Host | Windows 11 Pro `10.0.26200` build 26200; Intel Core i7-1165G7, 4 physical/8 logical processors; 16,461,264 kB visible RAM |
| Closure CLI | Node `v22.14.0`; npm `10.9.2`; Eclipse Temurin OpenJDK `21.0.7+6-LTS`; winget `v1.29.280` |
| Closure-time capacity snapshot | 1,623,144 kB free physical RAM and 72,134,201,344 free bytes on 510,655,012,864-byte `C:` while the emulator/QA services were active; not reconstructed as pre-install values |
| Android Studio | Official Google LLC Stable at `C:\Program Files\Android\Android Studio`; winget package `Google.AndroidStudio` `2026.1.2.10`; product build `AI-261.25134.95.2612.15822958` |
| SDK tools | SDK root `<ANDROID_SDK_ROOT>`; Platform-Tools/ADB `36.0.2`; command-line tools revision 22 at SDK-recognized `cmdline-tools/latest-2`; Emulator `36.6.11` |
| Project Android config | `com.anssoft.akademiktakvim`; min/compile/target SDK 24/36/36; Build-Tools 36; AGP 8.11; Gradle 8.14.3; existing NDK 27.1 |
| Image/AVD | Exactly one Google APIs x86_64 API 24 revision 27 image and exactly one AVD, `AcademicPhase1Low` |
| Requested/prelaunch AVD | 1,536 MB RAM, 2 cores, 720 × 1280, 320 dpi, 256 MB heap, 2,047 MB data, host GPU; cameras/audio/device frame off; hardware keyboard/Quick Boot on |
| Post-boot/effective AVD | `config.ini` retains 256 MB heap but normalizes data to 6,442,450,944 bytes; runtime API 24, 1,533,960 kB RAM, 2 cores, 720 × 1280/320 dpi, 384 MB heap, approximately 5.8 GB `/data` |
| Acceleration | WHPX `10.0.26200` installed and usable; unaccelerated software emulation was not accepted |
| First boot | 42.3 seconds from cold launch to `sys.boot_completed` |
| Visible Quick Boot | Same launch options without `-no-window`; visible standalone window ready in 4.5 seconds; ADB healthy |
| AVD path | `%USERPROFILE%\.android\avd\AcademicPhase1Low.avd\config.ini` |
| Debug build | `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android`: PASS in 388.1 seconds |
| Debug artifact/install | 105,428,719 bytes; SHA-256 `763148DA6A511220E4F37F5C57CF320458E208A90FC7AE2E525161E01B7D3A9D`; ADB install `Success` |
| Package/startup | `com.anssoft.akademiktakvim` `0.1.1`/12, debuggable, min 24/target 36; `MainActivity` started in 1,083 ms; no immediate fatal/native-module/React JS crash |
| Effective QA API | Explicit Metro `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`; local in-memory development API; no production mutation |

The noncanonical `latest-2` directory is a benign SDK-location warning caused by an older command-line-tools directory already occupying `latest`; revision 22 is recognized by the SDK catalog. API 36, 34, 30, and 28 Google APIs images were attempted sequentially on the same AVD name, then removed before the next attempt because their effective heap/data allocation exceeded the requested budget. API 24 is the only final installed system image and matches the app's minimum SDK.

The selected API 24 image/emulator still overrides the requested 256 MB heap/2,047 MB data. Post-boot `config.ini` retains 256 MB heap but normalizes data to 6,442,450,944 bytes; runtime is 384 MB heap/approximately 5.8 GB `/data`. This is recorded under the selected-image exception as a limitation; the hard two-core/2,048-MB-RAM closure gate passes.

## Phase 1 success-criteria matrix

All closure rows are resolved as PASS or BLOCKED. Historical failed attempts remain disclosed where useful, but none is used as acceptance evidence.

| Criterion | Status | Implementation evidence | Exact test evidence | Native evidence | Remaining limitation |
|---|---|---|---|---|---|
| Official Android Studio Stable verified | PASS | Google LLC package and product build recorded | Version/product-info inspection | Installed command-line environment | None |
| Minimum closure SDK additions and exactly one system image | PASS | Platform tools, command-line tools 22, Emulator 36.6.11, API 24 Google APIs x86_64 rev27 | SDK package/AVD inventory | API/ABI property checks | Pre-existing unrelated SDK platforms/NDK/CMake were preserved, not installed for this closure |
| Exactly one AVD named `AcademicPhase1Low` | PASS | AVD inventory | `avdmanager list avd` evidence register | Single runtime serial | None |
| AVD ≤2 cores and ≤2,048 MB RAM | PASS | Config 2 cores/1,536 MB | Config and runtime property inspection | Runtime 2 cores/1,533,960 kB | None |
| Configured/effective AVD values and selected-image exception documented | PASS | Prelaunch request 256 MB/2,047 MB; post-boot config 256 MB/6,442,450,944-byte data | Config/runtime property/filesystem inspection | Effective 384 MB/~5.8 GB | The requested heap/data budget itself was not met: every attempted stock image normalized higher values; hard ≤2-core/≤2,048-MB-RAM gate remains satisfied |
| Hardware acceleration | PASS | Host GPU/WHPX configuration | `emulator -accel-check` reports usable WHPX | 42.3-second accelerated cold boot | None |
| Visible standalone window and responsive launcher/device | PASS | Required visible launch command excludes `-no-window` | `adb devices -l`, `sys.boot_completed=1`, focused-window/device checks | Visible Quick Boot in 4.5 s; emulator accepted input and the installed app became the focused activity | Launcher responsiveness was observed rather than recorded as a video |
| Current debug APK installs, expected package starts, no immediate fatal crash | PASS | Current x86_64 debug assembly passed in 388.1 s; artifact hash/metadata recorded | Gradle PASS; ADB install `Success`; dumpsys expected package/version | `MainActivity` 1,083 ms; no immediate fatal/native-module/React JS crash | Full flows remain separate criteria |
| Installed artifact corresponds to final scoped checkpoint source | PASS | The APK timestamp follows the final mobile implementation edits; native/API implementation files have not changed since their respective passing build/test runs, and only documentation/evidence changed afterward | APK hash/timestamp plus final source/diff reconciliation | Installed artifact exercised the same mobile implementation staged in this scoped commit | Exact self-containing commit SHA is reported in the final response; debug artifact is local and not committed |
| Signed-out and signed-in hydration behavior | PASS | Explicit loading/error/ready gate and device-first refresh | Native helper/source tests | Clear-data showed Login/no Home flash; valid-session force-stop/relaunch showed bundle/loading then Home/no Login flash | Temporal result is direct observation plus timestamped immediate/final captures, not a video |
| Verification recovery and correct resend after relaunch | PASS | Non-secret pending record; real resend endpoint; separate verify/login result | Focused native/API tests | Registration reached Verification; relaunch restored email/timing with blank code/no password; resend reset 9:42/0:42 and survived a second relaunch | Installed invalid/expired verification fixtures are separated below |
| Verification success remains distinct from subsequent Login failure | PASS | Verification commits a verified confirmation before any later Login result | Focused native/API verification/login contract tests pass | A fresh native fixture showed verified Profile Confirmation; its retained stale password then returned Login with the distinct verified-but-login-failed copy | Exact capture hashes are registered; synthetic values are not retained |
| Distinct controlled authentication outcomes | PASS | Endpoint-aware mapping for wrong credentials, unverified email, invalid/expired verification, expired/invalid session, disabled account, and rate limiting | Focused auth classifier/API tests pass | Wrong credentials, unverified-account recovery, invalid verification, expired-state presentation, and expired session were observed distinctly | Server-expired verification submission is fixture-conditional and remains seeded automated evidence; disabled/429 stay deterministic contract evidence |
| Login/Register password visibility and keyboard behavior | PASS | Labelled 48 × 48 visibility controls; password input strings are not trimmed | Native source-contract/parity tests pass | Login and Register hide→show→hide labels/semantics plus hardware-keyboard Tab/focus/submit passed | Minimum length uses JavaScript UTF-16 code units; password-manager integration was not part of the required smoke and was not exercised |
| Complete password recovery | PASS with disclosed backend risks | Production known/unknown public status/body parity, secure code/digest, single-use consume, native request/confirm screens | API 24/24 + password 9/9 + native 42/42 passes; sanitized same-runtime public-field parity/revocation proof | Known/unknown matching presentation, controlled invalid code, independent visibility, resend/field clearing, explicit Back/Cancel clearing, fresh-code reset, success-to-Login, old rejection, and new-password Home passed | Latency is not equalized (MN-030); only code consumption is atomic and later password/session/invalidation writes are sequential (MN-031); hardware Back shares the tested cleanup helper; no heap-byte-erasure claim |
| Old password rejected, new password accepted, refresh sessions revoked | PASS | Reset replaces hash and revokes sessions | `apps/api/tests/password-recovery.test.ts`: 9/9 PASS plus same-runtime two-session proof | Native old password rejected; new password reached Home; both held pre-reset sessions returned 401 / `AUTH_SESSION_INVALID` without API restart | A second AVD was neither required nor permitted |
| User A local data cannot appear for User B | PASS | Owner-derived v2 key/envelope and account generation | Existing Phase 1 owner-isolation tests | B saw no A exam; B added its own; returning A showed only A | None for required two-account path |
| Owner-scoped manual exams survive relaunch | PASS | Hydration-before-write ordering | Existing Phase 1 storage tests | Unique A exam survived force-stop/relaunch | None for required path |
| Academic descendant clearing survives reload/relaunch | PASS | Replacement semantics across Mongo/in-memory and field-delete semantics in Firestore across user/admin paths | Existing repository/service/HTTP tests | Full A hierarchy matched server; university→B cleared all descendants; faculty replacement cleared department/class; both survived relaunch | Native interaction and isolated API-driven server-reload fixtures were both used |
| Logout cannot restore prior account/content | PASS | Tombstone, cleanup lock, abort/generation checks | Existing late-response/cleanup tests | Protected content absent immediately, after 5 s, and after signed-out relaunch | None for required path |
| Late refresh/content/preference/Google work cannot repopulate a closed or switched account | PASS | Account generation, abort signals, owner checks, and logout tombstone guard every repaired settlement path | Existing late-response/source-order/Google-cancellation tests | Logout/wait/relaunch stayed clear; A→B→A isolation stayed correct | Native timing did not force every Google SDK callback; automated cancellation/generation evidence covers those settlements |
| 360 dp, 320 dp, and 200% font-scale evidence | PASS with limitation | Source-derived width formulas and default font scaling | Static source audit plus exact capture hashes | 360/320 pass; 2.0 covers Login, Register, Verification, Password Recovery Request/Confirm, Home, and Profile academic selection with reachable actions | Home nav labels wrap/truncate and recovery password placeholders truncate at 2.0; retained as frontend limitations |
| TalkBack tested or exact blocker documented | PASS | Labels/live regions/48-unit recovery controls in source | Static accessibility assertions plus exact package/service query | BLOCKED at runtime: no TalkBack/accessibility package/activity; services null/disabled | Exact blocker in [`../evidence/phase-01-native/talkback-blocker.md`](../evidence/phase-01-native/talkback-blocker.md); no screen-reader acceptance claimed |
| All baseline and Phase 1 automated checks | PASS | Final implementation is unchanged since the passing runs | Native TypeScript exit 0; workspace TypeScript exit 0; API 23 files / 157 tests; full default and runner suites 29 files / 240 tests; focused native/API suites pass; admin/mobile builds 1,742/1,754 modules; both Android/Hermes exports 674 modules/19 assets/2.39 MB HBC | N/A | Earlier resource-contended 154/157 API attempt is historical only and was superseded by the final 157/157 default-timeout pass |
| Lint passes or unavailability is exact | PASS | No root/native script, dependency, or lint config | `MOBILE_NATIVE_LINT: NOT AVAILABLE` | N/A | TypeScript is not called lint |
| Sensitive-log scans pass | PASS | Recovery diagnostics exclude secrets/personal values | Expanded source scan returned `SENSITIVE_LOG_SCAN_NO_MATCHES` | Redacted startup logcat PASS with zero sensitive-pattern matches | Pattern-based scanning complements tests/review; it is not a universal secret detector |
| Documentation, evidence, and success matrix complete | PASS | Required documents/evidence directory and exact native hashes/results updated | Markdown link/content inspection and `git diff --check` pass | Native path/result reconciliation complete; 45 transient/sensitive PNGs and 144 XML dumps deleted, exactly 11 safe PNGs retained | Deleted captures remain historical hash references, not live paths |
| Resource cleanup while retaining one AVD/image | PASS | Cleanup completed after QA | No repo-local Node/Java/emulator/Studio/Gradle process; ports 3000/8081 clear; ADB list empty; exact one-AVD/one-image inventory retained | Emulator stopped | `AcademicPhase1Low` and API 24 Google APIs x86_64 revision 27 remain for reproducibility |
| One scoped local checkpoint commit exists | PASS — this scoped commit; exact SHA reported in final response | Authorized Phase 1 paths only; unrelated files excluded | Cached diff reviewed before commit | N/A | No push is authorized or performed |
| Phase 2 not started; no push/deploy/publish/production mutation | PASS | Scope inspection | Working-tree/command audit | Local fixtures only | Phase 2 remains prohibited until Phase 1 is accepted |

## Exact commands and results

Earlier 28-file/220-test/build/export rows below predate the password-recovery closure patch. They remain valid historical regression evidence but are not the final post-recovery reconciliation. Final closure commands are listed first, followed by the clearly labelled historical snapshot.

| Command | Final result |
|---|---|
| `& '<WINGET_EXE>' install --id Google.AndroidStudio --exact --source winget --accept-package-agreements --accept-source-agreements --silent --disable-interactivity` | PASS, exit 0; official Google LLC Stable `2026.1.2.10` installed |
| Visible emulator launch with `-avd AcademicPhase1Low -accel on -gpu host -memory 1536 -cores 2 -partition-size 2047 -camera-back none -camera-front none -no-audio -no-boot-anim` | PASS; visible Quick Boot 4.5 seconds, ADB healthy |
| `npm.cmd test -- apps/api/tests/password-recovery.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/email-verification-sender.test.ts apps/api/tests/mongoose-schemas.test.ts apps/api/tests/database-indexes.test.ts --configLoader runner` | PASS, 24/24 tests |
| `npm.cmd test -- apps/api/tests/password-recovery.test.ts --configLoader runner` | PASS, 9/9 tests |
| `npm.cmd test -- apps/api/tests --configLoader runner` | Final PASS, 23 files / 157 tests at default timeout. Earlier 155/155 and resource-contended 154/157 attempts remain historical context only |
| `npm.cmd test -- apps/api/tests/public-pages.controller.test.ts --configLoader runner --testTimeout 15000` | Isolated PASS, 4/4 tests after the resource-contended timeouts |
| `npm.cmd --prefix apps/mobile-native run typecheck` | Final PASS, exit 0, 16.8 seconds |
| `npm.cmd run typecheck` | Final PASS, exit 0, 24.6 seconds |
| `npm.cmd test -- --run tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts` | Initial sandbox attempt blocked before Vitest startup; identical approved rerun PASS, 2 files / 42 tests |
| `npx.cmd vitest run tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts tests/unit/google-calendar-sync.test.ts --configLoader runner` | Final PASS, 3 files / 49 tests |
| `npx.cmd vitest run --configLoader runner apps/api/tests/auth-application.service.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/email-verification-sender.test.ts apps/api/tests/operations.test.ts apps/api/tests/users-and-guards.test.ts` | Final PASS, 6 files / 51 tests |
| `npm.cmd test` | Final PASS, 29 files / 240 tests |
| `npx.cmd vitest run --configLoader runner` | Final PASS, 29 files / 240 tests |
| `npm.cmd run build:admin` and `npm.cmd run build:admin -- --configLoader runner` | Final PASS in both forms, 1,742 modules each |
| `npm.cmd run build:mobile` and `npm.cmd run build:mobile -- --configLoader runner` | Final PASS in both forms, 1,754 modules each |
| `npx.cmd expo export --platform android --output-dir C:\tmp\academicmobileapp-phase1-android-export-final-20260729-172829` from repository root | Initial sandbox mkdir `EPERM`; identical approved rerun PASS, exit 0: 674 modules / 19 assets / 2.39 MB HBC |
| `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\academicmobileapp-phase0-android-export-rerun-20260729-172829 --max-workers 2` from `apps/mobile-native` | PASS, 674 modules / 19 assets / 2.39 MB HBC |
| `.\gradlew.bat --no-daemon app:assembleDebug -PreactNativeArchitectures=x86_64` from `apps/mobile-native/android` | PASS in 388.1 seconds; current x86_64 debug build. First invocation from the repository root failed before Gradle execution because that directory has no Gradle project. |
| Mobile-native lint | `MOBILE_NATIVE_LINT: NOT AVAILABLE` — no applicable script/dependency/config; TypeScript is not reported as lint |
| **Historical pre-password-recovery snapshot below** | The following rows are preserved regression history, not the final closure result |
| `npm.cmd --prefix apps/mobile-native run typecheck` | PASS, exit 0 |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npx.cmd vitest run tests/unit/mobile-native-auth-recovery.test.ts tests/unit/mobile-native-session-integrity.test.ts tests/unit/google-calendar-sync.test.ts --configLoader runner` | PASS, 3 files / 40 tests |
| `npx.cmd vitest run --configLoader runner apps/api/tests/auth-application.service.test.ts apps/api/tests/auth-academic-selection-repositories.test.ts apps/api/tests/auth-http-contract.integration.test.ts apps/api/tests/email-verification-sender.test.ts apps/api/tests/operations.test.ts apps/api/tests/users-and-guards.test.ts` | PASS, 6 files / 51 tests |
| `npx.cmd vitest run --configLoader runner` | PASS, 28 files / 220 tests |
| `npm.cmd run build:admin -- --configLoader runner` | PASS, 1,742 modules |
| `npm.cmd run build:mobile -- --configLoader runner` | PASS, 1,754 modules |
| `npx.cmd expo export --platform android --output-dir C:\tmp\academicmobileapp-phase1-android-export-final-20260729-1152` from `apps/mobile-native` | First sandbox attempt failed with `EPERM`; approved rerun PASS, 674 modules / 19 assets / 2.37 MB HBC. |
| `npx.cmd expo export --platform android --output-dir C:\tmp\academicmobileapp-phase1-android-export-final-20260729-1201` from `apps/mobile-native` | Final post-patch PASS, 674 modules / 19 assets / 2.37 MB HBC. |
| `git diff --check` | PASS, exit 0; no whitespace errors (LF-to-CRLF notices only) |
| Expanded production-source sensitive-log scan (exact PowerShell below) | PASS: `SENSITIVE_LOG_SCAN_NO_MATCHES` |

```powershell
$scanPattern = '(VERIFY_EMAIL_CODE\s|ACCOUNT_DELETION_CODE\s|PASSWORD_RECOVERY_CODE\s|logger\.(log|warn|error|debug).*(\$\{input\.(email|userEmail|fullName|code|password|newPassword|passwordConfirmation|universityId|facultyName|departmentName)\}|accessToken|refreshToken|verificationCode|previewVerificationToken|recoveryCode|previewRecoveryCode|recoveryToken|examTitle)|console\.(log|warn|error|info).*\b(email|userEmail|fullName|password|newPassword|passwordConfirmation|accessToken|refreshToken|verificationCode|previewVerificationToken|recoveryCode|previewRecoveryCode|recoveryToken|examTitle|facultyName|departmentName)\b)'
rg -n $scanPattern apps/api/src apps/mobile-native
if ($LASTEXITCODE -eq 1) { Write-Output 'SENSITIVE_LOG_SCAN_NO_MATCHES'; exit 0 }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

An initial plain `npm` TypeScript invocation was blocked by the Windows PowerShell execution policy at `npm.ps1`; the explicit `npm.cmd` retries above passed. The sandbox `EPERM` was an environment access failure, not a product failure. The successful Expo export proves Metro resolution and Android/Hermes bundling only; it is not an install, launch, native-module, or visual result.

## Native screenshots and visual QA

Result: Environment/build/install/startup plus required hydration, verification recovery/resend/error separation, verification-success→later-Login-failure, generic password recovery/visibility/Back/Cancel, reset/old-new Login/two-session revocation, two-account storage, hierarchy replacement, logout-staleness, 360/320-dp, and all six required 200%-font surfaces passed. TalkBack is unavailable with its exact blocker; no screen-reader acceptance is claimed.

- Android tooling/environment is no longer blocked: official Stable Studio, Emulator 36.6.11, an accelerated Google APIs API 24 x86_64 image, and the single `AcademicPhase1Low` AVD exist.
- Current x86_64 debug assembly and ADB install passed. The expected debuggable package/version resolved; `MainActivity` started in 1,083 ms with no immediate fatal/native-module/React JS crash.
- Clear-data signed-out launch displayed Login directly without a Home flash. Valid-session force-stop/relaunch showed the development bundle/loading surface and then Home without a Login flash.
- Registration reached Verification; force-stop/relaunch restored the non-secret email/timing record with blank code/no password; native resend reset expiry/cooldown and survived a second relaunch.
- Native Login distinguished an unverified account from invalid credentials and opened Verification without restoring the password. Invalid verification produced controlled copy; expired-state presentation and expired-session behavior remained distinct. A verified confirmation was preserved before a later stale-password Login failure.
- `Şifremi unuttum` reached Recovery Request; known/unknown generic presentation, independent password visibility, controlled rejection of a redacted invalid probe, resend/field clearing, explicit Back/Cancel marker clearing, fresh-code reset, success-to-Login, old-password rejection, and new-password Home all passed. Same-runtime proof showed identical known/unknown public fields and revoked two held refresh sessions.
- A unique User A exam survived process death. User B saw no A exam and added only B; returning to A showed only A. Logout removed content immediately, after five seconds, and after signed-out relaunch.
- University and faculty replacement cleared dependent academic fields in the isolated API fixture and after native relaunch.
- 320-dp Login/Register/Recovery had no horizontal clipping and remained reachable by scroll/focus. At font scale 2.0, all required Login/Register/Verification/Password Recovery Request/Confirm/Home/Profile-academic actions remained reachable; Home navigation labels wrap/truncate and recovery password placeholders truncate.
- The exact PASS/BLOCKED disposition for every native subcheck is in [`../evidence/phase-01-native/native-qa-results.md`](../evidence/phase-01-native/native-qa-results.md). TalkBack runtime QA is exactly BLOCKED on the selected image, with complete package/service evidence.
- iOS remains unavailable on Windows and no iOS evidence is claimed; this final closure authorization is Android-specific.
- No Expo Web screenshot, old APK/AAB, or generated mock is substituted for current native evidence.

Therefore the required Android functional/flow/width/font evidence is complete. Accessibility acceptance remains deliberately narrower: the exact TalkBack package/service blocker is documented, and no screen-reader acceptance is claimed.

## Accessibility checks

Code-level checks completed for the Phase 1 surfaces:

- hydration and cleanup status containers use polite live regions;
- retry, verification-recovery, password visibility, and code-entry controls have explicit Turkish labels/roles where added;
- password visibility controls are 48 × 48 units;
- primary buttons/inputs have at least 50-unit height; auth mode and text-action controls have at least 48-unit height;
- disabled/loading conditions are wired to repaired auth and cleanup actions;
- critical auth colors have static normal-text contrast at or above 4.5:1 (`#ffffff` on `#4554e0` ≈ 5.84:1; `#64748b` on white ≈ 4.76:1);
- recovery feedback text `#1e293b` has 13.08–13.97:1 contrast on its info/success/error surfaces; validation `#be123c` is 6.29:1 on white;
- default React Native font scaling was not disabled.

TalkBack order/announcements and disabled/busy-state runtime acceptance are BLOCKED because the selected minimal Google APIs image contains no TalkBack/accessibility package or resolvable activity; exact output is retained in the evidence directory. Hardware-keyboard Tab focus and submit were used successfully, including at compact/large-font states. All six required 2.0 surfaces were captured with reachable actions; Home navigation labels visibly wrap/truncate. Password-manager interaction and physical-touch target validation were not separately exercised. VoiceOver, Reduce Transparency, and iOS material behavior cannot run on the Windows host. Broader existing accessibility debt remains in later phases.

## Regressions checked

- No existing endpoint or product destination was removed.
- YÖK, Summer School, Agenda, calendar, announcements, Google Calendar, preferences, account data deletion, and account deletion remain in source.
- The pre-password-recovery snapshot passed root/native TypeScript, focused API/native tests, the 28-file/220-test full regression suite, both web regression builds, and Android Expo export. Recovery checks then passed 24/24 focused API/schema and 9/9 password-recovery tests. Final reconciliation passed native/workspace TypeScript, focused native/API suites, the 23-file/157-test API suite, both 29-file/240-test full-suite forms, both admin/mobile build forms, and both final Android/Hermes export forms.
- API refresh rotation and token-reuse rejection remain covered.
- Strict endpoint catalog coverage now includes Google and resend without weakening existing entries.
- No password, refresh/access token, verification/deletion code, email address, or personal exam title is intentionally written to repaired diagnostic paths.
- No dependency, Expo, React Native, or UI-framework version changed.
- Native PASS claims are limited to the exact registered flows/captures. Fixture-conditional and hardware-handler boundaries are stated explicitly rather than mislabeled as direct device observations.

## Historical limitations and open risks at the original closure

1. **Recent authentication:** `DELETE /me` and `DELETE /me/data` have no backend reauthentication challenge/proof. This cannot be made trustworthy only in the client (MN-026).
2. **Server cleanup uncertainty:** an offline logout can safely clear the device after durable tombstoning, but server refresh-token revocation may remain unconfirmed and is shown as such.
3. **Google remote lifecycle:** native authorization cannot be force-aborted; REST cancellation cannot undo mutations already accepted remotely; managed events and OAuth grant cleanup/revoke UX remain Phase 3 (MN-006).
4. **Rate-limit client identity:** per-client isolation behind Cloud Run/reverse proxies depends on trusted-proxy configuration not changed in this no-infrastructure phase (MN-027).
5. **Recovery timing:** production status/body fields match, but eligible known requests can await more storage/SMTP work than unknown requests; timing-based account inference remains possible (MN-030).
6. **Recovery multi-write atomicity:** code consumption is atomic, but password update, session revocation, and remaining-record invalidation are sequential and need transaction/saga or reconciliation hardening (MN-031).
   Task A1 only lays down generation-safe persistence; Task A2 owns generation advancement/enforcement and atomic reset completion.
7. **Rendered/native automation:** no React Native component runner or native E2E harness exists (MN-019).
8. **Visual/accessibility runtime:** Android environment, required flows, 360/320 dp, and the complete six-surface 200%-font set are available. Home nav labels wrap/truncate and recovery placeholders truncate at 2.0. TalkBack is exactly unavailable on the retained image and is not claimed as accepted screen-reader behavior (MN-025/MN-029).
9. **Broader feedback UI:** endpoint-aware auth copy is repaired, but the existing global top message pattern still needs the planned design-system/auth UI phases (MN-009).
10. **Manual-exam features:** isolation/persistence are repaired; edit/delete functionality remains Phase 9.
11. **Effective AVD storage/heap:** the API 24 image reports a 384 MB heap and approximately 5.8 GB `/data`; post-boot config normalized the requested 2,047 MB data value to 6,442,450,944 bytes. Earlier API image attempts also forced larger values (MN-028).

## Migration and rollback considerations

- No destructive database migration is required. Password-recovery persistence adds repository/schema/index support; old deployments have no recovery records to migrate.
- Task A1 adds no migration or new index. Existing user, refresh-token, and recovery records with no `credentialGeneration` read as `0`; new users also begin at `0`.
- Until Task A2 advances or enforces generations, rollback is behaviorally compatible: older code ignores the additive fields and restored A1 code normalizes missing fields to `0`. Access JWTs are unchanged.
- Production must provide `PASSWORD_RECOVERY_TOKEN_PEPPER` or an existing `JWT_ACCESS_SECRET` of at least 32 characters before password-recovery request handling is allowed. Rollback may leave expired/unused recovery records, which contain only digests and can be cleaned by repository retention without exposing codes.
- The controlled `errorCode` fields and resend timing fields are additive. Older clients can continue reading status/message; repaired clients prefer codes.
- Academic selection changes semantics from partial descendant retention to complete replacement. Any client that intended to retain faculty/department/class level must submit the complete valid hierarchy. Roll out server/client changes together and keep the repository-adapter tests as the rollback gate.
- The v2 manual-exam key is ignored by older builds. Owner-unknown `native_manual_exams` is deleted and cannot be reconstructed; this is an intentional privacy decision, not reversible migration loss.
- Owner-scoped Google metadata can be ignored by an older build. Legacy Google metadata is removed after a verified owner match or discarded when invalid/mismatched.
- A rolled-back build that encounters the session tombstone cannot parse it as a session and should delete/log out; it must never be converted back into credentials.
- Pending verification state contains no secret and can be safely ignored/deleted by a rollback.
- Rollback must be a targeted code change reviewed against these storage/API boundaries. Do not restore stale academic descendants or owner-unknown local content, and do not reset the user's existing working tree.

## Historical Phase 2 handoff — do not start automatically

Phase 2 may begin only after the user explicitly requests it. Its first task is the separate content-trust contract: HTML entity/sanitization, publication-versus-crawl timestamps, URL scheme/official-source validation, selector error/no-results visibility, Summer refresh correctness, and URL-less card behavior.

The Phase 2 worker must preserve the Phase 1 invariants:

- wait for hydration readiness;
- capture an owner-generation snapshot for user-scoped content work;
- propagate cancellation/timeout signals;
- reject stale state/storage completion after account change;
- never display raw server/crawler payloads;
- do not weaken owner-scoped storage or durable session tombstoning.

No Phase 2 source work was performed in this phase.

## Initial Git baseline and closure checkpoint

- Branch: `agent/google-play-readiness-20260724`
- Initial closure HEAD: `cbd0067b03c3cf7286270df25164a556c55b55b9`
- Upstream shown by Git: `origin/agent/google-play-readiness-20260724`
- Final scoped local checkpoint commit: PASS — this scoped commit; exact SHA reported in the final response because a commit cannot contain its own hash.
- Push/deploy/publish/production mutation: none authorized or performed.

Historical `git status --short --branch` captured before the final password-recovery/Android closure additions follows. It is preserved as initial-state evidence and must not be mistaken for the final post-checkpoint status:

```text
## agent/google-play-readiness-20260724...origin/agent/google-play-readiness-20260724
 M README.md
 M apps/api/src/common/guards/rate-limit.guard.ts
 M apps/api/src/contracts/endpoint-catalog.ts
 M apps/api/src/modules/auth/auth-application.service.ts
 M apps/api/src/modules/auth/auth.dto.ts
 M apps/api/src/modules/auth/email-verification-sender.service.ts
 M apps/api/src/modules/auth/firestore-auth.repository.ts
 M apps/api/src/modules/auth/in-memory-auth.repository.ts
 M apps/api/src/modules/auth/mongo-auth.repository.ts
 M apps/api/src/modules/users/users.service.ts
 M apps/api/tests/auth-application.service.test.ts
 M apps/api/tests/email-verification-sender.test.ts
 M apps/api/tests/operations.test.ts
 M apps/api/tests/users-and-guards.test.ts
 M apps/mobile-native/App.tsx
 M apps/mobile-native/src/google-calendar/google-calendar-sync.ts
 M docs/04-security-hardening.md
 M docs/15-firebase-deploy.md
 M tests/unit/google-calendar-sync.test.ts
?? anssoftlogo.svg
?? apps/api/src/modules/auth/auth.constants.ts
?? apps/api/tests/auth-academic-selection-repositories.test.ts
?? apps/api/tests/auth-http-contract.integration.test.ts
?? apps/mobile-native/assets/anssoftlogo.svg
?? apps/mobile-native/src/auth/
?? apps/mobile-native/src/session-integrity/
?? data/missing-announcement-links-academic-units.csv
?? data/missing-announcement-links-by-university.csv
?? data/missing-announcement-links-universities.csv
?? docs/19-mobile-native-current-state-ui-ux-audit.md
?? docs/20-mobile-native-in-app-user-activity-report.md
?? docs/missing-announcement-links-report.md
?? docs/mobile-native-redesign/
?? prompts/
?? tests/unit/mobile-native-auth-recovery.test.ts
?? tests/unit/mobile-native-session-integrity.test.ts
```

The untracked logos, data reports, prompt set, missing-link report, and pre-existing redesign tree are preserved. Their presence is not evidence that Phase 1 created or approved unrelated work.
