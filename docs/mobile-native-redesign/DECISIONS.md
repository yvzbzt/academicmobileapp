# Redesign Decisions

Last updated: 31 July 2026

## Accepted decisions

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
| What is the durable Save model for feed items? | Phase 8 | Requires product/API decision; omit Save until persistence exists |
| Should Share use only the native share sheet or also a backend short link? | Phase 8 | Start with privacy-reviewed native share payload; never share crawler/internal URLs blindly |
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

**Navigation and scope:** Full announcement rows enter the existing trusted detail route, the compact recent action enters Announcements, and Calendar retains personal exam creation. Home does not reproduce the Announcements feed, Calendar, Profile, Summer School, or YÖK screens and does not add social actions or engagement metrics. Phase 8 is not started.
