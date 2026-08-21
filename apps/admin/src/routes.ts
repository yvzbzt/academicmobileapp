export const adminRoles = ["content_editor", "university_admin", "super_admin"] as const;

export type AdminRole = (typeof adminRoles)[number];

export const adminRoutePermissions = [
  { id: "dashboard", path: "/dashboard", requiredRoles: adminRoles },
  { id: "inputs", path: "/inputs", requiredRoles: adminRoles },
  { id: "catalog", path: "/catalog", requiredRoles: ["super_admin"] },
  { id: "sources", path: "/sources", requiredRoles: adminRoles },
  { id: "pdf", path: "/pdf", requiredRoles: adminRoles },
  { id: "calendar", path: "/calendar", requiredRoles: ["super_admin"] },
  { id: "notifications", path: "/notifications", requiredRoles: ["super_admin"] },
  { id: "audit", path: "/audit", requiredRoles: ["super_admin"] },
  { id: "users", path: "/users", requiredRoles: ["super_admin"] }
] as const satisfies ReadonlyArray<{
  id: string;
  path: string;
  requiredRoles: readonly AdminRole[];
}>;

export type AdminRoute = (typeof adminRoutePermissions)[number]["id"];

export function canAccessAdminRoute(role: AdminRole | undefined, route: AdminRoute): boolean {
  if (!role) return false;
  const permission = adminRoutePermissions.find((item) => item.id === route);
  return Boolean(permission?.requiredRoles.some((requiredRole) => requiredRole === role));
}

export function canManageGlobalAdminData(role: AdminRole | undefined): boolean {
  return role === "super_admin";
}
