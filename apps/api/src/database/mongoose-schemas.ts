import { Schema } from "mongoose";

export const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    emailLookupHash: { type: String, required: false, select: false },
    credentialGeneration: { type: Number, required: true, default: 0, min: 0 },
    passwordRecoveryAttempt: {
      tokenHash: { type: String, required: false },
      credentialGeneration: { type: Number, required: false, min: 0 },
      expiresAt: { type: Date, required: false },
      _id: false
    },
    passwordRecoveryCompletion: {
      operationKey: { type: String, required: false },
      completedAt: { type: Date, required: false },
      credentialGeneration: { type: Number, required: false, min: 1 },
      _id: false
    },
    emailVerifiedAt: { type: Date, required: false },
    passwordHash: { type: String, required: true, select: true },
    authProvider: {
      type: String,
      required: false,
      enum: ["password", "google", "apple", "password_google", "password_apple", "google_apple", "password_google_apple"],
      default: "password"
    },
    firebaseAuthUid: { type: String, required: false },
    firebaseAuthUidLookupHash: { type: String, required: false, select: false },
    appleSubject: { type: String, required: false },
    appleSubjectLookupHash: { type: String, required: false, select: false },
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

userSchema.index({ emailLookupHash: 1 }, { unique: true, sparse: true, name: "users_email_lookup_unique" });
userSchema.index({ firebaseAuthUidLookupHash: 1 }, { unique: true, sparse: true, name: "users_firebase_auth_uid_lookup" });
userSchema.index({ appleSubjectLookupHash: 1 }, { unique: true, sparse: true, name: "users_apple_subject_lookup" });
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

export const recentAuthenticationProofSchema = new Schema(
  {
    ownerId: { type: String, required: true },
    credentialGeneration: { type: Number, required: true, min: 0 },
    purpose: {
      type: String,
      required: true,
      enum: ["delete_personal_data", "delete_account"]
    },
    jtiDigest: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, required: false }
  },
  { collection: "recent_authentication_proofs", versionKey: false }
);

recentAuthenticationProofSchema.index(
  { jtiDigest: 1 },
  { unique: true, name: "recent_authentication_proofs_jti_digest_unique" }
);
recentAuthenticationProofSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "recent_authentication_proofs_expires_ttl" }
);

export const academicUnitSuggestionSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    userEmail: { type: String, required: true, trim: true },
    userEmailLookupHash: { type: String, required: false, select: false },
    universityId: { type: String, required: true },
    facultyName: { type: String, required: true, trim: true },
    departmentName: { type: String, required: false, trim: true },
    educationLevel: {
      type: String,
      required: true,
      enum: ["associate", "bachelor", "master", "doctorate"]
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },
    reviewedAt: { type: Date, required: false }
  },
  {
    collection: "academic_unit_suggestions",
    timestamps: { createdAt: true, updatedAt: false }
  }
);

academicUnitSuggestionSchema.index(
  { status: 1, createdAt: -1 },
  { name: "academic_unit_suggestions_status_created" }
);
academicUnitSuggestionSchema.index(
  { userId: 1 },
  { name: "academic_unit_suggestions_user" }
);

export const followedAcademicScopeSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    universityId: { type: String, required: true },
    facultyId: { type: String, required: false },
    departmentId: { type: String, required: false },
    normalizedScopeKey: { type: String, required: true, select: false }
  },
  {
    collection: "followed_academic_scopes",
    timestamps: { createdAt: true, updatedAt: false }
  }
);

