import { Schema } from "mongoose";

export const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    credentialGeneration: { type: Number, required: true, default: 0, min: 0 },
    emailVerifiedAt: { type: Date, required: false },
    passwordHash: { type: String, required: true, select: true },
    authProvider: { type: String, required: false, enum: ["password", "google", "password_google"], default: "password" },
    firebaseAuthUid: { type: String, required: false, index: true },
    role: {
      type: String,
      required: true,
      enum: ["student", "content_editor", "university_admin", "super_admin"],
      default: "student"
    },
    universityId: { type: String, required: false, index: true },
    facultyId: { type: String, required: false },
    departmentId: { type: String, required: false },
    classLevel: { type: Number, required: false, min: 1, max: 6 },
    status: { type: String, required: true, enum: ["active", "inactive", "locked"], default: "active", index: true },
    lastLoginAt: { type: Date, required: false },
    deletedAt: { type: Date, required: false }
  },
  { collection: "users", timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true, name: "users_email_unique" });
userSchema.index({ firebaseAuthUid: 1 }, { sparse: true, name: "users_firebase_auth_uid" });
userSchema.index({ universityId: 1, status: 1 }, { name: "users_university_status" });

export const refreshTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    credentialGeneration: { type: Number, required: true, default: 0, min: 0 },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true },
    ipAddress: { type: String, required: false },
    userAgent: { type: String, required: false },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, required: false },
    reusedAt: { type: Date, required: false }
  },
  { collection: "refresh_tokens", timestamps: { createdAt: true, updatedAt: false } }
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: "refresh_tokens_hash_unique" });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "refresh_tokens_expires_ttl" });
refreshTokenSchema.index({ familyId: 1, revokedAt: 1 }, { name: "refresh_tokens_family_revocation" });

export const emailVerificationTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    resendAvailableAt: { type: Date, required: true },
    consumedAt: { type: Date, required: false }
  },
  { collection: "email_verification_tokens", timestamps: { createdAt: true, updatedAt: false } }
);

emailVerificationTokenSchema.index({ tokenHash: 1 }, { unique: true, name: "email_verification_tokens_hash_unique" });
emailVerificationTokenSchema.index({ userId: 1, createdAt: -1 }, { name: "email_verification_tokens_user_latest" });
emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "email_verification_tokens_expires_ttl" });

export const passwordRecoveryTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    credentialGeneration: { type: Number, required: true, default: 0, min: 0 },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
    resendAvailableAt: { type: Date, required: true },
    consumedAt: { type: Date, required: false },
    invalidatedAt: { type: Date, required: false }
  },
  { collection: "password_recovery_tokens", timestamps: { createdAt: true, updatedAt: false } }
);

passwordRecoveryTokenSchema.index({ tokenHash: 1 }, { unique: true, name: "password_recovery_tokens_hash_unique" });
passwordRecoveryTokenSchema.index({ userId: 1, createdAt: -1 }, { name: "password_recovery_tokens_user_latest" });
passwordRecoveryTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "password_recovery_tokens_expires_ttl" });

export const universitySchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    city: { type: String, required: true, trim: true, index: true },
    type: { type: String, required: true, enum: ["state", "foundation", "private"] },
    websiteUrl: { type: String, required: false },
    announcementUrl: { type: String, required: false },
    academicCalendarUrl: { type: String, required: false },
    logoUrl: { type: String, required: false },
    emailDomains: [{ type: String, lowercase: true, trim: true }],
    status: { type: String, required: true, enum: ["active", "inactive", "archived"], default: "active", index: true }
  },
  { collection: "universities", timestamps: true }
);

universitySchema.index({ slug: 1 }, { unique: true, name: "universities_slug_unique" });
universitySchema.index({ status: 1, name: 1 }, { name: "universities_status_name" });
universitySchema.index({ emailDomains: 1 }, { name: "universities_email_domains" });

export const facultySchema = new Schema(
  {
    _id: { type: String, required: true },
    universityId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    websiteUrl: { type: String, required: false },
    announcementUrl: { type: String, required: false },
    status: { type: String, required: true, enum: ["active", "inactive", "archived"], default: "active", index: true }
  },
  { collection: "faculties", timestamps: true }
);

facultySchema.index({ universityId: 1, slug: 1 }, { unique: true, name: "faculties_university_slug_unique" });

