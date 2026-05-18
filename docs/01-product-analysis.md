# Product And Business Analysis

## 1. Product Vision

Universite Akademik Takvim Bildirim Uygulamasi, Turkiye'deki universitelerin akademik takvimlerini tek bir guvenilir mobil deneyimde toplar. Kullanici universitesini, fakulte ve bolum bilgisini secer; yayinlanmis akademik olaylari gorur ve tercih ettigi kategoriler icin zamaninda push notification alir.

## 2. Primary Stakeholders

| Stakeholder | Need | Success Metric |
|---|---|---|
| Student | Akademik tarihleri kacirmamak | Notification delivery success, active users |
| Content Editor | PDF kaynaklari hizli islemek | Review throughput, low correction time |
| Super Admin | Veri kalitesini ve yayini yonetmek | Low incident rate, audit completeness |
| University Admin | Kendi universite takvimini yonetmek | Scoped admin accuracy |
| Operations | Sistem sagligini izlemek | Queue latency, error budget |

## 3. MVP Scope

### In Scope

- Student register/login.
- University, faculty and department selection.
- Admin university/faculty/department management.
- Admin PDF upload.
- PDF validation, hashing, storage and text extraction pipeline foundation.
- Rule-based date normalization and category mapping.
- Admin review, approve, reject and publish workflow.
- Published academic calendar and upcoming event APIs.
- Device token registration, notification preferences and FCM-based notification jobs.
- MongoDB, Redis cache and BullMQ-based queue architecture.
- Baseline security controls and audit logs.

### Out Of MVP Scope

- Fully automated scraping.
- Advanced OCR and AI classification.
- Multi-language product UI.
- University-admin self-service rollout.
- Advanced rollback and analytics.
- Certificate pinning.

## 4. Business Rules

| Rule ID | Rule | Priority |
|---|---|---|
| BR-001 | Extracted PDF events must never be visible to students before admin approval and calendar publish. | Must |
| BR-002 | A PDF with the same hash must not be processed twice for the same source scope. | Must |
| BR-003 | Only published academic events are returned from public calendar endpoints. | Must |
| BR-004 | Notification jobs must respect user category preferences and quiet hours. | Must |
| BR-005 | Critical admin actions must create immutable audit logs. | Must |
| BR-006 | Student users can only manage their own profile, device tokens and preferences. | Must |
| BR-007 | Content editors can review events but cannot publish calendars unless explicitly granted. | Should |

## 5. Functional Requirements

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-001 | User authentication | Register, login, refresh and logout flows work with validation and secure token handling. |
| FR-002 | University selection | Student can select university, faculty and department; selection affects calendar feed. |
| FR-003 | PDF upload | Admin can upload a valid PDF for a university and academic year. |
| FR-004 | PDF extraction | System extracts date-bearing lines and creates pending extracted events. |
| FR-005 | Admin review | Admin can edit, approve or reject extracted events. |
| FR-006 | Calendar publish | Approved events can be published as the active calendar version. |
| FR-007 | Mobile calendar | Student sees published events and upcoming events. |
| FR-008 | Notifications | Student device tokens are registered and jobs are scheduled according to preferences. |

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | OWASP ASVS-aligned auth, authorization, upload and logging controls. |
| Availability | API and workers must expose health checks. |
| Observability | Structured logs, queue metrics and notification delivery status must be tracked. |
| Performance | Public catalog and calendar endpoints should use Redis cache. |
| Reliability | Background jobs must have retry and dead-letter handling. |
| Privacy | Passwords and tokens must never be logged or stored in plain text. |
| Maintainability | Modules must be independently testable with domain logic separated from framework adapters. |

## 7. MVP Acceptance Gate

MVP is acceptable when the following end-to-end scenario passes:

1. Super admin logs into admin panel.
2. Admin creates a university, faculty and department.
3. Admin uploads a text-based academic calendar PDF.
4. PDF is validated, hashed and parsed into pending extracted events.
5. Admin edits and approves events.
6. Admin publishes the calendar.
7. Student registers, selects the university and sees upcoming events.
8. Student registers a device token and notification jobs are scheduled.
9. Critical actions are visible in audit logs.
