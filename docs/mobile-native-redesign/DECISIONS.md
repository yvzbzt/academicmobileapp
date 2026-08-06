# Redesign Decisions

Last updated: 6 August 2026

## Accepted decisions

Decisions are append-only historical records. D-051 records the current Phase
11 cross-platform quality boundary. It supplements D-037 through D-050 and
supersedes their earlier future-phase or incomplete-quality wording where they
conflict. Earlier text remains evidence of what was true at its checkpoint, not
a description of the current source tree.

### D-001 — Incremental redesign in the existing native app

**Decision:** Evolve `apps/mobile-native`; do not rebuild it as a separate application. Preserve backend contracts unless a numbered phase explicitly changes and tests them.

**Why:** The existing app already contains authentication, academic profile selection, calendar/announcement data, Google Calendar sync, notification preferences, and deletion flows. Rebuilding would hide regressions and risk losing working behavior.

### D-002 — Four primary authenticated destinations

**Decision:** Target Home, Announcements, Calendar, and Profile. Authentication/onboarding are outside the tab shell.

**Migration:** Current Summer School and YÖK capabilities move into the Announcements information architecture. Current Agenda becomes Announcements. Manual exams and Google Calendar remain owned by Calendar even if Home provides shortcuts or summaries.

### D-003 — Content-first, not dashboard-first

**Decision:** Prioritize source identity, publication time, title, summary/media when useful, and a small set of real actions. Avoid nested dashboard cards, oversized marketing heroes, and decorative metrics without a student task.

### D-004 — Distinct academic indigo brand

**Decision:** Use the semantic indigo palette in `DESIGN_SYSTEM.md`, not LinkedIn blue. ANSSOFT identity may appear in launch/about/legal contexts without competing with the Academic Calendar product name.

### D-005 — Shared semantics, platform-specific chrome

**Decision:** Share tokens, data contracts, accessibility meaning, and content anatomy. Permit `.ios.tsx` / `.android.tsx` wrappers where navigation, sheets, feedback, motion, or material legitimately differs.

### D-006 — Opaque content surfaces

**Decision:** Main feed cards, forms, destructive controls, and reading surfaces stay opaque and high contrast. On supported iOS versions, translucent material is limited to navigation/control chrome and must degrade gracefully when Reduce Transparency is enabled or material APIs are unavailable.

### D-007 — Real actions only

**Decision:** Do not add likes, comments, reposts, connection counts, or fake engagement. Save, Share, Add to Calendar, and Open Official Source appear only when their behavior, failure state, accessibility, and persistence contract are real.

### D-008 — Virtualized long collections

**Decision:** Feed and selector implementations must use `FlatList`, `SectionList`, or an equally justified virtualized primitive. A page-wide `ScrollView` that mounts an unbounded feed is not an acceptable target.

### D-009 — Evidence before visual acceptance

**Decision:** Semantic component tests, contract/unit tests, native build smoke, and native screenshots are separate evidence categories. Web screenshots cannot satisfy native visual QA.

### D-010 — No framework churn in Phase 0

**Decision:** Phase 0 installs or upgrades nothing. Phase 4 must choose a single native component-test stack after confirming compatibility with Expo 54 / React Native 0.81.5. Do not install competing frameworks.

### D-011 — Turkish-first copy with localization seams

**Decision:** User-facing copy remains Turkish. New components must avoid sentence fragments assembled from hard-coded word order and must centralize reusable labels/error categories so later localization does not require component rewrites.

### D-012 — Trust precedes redesign

**Decision:** Phase 1 fixes account/session ownership; Phase 2 fixes content trust; Phase 3 reconciles integration promises. Visual phases must not normalize known-broken behavior by merely restyling it.

### D-013 — Verification recovery stores no secret

**Decision:** Persist only normalized email, verification expiry, and resend cooldown under `native_pending_email_verification`. Never persist the registration password or verification code. Verification activates the email identity only; login and refresh-session creation happen later as a separately reported result.

**Compatibility:** A relaunch can resume verification and resend without the password. After successful verification following a relaunch, the user must enter the password on Login. This is intentional because the client has no safe reason to retain it.

### D-014 — Every authenticated completion belongs to an account generation

**Decision:** A generation snapshot contains both owner ID and generation. Login/session activation creates a generation; logout, expiry, data deletion, account deletion, and replacement invalidate it and abort registered requests. A response may update React state or persistent owner data only while its snapshot is current.

**Why:** Access-token equality alone does not protect account switching, refresh rotation, native Google authorization, or queued storage writes.

### D-015 — Owner-unknown legacy exams are discarded

**Decision:** Manual exams use an owner-encoded v2 key and an envelope containing `schemaVersion`, `ownerId`, validated exam fields, and `updatedAt`. The old global `native_manual_exams` value has no trustworthy owner proof, so it is deleted and not assigned to the account that happens to sign in first.

**Rollback:** The v2 records are left intact if the app rolls back, but the old build cannot read them. The deleted owner-unknown legacy payload cannot be reconstructed by design. A future migration may import legacy content only when an independent, verified owner ID is available.

### D-016 — Auth failures use controlled codes and fixed copy

**Decision:** Auth endpoints return a stable `errorCode`; the native client maps that code plus endpoint context to fixed Turkish copy. Untrusted response bodies are never displayed. Supported outcomes distinguish invalid credentials, unverified email, invalid/expired verification, invalid/expired session, disabled account, and rate limiting.

### D-017 — Local cleanup is observable and server cleanup may be uncertain

**Decision:** Logout and account deletion first serialize a non-secret invalidation tombstone over `native_session`. Only after that durable write succeeds may the account generation be invalidated and authenticated UI state be cleared. If the tombstone write fails, the destructive action does not advance, the still-authenticated state remains visible, and a controlled retry is offered. Once the tombstone is durable, physical key deletion is best-effort compaction: even if removal fails, no token remains at that key and cold-start restoration treats the tombstone as logged out.

Server revocation/deletion and the remaining local/Google cleanup tasks run after the local session can no longer resurrect the account. Terminal cleanup also clears pending-verification memory/storage so a previous account's recovery state cannot reappear. Failure is represented only by controlled target identifiers. Unconfirmed server revocation does not restore personal UI state; failures to remove pending verification, owner-scoped manual-exam, or Google metadata remain visible and retryable.

**Known backend gap:** Account deletion has no recent-authentication challenge or reauthentication token contract. Phase 1 cannot add a client-only guarantee; this remains documented until the backend supports it.

### D-018 — Academic selection is a replacement contract

**Decision:** `/me/university` validates the complete submitted hierarchy. Omitted faculty, department, and class level are removed by every repository adapter. Native selection sends only real user selections and no longer invents `classLevel: 2`.

### D-019 — Hydration is an explicit root state and refresh precedes readiness

**Decision:** Cold start has `loading`, `error`, and `ready` hydration states. Login and Home are not stable root surfaces until a device ID exists, the stored session has been parsed, any stored refresh token has been rotated against that device ID, owner-scoped storage has been restored, and the initial authenticated context has settled. A recoverable startup failure renders a labelled retry state instead of silently presenting Login or stale Home.

**Compatibility:** A controlled expired/invalid/disabled session is cleared and reaches Login. Storage, network, or unexpected restoration failure stays on the hydration error boundary so it cannot be mistaken for an intentional logout.

### D-020 — Session writes and authenticated completions are bounded and serialized

**Decision:** SecureStore mutations use one serialized queue. A live-session write is rejected while account cleanup is locked, and refresh persistence rechecks both its owner-generation snapshot and the cleanup lock. Authenticated API requests register abort controllers and use a 15-second default timeout that remains active through response-body consumption; logout and account deletion use an explicit 8-second server-cleanup bound. Stale or aborted results cannot update state or owner storage.

**Why:** A generation check at fetch start is insufficient. Refresh rotation, JSON parsing, a queued SecureStore write, or a retry can otherwise settle after the account has been closed.

### D-021 — Destructive data work has a mutation barrier

