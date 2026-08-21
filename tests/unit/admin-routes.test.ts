import { describe, expect, it } from "vitest";
import {
  adminRoutePermissions,
  canAccessAdminRoute,
  canManageGlobalAdminData
} from "../../apps/admin/src/routes.js";

describe("admin route permissions", () => {
  it("keeps the rendered route inventory complete and unique", () => {
    expect(adminRoutePermissions.map((route) => route.id)).toEqual([
      "dashboard",
      "inputs",
      "catalog",
      "sources",
      "pdf",
      "calendar",
      "notifications",
      "audit",
      "users"
    ]);
    expect(new Set(adminRoutePermissions.map((route) => route.path)).size).toBe(adminRoutePermissions.length);
  });

  it.each(["content_editor", "university_admin"] as const)(
    "limits %s to scoped operational routes",
    (role) => {
      expect(adminRoutePermissions.filter((route) => canAccessAdminRoute(role, route.id)).map((route) => route.id)).toEqual([
        "dashboard",
        "inputs",
        "sources",
        "pdf"
      ]);
      expect(canManageGlobalAdminData(role)).toBe(false);
    }
  );

  it("allows super admins to use every route and global data form", () => {
    expect(adminRoutePermissions.every((route) => canAccessAdminRoute("super_admin", route.id))).toBe(true);
    expect(canManageGlobalAdminData("super_admin")).toBe(true);
  });

  it("denies unauthenticated users", () => {
    expect(adminRoutePermissions.every((route) => !canAccessAdminRoute(undefined, route.id))).toBe(true);
  });
});
