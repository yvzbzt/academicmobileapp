# Section Approval Log

## 2026-05-09 - Foundation And Domain Core

### Section

Monorepo foundation, backend domain core, initial product documentation, admin/mobile shell contracts, MongoDB index strategy, Redis cache/queue policy and DevOps local environment.

### Scope Completed

- Root TypeScript/Vitest validation setup.
- Backend date normalization for MVP-supported Turkish date formats.
- Academic event category mapping.
- Confidence score calculation.
- PDF processing pipeline state model.
- NoSQL query sanitizer.
- Shared API DTO contracts.
- Admin panel route map.
- Mobile navigation route map.
- API endpoint catalog with auth/role/rate-limit metadata.
- MongoDB index strategy as executable contract.
- Redis cache key and queue job policies as executable contracts.
- Docker Compose services for MongoDB, Redis, MinIO and ClamAV.
- Product analysis, architecture, MVP backlog, security, test, data, cache/queue and DevOps docs.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 4 passed
Tests: 17 passed
```

Covered scenarios:

- Numeric date normalization: `01.10.2026`, `01/10/2026`, `01-10-2026`.
- Turkish textual date normalization: source text equivalent to `1 October 2026`.
- Date range normalization: `01-05 October 2026`, `30 September - 04 October 2026`.
- Academic year and term detection.
- Category mapping for course registration, midterm, final and makeup exams.
- Confidence band behavior for high and low quality events.
- NoSQL operator and dotted-key sanitization.
- Required MongoDB indexes for duplicate PDF, notification scheduling and refresh token TTL.
- Redis TTL policy enforcement.
- Queue retry/dead-letter policy enforcement.

### Infrastructure Validation

Command:

```bash
docker compose config --quiet
```

Result:

```text
passed
```

### Security Review

- No secrets committed; only `.env.example` placeholders exist.
- Token, password and FCM token logging risks documented.
- NoSQL injection helper has automated test coverage.
- PDF validation and antivirus architecture documented and represented in Docker dependency stack.

### Known Risks

- Full NestJS controllers, MongoDB repositories and worker processors are not implemented yet.
- Admin and mobile apps are route/architecture shells, not runnable UI applications yet.
- OCR is intentionally deferred behind the MVP hook.

### Approval

Approved to proceed to the next engineering section: NestJS API bootstrap, MongoDB repositories and Auth module implementation.

## 2026-05-09 - NestJS API Bootstrap And Auth Core

### Section

NestJS API runtime, health endpoints and authentication application service.

### Scope Completed

- NestJS API bootstrap with global DTO validation.
- CORS configuration through environment variable.
- Liveness and readiness health endpoints.
- Auth controller for register, login, refresh-token and logout.
- Password hashing with bcrypt.
- JWT access token issuing with short TTL.
- Opaque refresh token issuing with SHA-256 hash storage.
- Refresh token rotation.
- Refresh token reuse detection and token family revocation.
- In-memory auth repository adapter for testable MVP service behavior before MongoDB adapter implementation.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 5 passed
Tests: 21 passed
```

Covered scenarios:

- Student registration creates secure session.
- Login rejects invalid credentials.
- Refresh flow rotates refresh token.
- Reusing an old refresh token is rejected.
- Refresh token family is revoked on reuse detection.
- Logout revokes refresh token.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
Invoke-RestMethod -Uri http://localhost:3000/health/live
Invoke-RestMethod -Uri http://localhost:3000/health/ready
```

Result:

```text
/health/live: { status: "ok" }
/health/ready: { status: "ok", dependencies: ["api"] }
```

### Security Review

- Passwords are hashed and never returned.
- Refresh tokens are opaque and only hashes are stored.
- Access token TTL is short by default.
- Refresh token reuse detection revokes the token family.
- DTO validation is globally enabled with whitelist and forbidNonWhitelisted.

### Known Risks

- Auth repository is still in-memory and must be replaced with MongoDB persistence.
- Rate limiting and account lockout are documented but not implemented yet.
- JWT guards and RBAC guards are next required security controls.

### Approval

Approved to proceed to the next engineering section: MongoDB repository adapter, JWT guard, RBAC guard and user profile endpoints.

## 2026-05-09 - JWT Guard, RBAC Guard And User Profile Endpoints

### Section

Authenticated user profile endpoints, JWT guard, RBAC guard and MongoDB schema foundation for users and refresh tokens.

### Scope Completed

- Access token verification added to TokenService.
- JwtAuthGuard validates `Authorization: Bearer` tokens and attaches authenticated user context.
- Roles decorator and RolesGuard added for endpoint-level RBAC.
- `/me` endpoint added for current user profile.
- `PATCH /me` endpoint added for limited profile update.
- `PATCH /me/university` endpoint added for student university/faculty/department/class selection.
- `POST /auth/logout` is now JWT protected.
- Auth user record extended with university, faculty, department and class level fields.
- Mongoose schemas added for `users` and `refresh_tokens` collections.
- Explicit NestJS `@Inject(...)` constructor annotations added for reliable ESM/tsx runtime dependency injection.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 7 passed
Tests: 28 passed
```