**Decision:** Logout, data deletion, and account deletion establish a cleanup lock that blocks new authenticated mutations. Data deletion waits for already-tracked academic-selection and preference mutations before issuing `DELETE /me/data`; successful deletion then invalidates/aborts the prior generation before resetting and reactivating the same owner. Google REST requests receive the same abort signal, while Google native SDK operations are serialized and protected by an epoch because the SDK authorization prompt itself is not abortable.

**Known boundary:** Cancellation prevents stale local settlement but cannot guarantee transaction-like rollback of Google Calendar mutations already accepted remotely. Phase 3 now supplies explicit disconnect, revoke, remote-removal, mapping verification, and partial-result behavior; it does not erase that provider-side atomicity boundary.

### D-022 — Password recovery has a production public-field-parity contract

**Decision:** In production, `POST /auth/password-recovery/request` always returns the same public status/body fields for a syntactically valid known or unknown email address. An accepted request issues a cryptographically random six-digit code with a ten-minute lifetime and a sixty-second resend cooldown. Only an email-domain-separated HMAC-SHA-256 digest is persisted; a newer accepted request invalidates older active recovery material, a successful confirmation consumes the code once, and all existing refresh sessions for the account are revoked after the password is replaced.

**Native boundary:** Login exposes the reachable Turkish-first `Şifremi unuttum` action. Request, code entry, new-password entry, confirmation, resend, error, success, Back, and cancellation states remain inside the existing authentication shell. The code, new password, and password confirmation exist only in memory and are cleared on completion, cancellation, or return to Login. Password-recovery state is intentionally not restored after process death because no recovery secret may be persisted.

**Security boundary:** Production fails closed unless `PASSWORD_RECOVERY_TOKEN_PEPPER` or the existing JWT access secret provides at least 32 characters of key material. Non-production may return `previewRecoveryCode` to isolated development/test fixtures; production never returns it. Controlled outcomes are `AUTH_PASSWORD_RECOVERY_CODE_INVALID`, `AUTH_PASSWORD_RECOVERY_CODE_EXPIRED`, `AUTH_PASSWORD_CONFIRMATION_MISMATCH`, `AUTH_PASSWORD_INVALID`, and `AUTH_RATE_LIMITED`. Raw server payloads and recovery secrets never become UI copy or logs.

**Known backend boundaries:** Public field equality is not latency equality. Unknown requests return after less work, while an eligible known request can await persistence and SMTP, so timing-based account inference remains possible. Confirmation conditionally consumes the code atomically, but password replacement, refresh-session revocation, and invalidation of remaining material are sequential repository operations rather than one transaction; a later failure can leave partial completion. Do not claim timing resistance or all-or-nothing reset semantics until those paths are explicitly hardened.

### D-023 — Native evidence records configured and effective emulator limits separately

**Decision:** Phase 1 closure uses one official Google Android Studio Stable installation, one Google APIs x86_64 system image, and exactly one AVD named `AcademicPhase1Low`. Configuration files and runtime-reported values are both evidence; a configured value must not be presented as an effective runtime value when the system image or emulator overrides it.

**Recorded closure environment:** Android Studio product build `AI-261.25134.95.2612.15822958` (winget package version `2026.1.2.10`), command-line tools revision 22 installed at the recognized noncanonical `cmdline-tools/latest-2` path, Emulator `36.6.11`, and Google APIs API 24 x86_64 revision 27. The AVD was requested/prelaunch-configured for 1,536 MB RAM, two cores, 720 × 1280 at 320 dpi, 256 MB heap, 2,047 MB data, host GPU, cameras/audio/device frame off, hardware keyboard on, and Quick Boot on.

**Effective-value disclosure:** WHPX acceleration is usable and the first cold boot completed in 42.3 seconds. Runtime reports 1,533,960 kB RAM, two cores, 720 × 1280 at 320 dpi, a 384 MB heap, and approximately 5.8 GB for `/data`; the post-boot `config.ini` was normalized to 6,442,450,944 bytes for the data partition while retaining `vm.heapSize=256M`. API 36, 34, 30, and 28 Google APIs images were tried before API 24; those images also forced heap/data values above the requested budget. The effective heap/data deviation remains visible evidence and cannot be relabelled as the requested 256 MB/≤4 GB configuration.

### D-024 — Credential generations have a backward-compatible persistence substrate

**Decision:** Every auth user, refresh-token record, and password-recovery record has a non-negative integer `credentialGeneration`. A legacy record with no field is read as generation `0`, and every newly created user starts at `0`. New refresh-token and password-recovery records copy the current user's generation at issuance time.

**Writer safety:** Existing-user mutations must not accept `credentialGeneration` from a stale or caller-controlled user object. Firestore uses field-level updates and explicit field deletions instead of full-document replacement; Mongo strips the field from general user-update input and retains partial `$set`/`$unset` writes; the in-memory adapter reads and writes its current map entry without an intervening await. University/faculty replacement continues to delete omitted descendants in every adapter.

**Deferred enforcement:** Task A1 does not advance the generation and does not reject refresh or recovery material on a mismatch. Generation increment, mismatch enforcement, and an atomic password-reset completion operation belong to Task A2. Existing access JWTs are unchanged. The substrate requires no migration, new index, or environment variable; while no generation is advanced, rollback remains compatible because missing fields read as `0`.

**Unchanged boundaries:** MN-031 remains open because the password-reset execution order is still consume, password update, refresh-session revocation, then remaining-token invalidation. MN-030 remains open because recovery-request latency is not equalized. Task B and Phase 2 are not started by this decision.

### D-025 — MongoDB is the sole API runtime persistence

**Decision:** The API binds all seven runtime repository tokens—auth/users, catalog, calendars, announcements, PDF processing, notifications, and audit logs—directly to their Mongo implementations. `REPOSITORY_MODE` and `repositoryMode` are no longer runtime inputs, `MONGODB_URI` is required at every API startup, Mongo readiness is unconditional, and catalog bootstrap always uses the shared repository contract.

**Temporary source boundary:** Firestore and in-memory repository source files remain physically present during R1A but are unreachable from `AppModule`; removing or relocating them is deferred to R1C. This wiring checkpoint does not reconcile adapter behavior, change repository contracts, or alter the A1 `credentialGeneration` substrate.

**Compatibility and operations:** Firebase Authentication, Google Sign-In/OAuth, Firebase Cloud Messaging, Firebase Hosting, `firebase`, and `firebase-admin` remain supported. No migration, dependency removal, deployment, production-data access, Task A2, Task B, Phase 2, or UI work is part of R1A.

### D-026 — User academic suggestions and followed scopes are Mongo-backed

**Decision:** Academic-unit suggestions and followed academic scopes live behind a focused `UserDataRepository` contract whose sole runtime implementation is `MongoUserDataRepository`. `UsersService` delegates these operations to the repository instead of retaining process-local arrays. Existing routes, request/response fields, role gates, suggestion review behavior, and university/faculty/department semantics remain unchanged.

**Persistence contract:** `academic_unit_suggestions` retains ownership, submitter email, university, faculty/department names, education level, pending/approved/rejected status, creation time, and the existing review time. `followed_academic_scopes` retains owner plus university/faculty/department scope and creation time. A stored normalized-scope key and a unique owner/key index make repeated follows idempotent while keeping distinct valid hierarchy scopes separate.

**Lifecycle and migration:** Personal-data clearing, self-account deletion with either value of `deleteData`, and administrative account deletion remove both data families. Records formerly held in `UsersService` existed only for the lifetime of one API process and provide no reliable persistent migration source, so R1B deliberately creates and runs no migration for them.

**Evidence boundary:** R1B combines deterministic Mongoose model doubles and a test-only `UserDataRepository` fixture with a focused create/read, index, concurrent-upsert, and cleanup integration test against the existing local/CI Mongo 7 service. That integration test uses a guarded `academic_user_data_r1b_test_<pid>` database and drops only that database before and after the test. It does not claim a Mongo reconnect, API-process restart, or durable-disk smoke. Firestore adapter removal remains R1C, and Mongo reconnect plus full live persistence smoke verification remains R1D. No deployment, production-data access, dependency/lockfile change, native application change, Task A2, Task B, Phase 2, or UI work is part of R1B.

### D-027 — Firestore database persistence is removed from the API

