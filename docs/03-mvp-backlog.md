# MVP Delivery Backlog

## Delivery Stages

| Stage | Scope | Completion Criteria |
|---|---|---|
| 0. Foundation | Monorepo, configs, docs, test runner | `npm run validate` passes |
| 1. Backend Core | Auth, users, universities, calendar domain | Unit and integration tests pass |
| 2. PDF Review | Upload, parse, extracted events, admin review | Admin can approve extracted event |
| 3. Publish And Mobile | Published calendar API and mobile screens | Student sees published events |
| 4. Notifications And Hardening | Device tokens, jobs, FCM, security controls | Test notification and scheduled notification work |
| 5. UI/UX Productization | Design system, CTA hierarchy, accessibility and performance budgets | Lighthouse and accessibility gates pass with UX KPI targets |

## Backend Tasks

| ID | Task | Acceptance Criteria |
|---|---|---|
| BE-001 | NestJS API bootstrap | Health endpoint, config validation and structured logging are available. |
| BE-002 | Auth module | Register, login, refresh rotation and logout are implemented with tests. |
| BE-003 | RBAC guards | Student, content_editor, university_admin and super_admin roles are enforced. |
| BE-004 | University APIs | Public list and admin CRUD work with cache invalidation. |
| BE-005 | Calendar APIs | Only published events are returned to students. |
| BE-006 | PDF source APIs | Upload, status, process and extracted event listing endpoints exist. |
| BE-007 | Notification APIs | Device token and preferences endpoints are implemented. |

## Admin Tasks

| ID | Task | Acceptance Criteria |
|---|---|---|
| AD-001 | Admin auth shell | Non-admin users cannot enter admin panel. |
| AD-002 | University management | Admin can create and update university data. |
| AD-003 | PDF management | Admin can upload PDF and see pipeline status. |
| AD-004 | Extracted event review | Admin can filter by confidence, edit fields, approve or reject. |
| AD-005 | Publish workflow | Approved events can be published and audit logged. |

## Mobile Tasks

| ID | Task | Acceptance Criteria |
|---|---|---|
| MB-001 | Auth flow | Register/login/logout work with secure storage. |
| MB-002 | University selection | Student can select university, faculty and department. |
| MB-003 | Dashboard | Upcoming events are displayed with loading, error and empty states. |
| MB-004 | Calendar list and detail | Published events are browsable and openable from push deep links. |
| MB-005 | Notification preferences | Preferences are editable and synced. |
| MB-006 | Native mobile app | React Native app supports login/register, university selection, calendar timeline and alarm scope selection. |

## UI/UX Productization Tasks

| ID | Task | Acceptance Criteria |
|---|---|---|
| UX-001 | Design token architecture | Color, type, spacing, radius and elevation tokens are implemented and consumed by admin and mobile apps. |
| UX-002 | CTA hierarchy standardization | Primary, secondary, tertiary and destructive CTA patterns are applied consistently across critical flows. |
| UX-003 | Accessible color system | Semantic colors meet WCAG 2.2 AA contrast requirements in critical screens. |
| UX-004 | Vector and icon governance | SVG/Lucide usage follows shared size, stroke and optimization standards with documented budget limits. |
| UX-005 | State pattern library | Loading, empty, error and success patterns exist for all critical operation panels and mobile flows. |
| UX-006 | UI performance budgets | JS/CSS/SVG budgets and Core Web Vitals thresholds are defined and enforced in CI. |
| UX-007 | UX KPI validation | Admin and mobile task completion and error-rate targets are measured and reported. |

## Section Approval Policy

Each completed section must have:

- Acceptance criteria checked.
- Unit or integration test where applicable.
- Documentation updated.
- Security impact reviewed.
- No failing typecheck or tests.