Covered scenarios:

- JWT guard attaches authenticated user from bearer token.
- JWT guard rejects missing bearer token.
- RolesGuard allows matching role.
- RolesGuard rejects non-matching role.
- UsersService updates authenticated user's academic selection.
- Mongoose user schema defines users collection and unique email index.
- Mongoose refresh token schema defines TTL cleanup index.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /auth/register
GET /me with Bearer token
PATCH /me/university with Bearer token
```

Result:

```text
registeredEmail matched /me email
selectedUniversity: university-1
classLevel: 2
```

### Security Review

- `/me` operations derive user identity from server-verified JWT payload, not from user-supplied IDs.
- Student-only university selection is enforced with RBAC metadata and guard.
- Missing or invalid bearer token returns 401.
- Wrong role returns 403.
- DTO validation remains globally enforced.
- Runtime DI issue was found through HTTP smoke testing and fixed with explicit injection annotations.

### Known Risks

- Mongoose schemas are defined but the runtime still uses in-memory repository for this section.
- MongoDB connection module and repository adapter wiring remain next work.
- Rate limiting is still pending.

### Approval

Approved to proceed to the next engineering section: University, faculty and department modules with Mongo-ready models, public list endpoints and cache invalidation contracts.

## 2026-05-09 - University, Faculty And Department Catalog Modules

### Section

Public university/faculty/department selection APIs, super admin catalog management endpoints, MongoDB catalog schemas and cache invalidation contracts.

### Scope Completed

- Catalog domain records for universities, faculties and departments.
- Turkish-safe slug generation.
- In-memory catalog repository with sample active university/faculty/department seed for local mobile selection flow.
- Public endpoints:
	- `GET /universities`
	- `GET /universities/:id`
	- `GET /universities/:id/faculties`
	- `GET /faculties/:id/departments`
- Super-admin protected endpoints:
	- `POST /admin/universities`
	- `PATCH /admin/universities/:id`
	- `DELETE /admin/universities/:id` as archive operation
	- `POST /admin/universities/:id/faculties`
	- `POST /admin/universities/:universityId/faculties/:facultyId/departments`
- Endpoint catalog updated with public and admin catalog routes.
- Mongoose schemas and indexes added for `universities`, `faculties` and `departments`.
- Cache invalidation planner added for university, faculty, department, user-university and calendar publish events.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 8 passed
Tests: 34 passed
```

Covered scenarios:

- Turkish-safe slug generation.
- Public active university list returns seeded data.
- University, faculty and department creation service flow.
- University archive behavior instead of hard delete.
- Catalog cache invalidation keys.
- Catalog MongoDB collection names and unique indexes.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
GET /universities
GET /universities/{id}/faculties
GET /faculties/{id}/departments
```

Result:

```text
universityCount: 1
firstUniversity: Ankara Ornek Universitesi
facultyCount: 1
departmentCount: 1
firstDepartment: Bilgisayar Muhendisligi
```

### Security Review

- Public endpoints return only active records by default.
- Admin catalog mutations require JWT and `super_admin` role.
- Delete operation archives university instead of destructive deletion.
- DTO validation is enforced for all write inputs.
- Cache invalidation is explicit and test covered.

### Known Risks

- Admin catalog HTTP smoke test is pending until a persisted seeded super_admin flow is added.
- Runtime repository remains in-memory; MongoDB repository adapter is still pending.
- Faculty and department update/archive admin endpoints are not yet implemented.

### Approval

Approved to proceed to the next engineering section: MongoDB repository adapter wiring and academic calendar/event MVP APIs.

## 2026-05-09 - Academic Calendar And Event MVP APIs

### Section

Published academic calendar and event read APIs for the mobile MVP.

### Scope Completed

- Academic calendar and academic event domain records.
- In-memory calendar repository with sample published 2026-2027 calendar and published events.
- Student endpoint: `GET /calendar/my`.
- Public endpoint: `GET /calendar/university/:universityId`.
- Student endpoint: `GET /calendar/upcoming`.
- Public endpoint: `GET /calendar/events` with category/date pagination filters.
- Public endpoint: `GET /calendar/events/:eventId`.
- Mongoose schemas and indexes for `academic_calendars` and `academic_events`.
- Endpoint catalog updated with calendar/event routes.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 9 passed
Tests: 39 passed
```

Covered scenarios:

- Student without university selection cannot read `/calendar/my`.
- Student with university selection receives published calendar and published events.
- Upcoming events are sorted by start date.
- Public event search filters by category.
- Academic calendar and event MongoDB indexes are defined.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /auth/register
PATCH /me/university
GET /calendar/my
GET /calendar/upcoming?limit=5
GET /calendar/events?category=final_exam
GET /calendar/events/{eventId}
```

Result:

```text
academicYear: 2026-2027
myEventCount: 2
upcomingCount: 2
finalEventTitle: Guz Donemi Final Sinavlari
detailId: sample-event-final-exams
```

### Security Review

- `/calendar/my` and `/calendar/upcoming` require JWT and student role.
- Student identity is derived from the verified token, not request parameters.
- Public endpoints only expose published calendar/event records.
- User must select a university before reading personalized calendar data.
- Pagination limits are capped in service logic.

### Known Risks

- Runtime repository remains in-memory; MongoDB adapter wiring is still pending.
- Admin calendar publish flow is not implemented yet.
- Notification scheduling after publish is not implemented yet.

### Approval

Approved to proceed to the next engineering section: PDF source upload/validation model and extracted event admin review MVP pipeline.

## 2026-05-09 - PDF Source Validation And Extracted Event Review MVP

### Section

PDF source intake, validation, text-layer extraction, extracted event creation and admin review workflow.

### Scope Completed

- PDF source domain model and in-memory repository.
- Extracted event domain model and in-memory repository.
- PDF validation rules:
	- MIME type must be `application/pdf`.
	- Magic bytes must start with `%PDF` hex `25504446`.
	- File size must be positive and below 25 MB.
	- Page count must be between 1 and 100.
	- Academic year must use `YYYY-YYYY` format.
- SHA-256 duplicate hash detection by university.
- Private object-storage-style file path generation.
- Text-layer processing path.
- OCR-required path for PDFs without text layer.
- Rule-based extracted event creation from date-bearing lines.
- Category mapping, date normalization and confidence score generation.
- Admin review endpoints for list/detail/update/approve/reject.
- Mongoose schemas and indexes for `pdf_sources` and `extracted_events`.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 10 passed
Tests: 45 passed
```

Covered scenarios:

- Unsafe non-PDF input is rejected.
- Duplicate PDF source is rejected by hash.
- Text-layer PDF produces pending review events.
- PDF without text layer is marked `ocr_required`.
- Admin approve/reject review decisions update status and reviewer metadata.
- PDF source and extracted event MongoDB indexes are defined.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /admin/pdf-sources
POST /admin/pdf-sources/{id}/process
GET /admin/pdf-sources/{id}/extracted-events
POST /admin/extracted-events/{id}/approve
```

Result:

```text
parseStatus: processed
extractedCount: 2
firstCategory: course_registration
approvedStatus: approved
```

### Security Review

- Admin PDF endpoints require JWT and one of `content_editor`, `university_admin`, `super_admin` roles.
- Upload validation rejects invalid MIME, magic bytes, file size and page count before processing.
- Duplicate hash prevents repeated processing of the same PDF content in the same university scope.
- PDFs without a text layer do not silently fail; they are marked `ocr_required` for controlled follow-up.
- Extracted events remain `pending_review` until an admin explicitly approves them.

### Known Risks

- This MVP endpoint accepts PDF metadata/raw text JSON rather than multipart binary upload.
- Antivirus scanning and sandboxed parser process are documented but not connected to runtime yet.
- Approved extracted events are not yet converted into published `academic_events`; publish workflow remains next work.
- University-admin scope isolation is not implemented yet; role is accepted but not scoped to university ownership.

### Approval

Approved to proceed to the next engineering section: converting approved extracted events into academic events and adding admin calendar draft/publish workflow.

## 2026-05-09 - Admin Calendar Draft And Publish Workflow

### Section

Converting approved extracted PDF events into academic calendar events and publishing a reviewed calendar version for mobile/public consumers.

### Scope Completed

- Calendar repository contract extended with draft creation, update, event creation, publish status updates and published-calendar archival operations.
- In-memory calendar repository now supports draft calendars and generated academic events.
- Admin calendar service added for:
	- Creating a draft calendar from approved extracted events.
	- Validating PDF source university and academic year alignment.
	- Rejecting draft creation when no extracted events have been approved.
	- Publishing draft calendars only when all events are approved.
	- Archiving the previously published calendar for the same university and academic year.
	- Marking imported academic events as `published` during publish.
	- MVP rollback by archiving a published calendar and its events.
- Admin calendar endpoints added:
	- `POST /admin/calendars`
	- `PATCH /admin/calendars/:id`
	- `POST /admin/calendars/:id/publish`
	- `POST /admin/calendars/:id/rollback`
- Endpoint catalog updated with admin calendar security metadata.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 11 passed
Tests: 49 passed
```

Covered scenarios:

- Draft calendar creation from approved extracted events.
- Imported academic events are created with `approved` status before publish.
- Draft creation rejects PDF sources that have no approved extracted events.
- Publishing archives the previous published calendar for the same university and academic year.
- Publishing promotes the draft calendar to `published`.
- Publishing promotes imported academic events to `published`.
- Rollback archives the published calendar and its events.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /admin/pdf-sources
POST /admin/pdf-sources/{id}/process
POST /admin/extracted-events/{id}/approve
POST /admin/calendars
POST /admin/calendars/{id}/publish
GET /calendar/university/sample-university-1?academicYear=2026-2027
```

Result:

```text
draftStatus: draft
draftEventCount: 2
publishStatus: published
archivedCalendarCount: 1
publicEventCount: 4
```

### Security Review

- Admin calendar endpoints require JWT and `super_admin` role.
- Draft creation uses only extracted events that already passed admin approval.
- Publish rejects calendars with non-approved events.
- PDF source ownership alignment is validated against target university and academic year.
- Prior published calendars are archived instead of destructively overwritten.

### Known Risks

- Runtime repositories remain in-memory; MongoDB adapter wiring is still pending.
- Calendar publish does not yet enqueue notification scheduling jobs.
- University-admin scoped publishing is not implemented yet; MVP publish is limited to `super_admin`.
- Rollback archives the current published calendar but does not automatically re-publish the previous archived version.

### Approval

Approved to proceed to the next engineering section: notification preference model, notification scheduling policy and publish-triggered queue integration.

## 2026-05-09 - Notification Preferences And Publish Scheduling MVP

### Section

Student notification device/preference runtime APIs and publish-triggered notification scheduling for academic events.

### Scope Completed

- Notification domain model added for device tokens, notification preferences and notification jobs.
- In-memory notification repository added for MVP runtime behavior.
- Student endpoints added:
	- `POST /devices/register`
	- `GET /notification-preferences`
	- `PATCH /notification-preferences`
- Default reminder offsets are created as `[7, 1, 0]` for new students.
- Quiet hours update support added with `Europe/Istanbul` timezone validation.
- Admin calendar publish flow now invokes notification scheduling after events are promoted to `published`.
- Event-level notification jobs are generated from each academic event's enabled notification rules.
- Duplicate event/offset notification jobs are prevented in the in-memory repository and MongoDB index contract.
- Mongoose schemas added for `device_tokens`, `notification_preferences` and `notification_jobs`.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 12 passed
Tests: 54 passed
```

Covered scenarios:

- Device token registration is idempotent.
- Default student notification preferences are created on first read.
- Preference updates persist categories, reminder offsets and quiet hours.
- Calendar publish creates scheduled notification jobs for each enabled event reminder rule.
- Notification queue policy includes retry/dead-letter handling for schedule jobs.
- Notification MongoDB schemas and indexes are defined.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /auth/register
POST /devices/register
GET /notification-preferences
PATCH /notification-preferences
```

Result:

```text
deviceStatus: active
defaultOffsets: [7, 1, 0]
updatedOffsets: [7, 1]
quietHoursStart: 22:00
finalExamEnabled: true
```

### Security Review

- Device and preference endpoints require JWT and `student` role.
- Device registration derives `userId` from the verified token, not request body.
- Notification preferences are scoped to the authenticated user.
- Device token registration is idempotent by token to reduce duplicate fan-out risk.
- Publish-triggered scheduling only runs after a calendar and its events are in `published` state.

### Known Risks

- Notification repository is still in-memory; MongoDB adapter remains pending.
- BullMQ/Redis worker execution is not yet connected; scheduling currently records jobs in repository form.
- Firebase/APNs send adapters are not implemented yet.
- Preference filtering is not yet applied to event-level schedule generation; it will be applied when user-level fan-out is implemented.

### Approval

Approved to proceed to the next engineering section: MongoDB repository adapter wiring for auth, catalog, calendar, PDF and notification modules.

## 2026-05-09 - Operational Adapter And Security Runtime Foundation

### Section

Queue adapter foundation, notification send worker staging, audit logging, Mongo connection readiness and global rate-limit runtime guard.

### Scope Completed

- Queue adapter contract added with in-memory implementation for MVP runtime staging.
- Notification worker service added to enqueue due `notification_send_job` items from scheduled notification jobs.
- Notification repository extended with due-job lookup and job status update operations.
- Audit log domain, in-memory repository and service added.
- Calendar publish now writes an audit record with actor, calendar, university, academic year and event count metadata.
- Calendar rollback now writes an audit record for archival rollback action.
- Mongo connection service added; it stays passive without `MONGODB_URI` and can create a Mongoose connection when configured.
- Global rate-limit guard added and wired through `APP_GUARD`.
- Rate-limit behavior is driven by the endpoint catalog policies: `none`, `standard`, `strict` and `upload`.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 58 passed
```

Covered scenarios:

- Due notification schedule records are enqueued as `notification_send_job` items.
- Calendar publish records audit log entries.
- Strict endpoint rate limiting returns HTTP 429 after the configured limit.
- Mongo connection service remains passive when no URI is configured.
- Existing auth, catalog, calendar, PDF and notification tests remain green.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
GET /health/live
GET /health/ready
POST /auth/register
```

Result:

```text
live: ok
ready: ok
registeredRole: student
hasAccessToken: true
```

### Security Review

- Rate limiting is enforced globally before controller handlers execute.
- Strict authentication endpoints now have lower request budgets than standard read endpoints.
- Upload endpoints have a dedicated policy bucket for future PDF multipart traffic.
- Audit logs record privileged calendar state transitions.
- Queue and notification worker contracts avoid sending tokens or secrets in queued payloads.

### Known Risks

- Queue implementation is still in-memory; Redis/BullMQ persistence remains pending.
- Mongo connection service is ready, but module repositories still default to in-memory adapters.
- Notification worker only enqueues due sends; Firebase/APNs delivery adapters remain pending.
- Rate-limit buckets are process-local; distributed Redis-backed counters remain pending.

### Approval

Approved to proceed to the next engineering section: real MongoDB repository adapters and Redis-backed queue/rate-limit persistence.

## 2026-05-09 - Persistent Adapter And Admin Audit Endpoint Foundation

### Section

MongoDB repository adapter implementations, Redis/BullMQ queue adapter, Redis-backed rate-limit store, Firebase push adapter and admin audit timeline endpoint.

### Scope Completed

- MongoDB adapter helper utilities added for model registration, domain mapping and undefined-field omission.
- MongoDB repository adapters added for:
	- Auth users and refresh tokens.
	- Catalog universities, faculties and departments.
	- Academic calendars and events.
	- PDF sources and extracted events.
	- Notification device tokens, preferences and jobs.
	- Audit logs.
- BullMQ queue adapter added for Redis-backed job enqueue/list operations.
- Redis-backed rate-limit store added alongside in-memory store.
- Global rate-limit guard now consumes the `RateLimitStore` abstraction.
- Firebase push sender adapter added with explicit `FIREBASE_SERVICE_ACCOUNT_JSON` configuration requirement.
- Admin audit endpoint added:
	- `GET /admin/audit-logs?entityType=...&entityId=...`
- Runtime AppModule now registers admin audit controller, push sender, rate-limit store and Redis URL provider.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 61 passed
```

Covered scenarios:

- BullMQ adapter fails explicitly when Redis is not configured.
- Firebase push sender fails explicitly when credentials are not configured.
- Admin audit controller returns an entity timeline.
- Existing publish audit, due notification queue staging and rate-limit tests remain green.
- Existing auth, catalog, calendar, PDF, notification and database contract tests remain green.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /admin/pdf-sources
POST /admin/pdf-sources/{id}/process
POST /admin/extracted-events/{id}/approve
POST /admin/calendars
POST /admin/calendars/{id}/publish
GET /admin/audit-logs?entityType=academic_calendar&entityId={calendarId}
```

Result:

```text
auditCount: 1
auditAction: calendar.published
entityId: matched published calendar id
```

### Security Review

- Audit timeline endpoint requires JWT and `super_admin` role.
- Firebase credentials are read from environment and are not committed.
- Redis/BullMQ and Redis rate-limit adapters fail closed when required infrastructure is not configured.
- Mongo adapters omit `undefined` fields to preserve strict optional field semantics.
- Queue payloads contain notification job references and event metadata, not device tokens or secrets.

### Known Risks

- AppModule still defaults to in-memory repositories; Mongo adapters are implemented but require environment-driven provider switching in the next section.
- BullMQ adapter is implemented but not yet the default queue provider.
- Redis-backed rate-limit store is implemented but the default runtime provider remains in-memory until Redis deployment is enabled.
- Firebase adapter supports FCM; direct APNs provider configuration is still pending.
- npm audit reports 8 low-severity dependency findings after adding queue/push packages.

### Approval

Approved to proceed to the next engineering section: environment-driven adapter selection, Redis worker runtime and production notification delivery hardening.

## 2026-05-09 - Runtime Adapter Selection And Audit Operations Expansion

### Section

Environment-driven infrastructure selection, notification delivery hardening and admin audit operations expansion.

### Scope Completed

- Runtime configuration reader added for safe infrastructure mode selection.
- AppModule provider selection now supports:
	- `REPOSITORY_MODE=memory|mongo`
	- `QUEUE_MODE=memory|bullmq`
	- `RATE_LIMIT_STORE=memory|redis`
- Mongo repository adapters are now selectable through runtime configuration while memory remains the default MVP mode.
- BullMQ queue adapter is selectable through runtime configuration.
- Redis rate-limit store is selectable through runtime configuration.
- Push sender is registered behind the `PushSender` provider token.
- Notification worker can send a due job to a device through the push sender.
- Invalid push tokens are disabled in the notification repository and mark the notification job as failed.
- Admin audit listing now supports filtering by actor, action, entity type and entity id.
- Admin audit listing supports pagination through `limit` and `offset`.
- Admin audit export endpoint added at `GET /admin/audit-logs/export` with JSONL payload response.
- `.env.example` expanded with runtime infrastructure mode and Firebase service-account JSON settings.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 64 passed
```

Added coverage:

- Audit filtering and JSONL export.
- Invalid device token cleanup during push delivery.
- Runtime adapter mode parsing and safe defaults.
- Existing queue staging, publish audit and rate-limit tests remain green.

### Runtime Smoke Tests

Commands:

```powershell
npm run start:api
POST /admin/pdf-sources
POST /admin/pdf-sources/{id}/process
POST /admin/extracted-events/{id}/approve
POST /admin/calendars
POST /admin/calendars/{id}/publish
GET /admin/audit-logs?entityType=academic_calendar&entityId={calendarId}&limit=10&offset=0
GET /admin/audit-logs/export?entityType=academic_calendar&entityId={calendarId}
```

Result:

```text
auditCount: 1
auditAction: calendar.published
exportContentType: application/x-ndjson
exportHasAction: true
```

### Security Review

- Production infrastructure switches are explicit and default to local in-memory mode.
- Audit list and export endpoints remain restricted to `super_admin`.
- Export endpoint returns structured JSONL content instead of writing files on the server.
- Invalid device-token cleanup prevents repeated sends to known-bad push tokens.
- Firebase credentials remain environment-only through `FIREBASE_SERVICE_ACCOUNT_JSON`.

### Known Risks

- Mongo and Redis modes are now selectable but still need Docker-backed integration smoke in the next section.
- BullMQ worker fan-out from scheduled jobs to all eligible users still needs a production-grade processor loop.
- Notification preference filtering per user/device is not yet applied to delivery fan-out.
- npm audit still reports 8 low-severity dependency findings.

### Approval

Approved to proceed to the next engineering section: Docker-backed Mongo/Redis integration validation, notification fan-out processor and admin operations pagination contracts.

## 2026-05-09 - Environment Validation, Bootstrap Seed And Infrastructure Readiness

### Section

Production configuration validation, first-run bootstrap seed support, dependency-aware health checks and infrastructure smoke tooling.

### Scope Completed

- Environment validation added for Mongo/Redis-backed runtime modes.
- API bootstrap now fails fast on invalid infrastructure mode configuration.
- Dependency-aware readiness service added for MongoDB and Redis.
- `/health/ready` now returns mode-aware dependency records.
- Optional bootstrap seed service added for sample catalog and first admin account.
- `.env.example` expanded with bootstrap settings.
- `npm run smoke:infra` added for MongoDB ping/write/read, Redis ping and BullMQ enqueue validation.
- DevOps documentation updated with smoke-test and runtime-mode guidance.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 67 passed
```

Added coverage:

- Environment validation rejects missing `MONGODB_URI`/`REDIS_URL` for production-backed modes.
- Readiness returns `ok` with skipped MongoDB/Redis in in-memory mode.
- Bootstrap seed creates the first admin user when explicitly invoked with a password.

### Runtime Smoke Tests

Command:

```powershell
npm run start:api
Invoke-RestMethod -Uri http://localhost:3000/health/ready
```

Result:

```text
status: ok
api: ok
mongodb: skipped
redis: skipped
```

### Infrastructure Smoke Attempt

Command:

```powershell
docker compose up -d mongodb redis
```

Result:

```text
Blocked locally: Docker daemon pipe was not available on this Windows session.
```

The smoke script is implemented and ready to run once Docker Desktop/daemon access is available.

### Approval

Approved to proceed to the next engineering section: notification fan-out processor, preference filtering, quiet-hours deferral and worker retry/dead-letter operations.

## 2026-05-10 - Infrastructure Smoke, Notification Operations And Admin Console Start

### Section

Docker-backed infrastructure validation, notification fan-out operations, retry/dead-letter visibility and first usable admin operations console.

### Scope Completed

- Docker Compose MongoDB and Redis services started successfully.
- Infrastructure smoke script passed against real containers:
	- MongoDB ping/write/read.
	- Redis ping.
	- BullMQ enqueue.
- Notification repository contract expanded for:
	- Active device-token listing.
	- Failed job listing.
	- Job rescheduling/retry.
- Notification worker expanded with:
	- Due job fan-out to active devices.
	- Notification preference filtering.
	- Category-level opt-out handling.
	- Quiet-hours deferral.
	- Invalid-token disable handling.
	- Failed job listing and retry operation.
- Admin notification operations API added:
	- `POST /admin/notification-jobs/process-due`
	- `GET /admin/notification-jobs/failed`
	- `POST /admin/notification-jobs/retry?jobId=...`
- Production-mode API smoke passed with:
	- `REPOSITORY_MODE=mongo`
	- `QUEUE_MODE=bullmq`
	- `RATE_LIMIT_STORE=redis`
	- `BOOTSTRAP_SEED_ENABLED=true`
- Mongo-backed readiness returned `mongodb: ok` and `redis: ok`.
- Seeded catalog was read from MongoDB through `GET /universities`.
- Initial Vite/React admin operations console added under `apps/admin`.
- Admin console supports:
	- JWT entry.
	- Audit timeline loading.
	- Audit JSONL export.
	- Due notification processing.
	- Failed notification job loading.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 71 passed
```