**Decision:** R1C1 deletes the Firestore database service, its shared conversion utilities, and the auth, catalog, calendar, announcement, PDF, notification, and audit Firestore repository adapters. The seven runtime repository tokens remain direct Mongo bindings, and `MongoUserDataRepository` remains the sole runtime user-data implementation. No production API source can import or instantiate a Firestore database adapter.

**Supersession:** The Firestore writer details in D-024 and the temporary source boundary in D-025 remain historical A1/R1A evidence. This decision supersedes them for the current source tree. The A1 `credentialGeneration` contract is unchanged on Mongo: missing values still read as `0`, refresh and recovery records retain their stamped generation, and Mongo user writers preserve a concurrently newer stored generation.

**Coverage:** Eleven adapter-only test executions were removed: one legacy-generation/update case, nine stale-writer rows, and one academic-descendant case. Shared behavior remains covered by a Mongo legacy-generation case, nine one-for-one Mongo stale-writer cases, strengthened Mongo `$set`/`$unset` descendant assertions, and the existing in-memory repository-contract tests. Two explicit module-resolution tests retain Firebase Authentication verification and FCM coverage. The full suite remains 32 files / 299 tests.

**Retained services and dependencies:** Firebase Authentication, `FirebaseAdminService`, Google Sign-In/OAuth, Firebase Cloud Messaging, Firebase Hosting, `firebase`, `firebase-admin`, their environment values, `firebase.json`, and `.firebaserc` remain supported. Firestore-related packages may remain transitively in the unchanged lockfile because retained Firebase packages depend on them; they do not provide an API persistence path.

**Operations and remaining boundary:** R1C1 runs no migration, deployment, publish, push, or production-data access. Existing historical Firestore-only data, if any, is not inspected or migrated. Production in-memory repository source remains runtime-unreachable and moves to test-only support only in R1C2. Mongo reconnect and durable persistence smoke evidence remain R1D. Task A2, Task B, Phase 2, and UI work remain unstarted.

### D-028 — Source-derived academic content has one fail-closed trust boundary

**Decision:** Source publication time, source update time, discovery time, and crawl/fetch time are separate fields. `publishedAt` and `sourceUpdatedAt` are emitted only when their provenance is the source itself. `discoveredAt` and `fetchedAt` are operational observations and may never become publication labels.

**Trust contract:** The stored source record is authoritative for identity, academic scope, official homepage, and domain. Both item and source must be explicitly `trusted`; absent, rejected, quarantined, inactive, mismatched, unsafe, unofficial, or source-less records fail closed before the mobile DTO boundary. Display text is recursively entity-decoded and sanitized, navigation/chrome titles are rejected, and normalized display titles retain a persistence-only `rawTitle` for audit. Direct legacy Mongo inserts default to quarantine.

**URL and duplicate contract:** Only credential-free HTTP/HTTPS URLs on the source's official `edu.tr` or `gov.tr` authority are accepted. Private, loopback, link-local, IPv4/IPv6-mapped, unsafe-scheme, and nonstandard-port URLs are rejected. Canonicalization removes fragments and tracking noise, sorts query parameters, normalizes host aliases, and preserves case-sensitive path/query semantics. Canonical duplicates select one deterministic trusted survivor.

**Mobile availability contract:** Existing array endpoints remain compatible. Additive `/announcements/my/trusted` and `/announcements/yok/trusted` envelopes expose item state, source count, and failed-source count so a failed source with no cache is not mislabeled as an empty feed. Summer School adds the same source-health semantics. Native rendering revalidates URLs, preserves verified data after refresh failure, and represents partial/stale states without redesigning the screens.

**Unchanged boundaries:** MongoDB remains the only runtime database. Firebase Authentication, Google Sign-In/OAuth, FCM, Hosting, password recovery, Google Calendar behavior, navigation, and visual design are unchanged.

### D-029 — Stored content repair is explicit, optimistic, and repeatable

**Decision:** Historical announcement repair is performed only by `npm.cmd run reconcile:content-trust`. It is dry-run by default; apply mode requires `--apply` plus an exact `--confirm-database=<name>`. The planner is deterministic and idempotent, preserves raw titles and explicit rejection/quarantine decisions, separates timestamp provenance, resolves canonical collisions without violating legacy unique indexes, and validates scope authority including the runtime YÖK scope.

**Safety boundary:** Apply mode batches per-document writes and verifies a preimage plus `updatedAt` before each mutation. Any source conflict prevents item mutations for that plan, returns a conflict exit status, and requires a new dry-run. The operation is not a transaction, creates no backup, and exact database-name confirmation is not proof that an environment is non-production. Operators must back up first, use an authorized non-production clone, and repeat dry-run/apply until the plan reports zero mutations. Phase 2 did not connect to or reconcile any database.

### D-030 — Audit evidence, source time, and source health remain distinct

**Decision:** `rawTitle` is the exact source-title string captured by the parser and is never normalized, Unicode-folded, or truncated before persistence. Display title and summary are separately decoded, sanitized, length-bounded fields. Unrecognized residual entity syntax is removed from display output rather than passed through; audit evidence remains available only in persistence and never crosses the mobile DTO.

**Timestamp boundary:** A date appearing in arbitrary title text is not publication provenance. Generic parsing accepts publication/update time only from source metadata, labelled text, or explicit time attributes. A leading title date may be treated as publication time only in a narrowly identified source adapter whose listing convention is covered by a deterministic fixture/test. Discovery and fetch time remain operational fields.

**Duplicate and health boundary:** Canonical duplicates prefer source publication/update evidence before discovery/fetch recency. A fresh cache does not erase persisted source failure: explicit `degraded`/`failed` health or a nonzero failure count makes the collection partial. Re-registering static/YÖK sources must preserve existing health metadata.

**Reconciliation boundary:** Missing, rejected, or quarantined source ownership still blocks API presentation, but it no longer short-circuits repair. The reconciliation planner sanitizes titles/summaries, canonicalizes or removes unsafe URLs, removes false source authority/dedupe values, and validates timestamp provenance before retaining the fail-closed status. The executable mutation helper and runtime scope-authority builder are tested directly without connecting to MongoDB.

### D-031 — Push delivery requires consent, native permission, and an owned installation

**Decision:** A saved notification preference is not proof of delivery. New preferences default to disabled, hydration inspects permission without prompting, and the native permission dialog is requested only after the user explicitly enables notifications. Delivery is presented as active only while the preference is enabled, OS permission is granted, and the current app installation is registered with the backend. Denial, permanent denial, unavailable native support, token failure, registration failure, and detach failure remain distinct controlled states; a permanently denied user is directed to system settings.

**Installation contract:** The native app obtains the platform FCM registration token through React Native Firebase and listens for token rotation. It sends the token with the stable app installation ID to `POST /devices/register`; the API domain-separates and SHA-256 hashes the installation ID before persistence. Registration rotates a token in place for the same installation, rejects an active token or installation owned by another account with HTTP 409, and returns only status, platform, and `lastSeenAt`. `DELETE /devices/current` disables the owner-matching installation idempotently. Logout also attempts server-side detachment from the refresh record's device ID; data deletion, self-account deletion, and administrative deletion remove notification records.

**Delivery and destination contract:** FCM success, invalid-token, provider-unavailable, and provider-rejected outcomes are explicit; a provider error cannot be recorded as sent, and an invalid token is disabled. Delivery audits retain `deviceTokenId`, never the raw token. Concurrent workers must acquire one atomic UUID-fenced claim with a ten-minute recovery lease before fan-out; a stale worker cannot complete or reschedule a reclaimed job. Immediately before every provider call the worker re-reads the active device record and skips a registration whose owner, installation hash, or token changed. Provider-visible title/body text is generic; trusted detail is resolved only inside the authenticated app. Android uses `academic-reminders` and `academic-updates` channels.

Version 1 push data contains only an exact `announcement` or `calendar_event` destination ID plus the recipient owner ID. A signed-out tap may persist that non-secret, owner-bound destination. After authentication the app calls `GET /announcements/my/trusted/:announcementId` or `GET /calendar/my/trusted/:eventId`, which applies the current owner/scope/publication/trust rules without the collection caps. Missing, malformed, inactive, out-of-scope, or untrusted records share a 404 boundary. The app rejects wrong/stale owners and never falls back to an unrelated item or an unvalidated URL.

