export const AUTH_ROUTE_NAMES = [
  "Login",
  "Register",
  "Verification",
  "PasswordRecoveryRequest",
  "PasswordRecoveryCode",
  "PasswordRecoveryConfirm"
] as const;

export const MAIN_TAB_ROUTE_NAMES = [
  "HomeTab",
  "AnnouncementsTab",
  "CalendarTab",
  "ProfileTab"
] as const;

export const ANNOUNCEMENT_ROUTE_NAMES = [
  "Announcements",
  "SummerSchool",
  "YokAnnouncements",
  "AnnouncementDetail"
] as const;

export const CALENDAR_ROUTE_NAMES = ["Calendar", "CalendarEventDetail"] as const;

export const SETTINGS_ROUTE_NAMES = [
  "AcademicProfileSettings",
  "FollowedUniversitiesSettings",
  "NotificationSettings",
  "GoogleCalendarSettings",
  "AccountDataSettings"
] as const;

export type AuthRouteName = (typeof AUTH_ROUTE_NAMES)[number];
export type MainTabRouteName = (typeof MAIN_TAB_ROUTE_NAMES)[number];
export type AnnouncementRouteName = (typeof ANNOUNCEMENT_ROUTE_NAMES)[number];
export type CalendarRouteName = (typeof CALENDAR_ROUTE_NAMES)[number];
export type SettingsRouteName = (typeof SETTINGS_ROUTE_NAMES)[number];
export type ProfileRouteName = "Profile" | SettingsRouteName;
export type HydrationRouteStatus = "loading" | "error";

/**
 * These param-list types intentionally have no React Navigation dependency.
 * A native adapter can use them directly when it creates its navigators.
 */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Verification: undefined;
  PasswordRecoveryRequest: undefined;
  PasswordRecoveryCode: undefined;
  PasswordRecoveryConfirm: undefined;
};

export type OnboardingStackParamList = {
  AcademicOnboarding: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
};

export type AnnouncementStackParamList = {
  Announcements: undefined;
  SummerSchool: undefined;
  YokAnnouncements: undefined;
  AnnouncementDetail: { announcementId: string };
};

export type CalendarStackParamList = {
  Calendar: undefined;
  CalendarEventDetail: { eventId: string };
};

export type ProfileStackParamList = {
  Profile: undefined;
  AcademicProfileSettings: undefined;
  FollowedUniversitiesSettings: undefined;
  NotificationSettings: undefined;
  GoogleCalendarSettings: undefined;
  AccountDataSettings: undefined;
};

export type SettingsStackParamList = ProfileStackParamList;

export type MainTabParamList = {
  HomeTab: undefined;
  AnnouncementsTab: undefined;
  CalendarTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Hydration: { status: HydrationRouteStatus };
  Auth: { screen: AuthRouteName };
  Onboarding: { screen: "AcademicOnboarding" };
  MainTabs: { screen: MainTabRouteName };
  Unknown: undefined;
};

export type AppRouteParamList = AuthStackParamList
  & OnboardingStackParamList
  & AnnouncementStackParamList
  & CalendarStackParamList
  & ProfileStackParamList
  & {
    Hydration: { status: HydrationRouteStatus };
    Home: undefined;
    Unknown: undefined;
  };

export type AppRouteName = keyof AppRouteParamList;

export type HydrationRoute = {
  name: "Hydration";
  params: { status: HydrationRouteStatus };
};

export type AuthRoute = {
  [Name in AuthRouteName]: { name: Name };
}[AuthRouteName];

export type OnboardingRoute = { name: "AcademicOnboarding" };

export type AnnouncementRoute =
  | { name: "Announcements" }
  | { name: "SummerSchool" }
  | { name: "YokAnnouncements" }
  | { name: "AnnouncementDetail"; params: { announcementId: string } };

export type CalendarRoute =
  | { name: "Calendar" }
  | { name: "CalendarEventDetail"; params: { eventId: string } };

export type ProfileRoute = {
  [Name in ProfileRouteName]: { name: Name };
}[ProfileRouteName];

export type NotificationDetailRoute =
  | Extract<AnnouncementRoute, { name: "AnnouncementDetail" }>
  | Extract<CalendarRoute, { name: "CalendarEventDetail" }>;

export type ProtectedAppRoute =
  | { name: "Home" }
  | AnnouncementRoute
  | CalendarRoute
  | ProfileRoute;

