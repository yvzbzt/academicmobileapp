# Test Strategy

## 1. Test Pyramid

| Layer | Purpose | Tools |
|---|---|---|
| Unit | Domain functions, validators, guards, services | Vitest, Jest |
| Integration | MongoDB repositories, Redis cache, BullMQ jobs | Testcontainers or docker compose test stack |
| E2E API | Auth, admin review, publish and notification flows | Supertest |
| Admin UI | Critical admin workflows | Playwright |
| Mobile UI | Auth, selection, calendar and notification preferences | Detox or Maestro |
| Security | Auth bypass, IDOR, NoSQL injection, upload abuse | Automated tests plus manual review |

## 2. Current Automated Tests

| Area | Coverage |
|---|---|
| Date normalization | Numeric dates, Turkish textual dates, ranges, academic year, terms |
| Category mapping | Main Turkish academic phrases to canonical categories |
| Confidence score | High and low confidence bands |
| Query sanitizer | MongoDB operator and dotted key removal |
| Auth and RBAC | Registration, login, refresh rotation, logout, JWT guard and role guard behavior |
| Catalog and calendar | Public catalog, academic selection, public calendar, upcoming events and publish workflow |
| PDF processing | Validation, duplicate hash protection, text extraction, approve/reject review flow |
| Notifications | Device registration, preferences, scheduling, fan-out, quiet hours, invalid token handling and delivery records |
| Infrastructure | MongoDB ping/write/read, Redis ping and BullMQ enqueue smoke test |
| Frontend builds | Admin operations console and student mobile web production bundles |

## 3. Required MVP Test Scenarios

### Backend

- Register rejects invalid email and weak password.
- Login returns tokens for valid credentials.
- Refresh token rotation invalidates old token.
- Student cannot access admin endpoints.
- Public calendar returns only published events.
- User university change invalidates user calendar cache.

### PDF Processing

- Valid text-based PDF creates pending extracted events.
- Duplicate PDF hash does not enqueue a new parse job.
- Encrypted PDF is rejected.
- Oversized PDF is rejected.
- Parser failure updates parseError and does not crash worker.
- Date formats listed in product requirements normalize correctly.

### Admin Panel

- Admin can create university.
- Content editor can review event.
- Content editor cannot publish unless role allows it.
- Super admin can publish calendar.
- Audit log appears after publish.

### Mobile App

- User can register, login and logout.
- Token is stored in secure storage only.
- University selection persists.
- Offline mode shows last cached calendar.
- Event detail opens from notification deep link.

### Notifications

- Device token registration is idempotent.
- Disabled category prevents job creation.
- Duplicate notification job is prevented.
- Invalid provider token is deactivated.
- Quiet hours are respected.

## 4. Section Approval Template

For each completed section, record:

```text
Section:
Scope Completed:
Automated Tests:
Manual Tests:
Security Review:
Known Risks:
Approval:
```