**Privacy boundary:** A push token is delivery credential material. It may exist in the native provider SDK, the Mongo `device_tokens` collection, and an outbound FCM request, but it is not stored in delivery audit rows, returned by registration APIs, persisted in native lifecycle state, or included in application logs. Real provider delivery still requires authorized Firebase/APNs configuration and separate native evidence.

### D-032 — Google Calendar connection is live-verified, owner-scoped, and remotely explicit

**Decision:** Stored Google metadata is a reconnect hint, not a connected state. Owner-scoped v3 metadata stores the stable Google account ID, email, last authorization verification/sync times, and source-to-Google event mappings without an access token. Restore enters `checking`, reads the current SDK account and token without showing a chooser, and calls the Calendar API before it may become `connected`. A missing, expired, mismatched, or unverifiable provider session is shown as `expired`, `error`, or `disconnected`; legacy metadata migrates only after the same live verification.

**Preflight and synchronization:** Profile ownership, network state, current academic calendar data, and trusted announcement data are checked before any Google account or scope prompt. No university, no network, no transferable content, a stale owner, a duplicate operation, or duplicate stored mappings stops before mutation. Calendar entries use source-authored `publishedAt`, or source-authored `sourceUpdatedAt` when publication is absent; discovery, crawl, and `fetchedAt` timestamps are never calendar dates. App-created events carry private owner/source/fingerprint properties. A live mapping match makes a repeat sync non-mutating. Missing remote events are deleted only for source families whose current fetch is complete; a source-only/unknown calendar response or partial/failed announcement response may create/update known items but cannot delete that family.

Collection limits are not deletion evidence. After live Google verification, every managed mapping absent from the current capped announcement/calendar collections is reconciled through the corresponding exact trusted-record endpoint before it can be treated as removed. A trusted exact result is merged into the desired set, an exact 404 is authoritative absence, and lookup/network/malformed-ID failure blocks deletion for that family. Create, update, delete, and final verification failures produce a durable `partial` state and retained mappings for retry.

**User choices and cleanup:** Account change first asks whether old app-managed events should remain or be removed, then disconnects before opening the chooser. Choosing to keep them makes those old-account records an intentional residual set: the new-account ledger replaces the old one, so later data/account deletion cannot remove them unless the user reconnects that Google account. The integration exposes three separate ordinary actions: disconnect and retain events, remove app-managed events and disconnect, or revoke Google access while retaining existing events. Disconnect/revoke retain a token-free `disconnected` v3 ledger so deletion for the same app owner can still attempt cleanup after reauthorization; successful managed-event removal clears it. Personal Google events are never selected for update or deletion; all remote mutations require both the app-managed marker and current Academic Calendar owner ID. Logout and session expiry clear local connection metadata and sign out locally while deliberately retaining the OAuth grant and existing managed events. Personal-data and account deletion attempt removal known through the current ledger, then OAuth revocation, then local metadata cleanup; partial/unavailable cleanup is reported by controlled retry targets rather than hidden.

**Data-residency boundary:** Academic titles, dates, descriptions, and official source links selected for sync travel directly from the device to the user's Google Calendar through Google's Calendar API. The app backend does not proxy or persist the Google event bodies or access token. The device retains only non-secret connection metadata and mappings in SecureStore. The Google account/provider remains an external data processor chosen by the user.

### D-033 — Dormant device-calendar code is retained as non-product reference

**Decision:** `apps/mobile-native/src/native-calendar` remains in the repository because its pure mapping/synchronization logic and tests may inform a later approved device-calendar feature. It is not imported by `App.tsx`, has no installed platform calendar adapter/dependency, requests no device-calendar permission, exposes no UI, and performs no runtime synchronization. Phase 3 therefore does not present it as a working integration.

**Activation gate:** Wiring it into the product would require a separately approved scope covering platform permission copy, calendar selection, owner-scoped persistence, remove/disconnect behavior, real iOS/Android evidence, and interaction with the active Google Calendar path. Retaining source code alone satisfies none of those gates.

### D-034 — Native Firebase 26 uses the Expo 54 New Architecture path

**Decision:** Phase 3 enables `newArchEnabled` in the committed Expo configuration because React Native Firebase App/Messaging 26 requires the React Native New Architecture. This is integration compatibility work, not the Phase 4 component/framework decision and not an Expo or React Native upgrade.

**Evidence boundary:** The generated Android project was aligned locally, Google Sign-In codegen was regenerated after the architecture switch, and the final x86_64 debug assembly and API 24 launch passed with Fabric active. The repository does not commit generated native projects or provider credentials. iOS still requires an authorized Firebase plist plus macOS/Xcode build evidence and is not accepted on this Windows run.

### D-035 — Phase 4 owns navigation mechanics; Phase 5 owns shell presentation

**Decision:** The execution brief supersedes the earlier planning note that deferred a route tree to Phase 5. Phase 4 adopts React Navigation 7 with native stack and bottom-tab adapters. Hydration, auth, onboarding, authenticated tabs, announcement detail, calendar detail, settings, and a non-echoing unknown fallback are real routes now. At the Phase 4 checkpoint, Phase 5 remained unstarted and owned later app-shell presentation rather than route mechanics; its completed shell decision is now recorded by D-038.

**State boundary:** Existing session, account-generation, verification/recovery, notification, content-trust, Google lifecycle, cancellation, and cleanup owners remain above or within their Phase 1–3 modules. Navigation params contain only allowlisted route identifiers. No token, secret, full content record, or navigation-state snapshot is persisted. A protected request cannot dispatch until the authenticated tree exists. The Phase 3 pending notification record remains owner/generation bound, receives an exact trusted-record lookup, wins over default Home after auth, and is cleared only after the navigator accepts the verified detail request.

**Back and linking:** Four tabs use history behavior. Native child stacks provide ordinary Android system Back and eligible iOS swipe-back; an active owned operation temporarily blocks abandonment. Static `academicpulse` routes are exact allowlist matches, arbitrary query/path variants fail to `UnknownRoute`, and raw untrusted URLs are not copied into fallback state or UI.

### D-036 — Jest Expo plus React Native Testing Library is the single component stack

**Decision:** Phase 4 installs Jest 29, `jest-expo` 54, and React Native Testing Library 13.3 under `apps/mobile-native`. Native render tests live only under `apps/mobile-native/tests`; root Vitest excludes that directory and continues to own pure route/token/platform/domain tests. There is no competing component runner, snapshot-approval workflow, Storybook, Maestro, or Detox installation.

**Testing contract:** Native tests query roles, names, accessibility state, and visible behavior. They cover primitive interaction/state plus real navigator tabs, one-shot requests, nested detail/back, request gating, malformed-ID fallback, and unknown routing. Jest mocks only the native safe-area and unavailable Liquid Glass boundary needed by the native renderer; pure decision logic remains unmocked in Vitest.

### D-037 — Semantic adaptation is shared; material eligibility is runtime-gated

**Decision:** `src/design-system` is the semantic source for new foundation colors, typography, spacing, radii, elevation/shadow, motion, safe areas, readable widths, and light/dark themes. Android selects Material-style tonal/ripple behavior, 48 dp targets, edge-to-edge screens, bottom tabs, and a large-width rail. iOS selects 44 pt targets and may use `expo-glass-effect` only for navigation/control `NavigationSurface` chrome when the Liquid Glass component and runtime API are both available and Reduce Transparency is off. Opaque semantic chrome is mandatory otherwise.

**Predictive-back boundary:** React Navigation's current integration requires opting out of Android's predictive callback. `predictiveBackGestureEnabled` therefore remains `false`, ordinary system Back is verified, and a pure preview policy is deterministic, but no predictive animation is claimed. Enabling the callback requires upstream navigator support and API 33+ native evidence in Phase 11.

**Migration/rollback:** Automatic system appearance and the new route/design dependencies require no storage or backend migration. Reverting the scoped Phase 4 commit restores the old conditional shell; Phase 1–3 keys and records remain readable because route state and theme preference are not persisted.

### D-038 — Phase 5 presents one four-destination shell with deliberate re-selection

