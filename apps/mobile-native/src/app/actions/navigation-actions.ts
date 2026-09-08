import { type AppVisibleRoute } from "../../navigation/AppNavigator";
import { type ProtectedAppRoute, type AppRouteIntent, parseAcademicPulseRouteUrl } from "../../navigation";
import { type AccountGenerationSnapshot } from "../../auth/session-integrity";
import {
  PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
  PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
} from "../../auth/prelogin-welcome";
import { type HomeImportantItem } from "../../home/home-model";
import { resolveHomeImportantDestination } from "../../home/home-destination";
import { type CalendarItem } from "../../calendar/calendar-model";
import { navigationTargetForProtectedRoute } from "../app-routes";
import { setStoredValue } from "../app-storage";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";
import type { HomeContentData } from "../useHomeContentData";

type Dependencies = Pick<ApplicationActions,
  "loadProtectedAnnouncementDetail" | "invalidateAnnouncementDetailOwnership"
  | "receiveNotificationDestination" | "openAnnouncement"
  | "clearPendingNotificationDestinationIfCurrent" | "cancelPasswordRecovery" | "returnToLoginForm"
  | "returnToPasswordRecoveryRequest" | "loadUniversities" | "loadFollowedUniversities"
> & Pick<ApplicationState,
  "setActiveTab" | "requestAppRoute" | "accountGuardRef" | "routeIntentCoordinatorRef"
  | "sessionRef" | "hydrationStatusRef" | "authOperationInProgressRef" | "busy"
  | "pendingDeepLinkRouteRef" | "setActiveCalendarDetail" | "calendar" | "setMessage"
  | "acknowledgeNavigationRequest" | "notificationNavigationRequestRef" | "setCleanupIssue"
  | "setActiveRoute" | "authStage" | "authMode" | "setAuthMode" | "setAuthStage"
  | "pendingPasswordRecovery" | "activeTrustedDetail" | "announcementDetailLoad" | "universities"
  | "followedUniversities" | "preloginWelcomeGate" | "setPreloginWelcomeGate"
> & Pick<ApplicationDerivedState,
  "navigatorRootSurface" | "selectedUniversity"
> & Pick<HomeContentData,
  "homeEvents" | "homeManualExams"
>;

export function createNavigationActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "openProtectedAppRoute" | "dispatchProtectedRouteIntent" | "receiveAcademicPulseUrl"
  | "resumePendingDeepLinkIfEligible" | "openCalendarItem" | "openHomeImportantItem"
  | "handleNavigationRequestHandled" | "handleVisibleRouteChange" | "completePreloginWelcome"