followedAcademicScopeSchema.index(
  { userId: 1, normalizedScopeKey: 1 },
  { unique: true, name: "followed_academic_scopes_user_scope_unique" }
);
followedAcademicScopeSchema.index(
  { userId: 1, createdAt: 1 },
  { name: "followed_academic_scopes_user_created" }
);

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
    canonicalUrl: { type: String, required: false, trim: true },
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
    itemCount: { type: Number, required: false, min: 0 },
    etag: { type: String, required: false, maxlength: 512 },
    lastModified: { type: String, required: false, maxlength: 128 },
    contentHash: { type: String, required: false, match: /^[a-f\d]{64}$/u },
    lastContentChangedAt: { type: Date, required: false },
    activeSnapshotId: { type: String, required: false },
    sourceDefinitionVersion: { type: String, required: false, maxlength: 64 },
    notificationProducerVersion: { type: String, required: false, maxlength: 64 },
    processingVersion: { type: String, required: false, maxlength: 96 },
    fetchIntervalMinutes: { type: Number, required: false, min: 5, max: 10080, default: 180 },
    discoveredAt: { type: Date, required: false },
    trustStatus: { type: String, required: false, enum: ["trusted", "rejected", "quarantined"], default: "quarantined", index: true },
    trustReasonCodes: [{ type: String, required: false }],
    duplicateOfId: { type: String, required: false }
  },
  { collection: "announcement_sources", timestamps: true }
);

announcementSourceSchema.index({ scopeType: 1, scopeId: 1, status: 1 }, { name: "announcement_sources_scope_status" });
announcementSourceSchema.index({ sourceUrl: 1, scopeType: 1, scopeId: 1 }, { unique: true, name: "announcement_sources_unique_scope_url" });
announcementSourceSchema.index({ canonicalUrl: 1, scopeType: 1, scopeId: 1 }, { name: "announcement_sources_canonical_scope" });
announcementSourceSchema.index({ status: 1, lastCheckedAt: 1 }, { name: "announcement_sources_due_checks" });

function studentRelevanceSchemaFields() {
  const supportedAudiences = [
    "all_students", "prospective_students", "associate_students", "bachelor_students",
    "master_students", "doctoral_students", "graduates"
  ];
  return {
    studentRelevance: { type: String, required: false, enum: ["relevant", "not_relevant", "uncertain"] },
    topic: {
      type: String,
      required: false,
      enum: [
        "academic_calendar", "admission", "course_registration", "course_schedule", "double_major_minor",
        "education_opportunity", "exam", "horizontal_transfer", "scholarship", "internship", "exchange",
        "graduation", "tuition", "housing", "competition", "student_achievement", "student_event",
        "personnel_recruitment", "procurement", "internal_operations", "unknown"
      ]
    },
    audience: {
      type: Schema.Types.Mixed,
      required: false,
      validate: {
        validator: (value: unknown) => value === "unknown" || (
          Array.isArray(value)
          && value.every((entry) => supportedAudiences.includes(entry as string))
        ),
        message: "audience must be unknown or a supported student audience list"
      }
    },
    actionType: { type: String, required: false, enum: ["apply", "attend", "pay", "register", "review", "submit", "unknown"] },
    deadline: { type: String, required: false, match: /^(?:unknown|\d{4}-\d{2}-\d{2})$/u },
    urgency: { type: String, required: false, enum: ["critical", "high", "normal", "low", "unknown"] },
    evidenceSpans: {
      type: [{
        _id: false,
        targetField: { type: String, required: true, enum: ["studentRelevance", "topic", "audience", "actionType", "deadline", "urgency"] },
        sourceField: { type: String, required: true, maxlength: 64 },
        start: { type: Number, required: true, min: 0 },
        end: { type: Number, required: true, min: 1 },
        text: { type: String, required: true, maxlength: 240 },
        ruleId: { type: String, required: true, maxlength: 96 }
      }],
      required: false,
      default: undefined
    },
    classificationVersion: { type: String, required: false, enum: ["student-relevance-rules-v2"] }
  };
}

