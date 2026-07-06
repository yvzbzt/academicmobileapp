export const adminRoutes = [
  { path: "/dashboard", label: "Panel", requiredRoles: ["content_editor", "university_admin", "super_admin"] },
  { path: "/universities", label: "Üniversiteler", requiredRoles: ["super_admin"] },
  { path: "/users", label: "Kullanıcılar", requiredRoles: ["super_admin"] },
  { path: "/pdf-sources", label: "PDF Kaynakları", requiredRoles: ["content_editor", "university_admin", "super_admin"] },
  { path: "/extracted-events", label: "İnceleme Kuyruğu", requiredRoles: ["content_editor", "university_admin", "super_admin"] },
  { path: "/calendars", label: "Takvimler", requiredRoles: ["super_admin"] },
  { path: "/audit-logs", label: "Denetim Kayıtları", requiredRoles: ["super_admin"] },
  { path: "/notification-jobs", label: "Bildirim İşleri", requiredRoles: ["super_admin"] }
] as const;
