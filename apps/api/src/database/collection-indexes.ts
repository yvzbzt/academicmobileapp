export interface MongoIndexDefinition {
  collection: string;
  keys: Record<string, 1 | -1>;
  unique?: boolean;
  sparse?: boolean;
  ttlSeconds?: number;
  name: string;
  purpose: string;
}

export const mongoIndexDefinitions: MongoIndexDefinition[] = [
  { collection: "users", keys: { email: 1 }, unique: true, name: "users_email_unique", purpose: "Login and duplicate email prevention" },
  { collection: "users", keys: { universityId: 1, status: 1 }, name: "users_university_status", purpose: "Notification fan-out by university" },
  { collection: "refresh_tokens", keys: { tokenHash: 1 }, unique: true, name: "refresh_tokens_hash_unique", purpose: "Refresh token lookup" },
  { collection: "refresh_tokens", keys: { expiresAt: 1 }, ttlSeconds: 0, name: "refresh_tokens_expires_ttl", purpose: "Expired token cleanup" },
  { collection: "email_verification_tokens", keys: { tokenHash: 1 }, unique: true, name: "email_verification_tokens_hash_unique", purpose: "Email verification token lookup" },
  { collection: "email_verification_tokens", keys: { userId: 1, createdAt: -1 }, name: "email_verification_tokens_user_latest", purpose: "Latest verification code and resend cooldown lookup" },
  { collection: "email_verification_tokens", keys: { expiresAt: 1 }, ttlSeconds: 0, name: "email_verification_tokens_expires_ttl", purpose: "Expired email verification token cleanup" },
  { collection: "universities", keys: { slug: 1 }, unique: true, name: "universities_slug_unique", purpose: "Stable public lookup" },
  { collection: "faculties", keys: { universityId: 1, slug: 1 }, unique: true, name: "faculties_university_slug_unique", purpose: "Faculty lookup within university" },
  { collection: "departments", keys: { facultyId: 1, slug: 1 }, unique: true, name: "departments_faculty_slug_unique", purpose: "Department lookup within faculty" },
  { collection: "announcement_sources", keys: { scopeType: 1, scopeId: 1, status: 1 }, name: "announcement_sources_scope_status", purpose: "Announcement source lookup by academic scope" },
  { collection: "announcement_sources", keys: { sourceUrl: 1, scopeType: 1, scopeId: 1 }, unique: true, name: "announcement_sources_unique_scope_url", purpose: "Prevent duplicate source mapping in same scope" },
  { collection: "announcement_items", keys: { sourceId: 1, link: 1 }, unique: true, name: "announcement_items_source_link_unique", purpose: "Prevent duplicate cached announcement items per source" },
  { collection: "announcement_items", keys: { scopeType: 1, scopeId: 1 }, name: "announcement_items_scope", purpose: "Read cached announcements by academic scope" },
  { collection: "academic_calendars", keys: { universityId: 1, academicYear: 1, version: -1 }, name: "calendars_university_year_version", purpose: "Calendar version retrieval" },
  { collection: "academic_calendars", keys: { universityId: 1, academicYear: 1, status: 1 }, name: "calendars_published_lookup", purpose: "Published calendar lookup" },
  { collection: "academic_events", keys: { universityId: 1, status: 1, startDate: 1 }, name: "events_university_status_start", purpose: "User calendar and upcoming events" },
  { collection: "academic_events", keys: { universityId: 1, category: 1, startDate: 1 }, name: "events_category_date", purpose: "Category and date range filters" },
  { collection: "pdf_sources", keys: { universityId: 1, fileHash: 1 }, unique: true, name: "pdf_sources_university_hash_unique", purpose: "Duplicate PDF prevention" },
  { collection: "pdf_sources", keys: { url: 1, fileHash: 1 }, name: "pdf_sources_url_hash", purpose: "URL change detection" },
  { collection: "extracted_events", keys: { status: 1, confidenceScore: 1, createdAt: -1 }, name: "extracted_review_queue", purpose: "Admin pending review filters" },
  { collection: "device_tokens", keys: { token: 1 }, unique: true, name: "device_tokens_token_unique", purpose: "Idempotent token registration" },
  { collection: "device_tokens", keys: { userId: 1, status: 1 }, name: "device_tokens_user_status", purpose: "Notification send fan-out" },
  { collection: "notification_preferences", keys: { userId: 1 }, unique: true, name: "notification_preferences_user_unique", purpose: "Preference lookup" },
  { collection: "notification_jobs", keys: { status: 1, scheduledAt: 1 }, name: "notification_jobs_due", purpose: "Scheduler due job query" },
  { collection: "notification_jobs", keys: { userId: 1, eventId: 1, scheduledAt: 1 }, unique: true, name: "notification_jobs_duplicate_guard", purpose: "Duplicate notification prevention" },
  { collection: "notification_jobs", keys: { userId: 1, eventId: 1, trigger: 1, offsetDays: 1, offsetHours: 1 }, unique: true, name: "notification_jobs_user_event_reminder_unique", purpose: "Prevent duplicate reminder jobs per user and trigger offset" },
  { collection: "student_alarms", keys: { userId: 1, scheduledAt: 1 }, name: "student_alarms_user_due", purpose: "Student alarm listing and delivery audit" },
  { collection: "student_alarms", keys: { userId: 1, targetId: 1, eventType: 1, trigger: 1, amount: 1, unit: 1 }, unique: true, name: "student_alarms_user_target_unique", purpose: "Prevent duplicate custom alarms per student and target" },
  { collection: "notification_deliveries", keys: { jobId: 1, userId: 1, deviceTokenId: 1 }, name: "notification_deliveries_job_user_device", purpose: "Per-recipient delivery audit" },
  { collection: "notification_deliveries", keys: { status: 1, createdAt: -1 }, name: "notification_deliveries_status_time", purpose: "Delivery operations and failure investigation" },
  { collection: "audit_logs", keys: { actorId: 1, createdAt: -1 }, name: "audit_actor_time", purpose: "Admin actor investigation" },
  { collection: "audit_logs", keys: { entityType: 1, entityId: 1, createdAt: -1 }, name: "audit_entity_time", purpose: "Entity history lookup" }
];
