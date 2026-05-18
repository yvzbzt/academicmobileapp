# Redis Cache And Queue Architecture

## 1. Cache Policy

Every cache key must have a TTL and explicit invalidation source. Calendar-related keys are treated as high stale-risk and invalidated on publish, rollback and event update.

| Key | TTL | Invalidation |
|---|---:|---|
| universities:all | 3600s | university created/updated |
| university:{id}:faculties | 3600s | faculty created/updated |
| faculty:{id}:departments | 3600s | department created/updated |
| calendar:university:{universityId}:year:{academicYear} | 900s | calendar published/rollback |
| calendar:user:{userId} | 600s | user university changed/calendar published |
| events:upcoming:university:{universityId} | 600s | calendar published/event updated |
| preferences:user:{userId} | 1800s | preferences updated |
| device_tokens:user:{userId} | 900s | device registered/deleted/invalidated |

## 2. Queue Policy

| Job | Retry | Timeout | Priority | Dead Letter |
|---|---:|---:|---:|---|
| pdf_download_job | 3 | 60s | 2 | Yes |
| pdf_validation_job | 1 | 30s | 1 | No |
| pdf_parse_job | 2 | 120s | 2 | Yes |
| ocr_job | 1 | 300s | 4 | Yes |
| event_normalization_job | 2 | 60s | 2 | Yes |
| notification_schedule_job | 3 | 180s | 3 | Yes |
| notification_send_job | 5 | 30s | 1 | Yes |
| cache_invalidation_job | 5 | 15s | 1 | Yes |
| audit_log_job | 5 | 15s | 1 | Yes |

## 3. 50,000 Student Notification Scenario

When final exam events are published for a university with 50,000 students:

1. Publish transaction stores events and emits `notification_schedule_job` per event.
2. Scheduler queries active users by university in pages.
3. Preferences are loaded from cache or MongoDB.
4. Users with disabled final_exam notifications are skipped.
5. One notification job is created per user, event and reminder offset with a unique duplicate guard.
6. Send jobs are batched by provider and rate-limited.
7. Invalid FCM tokens are marked inactive.
8. Every provider response is recorded in notification_logs with sensitive tokens redacted.