**Decision:** The authenticated shell has exactly four primary destinations and Turkish labels: `HomeTab` / Home / **Ana Sayfa**, `AnnouncementsTab` / Announcements / **Duyurular**, `CalendarTab` / Calendar / **Takvim**, and `ProfileTab` / Profile / **Profil**. `SummerSchool` and the YÖK procedures capability (`YokAnnouncements`) remain nested in the Announcements stack and retain strict protected-link reachability. They are not primary navigation items. This supersedes only D-035's Phase-4-time statement that Phase 5 was unstarted; D-035's route, ownership, and persistence boundaries remain in force.

**History and Back contract:** Each primary destination owns an independent native stack, while the tab router keeps most-recently-used tab history. Re-selecting a nested active tab returns it to its root without a duplicate push. Re-selecting a supported root screen scrolls its existing scroll container to the top, and repeated root taps do not create history. Android Back pops a nested stack before switching through tab history and remains unhandled at the Home root for normal platform exit behavior. An owning operation lock disables the custom top-bar Back action as well as gesture/hardware abandonment. Protected static links and verified notification destinations enter their owning stack without weakening the Phase 3 owner/exact-record guard.

**Top-bar and platform contract:** `AdaptiveTopBar` is the reusable shell header for title, optional subtitle/context, optional leading action, and optional trailing action descriptors. It handles its own top/side safe area. Below 375 dp it uses compact typography and places trailing controls on a wrapping second row; regular widths retain an inline wrapping arrangement. Text is scalable and not line-capped. Shell actions use explicit button labels/states and a 48×48 logical-unit minimum on both platforms. The bar and primary navigation are navigation/control `NavigationSurface` chrome: runtime-eligible iOS may use Liquid Glass, while Reduce Transparency, unavailable iOS material, and Android resolve to opaque tonal chrome; Android controls retain native ripple.

**Large-text and evidence boundary:** Primary labels are 11 logical units on iOS and 12 on Android and remain a single platform-pattern line. The ordinary visual multiplier cap is 1.35; below 375 logical units, larger requested text uses a 1.20 compact cap, an 80 dp Android navigation content area plus bottom system inset, and the full accessible name. Selected state is explicit in accessibility state and icon/indicator shape as well as color. Pure and Jest-renderer tests cover 320 dp, the 200%-font fallback contract, material selection, accessible actions, four-tab mapping, history, re-selection, scroll-to-top, locked Back, nested Back, and destination preservation. Phase 5 Android native visual/interaction evidence is pending final reconciliation, so these tests are not a claim of native no-clipping or 200%-font acceptance. iOS remains unverified on Windows; predictive Back remains disabled pending supported integration and API 33+ evidence; notification-permission/provider acceptance remains outside this decision.

### D-039 — Verification, session activation, and academic onboarding remain separate gates

**Decision:** Phase 6 replaces `ProfileConfirmation` with `AcademicOnboarding`. Email registration creates only the existing pending-verification record. Verification clears that record and advances to onboarding but does not create a session. University is required by the Phase 6 product gate even though the API's replacement DTO can represent no affiliation; faculty, department, and class level remain optional. This is a presentation/route decision, not an API validation change. Privacy Policy and Terms links are not invented because no allowlisted product routes currently exist for them.

**Mutation and owner boundary:** Selector changes update an in-memory draft only. Parent changes clear descendants deterministically. `Kaydet ve devam et` builds one complete-replacement `/me/university` payload. When no session exists, the retained in-memory password is used for the existing Login contract; after a relaunch the user explicitly re-enters it. Session persistence and owner-generation activation complete before the authenticated PATCH. If Login or save fails, onboarding remains visible with controlled feedback and no hidden picker mutation. No password, verification code, recovery code, or onboarding draft is newly persisted.

**Routing boundary:** `academic_onboarding` is resolved before a valid owner routes to tabs, allowing email, Google, restored-session, and retry paths to converge on one non-tab onboarding surface. The authenticated tree is revealed only after the save and bootstrap complete. Protected route requests are not acknowledged by auth/onboarding navigators and remain deferred until the authenticated navigator accepts them. An external onboarding request made by an already complete signed-in user still guards to Home.

**Form and platform boundary:** Phase 4 primitives own fields, password visibility, buttons, banners, virtualized selectors, and semantic colors. Auth routes opt into form-width keyboard-safe `Screen` behavior. iOS padding avoidance/native-stack conventions and eligible control chrome differ intentionally from Android `adjustResize` plus scroll handling, ripple, tonal surfaces, and ordinary hardware Back. Form and long-text surfaces remain opaque on both platforms. Windows cannot satisfy native iOS, VoiceOver, or Liquid Glass runtime acceptance; those limits are recorded rather than inferred from renderer tests.

## Open questions with decision owners

| Question | Required by | Resolution owner/gate |
|---|---:|---|
| Use React Navigation, Expo Router, or a small typed internal navigator? | Phase 4 | **Resolved by D-035:** React Navigation 7 native stacks + bottom tabs |
| Which component test runner is compatible with the current Expo/RN stack? | Phase 4 | **Resolved by D-036:** Jest Expo + React Native Testing Library only |
| Which native material API provides supported iOS translucent chrome? | Phase 4/11 | **Foundation resolved by D-037:** runtime-gated `expo-glass-effect`; native iOS visual acceptance remains Phase 11 |
| Should tablets use a navigation rail/sidebar while keeping four destinations? | Phase 5/11 | Phase 5 retains the same four semantic destinations and the Android rail selected at the existing wide-width breakpoint; native tablet visual acceptance remains Phase 11 |
| What is the durable Save model for feed items? | Phase 8 | **Resolved for Phase 8 by D-041:** no durable contract exists, so Save/read state is omitted; a later product/API decision is still required to add it |
| Should Share use only the native share sheet or also a backend short link? | Phase 8 | **Resolved for Phase 8 by D-041:** use the native share sheet with normalized title and specific trusted canonical URL; no backend short link is invented |
| What analytics provider and consent model will implement page views? | Separate approved instrumentation work | Follow the privacy-safe taxonomy in `docs/20-mobile-native-in-app-user-activity-report.md` |

## Rejected directions

- Copying LinkedIn's exact blue, logo placement, navigation appearance, or social actions.
- Six permanent phone bottom tabs.
- Glass feed cards or translucent form fields over decorative backgrounds.
- Replacing all existing code before fixing session/content correctness.
- Treating an Expo Web screenshot as evidence for iOS or Android.
- Adding a large UI framework only to obtain basic tokens, buttons, cards, or sheets.

### D-040 — Home is a bounded daily brief, not a dashboard or duplicate feed

**Decision:** Home prioritizes real student decisions in this order: identity/academic context, today's local-calendar-day items, nearest future important item, newest trusted announcement, three additional trusted items, then one actionable Phase 3 integration state. Missing university takes precedence over all data states; loading, populated, genuine empty, and recoverable error remain mutually exclusive.

**Data boundary:** Calendar events and owner-scoped manual exams supply academic dates. Phase 2 normalized trusted content supplies announcements. Publication/source-update time controls announcement order; crawler discovery/fetch time never substitutes. Background refresh preserves retained content and marks refreshing/stale/partial/offline truthfully. Countdown copy is derived from a live minute clock rather than stored.

**Navigation and scope:** Full announcement rows enter the existing trusted detail route, the compact recent action enters Announcements, and Calendar retains personal exam creation. Home does not reproduce the Announcements feed, Calendar, Profile, Summer School, or YÖK screens and does not add social actions or engagement metrics. Phase 8 now owns the unified Announcements experience under D-041 without changing this bounded Home contract.

### D-041 — Announcements is one trusted virtualized feed with capability-honest detail

**Decision:** The Announcements root is one content-first `FlatList`, not a page-wide or nested `ScrollView`. Its fixed hierarchy is academic context, labelled search, a wrapped **İçerik türü** group, a wrapped **Akademik kapsam ve kaynak** group, selected-filter/result summary, the existing YÖK/Yaz Okulu nested destinations, availability status, source-first rows, and a pagination footer. Content-type choices are **Tümü**, **Duyurular**, **Haberler**, and **Etkinlikler**; source choices are **Tüm kaynaklar**, **Üniversitem**, **Fakültem**, **Bölümüm**, **YÖK**, and **Yaz Okulu**. These controls wrap rather than becoming one horizontally scrolling strip.