export type UnknownRoute = { name: "Unknown" };

export type AppRoute =
  | HydrationRoute
  | AuthRoute
  | OnboardingRoute
  | ProtectedAppRoute
  | UnknownRoute;

export type RouteOwner = {
  ownerId: string;
  generation: number;
};

export type LegacyDestination =
  | "home"
  | "announcements"
  | "summer"
  | "yok"
  | "calendar"
  | "profile";

export const LEGACY_DESTINATIONS = [
  "home",
  "announcements",
  "summer",
  "yok",
  "calendar",
  "profile"
] as const satisfies readonly LegacyDestination[];

const AUTH_ROUTE_SET = new Set<string>(AUTH_ROUTE_NAMES);
const SETTINGS_ROUTE_SET = new Set<string>(SETTINGS_ROUTE_NAMES);
const NO_PARAM_ROUTE_SET = new Set<string>([
  ...AUTH_ROUTE_NAMES,
  "AcademicOnboarding",
  "Home",
  "Announcements",
  "SummerSchool",
  "YokAnnouncements",
  "Calendar",
  "Profile",
  ...SETTINGS_ROUTE_NAMES,
  "Unknown"
]);

export const appRoutes = {
  hydration: (status: HydrationRouteStatus): HydrationRoute => ({
    name: "Hydration",
    params: { status }
  }),
  login: (): AuthRoute => ({ name: "Login" }),
  register: (): AuthRoute => ({ name: "Register" }),
  verification: (): AuthRoute => ({ name: "Verification" }),
  passwordRecoveryRequest: (): AuthRoute => ({ name: "PasswordRecoveryRequest" }),
  passwordRecoveryCode: (): AuthRoute => ({ name: "PasswordRecoveryCode" }),
  passwordRecoveryConfirm: (): AuthRoute => ({ name: "PasswordRecoveryConfirm" }),
  academicOnboarding: (): OnboardingRoute => ({ name: "AcademicOnboarding" }),
  home: (): ProtectedAppRoute => ({ name: "Home" }),
  announcements: (): AnnouncementRoute => ({ name: "Announcements" }),
  summerSchool: (): AnnouncementRoute => ({ name: "SummerSchool" }),
  yokAnnouncements: (): AnnouncementRoute => ({ name: "YokAnnouncements" }),
  announcementDetail: (announcementId: string): NotificationDetailRoute => {
    assertSafeRouteIdentifier(announcementId);
    return { name: "AnnouncementDetail", params: { announcementId } };
  },
  calendar: (): CalendarRoute => ({ name: "Calendar" }),
  calendarEventDetail: (eventId: string): NotificationDetailRoute => {
    assertSafeRouteIdentifier(eventId);
    return { name: "CalendarEventDetail", params: { eventId } };
  },
  profile: (): ProfileRoute => ({ name: "Profile" }),
  academicProfileSettings: (): ProfileRoute => ({ name: "AcademicProfileSettings" }),
  followedUniversitiesSettings: (): ProfileRoute => ({ name: "FollowedUniversitiesSettings" }),
  notificationSettings: (): ProfileRoute => ({ name: "NotificationSettings" }),
  googleCalendarSettings: (): ProfileRoute => ({ name: "GoogleCalendarSettings" }),
  accountDataSettings: (): ProfileRoute => ({ name: "AccountDataSettings" }),
  unknown: (): UnknownRoute => ({ name: "Unknown" })
} as const;

export function mapLegacyDestination(destination: LegacyDestination): ProtectedAppRoute {
  switch (destination) {
    case "home":
      return appRoutes.home();
    case "announcements":
      return appRoutes.announcements();
    case "summer":
      return appRoutes.summerSchool();
    case "yok":
      return appRoutes.yokAnnouncements();
    case "calendar":
      return appRoutes.calendar();
    case "profile":
      return appRoutes.profile();
  }
}

export function isAuthRoute(route: AppRoute): route is AuthRoute {
  return AUTH_ROUTE_SET.has(route.name);
}

export function isOnboardingRoute(route: AppRoute): route is OnboardingRoute {
  return route.name === "AcademicOnboarding";
}

export function isProtectedRoute(route: AppRoute): route is ProtectedAppRoute {
  return route.name === "Home"
    || ANNOUNCEMENT_ROUTE_NAMES.some((name) => name === route.name)
    || CALENDAR_ROUTE_NAMES.some((name) => name === route.name)
    || route.name === "Profile"
    || SETTINGS_ROUTE_SET.has(route.name);
}