export const departmentSchema = new Schema(
  {
    _id: { type: String, required: true },
    universityId: { type: String, required: true, index: true },
    facultyId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    educationLevel: { type: String, required: true, enum: ["associate", "bachelor", "master", "doctorate"] },
    websiteUrl: { type: String, required: false },
    announcementUrl: { type: String, required: false },
    courseScheduleUrl: { type: String, required: false },
    examScheduleUrl: { type: String, required: false },
    status: { type: String, required: true, enum: ["active", "inactive", "archived"], default: "active", index: true }
  },
  { collection: "departments", timestamps: true }
);

departmentSchema.index({ facultyId: 1, slug: 1 }, { unique: true, name: "departments_faculty_slug_unique" });

export const announcementSourceSchema = new Schema(
  {
    scopeType: { type: String, required: true, enum: ["university", "faculty", "department"], index: true },
    scopeId: { type: String, required: true, index: true },
    sourceName: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    contentType: { type: String, required: false, enum: ["announcement", "news", "event"], default: "announcement", index: true },
    parser: { type: String, required: true, enum: ["auto", "rss", "html"], default: "auto" },
    priority: { type: Number, required: true, default: 10 },
    status: { type: String, required: true, enum: ["active", "inactive"], default: "active", index: true },
    homepageUrl: { type: String, required: false, trim: true },
    discoveryMethod: { type: String, required: false, enum: ["catalog_website", "domain_candidate", "manual"] },
    healthStatus: { type: String, required: false, enum: ["pending", "healthy", "degraded", "failed"], index: true },
    lastCheckedAt: { type: Date, required: false },
    lastSuccessAt: { type: Date, required: false },
    lastError: { type: String, required: false, trim: true },
    consecutiveFailures: { type: Number, required: false, min: 0 },
    itemCount: { type: Number, required: false, min: 0 }
  },
  { collection: "announcement_sources", timestamps: true }
);

announcementSourceSchema.index({ scopeType: 1, scopeId: 1, status: 1 }, { name: "announcement_sources_scope_status" });
announcementSourceSchema.index({ sourceUrl: 1, scopeType: 1, scopeId: 1 }, { unique: true, name: "announcement_sources_unique_scope_url" });

export const announcementItemSchema = new Schema(
  {
    sourceId: { type: String, required: true, index: true },
    sourceName: { type: String, required: true, trim: true },
    contentType: { type: String, required: false, enum: ["announcement", "news", "event"], default: "announcement", index: true },
    scopeType: { type: String, required: true, enum: ["university", "faculty", "department"], index: true },
    scopeId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    link: { type: String, required: true, trim: true },
    publishedAt: { type: String, required: false },
    summary: { type: String, required: false, trim: true },
    fetchedAt: { type: String, required: false }
  },
  { collection: "announcement_items", timestamps: true }
);

announcementItemSchema.index({ sourceId: 1, link: 1 }, { unique: true, name: "announcement_items_source_link_unique" });
announcementItemSchema.index({ scopeType: 1, scopeId: 1 }, { name: "announcement_items_scope" });

export const academicCalendarSchema = new Schema(
  {
    universityId: { type: String, required: true, index: true },
    academicYear: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ["draft", "published", "archived"], default: "draft", index: true },
    version: { type: Number, required: true, min: 1 },
    sourcePdfId: { type: String, required: false },
    sourceUrl: { type: String, required: false },
    publishedAt: { type: Date, required: false },
    createdBy: { type: String, required: false },
    approvedBy: { type: String, required: false }
  },
  { collection: "academic_calendars", timestamps: true }
);

academicCalendarSchema.index({ universityId: 1, academicYear: 1, version: -1 }, { name: "calendars_university_year_version" });
academicCalendarSchema.index({ universityId: 1, academicYear: 1, status: 1 }, { name: "calendars_published_lookup" });

