export interface CacheKeyPolicy {
  pattern: string;
  ttlSeconds: number;
  invalidatedBy: string[];
  usedBy: string[];
  staleRisk: "low" | "medium" | "high";
}

export const cacheKeyPolicies: CacheKeyPolicy[] = [
  { pattern: "universities:all", ttlSeconds: 3600, invalidatedBy: ["university.updated", "university.created"], usedBy: ["GET /universities"], staleRisk: "medium" },
  { pattern: "university:{id}", ttlSeconds: 3600, invalidatedBy: ["university.updated"], usedBy: ["GET /universities/:id"], staleRisk: "medium" },
  { pattern: "university:{id}:faculties", ttlSeconds: 3600, invalidatedBy: ["faculty.created", "faculty.updated"], usedBy: ["GET /universities/:id/faculties"], staleRisk: "medium" },
  { pattern: "faculty:{id}:departments", ttlSeconds: 3600, invalidatedBy: ["department.created", "department.updated"], usedBy: ["GET /faculties/:id/departments"], staleRisk: "medium" },
  { pattern: "calendar:university:{universityId}:year:{academicYear}", ttlSeconds: 900, invalidatedBy: ["calendar.published", "calendar.rollback"], usedBy: ["GET /calendar/university/:universityId"], staleRisk: "high" },
  { pattern: "calendar:user:{userId}", ttlSeconds: 600, invalidatedBy: ["user.university_changed", "calendar.published"], usedBy: ["GET /calendar/my"], staleRisk: "high" },
  { pattern: "events:upcoming:university:{universityId}", ttlSeconds: 600, invalidatedBy: ["calendar.published", "event.updated"], usedBy: ["GET /calendar/upcoming"], staleRisk: "high" },
  { pattern: "preferences:user:{userId}", ttlSeconds: 1800, invalidatedBy: ["preferences.updated"], usedBy: ["notification_schedule_job"], staleRisk: "medium" },
  { pattern: "device_tokens:user:{userId}", ttlSeconds: 900, invalidatedBy: ["device.registered", "device.deleted", "device.invalidated"], usedBy: ["notification_send_job"], staleRisk: "medium" }
];