export function isNotificationDetailRoute(route: AppRoute): route is NotificationDetailRoute {
  return route.name === "AnnouncementDetail" || route.name === "CalendarEventDetail";
}

export function tabForRoute(route: ProtectedAppRoute): MainTabRouteName {
  switch (route.name) {
    case "Home":
      return "HomeTab";
    case "Announcements":
    case "SummerSchool":
    case "YokAnnouncements":
    case "AnnouncementDetail":
      return "AnnouncementsTab";
    case "Calendar":
    case "CalendarEventDetail":
      return "CalendarTab";
    case "Profile":
    case "AcademicProfileSettings":
    case "FollowedUniversitiesSettings":
    case "NotificationSettings":
    case "GoogleCalendarSettings":
    case "AccountDataSettings":
      return "ProfileTab";
  }
}

export function rootRouteForTab(tab: MainTabRouteName): ProtectedAppRoute {
  switch (tab) {
    case "HomeTab":
      return appRoutes.home();
    case "AnnouncementsTab":
      return appRoutes.announcements();
    case "CalendarTab":
      return appRoutes.calendar();
    case "ProfileTab":
      return appRoutes.profile();
  }
}

export function parentRouteFor(route: AppRoute): AppRoute | null {
  switch (route.name) {
    case "Register":
    case "Verification":
    case "PasswordRecoveryRequest":
    case "AcademicOnboarding":
      return appRoutes.login();
    case "PasswordRecoveryCode":
      return appRoutes.passwordRecoveryRequest();
    case "PasswordRecoveryConfirm":
      return appRoutes.passwordRecoveryCode();
    case "SummerSchool":
    case "YokAnnouncements":
    case "AnnouncementDetail":
      return appRoutes.announcements();
    case "CalendarEventDetail":
      return appRoutes.calendar();
    case "AcademicProfileSettings":
    case "FollowedUniversitiesSettings":
    case "NotificationSettings":
    case "GoogleCalendarSettings":
    case "AccountDataSettings":
      return appRoutes.profile();
    default:
      return null;
  }
}

export function routeKey(route: AppRoute): string {
  if (route.name === "Hydration") return `Hydration:${route.params.status}`;
  if (route.name === "AnnouncementDetail") return `AnnouncementDetail:${route.params.announcementId}`;
  if (route.name === "CalendarEventDetail") return `CalendarEventDetail:${route.params.eventId}`;
  return route.name;
}

export function cloneAppRoute(route: AppRoute): AppRoute {
  if (route.name === "Hydration") return appRoutes.hydration(route.params.status);
  if (route.name === "AnnouncementDetail") return appRoutes.announcementDetail(route.params.announcementId);
  if (route.name === "CalendarEventDetail") return appRoutes.calendarEventDetail(route.params.eventId);
  return { name: route.name } as AppRoute;
}

export function isAppRoute(value: unknown): value is AppRoute {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  if (NO_PARAM_ROUTE_SET.has(value.name)) {
    return hasExactKeys(value, ["name"]);
  }
  if (value.name === "Hydration") {
    return hasExactKeys(value, ["name", "params"])
      && isRecord(value.params)
      && hasExactKeys(value.params, ["status"])
      && (value.params.status === "loading" || value.params.status === "error");
  }
  if (value.name === "AnnouncementDetail") {
    return hasExactKeys(value, ["name", "params"])
      && isRecord(value.params)
      && hasExactKeys(value.params, ["announcementId"])
      && isSafeRouteIdentifier(value.params.announcementId);
  }
  if (value.name === "CalendarEventDetail") {
    return hasExactKeys(value, ["name", "params"])
      && isRecord(value.params)
      && hasExactKeys(value.params, ["eventId"])
      && isSafeRouteIdentifier(value.params.eventId);
  }
  return false;
}

export function isSafeRouteIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

export function isValidRouteOwner(ownerId: unknown, generation: unknown): boolean {
  return isSafeRouteIdentifier(ownerId)
    && typeof generation === "number"
    && Number.isSafeInteger(generation)
    && generation >= 0;
}

function assertSafeRouteIdentifier(value: unknown): asserts value is string {
  if (!isSafeRouteIdentifier(value)) {
    throw new Error("A safe route identifier is required.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}
