import { type AppVisibleRoute } from "../navigation/AppNavigator";
import { type ProtectedAppRoute, type AppRoute } from "../navigation";
import { type AuthStage, type AuthMode, type TabId } from "./app-types";

export const AUTH_ROUTE_NAMES = new Set<AppVisibleRoute>([
  "Login",
  "Register",
  "Verification",
  "PasswordRecoveryRequest",
  "PasswordRecoveryCode",
  "PasswordRecoveryConfirm"
]);

export const AUTHENTICATED_ROUTE_NAMES = new Set<AppVisibleRoute>([
  "Home",
  "Announcements",
  "SummerSchool",
  "YokAnnouncements",
  "AnnouncementDetail",
  "Calendar",
  "CalendarEventDetail",
  "Profile",
  "AcademicProfileSettings",
  "FollowedUniversitiesSettings",
  "NotificationSettings",
  "AppleCalendarSettings",
  "GoogleCalendarSettings",
  "AccountDataSettings",
  "UnknownRoute"
]);

export function routeForAuthState(authStage: AuthStage, authMode: AuthMode): AppVisibleRoute {
  switch (authStage) {
    case "verify": return "Verification";
    case "academic_onboarding": return "AcademicOnboarding";
    case "password_recovery_request": return "PasswordRecoveryRequest";
    case "password_recovery_code": return "PasswordRecoveryCode";
    case "password_recovery_confirm": return "PasswordRecoveryConfirm";
    case "auth": return authMode === "register" ? "Register" : "Login";
  }
}

export function routeForLegacyTab(tab: TabId): AppVisibleRoute {
  switch (tab) {
    case "home": return "Home";
    case "announcements": return "Announcements";
    case "summer": return "SummerSchool";
    case "yok": return "YokAnnouncements";
    case "calendar": return "Calendar";
    case "profile": return "Profile";
  }
}

export function routeBelongsToLegacyTab(route: AppVisibleRoute, tab: TabId): boolean {
  switch (tab) {
    case "home": return route === "Home";
    case "announcements":
      return route === "Announcements"
        || route === "SummerSchool"
        || route === "YokAnnouncements"
        || route === "AnnouncementDetail";
    case "summer": return route === "SummerSchool";
    case "yok": return route === "YokAnnouncements";
    case "calendar": return route === "Calendar" || route === "CalendarEventDetail";
    case "profile":
      return route === "Profile"
        || route === "AcademicProfileSettings"
        || route === "FollowedUniversitiesSettings"
        || route === "NotificationSettings"
        || route === "AppleCalendarSettings"
        || route === "GoogleCalendarSettings"
        || route === "AccountDataSettings";
  }
}

export function navigationTargetForProtectedRoute(route: ProtectedAppRoute): {
  route: AppVisibleRoute;
  legacyTab: TabId;
  params?: Readonly<Record<string, string>>;
} {
  switch (route.name) {
    case "Home":
      return { route: "Home", legacyTab: "home" };
    case "Announcements":
      return { route: "Announcements", legacyTab: "announcements" };
    case "SummerSchool":
      return { route: "SummerSchool", legacyTab: "summer" };
    case "YokAnnouncements":
      return { route: "YokAnnouncements", legacyTab: "yok" };
    case "AnnouncementDetail":
      return {
        route: "AnnouncementDetail",
        legacyTab: "announcements",
        params: { announcementId: route.params.announcementId }
      };
    case "Calendar":
      return { route: "Calendar", legacyTab: "calendar" };
    case "CalendarEventDetail":
      return {
        route: "CalendarEventDetail",
        legacyTab: "calendar",
        params: { eventId: route.params.eventId }
      };
    case "Profile":
    case "AcademicProfileSettings":
    case "FollowedUniversitiesSettings":
    case "NotificationSettings":
    case "AppleCalendarSettings":
    case "GoogleCalendarSettings":
    case "AccountDataSettings":
      return { route: route.name, legacyTab: "profile" };
  }
}

export function visibleRouteForResolvedRoot(route: AppRoute): AppVisibleRoute {
  if (route.name === "Hydration") {
    return route.params.status === "loading" ? "BootstrapLoading" : "BootstrapError";
  }
  if (route.name === "Unknown") return "UnknownRoute";
  return route.name;
}