Added coverage:

- Notification fan-out sends to eligible active devices.
- Category opt-out skips delivery and cancels an aggregate job with no eligible recipients.
- Quiet-hours preferences defer due notification jobs.
- Failed notification jobs can be listed and retried through admin operations.

### Infrastructure Smoke Tests

Commands:

```powershell
docker compose up -d mongodb redis
npm run smoke:infra
```

Result:

```json
{
  "mongodb": "ok",
  "redis": "ok",
  "bullmq": "ok",
  "jobId": "1"
}
```

### Runtime Smoke Tests

Production-mode API:

```powershell
REPOSITORY_MODE=mongo
QUEUE_MODE=bullmq
RATE_LIMIT_STORE=redis
BOOTSTRAP_SEED_ENABLED=true
npm run start:api
GET /health/ready
GET /universities
```

Result:

```text
health: ok
mongodb: ok
redis: ok
seeded universities: 1
```

Admin console:

```powershell
npm run dev:admin
```

Result:

```text
Vite admin console rendered at http://localhost:3002/
```

### Known Risks

- Notification jobs are still aggregate jobs; per-recipient delivery records should be introduced before high-volume production use.
- Quiet-hours deferral currently reschedules the aggregate job when all eligible recipients are deferred.
- Admin console is an operations MVP, not a full role-management/content-management UI yet.
- Mobile application and public frontend are still pending.
- npm audit still reports 8 low-severity dependency findings.

### Approval

Approved to proceed to the next engineering section: per-recipient notification delivery records, full admin CRUD workflows, mobile app MVP and deployment pipeline hardening.

## 2026-05-10 - General MVP Completion Pass

### Section

Per-recipient notification delivery records, expanded admin operations UI, student mobile web MVP and CI/CD validation hardening.

### Scope Completed

- Per-recipient notification delivery model added for `sent`, `failed`, `deferred` and `skipped` outcomes.
- MongoDB schema and index contract added for `notification_deliveries`.
- In-memory and Mongo notification repositories now record and list delivery records by notification job.
- Notification worker records delivery outcomes during fan-out, invalid-token cleanup, quiet-hours deferral and preference skips.
- Admin notification operations API expanded with `GET /admin/notification-jobs/deliveries?jobId=...`.
- Admin console expanded from operations shell into MVP workflows for catalog CRUD, faculty/department creation, PDF source processing, extracted event review, calendar draft/publish/rollback, notification processing/retry/delivery timeline and audit export.
- Student mobile web MVP added under `apps/mobile` with login/register, university selection, published calendar, upcoming events, notification preferences and web device registration.
- Root scripts now include `dev:mobile`, `build:admin` and `build:mobile`.
- `npm run validate` now includes typecheck, Vitest, admin production build and mobile production build.
- GitHub Actions CI added with Node 22, MongoDB, Redis, full validation, infrastructure smoke and high-severity production dependency audit.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 72 passed
Admin build: passed
Mobile build: passed
```

Added coverage:

- Sent delivery records include provider message id and delivered timestamp.
- Invalid push tokens record failed delivery and disable the token.
- Category opt-out records skipped delivery.
- Quiet-hours deferral records deferred delivery.
- Admin operations can list delivery records for a notification job.

### Infrastructure Smoke Tests

Command:

```powershell
npm run smoke:infra
```

Result:

```json
{
	"mongodb": "ok",
	"redis": "ok",
	"bullmq": "ok",
	"jobId": "2"
}
```

### Security Review

- Delivery endpoint requires `super_admin` role and returns operational delivery status rather than provider credentials.
- Student mobile operations still rely on server-side JWT, RBAC and DTO validation.
- Admin console keeps JWT only in React state for the current session and does not persist it.
- CI validates production builds and infrastructure adapters before merge.

### Known Risks

- Mobile MVP is responsive web, not a native React Native binary.
- PDF intake still uses metadata/raw-text JSON; multipart object-storage upload and antivirus enforcement remain production hardening items.
- Notification delivery is ready for Firebase FCM but provider credentials must be configured per environment.
- Role-management UI and university-admin scoped authorization remain post-MVP hardening.

### Approval

General MVP is approved for staging preparation and stakeholder walkthrough.

## 2026-05-10 - Packaging And Staging Readiness

### Section

Container packaging, production-style compose readiness, refreshed project documentation and final validation pass.

### Scope Completed

- `.dockerignore` added to keep image contexts small and exclude secrets, local storage and build outputs.
- API Dockerfile added for the NestJS runtime.
- Admin Dockerfile added for Vite build plus nginx SPA serving.
- Student mobile web Dockerfile added for Vite build plus nginx SPA serving.
- Shared nginx SPA fallback config added with `/healthz` endpoint.
- Production-style compose file added for API, admin, mobile, MongoDB and Redis.
- Root README refreshed with current MVP scope, local startup, validation and production compose commands.
- Admin README refreshed for the current Vite operations console.
- Environment example expanded with CORS and frontend API base URL settings.
- Root scripts added for production compose config/build validation.

### Automated Tests

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 72 passed
Admin build: passed
Mobile build: passed
```