> {
  const {
    loadProtectedAnnouncementDetail,
    invalidateAnnouncementDetailOwnership,
    setActiveTab,
    requestAppRoute,
    accountGuardRef,
    routeIntentCoordinatorRef,
    receiveNotificationDestination,
    sessionRef,
    hydrationStatusRef,
    navigatorRootSurface,
    authOperationInProgressRef,
    busy,
    pendingDeepLinkRouteRef,
    setActiveCalendarDetail,
    homeEvents,
    homeManualExams,
    calendar,
    selectedUniversity,
    openAnnouncement,
    setMessage,
    acknowledgeNavigationRequest,
    notificationNavigationRequestRef,
    clearPendingNotificationDestinationIfCurrent,
    setCleanupIssue,
    setActiveRoute,
    authStage,
    cancelPasswordRecovery,
    authMode,
    returnToLoginForm,
    setAuthMode,
    setAuthStage,
    returnToPasswordRecoveryRequest,
    pendingPasswordRecovery,
    activeTrustedDetail,
    announcementDetailLoad,
    universities,
    loadUniversities,
    followedUniversities,
    loadFollowedUniversities,
    preloginWelcomeGate,
    setPreloginWelcomeGate
  } = dependencies;

  function openProtectedAppRoute(route: ProtectedAppRoute): void {
    if (route.name === "AnnouncementDetail") {
      loadProtectedAnnouncementDetail(route.params.announcementId);
    } else if (route.name === "CalendarEventDetail") {
      invalidateAnnouncementDetailOwnership();
    }
    const target = navigationTargetForProtectedRoute(route);
    setActiveTab(target.legacyTab);
    requestAppRoute(target.route, target.params);
  }

  function dispatchProtectedRouteIntent(
    intent: AppRouteIntent,
    ownerSnapshot: AccountGenerationSnapshot
  ): boolean {
    if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return false;
    const result = routeIntentCoordinatorRef.current.enqueue(intent, ownerSnapshot);
    if (result !== "enqueued" && result !== "promoted") return false;
    const selected = routeIntentCoordinatorRef.current.consumeFor(
      ownerSnapshot.ownerId,
      ownerSnapshot.generation
    );
    if (!selected) return false;
    if (selected.route.name === "Unknown") {
      requestAppRoute("UnknownRoute");
      return true;
    }
    openProtectedAppRoute(selected.route);
    return true;
  }

  function receiveAcademicPulseUrl(url: unknown): void {
    const resolution = parseAcademicPulseRouteUrl(url);
    if (resolution.kind === "notification") {
      void receiveNotificationDestination(resolution.notification);
      return;
    }

    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    const exactOwner = currentSession && ownerSnapshot && currentSession.user.id === ownerSnapshot.ownerId
      ? ownerSnapshot
      : null;
    if (
      hydrationStatusRef.current !== "ready"
      || navigatorRootSurface !== "authenticated"
      || authOperationInProgressRef.current
      || busy
      || !exactOwner
    ) {
      pendingDeepLinkRouteRef.current = { route: resolution.route, owner: exactOwner };
      return;
    }
    pendingDeepLinkRouteRef.current = null;
    dispatchProtectedRouteIntent({ source: "deep_link", route: resolution.route }, exactOwner);
  }

  function resumePendingDeepLinkIfEligible(): void {
    const pending = pendingDeepLinkRouteRef.current;
    if (!pending || hydrationStatusRef.current !== "ready") return;
    if (navigatorRootSurface !== "authenticated" || authOperationInProgressRef.current || busy) return;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId) return;
    if (
      pending.owner
      && (
        pending.owner.ownerId !== ownerSnapshot.ownerId
        || pending.owner.generation !== ownerSnapshot.generation
      )
    ) {
      pendingDeepLinkRouteRef.current = null;
      return;
    }
    pendingDeepLinkRouteRef.current = { ...pending, owner: ownerSnapshot };
    pendingDeepLinkRouteRef.current = null;
    dispatchProtectedRouteIntent({ source: "deep_link", route: pending.route }, ownerSnapshot);
  }

  function openCalendarItem(item: CalendarItem): void {
    setActiveCalendarDetail(item);
    setActiveTab("calendar");
    requestAppRoute("CalendarEventDetail", { eventId: item.routeId });
  }

  function openHomeImportantItem(item: HomeImportantItem): void {
    const destination = resolveHomeImportantDestination({
      item,
      events: homeEvents,
      manualExams: homeManualExams,
      academicSourceLabel: calendar.data?.calendar.title
        ?? selectedUniversity?.name
        ?? "Resmî akademik kaynak",
    });
    if (destination.kind === "calendar_detail") {
      openCalendarItem(destination.item);
      return;
    }
    if (destination.kind === "official_source") {
      void openAnnouncement(destination.url).then((opened) => {
        if (!opened && destination.fallbackItem) openCalendarItem(destination.fallbackItem);
      });
      return;
    }
    setMessage({
      text: destination.reason === "missing_item"
        ? "Bu etkinlik artık güncel akademik kayıtlarda bulunamıyor."
        : "Bu etkinliğin ayrıntısı veya resmî kaynağı kullanılamıyor.",
      tone: "error",
    });
  }

  function handleNavigationRequestHandled(requestKey: string): void {
    acknowledgeNavigationRequest(requestKey);
    const notificationRequest = notificationNavigationRequestRef.current;
    if (!notificationRequest || notificationRequest.requestKey !== requestKey) return;
    notificationNavigationRequestRef.current = null;
    if (
      !accountGuardRef.current.isCurrent(notificationRequest.ownerSnapshot)
      || sessionRef.current?.user.id !== notificationRequest.ownerSnapshot.ownerId
    ) return;
    void clearPendingNotificationDestinationIfCurrent(notificationRequest.record)
      .then((cleared) => {
        if (cleared || !accountGuardRef.current.isCurrent(notificationRequest.ownerSnapshot)) return;
        setCleanupIssue({
          action: "activation",
          failedTargets: ["pending_notification_storage"],
          ownerId: notificationRequest.ownerSnapshot.ownerId
        });
      })
      .catch(() => {
        if (!accountGuardRef.current.isCurrent(notificationRequest.ownerSnapshot)) return;
        setCleanupIssue({
          action: "activation",
          failedTargets: ["pending_notification_storage"],
          ownerId: notificationRequest.ownerSnapshot.ownerId
        });
      });
  }

  function handleVisibleRouteChange(route: AppVisibleRoute): void {
    setActiveRoute(route);
    switch (route) {
      case "Login":
        if (authStage.startsWith("password_recovery")) {
          cancelPasswordRecovery();
        } else if (authStage !== "auth" || authMode !== "login") {
          returnToLoginForm();
        }
        return;
      case "Register":
        setAuthMode("register");
        setAuthStage("auth");
        return;
      case "Verification":
        setAuthMode("login");
        setAuthStage("verify");
        return;
      case "PasswordRecoveryRequest":
        if (authStage === "password_recovery_code" || authStage === "password_recovery_confirm") returnToPasswordRecoveryRequest();
        else setAuthStage("password_recovery_request");
        return;
      case "PasswordRecoveryCode":
        if (pendingPasswordRecovery) setAuthStage("password_recovery_code");
        else setAuthStage("password_recovery_request");
        return;
      case "PasswordRecoveryConfirm":
        if (pendingPasswordRecovery) setAuthStage("password_recovery_confirm");
        else setAuthStage("password_recovery_request");
        return;
      case "AcademicOnboarding":
        setAuthStage("academic_onboarding");
        return;
      case "Home":
        setActiveTab("home");
        return;
      case "Announcements":
        setActiveTab("announcements");
        return;
      case "AnnouncementDetail":
        setActiveTab("announcements");
        if (activeTrustedDetail?.type !== "announcement" && !announcementDetailLoad) {
          requestAppRoute("Announcements");
        }
        return;
      case "SummerSchool":
        setActiveTab("summer");
        return;
      case "YokAnnouncements":
        setActiveTab("yok");
        return;
      case "Calendar":
      case "CalendarEventDetail":
        setActiveTab("calendar");
        return;
      case "Profile":
      case "AcademicProfileSettings":
      case "FollowedUniversitiesSettings":
      case "NotificationSettings":
      case "AppleCalendarSettings":
      case "GoogleCalendarSettings":
      case "AccountDataSettings":
        setActiveTab("profile");
        if (route === "FollowedUniversitiesSettings") {
          if (!universities.attempted && !universities.loading) void loadUniversities();
          if (!followedUniversities.attempted && !followedUniversities.loading) void loadFollowedUniversities();
        }
        return;
      case "BootstrapLoading":
      case "BootstrapError":
      case "UnknownRoute":
        return;
    }
  }

  async function completePreloginWelcome(): Promise<void> {
    if (preloginWelcomeGate === "saving") return;
    setPreloginWelcomeGate("saving");
    try {
      await setStoredValue(
        PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
        PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
      );
    } catch {
      // Continue in memory; the next successful session restore repairs the
      // installation flag without exposing a low-level storage error.
    } finally {
      // A transient storage failure must never trap someone on the welcome
      // screen. Persistence is retried on a later successful session restore.
      setPreloginWelcomeGate("completed");
      setAuthMode("login");
      setAuthStage("auth");
      setActiveRoute("Login");
    }
  }

  return {
    openProtectedAppRoute,
    dispatchProtectedRouteIntent,
    receiveAcademicPulseUrl,
    resumePendingDeepLinkIfEligible,
    openCalendarItem,
    openHomeImportantItem,
    handleNavigationRequestHandled,
    handleVisibleRouteChange,
    completePreloginWelcome
  };
}