**Trust, identity, and time:** Phase 8 consumes only the additive Phase 2 trusted DTO and applies a second fail-closed presentation gate. Explicit trust, item/source/scope identity, already normalized display text, safe canonical/link/official URLs, and matching institutional authority are required. Canonical official URL is the stable row and deduplication identity. Publication time orders first, with source-update time as the only display fallback; discovery/fetch time never affects display order or becomes publication copy. Equivalent canonical items merge their source-family membership deterministically.

**Search, availability, and loading:** Search is a 300 ms client-side match over normalized title, safe summary, and source name, including Turkish character folding. The raw query stays in component memory and is not logged, persisted, routed, or instrumented. Initial loading, background refresh, populated, genuine empty, no-results, stale, partial, offline, recoverable error, pagination loading, and pagination failure have one dominant resolver state. Useful rows survive refresh and pagination failures. The existing trusted academic and YÖK endpoints have a limit rather than a cursor/total contract, so controlled loading increases the requested cap through 20, 40, 60, 80, and 100 and stops there; it does not claim unbounded or cursor pagination.

**Detail and action boundary:** Full-row selection enters the existing in-app `AnnouncementDetail` route before any external handoff. The detail revalidates the record and shows normalized title, type/scope, source name/domain, separately labelled publication/update dates, and the complete safe summary that the DTO actually supplies. Native Share includes only normalized title and the specific trusted canonical item URL. Open Official Source displays the destination domain, allowlists/canonicalizes HTTP/HTTPS again, catches unsupported/failing handoff, and leaves the current route intact when it cannot open. The Phase 2 DTO has no complete body, attachments, deadline/event period, durable Save/read state, or feed-owned calendar mutation, so Phase 8 does not invent those sections or actions.

**YÖK and Summer School placement:** Trusted YÖK items and compatible trusted Summer School announcements join the same chronological feed and have source filters. `YokAnnouncements` and `SummerSchool` remain nested under Announcements with their existing exact protected deep links. Summer requirements, options, and calendar dates are separate contract shapes and remain on the nested Summer School screen; they are not coerced into trusted announcement records. Neither capability returns to primary navigation.

**Platform, accessibility, and evidence boundary:** Reading surfaces remain opaque on both platforms. Eligible iOS material remains navigation/control chrome only; Android uses semantic tonal surfaces, ripple, 48 dp targets, existing edge-to-edge inset ownership, and ordinary stack Back. The feed stays one column, uses a 16-unit gutter below 375, caps readable width at 720, and exposes headings, busy state, selected filters, wrapping Turkish text, and source/time/title/summary/action reading order. `ContentFeedPreview` is dual-gated by `__DEV__` plus `EXPO_PUBLIC_PHASE8_CONTENT_FEED_PREVIEW=1`, uses synthetic `preview.edu.tr`/YÖK records, and imports no API, persistence, or provider module. Renderer tests and the preview do not establish native iOS, VoiceOver, provider, production-data, or final Android acceptance; those results must be recorded separately.

**Compatibility and rollback:** No endpoint, DTO, database schema, repository, storage key, authentication/session rule, notification lifecycle, Google Calendar lifecycle, permission, or production data changes. Rollback is code-only and leaves Phase 1–7 records and route identifiers compatible. Calendar redesign remains Phase 9 and is not part of this decision.

### D-042 — Credential reset is one generation-advancing Mongo security commit

**Decision:** Package 1 (`641d7bee8a1cd539179769069a22b5c3220e8a6d`) completes the generation work that D-024 deferred. Missing legacy generations still normalize to `0`. Access JWTs, refresh-token rows, password-recovery rows, and recent-authentication proofs carry the current generation. Protected API authentication re-reads the current user and rejects an access token with a stale generation; refresh and recovery likewise reject stale material before rotation or reset.

**Reset commit:** Mongo password recovery uses one user-document compare-and-set keyed by owner, accepted recovery token, and expected generation. That write replaces the password hash, increments the generation exactly once, records a password-bound completion operation key, and consumes/supersedes the accepted attempt. Hash failure occurs before persistence. Concurrent confirmations and two-record races cannot both commit. An identical response-loss retry returns the deterministic completed result; proposing a different replacement password does not. Cleanup of physically older refresh/recovery rows is best effort after the security commit because their old generation is already logically invalid. This design remains standalone-Mongo compatible and requires no transaction, replica set, Redis, or BullMQ.

**Recent authentication:** `POST /auth/recent-authentication` verifies the current owner's real password or Google identity method and issues a five-minute proof bound to owner, credential generation, one explicit purpose (`delete_personal_data` or `delete_account`), and a cryptographically random `jti`. Mongo persists only the `jti` digest with the binding fields and creation/expiry/consumption times, with TTL cleanup. `RecentAuthGuard` atomically consumes the matching unconsumed record before `DELETE /me/data` or `DELETE /me` executes; reuse, cross-purpose use, cross-owner/generation use, and concurrent double acceptance fail closed. Consumption is not rolled back if later deletion work fails, so a retry requires fresh reauthentication. The native confirmation panel requests a new purpose-specific proof per operation and never manufactures authority locally. D-017's missing-recent-auth statement and D-024/D-027's unstarted-enforcement statements are therefore historical.

**Enumeration and client identity:** Recovery requests retain one fixed public status/shape, perform comparable lookup/hash/recovery-repository work for known, unknown, and cooldown paths, schedule any real delivery outside the public request path, enforce a public response-time floor, and bound provider delivery. The checked-in reverse-proxy policy trusts only configured CIDRs and, for the deployed single Caddy hop, uses only the right-most forwarded address; direct or untrusted peers cannot spoof `X-Forwarded-For`. The legacy web client also fails clearly when required Firebase environment configuration is absent and contains no hard-coded `AIza...` fallback. These decisions supersede the open MN-026, MN-027, MN-030, and MN-031 boundaries.

### D-043 — Trusted content preserves calendar dates and binds outbound requests to approved addresses

**Decision:** Package 2 (`5a6ac1a48101569b4a9061f995b0bdd4ba77dd25`) represents a source calendar date as a date, not an accidental UTC instant. `publicationKind`/`publishedDate` and calendar `dateOnlyStart`/`dateOnlyEnd` preserve date-only and inclusive-range meaning through parser/PDF ingestion, Mongo persistence, trusted API DTOs, Home, feed/detail, ICS/Google compatibility, and native presentation. Timestamped events retain real instants. Europe/Istanbul regressions prove that a local calendar day does not shift across the API-to-native boundary and that inclusive end dates are not discarded. This supersedes D-032's timestamp-only synchronization wording and adds to D-041's time contract.

**Outbound network boundary:** Every API transport—including YÖK Atlas bootstrap, configured web search, PDF/OCR, Google OAuth token verification, fixed Google metadata token lookup, and announcement parsing—uses one protected boundary with caller-specific method, header, body, timeout, redirect, request-size, and response-size limits. Every hop validates scheme, credentials, port, hostname, all DNS answers, and the actual connected address; private, loopback, link-local, mapped, rebound, mismatched, and otherwise forbidden destinations fail closed. Configured search redirects stay on the configured authority. Google public providers use fixed trusted authorities; the metadata-only exception accepts only its exact non-configurable URL, exact link-local address, required header, no redirects, and tight bounds. TLS certificate validation is mandatory in every environment; no flag or retry may disable it.

**Layout and identity:** Adapter-specific structural invariants require the expected listing shape rather than accepting one plausible row as proof of a healthy parser. Normalized content receives a deterministic fingerprint independent of crawler URL noise. Deduplication preserves canonical URL and every verified academic/source relationship instead of discarding legitimate scope provenance. D-028 and D-030 remain historical foundations but are incomplete without these rules.

### D-044 — Trusted ingestion automatically owns durable notification jobs

**Decision:** Package 2 completes the production path beneath D-031. New or materially changed trusted announcement/calendar content creates or updates an idempotent Mongo notification job through a producer key and content fingerprint. Rejected, quarantined, unsafe, source-less, removed, superseded, or no-longer-matching content creates no deliverable job and retires any obsolete producer relationship.