### Infrastructure And Packaging Validation

Commands:

```powershell
npm run compose:prod:config
npm run smoke:infra
npm run compose:prod:build:classic
```

Result:

```text
Production compose config: passed
MongoDB smoke: ok
Redis smoke: ok
BullMQ smoke: ok, jobId: 3
Production images: api built, admin built, mobile built
```

### Security Review

- Production compose requires caller-provided JWT access and refresh secrets.
- API production-style runtime uses MongoDB, BullMQ and Redis rate limiting by default.
- Frontend containers serve static assets through nginx and do not embed server secrets.
- Docker context excludes `.env` files and local upload/storage paths.

### Known Risks

- Replace placeholder JWT secrets and Firebase credentials per environment before real staging use.
- Multipart PDF upload, object-storage persistence and ClamAV runtime enforcement remain post-MVP hardening items.
- Container image vulnerability scanning should be added before production release gates.
- On this Windows workspace path, Docker Compose Buildx/Bake can fail on non-ASCII path handling; the documented classic compose build fallback succeeds.

### Approval

MVP packaging is approved for staging deployment rehearsal and stakeholder walkthrough.

## 2026-05-11 - UI/UX Productization Planning

### Section

Production-level UI/UX planning for admin web and student mobile web.

### Scope Completed

- UI/UX product readiness report created with design system, CTA, color and vector standards.
- 8-week implementation roadmap created with phased execution and acceptance criteria.
- Optimization scenarios created with performance budgets, accessibility gates and release criteria.
- Backlog extended with Stage 5 UI/UX productization tasks.

### Artifacts

- `docs/10-ui-ux-product-readiness-report.md`
- `docs/11-ui-ux-implementation-roadmap.md`
- `docs/12-ui-ux-optimization-scenarios.md`

### Security And Quality Review

- Accessibility baseline aligned to WCAG 2.2 AA.
- Contrast and CTA semantics documented to reduce operational risk.
- Performance budgets and CI gate model defined for repeatable quality control.

### Approval

UI/UX productization planning is approved to proceed to design-token implementation and phased frontend refactor.

## 2026-05-11 - UI/UX Productization Implementation (Phase 1)

### Section

Web admin and mobile web UI/UX implementation aligned with the production planning artifacts.

### Scope Completed

- Admin and mobile interfaces migrated to token-driven visual system foundations.
- CTA hierarchy implemented with primary, secondary, chip and destructive button patterns.
- Loading, empty and error state patterns implemented in critical panels.
- Accessibility upgrades added: focus-visible states, improved labels, status messaging and reduced-motion support.
- Interaction guardrails added for protected actions (JWT/session-required feedback).
- UX feedback quality improved with sticky status notices and deterministic action messaging.

### Implementation Targets

- `apps/admin/src/main.tsx`
- `apps/admin/src/styles.css`
- `apps/mobile/src/main.tsx`
- `apps/mobile/src/styles.css`

### Automated Validation

Command:

```bash
npm run validate
```

Result:

```text
Typecheck: passed
Test files: 13 passed
Tests: 72 passed
Admin build: passed
Mobile build: passed
```

### Approval

UI/UX productization Phase 1 implementation is approved to proceed with Phase 2 (task-based usability measurement and CI quality gate enforcement).

## 2026-05-11 - React Native Mobile Implementation And Alarm Scope Clarification

### Section

React Native (Expo) student application implementation and explicit alarm model documentation for PDF/OCR/manual ingestion outputs.

### Scope Completed

- Expo TypeScript mobile-native application scaffold added under `apps/mobile-native`.
- Native app implemented with API-integrated flows:
	- register/login/logout
	- university selection
	- published calendar and upcoming list
	- notification preference and device registration
- Alarm scope UX implemented in native app:
	- all calendar alarms
	- selected field alarms by category
- API CORS default origins expanded for local multi-frontend development.
- Mobile web auth flow fixed by adding required `deviceId` field.
- Ingestion and alarm business model documented for OCR/manual input clarity.

### Implementation Targets

- `apps/mobile-native/App.tsx`
- `apps/mobile-native/package.json`
- `apps/mobile-native/app.json`
- `apps/mobile-native/README.md`
- `apps/api/src/main.ts`
- `apps/mobile/src/main.tsx`
- `docs/13-pdf-ingestion-and-alarm-model.md`

### Automated Validation

Commands:

```bash
npm run typecheck:mobile:native
npm run validate
./scripts/e2e-student-smoke.ps1
```

Expected result:

```text
Native typecheck: passed
Root validate: passed
Student E2E smoke: passed
```

### Approval

React Native mobile implementation baseline is approved for emulator/device acceptance testing and push-token provider integration.
