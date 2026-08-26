import {
  SETTINGS_ROUTE_NAMES,
  appRoutes,
  cloneAppRoute,
  isAppRoute,
  isProtectedRoute,
  parentRouteFor,
  routeKey,
  tabForRoute,
} from "../../src/navigation/routes";

describe("Apple Calendar route contract", () => {
  it("is a parameterless protected settings route owned by Profile", () => {
    const route = appRoutes.appleCalendarSettings();

    expect(SETTINGS_ROUTE_NAMES).toContain("AppleCalendarSettings");
    expect(route).toEqual({ name: "AppleCalendarSettings" });
    expect(isAppRoute(route)).toBe(true);
    expect(isProtectedRoute(route)).toBe(true);
    expect(tabForRoute(route)).toBe("ProfileTab");
    expect(parentRouteFor(route)).toEqual(appRoutes.profile());
    expect(routeKey(route)).toBe("AppleCalendarSettings");
    expect(cloneAppRoute(route)).toEqual(route);
    expect(cloneAppRoute(route)).not.toBe(route);
  });

  it("rejects parameters and unrelated object keys", () => {
    expect(isAppRoute({ name: "AppleCalendarSettings", params: {} })).toBe(false);
    expect(isAppRoute({ name: "AppleCalendarSettings", source: "settings" })).toBe(false);
  });
});