**Dispatch:** The application-owned worker starts automatically, claims due work with the existing UUID fence/lease, preserves quiet hours/preferences/owned-device checks, retries controlled failures, exposes health, periodically retires stale work, and stops its timers during application shutdown. Immediately before each provider call it resolves the exact trusted destination again and requires the expected fingerprint/date identity. Restart, response-loss retry, duplicate production, stale-job retirement, and destination-change behavior are deterministic tests. No super-admin request is required for ordinary dispatch, and no new queue infrastructure is introduced.

**Per-device ambiguity fence:** Before provider I/O, the worker atomically creates one Mongo delivery attempt identified by a domain-separated digest of notification job ID, device-installation hash, and deterministic attempt version (job revision, operator retry epoch, and attempt number). The durable state moves from `sending` to exactly one of `sent`, `failed`, `invalid_device`, or `ambiguous`. A successful provider response whose `sent` persistence cannot be confirmed stays fenced as `sending` and becomes `ambiguous` immediately when possible or after its bounded lease; neither state is automatically resent after worker restart. Unknown provider outcomes are ambiguous, while only failures that explicitly prove non-acceptance remain retryable. Other devices retain independent attempt identities. Health and delivery operations expose sending/expired/ambiguous counts and safe attempt metadata without push tokens or notification bodies.

### D-045 — Completed mobile phases use explicit actions, priority, focus, and no-data states

**Decision:** Package 3 (`2e3664546f628a19c6fa929b9ee9469e5322f9a8`) adds regression coverage around the existing four-tab shell rather than changing its information architecture. Selected-root reselect reaches the current virtualized root, switching away/back retains scroll state, keyboard/bottom inset ownership remains explicit, and a root top-bar action exists only where an already-implemented destination supplies a real action. No badge or placeholder action is invented. This completes the missing integrated evidence beneath D-038; it is not native iOS, tablet, or installed E2E acceptance.

**Auth and Home:** Academic onboarding visibly begins with `1 / 3 · Hesap` and retains steps 2/3 and 3/3. Login focuses the actual first invalid field, including Email, rather than proving only message order. Home labels an announcement important only when a deterministic priority rule qualifies it; the newest item is not important by default. Recent announcements are selected independently, and an actionable integration remains visible when it is the only useful content. `offline_no_data` and `partial_no_data` remain distinct from genuine empty and recoverable error. These rules supersede D-040's newest-as-important wording and preserve D-043 date/range semantics.

### D-046 — Feed performance acceptance uses a non-debuggable release harness without speculative tuning

**Decision:** Phase 8 release acceptance uses the repository-owned alternate entry and deterministic 100-record fixture with `NODE_ENV=production`, an x86_64 non-debuggable release APK, no Metro dependency, one warm-up, and five measured warm-scroll trials. Each trial must contain at least 100 valid `gfxinfo framestats` rows; aggregate nearest-rank p90 must be at most 32 ms, p95 at most 50 ms, and no frame may reach 700 ms.

**Accepted result:** On the API 24 720×1280/320 dpi emulator using the host Intel renderer, the final run recorded 600 valid frames, p90 `24.928167 ms`, p95 `35.777763 ms`, zero frozen frames, and APK SHA-256 `ce910347fbb1b663c1ec12b8b03b442533655e23a131093bd4abcbdeded17a26`. An earlier SwiftShader run failed. The experimental `initialNumToRender=4`, `maxToRenderPerBatch=3`, `windowSize=3`, `updateCellsBatchingPeriod=75`, and Android clipping settings worsened that environment and were fully reverted. The original Phase 8 FlatList settings remain the shipped decision; no unproven product bottleneck change is claimed.

**Evidence boundary:** This is repeatable local release-mode evidence, not production-device telemetry or broad device acceptance. Hardware/renderer choice materially affects the emulator result. iOS, modern Android hardware, tablet/rail, TalkBack/VoiceOver, live providers, and installed authenticated E2E remain separate evidence gates. MN-021 remains open for approved shipped performance/crash analytics.

### D-047 — Calendar is Agenda-first and personal exams remain owner-local

**Decision:** Calendar opens in **Ajanda** and offers **Hafta** and **Ay** as explicit alternate views over one normalized item model. Agenda groups current/future items by Europe/Istanbul civil day. Week summarizes seven days. Month renders a stable 42-cell informational grid and follows it with an accessible event list. Academic records preserve their trusted date-only start, inclusive date-only end, or real instant; a date-only record never receives an invented clock time. Type is always icon plus Turkish text plus semantic color.

**Personal-exam boundary:** Personal exams remain the existing versioned SecureStore model, bound to the current app owner and account generation. Create, edit, and delete share the same stale-owner/late-operation guard and serialized persistence. Relaunch and A→B→A switching restore only the matching owner's records. Date/time comes from native system selection; unrestricted date text is not accepted. Academic events remain read-only.

**Google boundary:** The Calendar root presents Phase 3's lifecycle through a compact status card and real sync/manage actions; it does not replace that lifecycle. Provider verification, preflight, capped-collection reconciliation, mappings, partial success, account switching, disconnect-retain, managed removal, revoke, deletion cleanup, owner binding, and cancellation/late-result protection remain unchanged. A remote mutation still requires both the app-managed private marker and matching Academic Calendar owner, so personal Google Calendar events are never modified.

**Platform, accessibility, and evidence:** Android uses Material-compatible opaque tonal surfaces, ripple, edge-to-edge ownership, a bottom sheet, native date/time dialogs, 48 dp targets, and ordinary native-stack Back. iOS glass eligibility remains navigation/control chrome only with opaque fallback. Compact/large-text mode uses a vertical view control and scrollable editor. Renderer and Android API 24 evidence cover explicit selected/busy/expanded/invalid/error states, but do not establish TalkBack, VoiceOver, native iOS/Liquid Glass, API 33+ predictive Back, or live-provider acceptance. No API, database, migration, or production-data change is part of Phase 9.

### D-048 — Profile is a routed settings index over real capabilities

**Decision:** The Profile root has one stable hierarchy: real summary, personal information, academic profile, notifications, calendar connections, truthful app information, and account management. The current authoritative `/me` full name and email feed Profile, and the same authoritative email feeds Account; session or provider fallbacks cannot silently diverge between those routes. Account does not invent a separate name field. Academic, notification, Google Calendar, and account controls remain on dedicated routes. The account route alone owns a collapsed danger area at the bottom. The root does not repeat destructive controls or become a dashboard of nested cards.

**Omission boundary:** There is no persisted appearance preference, so the application continues to follow the system and exposes no theme picker. There are no real help, privacy-policy, terms, or support destinations, so no dead rows are invented. No profile image, student identifier, social identity, fake statistic, or fake engagement is inferred. Configuration-backed version `0.1.1` and Android build `12` are the only app metadata approved for presentation.

### D-049 — Academic profile editing is draft-first and commits once

**Decision:** Onboarding and profile settings share the searchable, virtualized academic-field presentation, but their orchestration remains route-specific. University is required and descendants are optional. Changing a parent synchronously clears incompatible descendants in the local draft. Selector selection performs no network mutation. One Save sends the complete replacement payload, and the returned server representation replaces both visible values and the clean baseline.

**Navigation boundary:** While the draft differs from its authoritative baseline, route removal is guarded across header Back, Android system Back, gesture/navigation removal, and explicit cancel. Explicit Cancel requests the same guarded route transition rather than bypassing it. Confirmed discard resets the draft; a failed save preserves dirty state and the editable draft for retry. Academic and Account routes use the shared keyboard-safe screen boundary. Loading/no-results/error/retry, expanded, selected, invalid, saving, saved, and error states are explicit and accessible.

### D-050 — Settings report operational truth instead of optimistic toggles

**Notification decision:** OS permission, this installation's backend registration, the stored preference, and effective delivery are separate facts. The stored preference is always labelled **Açık** or **Kapalı**, independently of dirty, saving, saved, or failed-save state. Effective delivery is active only when the preference is enabled, permission is granted, and registration is complete. The native Settings handoff is duplicate-safe, owns an explicit busy state, and converts rejection to controlled feedback. Supported modes/categories retain the Phase 3 persistence contract; device tokens, provider credentials, and unsupported reminder/quiet-hours controls never reach the UI.