export const announcementItemSchema = new Schema(
  {
    sourceId: { type: String, required: true, index: true },
    sourceName: { type: String, required: true, trim: true },
    contentType: { type: String, required: false, enum: ["announcement", "news", "event"], default: "announcement", index: true },
    scopeType: { type: String, required: true, enum: ["university", "faculty", "department"], index: true },
    scopeId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    rawTitle: { type: String, required: false },
    link: { type: String, required: true, trim: true },
    canonicalUrl: { type: String, required: false, trim: true },
    canonicalUrlAliases: [{ type: String, required: false, trim: true }],
    officialSourceUrl: { type: String, required: false, trim: true },
    contentFingerprint: { type: String, required: false, trim: true, index: true },
    notificationEligibleFingerprint: { type: String, required: false, trim: true },
    notificationProducedFingerprint: { type: String, required: false, trim: true },
    publicationKind: { type: String, required: false, enum: ["date", "timestamp"] },
    publishedDate: { type: String, required: false },
    publishedAt: { type: String, required: false },
    publicationTimeSource: { type: String, required: false, enum: ["source"] },
    sourceUpdatedAt: { type: String, required: false },
    sourceUpdateTimeSource: { type: String, required: false, enum: ["source"] },
    discoveredAt: { type: String, required: false },
    summary: { type: String, required: false, trim: true },
    body: [{
      _id: false,
      type: { type: String, required: true, enum: ["heading", "paragraph", "bullet"] },
      text: { type: String, required: true, trim: true, maxlength: 800 }
    }],
    keyDates: [{
      _id: false,
      label: { type: String, required: true, trim: true, maxlength: 160 },
      startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/u },
      endDate: { type: String, required: false, match: /^\d{4}-\d{2}-\d{2}$/u }
    }],
    fetchedAt: { type: String, required: false },
    freshness: { type: String, required: false, enum: ["fresh", "stale"], default: "fresh" },
    ...studentRelevanceSchemaFields(),
    trustStatus: { type: String, required: false, enum: ["trusted", "rejected", "quarantined"], default: "quarantined", index: true },
    trustReasonCodes: [{ type: String, required: false }],
    dedupeKey: { type: String, required: false, trim: true, index: true },
    duplicateOfId: { type: String, required: false }
  },
  { collection: "announcement_items", timestamps: true }
);

announcementItemSchema.index({ sourceId: 1, link: 1 }, { unique: true, name: "announcement_items_source_link_unique" });
announcementItemSchema.index({ sourceId: 1, canonicalUrl: 1 }, { name: "announcement_items_source_canonical" });
announcementItemSchema.index({ trustStatus: 1, dedupeKey: 1 }, { name: "announcement_items_trust_dedupe" });
announcementItemSchema.index({ scopeType: 1, scopeId: 1 }, { name: "announcement_items_scope" });
announcementItemSchema.index({ scopeType: 1, scopeId: 1, contentFingerprint: 1 }, { name: "announcement_items_scope_fingerprint" });

export const announcementSnapshotSchema = new Schema(
  {
    sourceId: { type: String, required: true },
    items: { type: [Schema.Types.Mixed], required: true, default: undefined },
    snapshotHash: { type: String, required: true, match: /^[a-f\d]{64}$/u }
  },
  { collection: "announcement_snapshots", timestamps: true }
);

export const savedAnnouncementSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    announcementId: { type: String, required: true, trim: true, index: true },
    savedAt: { type: Date, required: true, default: Date.now }
  },
  { collection: "saved_announcements", timestamps: true }
);

