export const adminRoutes = [
  { path: "/dashboard", label: "Dashboard", requiredRoles: ["content_editor", "university_admin", "super_admin"] },
  { path: "/universities", label: "Universities", requiredRoles: ["super_admin"] },
  { path: "/pdf-sources", label: "PDF Sources", requiredRoles: ["content_editor", "university_admin", "super_admin"] },
  { path: "/extracted-events", label: "Review Queue", requiredRoles: ["content_editor", "university_admin", "super_admin"] },
  { path: "/calendars", label: "Calendars", requiredRoles: ["super_admin"] },
  { path: "/audit-logs", label: "Audit Logs", requiredRoles: ["super_admin"] },
  { path: "/notification-jobs", label: "Notification Jobs", requiredRoles: ["super_admin"] }
] as const;