**Google decision:** The dedicated Google Calendar route is a compact view of the unchanged Phase 3 lifecycle. Account identity, last sync, current managed-mapping count, partial/mapping warnings, and only valid state actions are shown. A disconnected provider state does not hide a retained managed-event ledger or its applicable reconnect, account-switch, disconnect, removal, and revoke actions. Controls consume the external lifecycle coordinator's busy state. After managed-event removal eliminates its launcher, focus moves to the surviving screen heading. Connect/verify, sync, switch-account, disconnect-retain, managed-event removal, revoke, partial success, owner binding, and stale/late-operation protection are not reimplemented. Personal Google events remain structurally outside every mutation candidate set.

**Account decision:** Logout, delete app data, and delete account are distinct actions with distinct consequences. The two destructive operations use the existing purpose-bound, single-use recent-authentication proof and never share or expose proof material. Confirmation can be cancelled, focus returns to its launcher, busy state prevents duplicate submission, and user-facing errors remain fixed/non-raw. Profile and Account operation feedback is semantic and rendered only on the owning active route, preventing duplicate banners. No API, schema, repository, persistence, provider, or security-contract change is authorized by Phase 10.

**Platform and evidence boundary:** Android uses Material 3-compatible opaque settings surfaces, ripple, sheets/dialogs, 48 dp targets, edge-to-edge ownership, and ordinary Back. iOS Liquid Glass remains navigation/control chrome only. Compact and large-text layouts stack and scroll required actions. Fresh automated evidence passes focused root policy/lifecycle coverage at 5 files / 80 tests, focused native presentation/navigation/selector/auth coverage at 5 suites / 71 tests / 0 snapshots, complete native Jest at 23 / 206 / 0, complete API at 45 / 445, full root regression at 72 / 841, both TypeScript checks, both web builds, and Android x86_64 assembly plus reinstall. The reviewed Android set records 44 PNG/XML pairs, 88 integrity-index rows, reachable 48 dp controls, exact 320 dp at font scale 2.0, light/dark and simulated-tablet layouts, ordinary Back in one process, a clean filtered runtime log, and restored device settings. The synthetic preview cannot prove authenticated relaunch/account switching, SecureStore, live provider operations, Android 13 permission, predictive Back, native iOS/Liquid Glass, or assistive-technology traversal; TalkBack was disabled. The dirty academic leave guard is accepted from automated production-route coverage and is not relabelled as a native dirty-Back smoke.

### D-051 — Cross-platform quality is enforced at shared semantic boundaries

**Decision:** Phase 11 keeps the established four-destination information
architecture and feature contracts. It closes verified cross-platform quality
defects at shared route, primitive, token, and presentation boundaries instead
of adding platform-specific product logic. Bootstrap/error/fallback surfaces and
the reachable nested YÖK and Summer School destinations now consume the same
semantic light/dark system as the previously migrated routes. YÖK owns one
`FlatList`; Summer School owns one `SectionList` across dates, requirements,
trusted announcements, and matching options. Date-only/inclusive-range meaning,
trusted detail navigation, controlled official-link handoff, and Phase 1–10
ownership/lifecycle behavior are unchanged.

**Contrast and state decision:** Normal semantic text combinations must meet at
least 4.5:1 on every supported semantic surface, and meaningful control/focus/
status/disabled boundaries must meet at least 3:1 in both themes. The corrected
light disabled text/on-disabled value is `#526079`; light default/strong borders
are `#758197`/`#526079`; dark default/strong borders are
`#94A3B8`/`#CBD5E1`. Disabled controls retain a distinct fill, visible border,
readable label, and disabled state. New route/component code under
`apps/mobile-native/src` cannot introduce a screen-local raw palette; selection,
classification, busy, expanded, invalid, error, and destructive meaning must
also use text, icon, shape, or programmatic state.

**Focus and result decision:** Focused authenticated routes target the real
top-bar heading; headerless routes announce a fixed safe title. Modal sheets
focus their heading and can return focus to the launcher. First-invalid focus is
required for recovery, academic selection, and personal-exam entry; native
date/time dismissal returns to the initiating control. Important mutation
results stay on the one active owning route through semantic alert banners.
Announcement filter/search results and Calendar view/period results announce
their selected context and count through platform-appropriate live behavior.
This programmatic contract does not by itself prove TalkBack or VoiceOver
traversal.

**Responsive, material, and effects decision:** Deterministic policy coverage
spans widths 320, 360, 393, 430, and 853 at font scales 1.3, 1.5, and 2.0.
Content remains vertically reachable, uses compact gutters and the existing
720-unit readable maximum, and never creates a second navigation model.
Android keeps Material 3-compatible tonal opaque content, ripple, 48 dp targets,
edge-to-edge ownership, native dialogs/sheets, ordinary Back, and the existing
wide-width rail. iOS keeps content opaque and restricts Liquid Glass to eligible
navigation/control chrome; Reduce Transparency or unavailable runtime support
uses the opaque fallback. Reduce Motion simplifies nonessential shared
transitions. No continuous decorative animation or Three.js path is accepted.
Long product collections remain virtualized; Phase 11 does not ship speculative
windowing or clipping changes to improve one emulator result.

Android ripple-backed Buttons remount their native view when semantic mode
changes so the native fill and on-primary foreground cannot straddle different
themes. This is a shared platform repair, not a persisted theme preference or a
new product setting.

**Compatibility and evidence boundary:** Phase 11 changes no API, schema,
repository, authentication/session, notification, Google Calendar, SecureStore,
theme-preference, provider, or production-data contract. The exact Android
captures and release measurements live in the Phase 11 report/evidence index.
Windows cannot establish native iOS, VoiceOver, Dynamic Type, swipe-back, or
Liquid Glass; the authorized API 24 AVD cannot establish Android 13 notification
permission or predictive Back, and TalkBack traversal is unavailable. A
temporary tablet-style viewport is not physical tablet/foldable acceptance. No
live provider/account result, installed authenticated E2E, automated screenshot
regression, or mobile-native lint result is claimed. Phase 12 later reconciled
these boundaries without altering this Phase 11 decision.

### D-052 — Final readiness is platform-specific and production secrets fail closed

**Security/configuration decision:** A production access-token signing secret and
the dedicated Calendar-feed signing secret are independently required, must
contain at least 32 non-whitespace characters, must differ, and must not be a checked-in
development/example placeholder. Production startup and the direct signing
boundaries both fail closed; neither production signer falls back to a public
development value or to the other key. Non-production deterministic fallbacks
remain available only for local tests and development. Android generation must
apply Expo SecureStore backup exclusions and deterministic Firebase default
notification metadata from tracked Expo/plugin configuration; ignored generated
native state is evidence, not the configuration authority.

**Readiness decision:** Phase completion, implementation readiness, publication
readiness, and provider verification are separate claims. Android implementation
is `CONDITIONALLY_READY` because deterministic tests, current debug/release
builds, API 24 native evidence, and the release-feed measurement pass, while
modern-Android, TalkBack, and installed-authenticated checks remain explicit
manual evidence. Android publication is `NOT_READY` until a version code above
the independently verified Play maximum is selected, source-authoritative
release-signing enforcement is established, and Play signing, store,
privacy, and listing gates are completed. iOS implementation and publication
are `NOT_READY` because source-owned bundle/build identity, native project and
signing/APNs configuration, and Xcode evidence are absent. Combined live-provider
readiness and overall product release readiness are therefore `NOT_READY`.

**Scope/evidence boundary:** Phase 12 adds no product screen, feature, provider
infrastructure, database, endpoint, schema, or Phase 13. Phase 11's 32 PNG/XML
pairs remain representative current-source UI evidence because Phase 12 changed
only API security and native generation configuration; Phase 12 independently
reconciles their integrity index and records current Android build/performance
artifacts. API 24 is not evidence for Android 13 notification permission,
predictive Back, or TalkBack. No iOS, live provider, Play Console, production
account, calendar, notification token, credential, or user-data claim is made.
