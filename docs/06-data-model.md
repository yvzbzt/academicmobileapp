# MongoDB Data Model

## 1. Modeling Principles

- Use references for high-cardinality relations such as users, events, notification jobs and audit logs.
- Denormalize stable read fields where it improves mobile feed performance, for example `universityId`, `academicYear`, `term` on academic_events.
- Keep extracted_events separate from academic_events because extracted data is not trusted until admin review.
- Use soft delete or status fields for operational records.
- Use TTL only for naturally expiring security records such as refresh tokens and reset tokens.

## 2. Collections

| Collection | Purpose | Key Indexes |
|---|---|---|
| users | Student and admin accounts | email unique, universityId/status |
| universities | University catalog | slug unique |
| faculties | Faculty catalog | universityId/slug unique |
| departments | Department catalog | facultyId/slug unique |
| academic_calendars | Calendar versions | universityId/academicYear/version, published lookup |
| academic_events | Published or draft academic events | universityId/status/startDate, category/date |
| pdf_sources | Uploaded or URL-based PDFs | universityId/fileHash unique, url/fileHash |
| extracted_events | Untrusted extracted event candidates | status/confidenceScore/createdAt |
| device_tokens | Push tokens | token unique, userId/status |
| notification_preferences | User notification configuration | userId unique |
| notification_jobs | Scheduled notification work | status/scheduledAt, userId/eventId/scheduledAt unique |
| notification_logs | Provider send history | userId/eventId/sentAt |
| audit_logs | Admin and security action history | actorId/createdAt, entityType/entityId/createdAt |
| refresh_tokens | Refresh session state | tokenHash unique, expiresAt TTL |

## 3. Critical Query Optimization

| Query | Index Strategy |
|---|---|
| User calendar | users `_id`, then academic_events `universityId + status + startDate` |
| University calendar | academic_calendars `universityId + academicYear + status` |
| Upcoming events | academic_events `universityId + status + startDate` |
| Date range events | academic_events `universityId + category + startDate` |
| Pending review | extracted_events `status + confidenceScore + createdAt` |
| PDF hash check | pdf_sources `universityId + fileHash` unique |
| Due notification jobs | notification_jobs `status + scheduledAt` |
| Device lookup | device_tokens `token` unique and `userId + status` |
| Audit investigation | audit_logs `actorId + createdAt` and `entityType + entityId + createdAt` |

## 4. Versioning Strategy

- A calendar has immutable version numbers per university and academic year.
- Publishing a new version archives the previous published version in the same transaction.
- Events should reference `calendarId` and carry denormalized `universityId` and `academicYear`.
- PDF versions are kept in pdf_sources with fileHash, version and processedAt.
- Rollback changes the active calendar pointer/status and cancels or regenerates affected notification jobs.