savedAnnouncementSchema.index(
  { userId: 1, announcementId: 1 },
  { unique: true, name: "saved_announcements_user_announcement_unique" }
);

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
    courseName: { type: String, required: false, trim: true, maxlength: 240 },
    description: { type: String, required: false },
    location: { type: String, required: false, trim: true, maxlength: 240 },
    scheduleSeriesId: { type: String, required: false, index: true },
    temporalKind: { type: String, required: false, enum: ["date", "timestamp"], index: true },
    endTemporalKind: { type: String, required: false, enum: ["date", "timestamp"] },
    dateOnlyStart: { type: String, required: false, match: /^\d{4}-\d{2}-\d{2}$/u, index: true },
    dateOnlyEnd: { type: String, required: false, match: /^\d{4}-\d{2}-\d{2}$/u },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: false },
    timezone: { type: String, required: true, default: "Europe/Istanbul" },
    originalDateText: { type: String, required: false },
    originalText: { type: String, required: false },
    sourcePdfId: { type: String, required: false },
    sourcePage: { type: Number, required: false },
    confidenceScore: { type: Number, required: false, min: 0, max: 100 },
    ...studentRelevanceSchemaFields(),
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
academicEventSchema.index({ scheduleSeriesId: 1, status: 1 }, { name: "events_schedule_series_status" });

export const pdfSourceSchema = new Schema(
  {
    universityId: { type: String, required: true, index: true },
    url: { type: String, required: false },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileHash: { type: String, required: true },
    binarySha256: { type: String, required: false, match: /^[a-f\d]{64}$/u },
    binaryIdentityVerified: { type: Boolean, required: false, default: false },
    activeExtractedEventIds: { type: [{ type: String }], required: false, default: undefined },
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
    temporalKind: { type: String, required: false, enum: ["date", "timestamp"] },
    endTemporalKind: { type: String, required: false, enum: ["date", "timestamp"] },
    dateOnlyStart: { type: String, required: false, match: /^\d{4}-\d{2}-\d{2}$/u, index: true },
    dateOnlyEnd: { type: String, required: false, match: /^\d{4}-\d{2}-\d{2}$/u },
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
    semanticKey: { type: String, required: false, maxlength: 128 },
    sourceEventKey: { type: String, required: false, maxlength: 128 },
    extractionFingerprint: { type: String, required: false, match: /^[a-f\d]{64}$/u },
    observedPdfSourceIds: { type: [{ type: String }], required: false, default: undefined },
    ...studentRelevanceSchemaFields(),
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
    token: { type: String, required: true },
    tokenLookupHash: { type: String, required: false, select: false },
    installationHash: { type: String, required: false },
    status: { type: String, required: true, enum: ["active", "disabled"], default: "active", index: true },
    lastSeenAt: { type: Date, required: true }
  },
  { collection: "device_tokens", timestamps: true }
);

deviceTokenSchema.index({ tokenLookupHash: 1 }, { unique: true, sparse: true, name: "device_tokens_token_lookup_unique" });
deviceTokenSchema.index({ installationHash: 1 }, { unique: true, sparse: true, name: "device_tokens_installation_unique" });
deviceTokenSchema.index({ userId: 1, status: 1 }, { name: "device_tokens_user_status" });

export const notificationPreferenceSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, required: true, default: false },
    deliveryConsentVersion: { type: String, required: false, enum: ["phase3-v1"] },
    categories: { type: Map, of: Boolean, required: true, default: {} },
    reminderOffsets: [{ type: Number, required: true, min: 0, max: 30 }],
    reminderRules: [
      {
        _id: false,
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
    destinationType: { type: String, required: false, enum: ["calendar_event", "announcement"] },
    destinationId: { type: String, required: false, index: true },
    destinationScopeType: { type: String, required: false, enum: ["global", "university", "faculty", "department"], index: true },
    destinationScopeId: { type: String, required: false, index: true },
    destinationFingerprint: { type: String, required: false, trim: true, index: true },
    producerKey: { type: String, required: false, trim: true, index: true },
    producerKeys: [{ type: String, required: false, trim: true }],
    producerDestinations: [{
      _id: false,
      producerKey: { type: String, required: true, trim: true },
      calendarId: { type: String, required: true },
      eventId: { type: String, required: true },
      destinationId: { type: String, required: true },
      title: { type: String, required: true, trim: true }
    }],
    producerRelationRevision: { type: Number, required: true, min: 0, default: 0 },
    producerGroupKey: { type: String, required: false, trim: true, index: true },
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
    status: { type: String, required: true, enum: ["scheduled", "processing", "sent", "failed", "dead", "cancelled"], default: "scheduled", index: true },
    revision: { type: Number, required: true, min: 1, default: 1 },
    deliveryAttemptEpoch: { type: Number, required: true, min: 0, default: 0 },
    attemptCount: { type: Number, required: true, min: 0, default: 0 },
    maxAttempts: { type: Number, required: true, min: 1, max: 20, default: 5 },
    lastAttemptAt: { type: Date, required: false },
    lastFailureReason: {
      type: String,
      required: false,
      enum: ["provider_unavailable", "provider_rejected", "destination_unavailable", "destination_changed", "worker_interrupted"]
    },
    exhaustedAt: { type: Date, required: false },
    processingClaimId: { type: String, required: false },
    processingLeaseUntil: { type: Date, required: false }
  },
  { collection: "notification_jobs", timestamps: true }
);

