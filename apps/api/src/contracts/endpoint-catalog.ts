import type { UserRole } from "../../../../packages/shared/src/contracts.js";

export interface EndpointContract {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  authRequired: boolean;
  roles: UserRole[] | "public";
  rateLimit: "none" | "standard" | "strict" | "upload";
}

const allAuthenticatedRoles: UserRole[] = ["student", "content_editor", "university_admin", "super_admin"];
const studentRoles: UserRole[] = ["student"];
const contentAdminRoles: UserRole[] = ["content_editor", "university_admin", "super_admin"];
const superAdminRoles: UserRole[] = ["super_admin"];

export const endpointCatalog: EndpointContract[] = [
  { method: "GET", path: "/health/live", authRequired: false, roles: "public", rateLimit: "none" },
  { method: "GET", path: "/health/ready", authRequired: false, roles: "public", rateLimit: "none" },

  { method: "GET", path: "/account-deletion", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "POST", path: "/account-deletion/request-code", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/account-deletion/confirm", authRequired: false, roles: "public", rateLimit: "strict" },

  { method: "POST", path: "/auth/register", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/verify-email", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "GET", path: "/auth/verify-email", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/resend-verification-code", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/password-recovery/request", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/password-recovery/confirm", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/login", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/google", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/apple", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/refresh-token", authRequired: false, roles: "public", rateLimit: "strict" },
  { method: "POST", path: "/auth/recent-authentication", authRequired: true, roles: allAuthenticatedRoles, rateLimit: "strict" },
  { method: "POST", path: "/auth/logout", authRequired: true, roles: allAuthenticatedRoles, rateLimit: "standard" },

  { method: "GET", path: "/me", authRequired: true, roles: allAuthenticatedRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/me", authRequired: true, roles: allAuthenticatedRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/me", authRequired: true, roles: allAuthenticatedRoles, rateLimit: "strict" },
  { method: "DELETE", path: "/me/data", authRequired: true, roles: allAuthenticatedRoles, rateLimit: "strict" },
  { method: "PATCH", path: "/me/university", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/me/affiliation-options", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "POST", path: "/me/academic-suggestions", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/me/follows", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "POST", path: "/me/follows", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/me/follows/:id", authRequired: true, roles: studentRoles, rateLimit: "standard" },

  { method: "GET", path: "/admin/users", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/users/unassociated-email-domains", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/users/academic-unit-suggestions", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/users/academic-unit-suggestions/:id/approve", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/users/academic-unit-suggestions/:id/reject", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/users/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/admin/users/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },

  { method: "GET", path: "/announcements/my", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/announcements/my/trusted", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/announcements/my/trusted/:announcementId", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/announcements/my/saved/:announcementId", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "PUT", path: "/announcements/my/saved/:announcementId", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/announcements/my/saved/:announcementId", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/announcements/yok", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/announcements/yok/trusted", authRequired: false, roles: "public", rateLimit: "standard" },

  { method: "GET", path: "/admin/announcements/sources", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/announcements/source-profiles", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "PUT", path: "/admin/announcements/source-profiles/:universityId/:contentType", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/announcements/source-profiles/:universityId/:contentType/preview", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "GET", path: "/admin/source-coverage", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/announcements/sources", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/announcements/sources/provision-registry", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/announcements/discover", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/announcements/ingest", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/announcements/sources/:id/ingest", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/announcements/sources/:id/preview", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/announcements/sources/:id/approve", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/announcements/sources/:id/reject", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "PUT", path: "/admin/announcements/sources/:id", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/admin/announcements/sources/:id", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/announcements/review-items", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/announcements/review-items/:id", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/announcements/review-items/:id/llm-review", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/announcements/review-items/llm-review", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "GET", path: "/admin/announcements/llm-settings", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "PUT", path: "/admin/announcements/llm-settings", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/admin/announcements/llm-settings/key", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/announcements/llm-settings/test", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },

  { method: "GET", path: "/universities", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/universities/:id/faculties", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/universities/:id", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/faculties/:id/departments", authRequired: false, roles: "public", rateLimit: "standard" },

  { method: "POST", path: "/admin/universities", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/catalog/sync-verified-sources", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/universities/:id/email-domains", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/universities/:id/faculties", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/universities/:universityId/faculties/:facultyId/departments", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/universities/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/admin/universities/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/faculties/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/departments/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },

  { method: "GET", path: "/calendar/my", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/my/course-schedules", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/my/exam-schedules", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/my/trusted/:eventId", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/summer-school/my", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/integrations", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/integrations/feed/:token.ics", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/calendar/upcoming", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/calendar/events", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/calendar/events/:eventId", authRequired: false, roles: "public", rateLimit: "standard" },
  { method: "GET", path: "/calendar/university/:universityId", authRequired: false, roles: "public", rateLimit: "standard" },

  { method: "POST", path: "/admin/calendars", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/manual", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/ingest", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/calendars/schedule-sources/provision-registry", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "GET", path: "/admin/calendars/schedule-sources", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/schedule-sources/:id/ingest", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "PATCH", path: "/admin/calendars/schedule-sources/:id/candidates/:rowNumber", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/schedule-sources/:id/review", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/calendars/schedule-sources/:id/reopen-review", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "POST", path: "/admin/calendars/schedule-sources/:id/publish", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "GET", path: "/admin/calendars/course-schedules", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/course-schedules", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/admin/calendars/course-schedules/:seriesId", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/calendars/:id", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/:id/publish", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/calendars/:id/rollback", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },

  { method: "POST", path: "/admin/pdf-sources", authRequired: true, roles: contentAdminRoles, rateLimit: "upload" },
  { method: "POST", path: "/admin/pdf-sources/:id/process", authRequired: true, roles: contentAdminRoles, rateLimit: "strict" },
  { method: "GET", path: "/admin/pdf-sources/:id", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/pdf-sources/:id/extracted-events", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/extracted-events", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/extracted-events/:id", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/admin/extracted-events/:id", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/extracted-events/:id/approve", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/extracted-events/:id/reject", authRequired: true, roles: contentAdminRoles, rateLimit: "standard" },

  { method: "POST", path: "/devices/register", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/devices/current", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/notification-preferences", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "PATCH", path: "/notification-preferences", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "GET", path: "/notification-alarms", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "POST", path: "/notification-alarms", authRequired: true, roles: studentRoles, rateLimit: "standard" },
  { method: "DELETE", path: "/notification-alarms/:id", authRequired: true, roles: studentRoles, rateLimit: "standard" },

  { method: "GET", path: "/admin/notification-jobs/health", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/notification-jobs/process-due", authRequired: true, roles: superAdminRoles, rateLimit: "strict" },
  { method: "GET", path: "/admin/notification-jobs/failed", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/notification-jobs/deliveries", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "POST", path: "/admin/notification-jobs/retry", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },

  { method: "GET", path: "/admin/audit-logs", authRequired: true, roles: superAdminRoles, rateLimit: "standard" },
  { method: "GET", path: "/admin/audit-logs/export", authRequired: true, roles: superAdminRoles, rateLimit: "standard" }
];
