# Phase 03 — Integrations

Status date: 2026-08-04
Status: Reconciled current. The original Phase 3 provider/device contract remains accepted, and the missing autonomous notification-production/dispatch lifecycle is closed by the Phase 2 repair descendant.

## Reconciled current state — 2026-08-04

The original Phase 3 milestone remains `b74bdcc8da7657c2886cf35f6a9b4f2dedbe29d8`. Starting from the accepted Phase 8 baseline `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9`, commit `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` completed the automatic notification path without adding Redis, BullMQ, or another queue service.

- New or materially changed trusted announcements and published calendar records reconcile their eligible notification jobs automatically. Rejected, quarantined, untrusted, unsafe, source-less, removed, or superseded content creates no active delivery job; producer relationships retire/cancel stale work deterministically.
- The Mongo-backed worker starts from the application lifecycle, scans and retires stale jobs, claims due jobs with UUID fencing, revision checks, and renewable leases, and applies bounded retry/exhaustion state. Provider failures cannot let a stale claimant finalize a newer revision.
- Before fan-out begins, the worker re-reads the exact destination and its current trust/scope state; for each device it re-reads owner, preference, quiet-hour, and active-registration state. Destination fingerprints and exact repository reads prevent capped-list fallbacks or delivery to content that changed after scheduling.
- Worker health exposes lifecycle state, consecutive failures, timestamps, and due/retrying/processing/dead backlog counts. Controlled shutdown stops new cycles, clears timers, and drains the active cycle before completing.
- The original Phase 3 permission, installation ownership, token rotation/detach, strict notification destination, Google Calendar preflight/mapping/removal/revoke, owner-safe cleanup, generic provider-visible copy, and secret-free logging contracts remain intact. No real FCM/APNs send or Google-account mutation is newly claimed; those provider evidence limits remain current.

### Current provenance

| Scope | Commit | Reconciled meaning |
|---|---|---|
| Historical Phase 3 milestone | `b74bdcc8da7657c2886cf35f6a9b4f2dedbe29d8` | Original deterministic integration contract retained below |
| Accepted Phase 8 baseline | `7b64c9c364b1b3b85e3a7b881894b3ea9e8ba7b9` | Starting point for the bounded remediation |
| Phase 1 repair ancestor | `641d7bee8a1cd539179769069a22b5c3220e8a6d` | Preserved authentication/owner boundary |
| Phase 2 repair | `5a6ac1a48101569b4a9061f995b0bdd4ba77dd25` | Automatic job production/retirement, due-job dispatch, fencing, retry, destination revalidation, health, and shutdown |
| Phase 3 mobile repair descendant | `2e3664546f628a19c6fa929b9ee9469e5322f9a8` | Preserves the repaired integration runtime through the mobile reconciliation |

## Historical Phase 3 milestone record

**Historical snapshot boundary.** The remainder of this report records the original Phase 3 completion snapshot. Its statements that Phase 4 had not started or that the report was still awaiting its commit are historical; original implementation evidence and provider limitations remain preserved.

## Objective

Make Google Calendar and notification behavior match the product promise, user consent, account ownership, and deletion semantics without redesigning the application shell.

## Implemented notification contract

| Moment | Product behavior |
|---|---|
| New account / missing preference | Backend preference is disabled. The app does not claim delivery and does not prompt during hydration. |
| Hydration / app resume | Existing OS permission is inspected. An already-granted, enabled installation may refresh its FCM token and register; revoked permission disables delivery and the backend preference. |
| Explicit enable | The save action requests permission, obtains the platform FCM token, and registers the current installation. The preference is enabled only when all three succeed. |
| Denied / permanently denied / unavailable | Delivery remains off. Permanent denial exposes the system-settings handoff. Errors are controlled and never display a token/provider payload. |
| Token rotation | The listener serializes a re-registration for the same owner/installation. No token is placed in React state, SecureStore lifecycle metadata, API responses, delivery audits, or logs. |
| Disable / logout / expiry | The current installation is detached. Logout additionally lets the backend derive and disable the installation from the refresh record's device ID. Offline or failed cleanup remains an observable retry target. |
| Data / account / admin deletion | The backend removes device tokens, preferences, alarms, jobs, and delivery rows for the owner; native pending destinations and registration state are also cleared. |
| Provider delivery | A job is atomically UUID-claimed with a recovery lease. The worker re-reads the active registration immediately before sending, uses generic visible text, and distinguishes success, invalid token, provider unavailable, provider rejection, and stale registration. Invalid tokens are disabled and provider failure is never marked sent. |
| Tap / URL destination | Only version 1 `announcement` or `calendar_event` destinations are accepted. Owner and account-generation checks precede a fresh exact-ID lookup in trusted content. Missing or mismatched content never falls back to a different record or URL. |