notificationJobSchema.index({ status: 1, scheduledAt: 1 }, { name: "notification_jobs_due" });
notificationJobSchema.index({ status: 1, processingLeaseUntil: 1, scheduledAt: 1 }, { name: "notification_jobs_claim_recovery" });
notificationJobSchema.index({ userId: 1, eventId: 1, trigger: 1, offsetDays: 1, offsetHours: 1 }, { unique: true, name: "notification_jobs_user_event_reminder_unique" });
notificationJobSchema.index({ producerKey: 1, status: 1 }, { name: "notification_jobs_producer_status" });
notificationJobSchema.index({ producerKeys: 1, status: 1 }, { name: "notification_jobs_producer_relationships" });
notificationJobSchema.index({ producerGroupKey: 1, producerKey: 1, status: 1 }, { name: "notification_jobs_producer_group" });
notificationJobSchema.index(
  { destinationType: 1, destinationScopeType: 1, destinationScopeId: 1, destinationFingerprint: 1 },
  { name: "notification_jobs_trusted_destination" }
);

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
    jobRevision: { type: Number, required: false, min: 1, default: 1, index: true },
    attemptIdentity: { type: String, required: false, trim: true },
    attemptVersion: { type: String, required: false, trim: true },
    deviceInstallationHash: { type: String, required: false, trim: true },
    userId: { type: String, required: true, index: true },
    deviceTokenId: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ["sending", "sent", "failed", "invalid_device", "ambiguous", "deferred", "skipped"], index: true },
    sendingClaimId: { type: String, required: false },
    sendingStartedAt: { type: Date, required: false },
    sendingLeaseUntil: { type: Date, required: false },
    providerMessageId: { type: String, required: false, maxlength: 512 },
    failureReason: {
      type: String,
      required: false,
      enum: ["invalid_token", "provider_unavailable", "provider_rejected", "scope_mismatch", "preference_disabled", "quiet_hours", "destination_unavailable", "device_registration_stale", "provider_outcome_unknown"]
    },
    deliveredAt: { type: Date, required: false },
    finalizedAt: { type: Date, required: false }
  },
  { collection: "notification_deliveries", timestamps: true }
);

notificationDeliverySchema.index({ attemptIdentity: 1 }, { unique: true, sparse: true, name: "notification_deliveries_attempt_identity_unique" });
notificationDeliverySchema.index({ status: 1, sendingLeaseUntil: 1 }, { name: "notification_deliveries_attempt_recovery" });
notificationDeliverySchema.index({ jobId: 1, userId: 1, deviceTokenId: 1 }, { name: "notification_deliveries_job_user_device" });
notificationDeliverySchema.index({ jobId: 1, status: 1, deviceTokenId: 1 }, { name: "notification_deliveries_job_status_device" });
notificationDeliverySchema.index({ status: 1, createdAt: -1 }, { name: "notification_deliveries_status_time" });
