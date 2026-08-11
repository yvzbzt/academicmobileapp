import {
  parseNotificationDeepLink,
  type NotificationDestination,
  type ParsedNotificationDestination
} from "../notifications/notification-destination";
import {
  appRoutes,
  type NotificationDetailRoute,
  type ProtectedAppRoute,
  type UnknownRoute
} from "./routes";

export type AcademicPulseRouteResolution =
  | {
      kind: "route";
      route: ProtectedAppRoute;
    }
  | {
      kind: "notification";
      notification: ParsedNotificationDestination;
    }
  | {
      kind: "unknown";
      route: UnknownRoute;
    };

export const ACADEMIC_PULSE_ROUTE_URLS = [
  "academicpulse://tab/home",
  "academicpulse://tab/announcements",
  "academicpulse://tab/calendar",
  "academicpulse://tab/profile",
  "academicpulse://announcements/summer-school",
  "academicpulse://announcements/yok",
  "academicpulse://settings/academic-profile",
  "academicpulse://settings/notifications",
  "academicpulse://settings/google-calendar",
  "academicpulse://settings/account-data"
] as const;

const STATIC_ROUTE_RESOLVERS: Readonly<Record<string, () => ProtectedAppRoute>> = {
  "academicpulse://tab/home": appRoutes.home,
  "academicpulse://tab/announcements": appRoutes.announcements,
  "academicpulse://tab/calendar": appRoutes.calendar,
  "academicpulse://tab/profile": appRoutes.profile,
  "academicpulse://announcements/summer-school": appRoutes.summerSchool,
  "academicpulse://announcements/yok": appRoutes.yokAnnouncements,
  "academicpulse://settings/academic-profile": appRoutes.academicProfileSettings,
  "academicpulse://settings/notifications": appRoutes.notificationSettings,
  "academicpulse://settings/google-calendar": appRoutes.googleCalendarSettings,
  "academicpulse://settings/account-data": appRoutes.accountDataSettings
};

/**
 * Resolves only the versioned notification URL or the explicit route allowlist.
 * Unknown results deliberately contain no copy of the untrusted URL.
 */
export function parseAcademicPulseRouteUrl(value: unknown): AcademicPulseRouteResolution {
  if (typeof value !== "string") return unknownResolution();

  const notification = parseNotificationDeepLink(value);
  if (notification) {
    return {
      kind: "notification",
      notification: {
        recipientOwnerId: notification.recipientOwnerId,
        destination: { ...notification.destination }
      }
    };
  }

  const resolveStaticRoute = STATIC_ROUTE_RESOLVERS[value];
  if (!resolveStaticRoute) return unknownResolution();
  return { kind: "route", route: resolveStaticRoute() };
}

export const resolveAcademicPulseDeepLink = parseAcademicPulseRouteUrl;

/**
 * Call this only after Phase 3's exact trusted-record lookup has succeeded for
 * the current owner generation. Parsing a notification URL alone is not proof
 * that its content is available to the signed-in account.
 */
export function routeForVerifiedNotification(
  destination: NotificationDestination
): NotificationDetailRoute {
  return destination.type === "announcement"
    ? appRoutes.announcementDetail(destination.id)
    : appRoutes.calendarEventDetail(destination.id);
}

function unknownResolution(): AcademicPulseRouteResolution {
  return { kind: "unknown", route: appRoutes.unknown() };
}