The API accepts `{ platform, token, deviceId }`, hashes `deviceId` with a domain-separated SHA-256 value, rotates the token for the same installation, and rejects active cross-owner installation/token reuse with HTTP 409. Registration returns only status/platform/time. `DELETE /devices/current` is idempotent for the owner. Android channel IDs are `academic-reminders` and `academic-updates`. Exact destination endpoints bypass capped collections while applying the same current-owner, publication, scope, and trust boundary with indistinguishable 404 responses.

## Implemented Google Calendar contract

| Concern | Product behavior |
|---|---|
| Durable state | Owner-scoped v3 metadata contains stable Google account ID/email, live verification/sync times, and source/event/fingerprint mappings; it contains no access token. |
| Restore | Stored data enters `checking`. The current SDK account/token and Calendar API are queried without opening a chooser. Only a successful live check becomes `connected`; mismatch/expiry/failure stays explicit. Legacy metadata migrates only after verification. |
| Preflight | Current owner/profile, network, calendar response, and trusted announcements are evaluated before any account/scope prompt. Missing university, no network, no transferable content, duplicate operation, stale owner, or duplicate mapping stops before mutation. |
| Timestamp source | Announcement calendar dates may use only source-authored `publishedAt`, or source-authored `sourceUpdatedAt` when publication is absent. `discoveredAt`, crawl time, and `fetchedAt` are never publication/calendar dates. |
| Sync | App-managed Google events carry private owner/source/type/fingerprint properties. Matching live mappings skip mutation. Create/update/delete is followed by verification and refreshed mappings. |
| Partial source / failure | A source family may delete missing remote events only when its current response is complete. Source-only/unknown calendar state and partial/failed announcement input can create/update known items but cannot delete that family. Every remote mapping omitted by a capped collection is checked through an exact trusted-record endpoint before deletion. Mutation, lookup, or verification failures persist a `partial` state and mappings for retry. |
| Account change | The user chooses Cancel, keep old managed events, or remove old managed events before disconnect and account selection. Keep is an intentional residual choice: the new-account ledger replaces the old one, so those old records require reconnecting that Google account for later removal. |
| Disconnect / remove / revoke | Separate controls disconnect while retaining events, remove app-owned events then disconnect, or revoke Google access while retaining existing events. Ordinary disconnect/revoke retains a token-free `disconnected` v3 ledger so later deletion for this app owner can still attempt cleanup after reauthorization. Successful removal clears the ledger; partial removal keeps mappings for retry. |
| Logout / expiry | Local connection metadata is cleared and the SDK signs out. Existing managed events and the OAuth grant deliberately remain. |
| Personal-data / account deletion | The client attempts managed-event removal known through the current ledger, then OAuth revoke, then metadata/sign-in cleanup. A failure is reported as a controlled cleanup target and does not masquerade as success. Records intentionally left in an old Google account during account switch are outside the current ledger and require reconnecting that account. |
| Personal events | Events lacking both the app-managed marker and current Academic Calendar owner ID are never updated or deleted. |

The native operation guard combines owner, epoch, and operation ID so a late non-abortable SDK result cannot settle into a changed account. Google REST requests also receive the Phase 1 abort signal. Cancellation still cannot roll back a mutation that Google already accepted; final verification and partial state make that boundary visible.

## Privacy and data residency

- FCM tokens reside only where delivery requires them: the native provider SDK, Mongo `device_tokens`, and the outbound Firebase Admin request. Installation IDs are hashed before Mongo persistence. Delivery audit and admin DTOs expose only `deviceTokenId` and controlled outcome fields.
- Notification destination storage is non-secret but owner-bound. It contains only schema/type/ID/owner/time and is removed after resolution, wrong-owner rejection, logout, data deletion, or account deletion.
- Google access tokens remain in the provider SDK call path and are not stored in the application backend or durable connection record.
- Selected academic event/announcement titles, dates, descriptions, and official links travel directly from the device to the user's Google Calendar. Google is the external processor selected by the user; the application backend does not proxy or retain Google event bodies.
- No token, authorization header, personal Google event content, or raw provider error is permitted in application logs.

## Dormant native-device-calendar boundary

`apps/mobile-native/src/native-calendar` is retained as reference-only pure logic. It is not imported by `App.tsx`, has no installed platform calendar dependency/adapter, asks for no calendar permission, exposes no UI, and performs no runtime synchronization. Activating it requires a separate approved scope and real platform evidence; Phase 3 does not advertise it as a feature.

## Dependency and configuration boundary

Phase 3 adds Expo Notifications, Expo Network, React Native Firebase App, and React Native Firebase Messaging, with Android notification-channel configuration. React Native Firebase 26 requires the React Native New Architecture, so the Expo 54 configuration now enables it; the Android debug build and launch verified Fabric without upgrading Expo or React Native. These native modules require a development/native build; web output is not evidence for them.

Provider acceptance is intentionally blocked without authorized non-production configuration:

- The sole authorized Android AVD, `AcademicPhase1Low`, is API 24. It can support build/install/launch and strict URL-handoff smoke, but it cannot demonstrate API 26+ notification channels or the API 33+ runtime notification-permission prompt.
- iOS cannot be built or launched on the Windows host. No authorized `GoogleService-Info.plist`, iOS OAuth/native-client fixture, Xcode/simulator, or APNs/FCM provider credentials are present.
- No authorized non-production Firebase sender/project or Google account/calendar content fixture was supplied. Production credentials, data, sends, and remote mutations are prohibited and were not used.

## Files changed

- Native app/configuration: `apps/mobile-native/App.tsx`, `README.md`, `app.json`, `firebase.json`, `package.json`, `package-lock.json`, `src/auth/session-integrity.ts`, `src/google-calendar/google-calendar-sync.ts`, `src/google-calendar/google-calendar-lifecycle.ts`, and all five files under `src/notifications/`.
- API/contracts/persistence: shared contracts and endpoint catalog; announcement and calendar exact-record controller/service/repository contracts; notification controller/DTO/service/repositories/worker/sender/types; Mongo schemas/index definitions; auth logout and user-cleanup integration.
- Existing admin/responsive clients: notification registration/preferences were reconciled so non-native clients no longer manufacture a fake push registration or claim native delivery.
- Tests: notification lifecycle/destination/native-adapter, Google sync/lifecycle, capped calendar reconciliation, Mongo notification repository, and the affected API auth/announcement/calendar/notification/operations/schema/index/user/public-page suites.
- Documentation/evidence: `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_MATRIX.md`, `SCREEN_INVENTORY.md`, this report, and `evidence/phase-03-native/`.

Generated Android native files and provider configuration remain untracked/ignored. Unrelated pre-existing untracked logos, data reports, roadmap-phase documents, and prompts were preserved and excluded.

## Final validation

- Focused Phase 3: PASS, 10 files / 155 tests.
- Complete API: PASS, 30 files / 310 tests.
- Workspace TypeScript: PASS.
- Mobile-native TypeScript: PASS.
- Full regression: PASS, 41 files / 495 tests, above the 36 / 400 baseline.
- Admin build: PASS, 1,742 modules.
- Responsive mobile web build: PASS, 1,754 modules.
- Expo public configuration: PASS with SDK 54, `newArchEnabled: true`, scheme/package, and required plugins.
- Android x86_64 debug assembly: final PASS in 100.4 seconds; APK 39,267,789 bytes. The initial architecture mismatch and stale incremental Google Sign-In codegen were diagnosed, the committed configuration was corrected, codegen was regenerated, and the identical required assembly then passed.
- Android API 24 install/launch: PASS. Package/version/min/target metadata matched; Metro bundled 962 modules; Fabric was active; Login/Register rendered; the process remained alive.
- Strict signed-out notification handoff: PASS. The complete version/owner/type/exact-ID URL was accepted, Login/Register remained visible, and encrypted SecureStore contained the pending-notification key. No content was exposed before authentication.
- Fatal-log filter, added-line sensitive-log scan, `git diff --check`, and final cached-diff check: PASS.

The authoritative commands, timings, warnings, and evidence boundaries are in `TEST_MATRIX.md`. Native screenshot and command details are in [`../evidence/phase-03-native`](../evidence/phase-03-native/README.md).

## Accessibility and native evidence

The API 24 UI hierarchy exposed labelled Login/Register, Google sign-in, email, password, password-visibility, and recovery controls after the current-source launch. The strict pending destination did not replace authentication or expose trusted content while signed out. No new shell or feed visual redesign was introduced. Provider integration controls could not be reached without an authorized account fixture, so no notification-settings or Google-action visual/accessibility acceptance is claimed. Phase 4 still owns the semantic rendered-component test-stack decision.

## Exit-gate disposition

- `MN-006`: implementation and deterministic contract gap resolved; real provider/account evidence remains `MN-034`.
- `MN-007`: implementation and deterministic contract gap resolved; OS permission/channel/provider evidence remains `MN-033`/`MN-034`.
- `MN-023`: resolved by explicit reference-only retention and README reconciliation.
- Native permission/account chooser evidence is blocked exactly as listed above; no web screenshot or API 24 behavior is substituted for unsupported platform proof.
- No background sync, broad screen redesign, new navigation architecture, native component-test framework, deployment, production access, or Phase 4 work is included.

## Git and handoff

- Branch: `agent/google-play-readiness-20260724`.
- Required starting HEAD: `d722f9092c1d500e0145214b2b57a08d1a8191d9` (verified before changes).
- Pre-commit report state: scoped Phase 3 changes validated and ready for one local commit; unrelated untracked files preserved. The resulting SHA is reported in the terminal handoff because a commit cannot contain its own final object ID.
- No push, deploy, publish, production data/account access, provider send, remote calendar mutation, or Play Console action occurred.
- Next-phase handoff: stop here. Phase 4 has not started and requires a separate instruction.
