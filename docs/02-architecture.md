# Technical Architecture

## 1. MVP Architecture Decision

Start with a modular monolith backend using NestJS. This keeps transaction boundaries, product iteration and deployment simple while preserving module boundaries that can later be extracted into services.

## 2. System Context

```text
React Native Mobile App
  -> Backend API
     -> MongoDB
     -> Redis Cache
     -> Redis/BullMQ Queues
     -> Object Storage
     -> FCM/APNs Providers

Next.js Admin Panel
  -> Backend API
     -> PDF Processing Queue
     -> Audit Logs

Worker Processes
  -> PDF Parsing
  -> OCR Fallback
  -> Event Normalization
  -> Notification Scheduling
  -> Notification Sending
```

## 3. Runtime Components

| Component | Responsibility | MVP |
|---|---|---|
| Mobile App | Student onboarding, calendar, preferences and push token registration | Yes |
| Admin Panel | Content operations, PDF upload, review and publish | Yes |
| Backend API | Auth, RBAC, data access, calendar APIs and admin APIs | Yes |
| PDF Worker | Validates, parses and normalizes PDF event candidates | Yes |
| OCR Worker | Handles scanned PDFs | Later, with MVP hook |
| Notification Worker | Schedules and sends notifications | Yes |
| Scheduler Worker | Periodic stale jobs and due notifications | Yes |
| MongoDB | Primary document database | Yes |
| Redis | Cache and queue backend | Yes |
| Object Storage | Private PDF storage | Yes |
| Monitoring | Logs, metrics, errors and queue health | Baseline |

## 4. Module Boundaries

| Module | Collections | Key APIs | Dependencies |
|---|---|---|---|
| Auth | users, refresh_tokens | `/auth/*` | Users, Audit |
| Users | users | `/me`, `/admin/users` | Auth, Preferences |
| Universities | universities | `/universities`, `/admin/universities` | Cache, Audit |
| Faculties | faculties | `/universities/:id/faculties` | Universities |
| Departments | departments | `/faculties/:id/departments` | Faculties |
| Calendars | academic_calendars | `/calendar/*`, `/admin/calendars/*` | Events, Cache, Queue |
| Events | academic_events | `/calendar/events/*` | Notifications |
| PDF Sources | pdf_sources | `/admin/pdf-sources/*` | Storage, Queue, Security |
| PDF Processing | pdf_sources, extracted_events | Worker jobs | Object Storage |
| Extracted Events | extracted_events | `/admin/extracted-events/*` | Calendars, Audit |
| Notifications | notification_jobs, notification_logs | `/notification-preferences` | Device Tokens, Queue |
| Device Tokens | device_tokens | `/devices/*` | Auth, Notifications |
| Audit Logs | audit_logs | `/admin/audit-logs` | All admin modules |

## 5. Synchronous Flows

- Student login/register.
- Student calendar and upcoming events retrieval.
- Admin CRUD operations for universities, faculties and departments.
- Admin extracted event review and publish commands.

## 6. Asynchronous Flows

- PDF upload creates parsing jobs.
- Parsing jobs create extracted events.
- Calendar publish creates notification schedule jobs.
- Scheduler converts due notification jobs into send jobs.
- Send worker calls FCM/APNs and writes delivery logs.
- Cache invalidation jobs clear affected Redis keys.

## 7. Data Consistency

MongoDB transactions are required for:

- Calendar publish: archive old version, publish new version, update events, schedule notifications.
- Event approval: update extracted event, create academic event, write audit log.
- User university change: update user, invalidate user calendar cache, cancel irrelevant pending notifications.
- PDF processing completion: update source status and insert extracted events.

## 8. Future Extraction Path

| Future Service | Extraction Trigger |
|---|---|
| PDF Processing Service | High CPU/OCR load or sandbox isolation requirement |
| Notification Service | High notification volume or provider-specific scaling |
| University Content Service | Multi-tenant university admin rollout |
| Analytics Service | Event and notification analytics need independent pipelines |