export const academicEventSchema = new Schema(
  {
    calendarId: { type: String, required: true, index: true },
    universityId: { type: String, required: true, index: true },
    facultyId: { type: String, required: false, index: true },
    departmentId: { type: String, required: false, index: true },
    academicYear: { type: String, required: true, index: true },
    term: { type: String, required: true, enum: ["fall", "spring", "summer", "full_year", "unknown"] },
    category: {
      type: String,
      required: true,
      enum: [
        "academic_year_start",
        "academic_year_end",
        "fall_term_start",
        "fall_term_end",
        "spring_term_start",
        "spring_term_end",
        "course_registration",
        "course_renewal",
        "course_add_drop",
        "course_schedule",
        "midterm_exam",
        "final_exam",
        "makeup_exam",
        "single_course_exam",
        "department_exam_schedule",
        "graduation_application",
        "tuition_payment",
        "horizontal_transfer",
        "summer_school_registration",
        "summer_school_start",
        "summer_school_end",
        "holiday",
        "orientation",
        "custom_event"
      ],
      index: true
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: false },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: false },
    timezone: { type: String, required: true, default: "Europe/Istanbul" },
    originalDateText: { type: String, required: false },
    originalText: { type: String, required: false },
    sourcePdfId: { type: String, required: false },
    sourcePage: { type: Number, required: false },
    confidenceScore: { type: Number, required: false, min: 0, max: 100 },
    status: { type: String, required: true, enum: ["draft", "approved", "published", "archived"], index: true },
    notificationRules: [
      {
        offsetDays: { type: Number, required: true },
        offsetHours: { type: Number, required: false, min: 0, max: 720 },
        trigger: { type: String, required: false, enum: ["before", "at_time", "approaching"] },
        enabled: { type: Boolean, required: true, default: true }
      }
    ]
  },
  { collection: "academic_events", timestamps: true }
);

academicEventSchema.index({ universityId: 1, status: 1, startDate: 1 }, { name: "events_university_status_start" });
academicEventSchema.index({ universityId: 1, category: 1, startDate: 1 }, { name: "events_category_date" });

export const pdfSourceSchema = new Schema(
  {
    universityId: { type: String, required: true, index: true },
    url: { type: String, required: false },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileHash: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true },
    magicBytesHex: { type: String, required: true },
    pageCount: { type: Number, required: true, min: 1, max: 100 },
    academicYear: { type: String, required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, required: true, enum: ["uploaded", "duplicate", "rejected", "archived"], index: true },
    parseStatus: { type: String, required: true, enum: ["pending", "processing", "processed", "failed", "ocr_required"], index: true },
    parseError: { type: String, required: false },
    uploadedBy: { type: String, required: true, index: true },
    rawText: { type: String, required: false },
    ocrProvider: { type: String, required: false },
    ocrProcessedAt: { type: Date, required: false },
    downloadedAt: { type: Date, required: false },
    processedAt: { type: Date, required: false }
  },
  { collection: "pdf_sources", timestamps: true }
);

pdfSourceSchema.index({ universityId: 1, fileHash: 1 }, { unique: true, name: "pdf_sources_university_hash_unique" });
pdfSourceSchema.index({ url: 1, fileHash: 1 }, { name: "pdf_sources_url_hash" });

export const extractedEventSchema = new Schema(
  {
    pdfSourceId: { type: String, required: true, index: true },
    universityId: { type: String, required: true, index: true },
    academicYear: { type: String, required: true, index: true },
    rawText: { type: String, required: true },
    originalDateText: { type: String, required: true },
    normalizedTitle: { type: String, required: true },
    normalizedCategory: { type: String, required: true, index: true },
    startDate: { type: Date, required: false, index: true },
    endDate: { type: Date, required: false },
    startTime: { type: String, required: false },
    endTime: { type: String, required: false },
    hasExplicitTime: { type: Boolean, required: false },
    timezone: { type: String, required: true, default: "Europe/Istanbul" },
    datePrecision: { type: String, required: true },
    term: { type: String, required: true },
    sourcePage: { type: Number, required: true, min: 1 },
    confidenceScore: { type: Number, required: true, min: 0, max: 100, index: true },
    status: { type: String, required: true, enum: ["pending_review", "approved", "rejected"], index: true },
    adminNote: { type: String, required: false },
    reviewedBy: { type: String, required: false },
    reviewedAt: { type: Date, required: false }
  },
  { collection: "extracted_events", timestamps: true }
);

extractedEventSchema.index({ status: 1, confidenceScore: 1, createdAt: -1 }, { name: "extracted_review_queue" });

export const deviceTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    platform: { type: String, required: true, enum: ["ios", "android", "web"] },
    token: { type: String, required: true, unique: true },
    status: { type: String, required: true, enum: ["active", "disabled"], default: "active", index: true },
    lastSeenAt: { type: Date, required: true }
  },
  { collection: "device_tokens", timestamps: true }
);

