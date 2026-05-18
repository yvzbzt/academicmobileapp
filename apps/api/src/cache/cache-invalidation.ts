export type CacheInvalidationEvent =
  | { type: "university.created" }
  | { type: "university.updated"; universityId: string }
  | { type: "faculty.created"; universityId: string }
  | { type: "faculty.updated"; universityId: string; facultyId: string }
  | { type: "department.created"; facultyId: string }
  | { type: "department.updated"; facultyId: string; departmentId: string }
  | { type: "user.university_changed"; userId: string }
  | { type: "calendar.published"; universityId: string; academicYear: string };

export function planCacheInvalidation(event: CacheInvalidationEvent): string[] {
  switch (event.type) {
    case "university.created":
      return ["universities:all"];
    case "university.updated":
      return ["universities:all", `university:${event.universityId}`];
    case "faculty.created":
      return [`university:${event.universityId}:faculties`];
    case "faculty.updated":
      return [`university:${event.universityId}:faculties`, `faculty:${event.facultyId}`];
    case "department.created":
      return [`faculty:${event.facultyId}:departments`];
    case "department.updated":
      return [`faculty:${event.facultyId}:departments`, `department:${event.departmentId}`];
    case "user.university_changed":
      return [`calendar:user:${event.userId}`];
    case "calendar.published":
      return [
        `calendar:university:${event.universityId}:year:${event.academicYear}`,
        `events:upcoming:university:${event.universityId}`
      ];
  }
}