deviceTokenSchema.index({ token: 1 }, { unique: true, name: "device_tokens_token_unique" });
deviceTokenSchema.index({ userId: 1, status: 1 }, { name: "device_tokens_user_status" });

export const notificationPreferenceSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, required: true, default: true },
    categories: { type: Map, of: Boolean, required: true, default: {} },
    reminderOffsets: [{ type: Number, required: true, min: 0, max: 30 }],
    reminderRules: [
      {
        trigger: { type: String, required: true, enum: ["before", "at_time", "approaching"] },
        amount: { type: Number, required: true, min: 0, max: 720 },
        unit: { type: String, required: true, enum: ["days", "hours"] },
        enabled: { type: Boolean, required: true, default: true }
      }
    ],
    quietHours: {
      enabled: { type: Boolean, required: false },
      start: { type: String, required: false },
      end: { type: String, required: false },
      timezone: { type: String, required: false, enum: ["Europe/Istanbul"] }
    }
  },
  { collection: "notification_preferences", timestamps: true }
);

notificationPreferenceSchema.index({ userId: 1 }, { unique: true, name: "notification_preferences_user_unique" });

export const notificationJobSchema = new Schema(
  {
    calendarId: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    userId: { type: String, required: false, index: true },
    alarmId: { type: String, required: false, index: true },
    eventType: { type: String, required: false, enum: ["exam", "calendar_event", "announcement", "course"] },
    universityId: { type: String, required: true, index: true },
    facultyId: { type: String, required: false, index: true },
    departmentId: { type: String, required: false, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, index: true },
    offsetDays: { type: Number, required: true, min: 0, max: 30 },
    offsetHours: { type: Number, required: false, min: 0, max: 720, default: 0 },
    trigger: { type: String, required: true, enum: ["before", "at_time", "approaching"], default: "before" },
    scheduledAt: { type: Date, required: true, index: true },
    status: { type: String, required: true, enum: ["scheduled", "sent", "failed", "cancelled"], default: "scheduled", index: true }
  },
  { collection: "notification_jobs", timestamps: true }
);

notificationJobSchema.index({ status: 1, scheduledAt: 1 }, { name: "notification_jobs_due" });
notificationJobSchema.index({ userId: 1, eventId: 1, trigger: 1, offsetDays: 1, offsetHours: 1 }, { unique: true, name: "notification_jobs_user_event_reminder_unique" });

export const studentAlarmSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    eventType: { type: String, required: true, enum: ["exam", "calendar_event", "announcement", "course"], index: true },
    targetId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    scheduledFor: { type: Date, required: true, index: true },
    trigger: { type: String, required: true, enum: ["at_time", "before"] },
    amount: { type: Number, required: true, min: 0, max: 720 },
    unit: { type: String, required: true, enum: ["days", "hours"] },
    scheduledAt: { type: Date, required: true, index: true },
    timezone: { type: String, required: true, enum: ["Europe/Istanbul"], default: "Europe/Istanbul" },
    universityId: { type: String, required: true, index: true },
    facultyId: { type: String, required: false, index: true },
    departmentId: { type: String, required: false, index: true },
    sourceUrl: { type: String, required: false },
    status: { type: String, required: true, enum: ["scheduled", "cancelled"], default: "scheduled", index: true }
  },
  { collection: "student_alarms", timestamps: true }
);

studentAlarmSchema.index({ userId: 1, scheduledAt: 1 }, { name: "student_alarms_user_due" });
studentAlarmSchema.index({ userId: 1, targetId: 1, eventType: 1, trigger: 1, amount: 1, unit: 1 }, { unique: true, name: "student_alarms_user_target_unique" });

export const notificationDeliverySchema = new Schema(
  {
    jobId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    deviceTokenId: { type: String, required: true, index: true },
    token: { type: String, required: true },
    status: { type: String, required: true, enum: ["sent", "failed", "deferred", "skipped"], index: true },
    providerMessageId: { type: String, required: false },
    failureReason: { type: String, required: false },
    deliveredAt: { type: Date, required: false }
  },
  { collection: "notification_deliveries", timestamps: true }
);

notificationDeliverySchema.index({ jobId: 1, userId: 1, deviceTokenId: 1 }, { name: "notification_deliveries_job_user_device" });
notificationDeliverySchema.index({ status: 1, createdAt: -1 }, { name: "notification_deliveries_status_time" });
