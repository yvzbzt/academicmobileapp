import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { useEffect } from "react";
import { Platform, Linking, AppState, InteractionManager } from "react-native";
import { runtimeDiagnostic } from "../performance/runtime-diagnostics";
import { FirebaseNotificationTapAdapter } from "../notifications";
import { routeBelongsToLegacyTab } from "./app-routes";
import { StaleAccountRequestError } from "./app-errors";
import { GOOGLE_AUTH_CONFIGURED, GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from "./app-auth-providers";
import type { ApplicationActions } from "./application-actions";
import type { ApplicationState } from "./useApplicationState";
import type { ApplicationDerivedState } from "./useApplicationDerivedState";

type Dependencies = Pick<ApplicationActions,
  "hydrateApplication" | "receiveNotificationDestination" | "receiveAcademicPulseUrl"
  | "resumePendingDeepLinkIfEligible" | "restoreAppleCalendarConnection"
  | "reconcileNotificationDelivery" | "loadFacultiesForRegistration"
  | "loadDepartmentsForRegistration" | "loadAnnouncements" | "loadYokAnnouncements"
  | "loadSummerSchool" | "loadUniversities"
> & Pick<ApplicationState,
  "message" | "setMessage" | "setActiveRoute" | "activeTab" | "authMode" | "authStage"
  | "pendingVerification" | "setVerificationClockMs" | "pendingPasswordRecovery"
  | "setPasswordRecoveryClockMs" | "sessionRef" | "session" | "notificationCoordinatorOwnerTokenRef"
  | "hydrationStatusRef" | "hydrationStatus" | "notificationUnsubscribeRef"
  | "notificationRotationUnsubscribeRef" | "notificationForegroundUnsubscribeRef"
  | "notificationCoordinatorRef" | "notificationTapAdapterRef" | "notificationNavigationRequestRef"
  | "pendingDeepLinkRouteRef" | "authenticatedContextPending" | "busy" | "accountGuardRef"
  | "accountCleanupInProgressRef" | "appleCalendarOperationRef" | "setAppleCalendarState"
  | "setAppleCalendarError" | "setAlarmEnabled" | "setCleanupIssue" | "setAppleAvailable"
  | "alarmEnabledRef" | "alarmEnabled" | "alarmModeRef" | "alarmMode" | "categoryDraftRef"
  | "categoryDraft" | "preferences" | "setCategoryDraft" | "setAlarmMode"
  | "setNotificationPreferenceOutcome" | "registerUniversityId" | "registerFacultyId"
  | "announcements" | "yokAnnouncements" | "summerSchool" | "contentFeedLimit" | "universities"
> & Pick<ApplicationDerivedState,
  "navigatorRootSurface" | "expectedBaseRoute" | "availableCategories" | "controlledActiveRoute"
>;

export function useApplicationEffects(dependencies: Dependencies) {
  const {
    hydrateApplication,
    message,
    navigatorRootSurface,
    setMessage,
    setActiveRoute,
    expectedBaseRoute,
    activeTab,
    authMode,
    authStage,
    pendingVerification,
    setVerificationClockMs,
    pendingPasswordRecovery,
    setPasswordRecoveryClockMs,
    sessionRef,
    session,
    notificationCoordinatorOwnerTokenRef,
    hydrationStatusRef,
    hydrationStatus,
    notificationUnsubscribeRef,
    notificationRotationUnsubscribeRef,
    notificationForegroundUnsubscribeRef,
    notificationCoordinatorRef,
    notificationTapAdapterRef,
    receiveNotificationDestination,
    receiveAcademicPulseUrl,
    notificationNavigationRequestRef,
    pendingDeepLinkRouteRef,
    resumePendingDeepLinkIfEligible,
    authenticatedContextPending,
    busy,
    accountGuardRef,
    accountCleanupInProgressRef,
    appleCalendarOperationRef,
    restoreAppleCalendarConnection,
    setAppleCalendarState,
    setAppleCalendarError,
    reconcileNotificationDelivery,
    setAlarmEnabled,
    setCleanupIssue,
    setAppleAvailable,
    alarmEnabledRef,
    alarmEnabled,
    alarmModeRef,
    alarmMode,
    categoryDraftRef,
    categoryDraft,
    preferences,
    availableCategories,
    setCategoryDraft,
    setAlarmMode,
    setNotificationPreferenceOutcome,
    registerUniversityId,
    loadFacultiesForRegistration,
    registerFacultyId,
    loadDepartmentsForRegistration,
    announcements,
    loadAnnouncements,
    yokAnnouncements,
    summerSchool,
    loadYokAnnouncements,
    contentFeedLimit,
    loadSummerSchool,
    controlledActiveRoute,
    universities,
    loadUniversities
  } = dependencies;

  useEffect(() => {
    void hydrateApplication();
  }, []);

  useEffect(() => {
    if (!message || navigatorRootSurface !== "authenticated") return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message, navigatorRootSurface]);

  useEffect(() => {
    setActiveRoute((current) => {
      if (navigatorRootSurface !== "authenticated") return expectedBaseRoute;
      return routeBelongsToLegacyTab(current, activeTab) ? current : expectedBaseRoute;
    });
  }, [activeTab, authMode, authStage, expectedBaseRoute, navigatorRootSurface]);

  useEffect(() => {
    if (authStage !== "verify" || !pendingVerification) return;
    setVerificationClockMs(Date.now());
    const timer = setInterval(() => setVerificationClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [authStage, pendingVerification?.email, pendingVerification?.verificationExpiresAt, pendingVerification?.resendAvailableAt]);

  useEffect(() => {
    if (!authStage.startsWith("password_recovery") || !pendingPasswordRecovery) return;
    setPasswordRecoveryClockMs(Date.now());
    const timer = setInterval(() => setPasswordRecoveryClockMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [
    authStage,
    pendingPasswordRecovery?.email,
    pendingPasswordRecovery?.recoveryExpiresAt,
    pendingPasswordRecovery?.resendAvailableAt
  ]);

  useEffect(() => {
    sessionRef.current = session;
    notificationCoordinatorOwnerTokenRef.current = session;
  }, [session]);

  useEffect(() => {
    hydrationStatusRef.current = hydrationStatus;
  }, [hydrationStatus]);

  useEffect(() => () => {
    notificationUnsubscribeRef.current?.();
    notificationRotationUnsubscribeRef.current?.();
    notificationForegroundUnsubscribeRef.current?.();
    notificationCoordinatorRef.current?.dispose();
    notificationCoordinatorRef.current = null;
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    const tapAdapter = new FirebaseNotificationTapAdapter();
    notificationTapAdapterRef.current = tapAdapter;
    void tapAdapter.consumeInitialDestination()
      .then((destination) => receiveNotificationDestination(destination))
      .catch(() => undefined);
    const unsubscribeTap = tapAdapter.subscribe((destination) => {
      void receiveNotificationDestination(destination);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) receiveAcademicPulseUrl(url);
    }).catch(() => undefined);
    const linkingSubscription = Linking.addEventListener("url", ({ url }) => {
      receiveAcademicPulseUrl(url);
    });
    return () => {
      unsubscribeTap();
      linkingSubscription.remove();
      notificationTapAdapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (hydrationStatus !== "ready") return;
    if (notificationNavigationRequestRef.current) {
      pendingDeepLinkRouteRef.current = null;
      return;
    }
    resumePendingDeepLinkIfEligible();
  }, [authStage, authenticatedContextPending, busy, hydrationStatus, session?.user.id]);

  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      const currentSession = sessionRef.current;
      const ownerSnapshot = accountGuardRef.current.capture();
      if (
        Platform.OS === "ios"
        && currentSession
        && ownerSnapshot
        && !accountCleanupInProgressRef.current
        && !appleCalendarOperationRef.current
      ) {
        void restoreAppleCalendarConnection(currentSession.user.id, ownerSnapshot).catch((error: unknown) => {
          if (error instanceof StaleAccountRequestError) return;
          if (sessionRef.current?.user.id !== currentSession.user.id) return;
          setAppleCalendarState("error");
          setAppleCalendarError("Apple Takvim izin durumu yenilenemedi.");
        });
      }
      const coordinator = notificationCoordinatorRef.current;
      if (!currentSession || !coordinator) return;
      void reconcileNotificationDelivery(currentSession, coordinator).catch(async () => {
        if (sessionRef.current?.user.id !== currentSession.user.id) return;
        await coordinator.setPreferenceEnabled(false).catch(() => undefined);
        setAlarmEnabled(false);
        setCleanupIssue({
          action: "notification_settings",
          failedTargets: ["device_registration"],
          ownerId: currentSession.user.id
        });
        setMessage({
          text: "Bildirim durumu yenilenemediği için teslimat etkin gösterilmiyor. Bağlantını kontrol edip tekrar dene.",
          tone: "error"
        });
      });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!GOOGLE_AUTH_CONFIGURED) return;

    GoogleSignin.configure({
      scopes: ["email", "profile"],
      offlineAccess: false,
      ...(GOOGLE_WEB_CLIENT_ID ? { webClientId: GOOGLE_WEB_CLIENT_ID } : {}),
      ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {})
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      setAppleAvailable(false);
      return;
    }
    let active = true;
    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setAppleAvailable(available);
      })
      .catch(() => {
        if (active) setAppleAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    alarmEnabledRef.current = alarmEnabled;
  }, [alarmEnabled]);

  useEffect(() => {
    alarmModeRef.current = alarmMode;
  }, [alarmMode]);

  useEffect(() => {
    categoryDraftRef.current = categoryDraft;
  }, [categoryDraft]);

  useEffect(() => {
    if (!preferences.data) return;

    const draft: Record<string, boolean> = {};
    for (const category of availableCategories) {
      draft[category] = preferences.data.categories[category] !== false;
    }

    const allEnabled = availableCategories.every((category) => draft[category] !== false);
    categoryDraftRef.current = draft;
    alarmEnabledRef.current = preferences.data.enabled;
    alarmModeRef.current = allEnabled ? "all_calendar" : "selected_fields";
    setCategoryDraft(draft);
    setAlarmEnabled(preferences.data.enabled);
    setAlarmMode(allEnabled ? "all_calendar" : "selected_fields");
    setNotificationPreferenceOutcome((current) => current === "error" ? current : "saved");
  }, [preferences.data, availableCategories]);

  useEffect(() => {
    if (!registerUniversityId) return;
    void loadFacultiesForRegistration(registerUniversityId);
  }, [registerUniversityId]);

  useEffect(() => {
    if (!registerFacultyId) return;
    void loadDepartmentsForRegistration(registerFacultyId);
  }, [registerFacultyId]);

  useEffect(() => {
    if (!session) return;
    const announcementsExperienceVisible = activeTab === "announcements"
      || activeTab === "yok"
      || activeTab === "summer";
    if (!announcementsExperienceVisible) return;

    if (registerUniversityId && !announcements.loading && !announcements.data && !announcements.attempted) {
      void loadAnnouncements(undefined, registerUniversityId);
      return;
    }

    if (announcements.loading || !announcements.attempted) return;

    const shouldLoadYokAnnouncements = !yokAnnouncements.loading
      && !yokAnnouncements.data
      && !yokAnnouncements.attempted;
    const shouldLoadSummerSchool = Boolean(
      registerUniversityId
      && !summerSchool.loading
      && !summerSchool.data
      && !summerSchool.attempted
    );
    if (!shouldLoadYokAnnouncements && !shouldLoadSummerSchool) return;

    let cancelled = false;
    let secondaryFeedWarmup: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const secondaryFeedTimer = setTimeout(() => {
      secondaryFeedWarmup = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        if (shouldLoadYokAnnouncements) {
          void loadYokAnnouncements(true, contentFeedLimit);
        }
        if (shouldLoadSummerSchool) {
          void loadSummerSchool();
        }
      });
    }, 1_200);
    return () => {
      cancelled = true;
      clearTimeout(secondaryFeedTimer);
      secondaryFeedWarmup?.cancel();
    };
  }, [
    activeTab,
    announcements.data,
    announcements.attempted,
    announcements.loading,
    contentFeedLimit,
    registerUniversityId,
    session?.user.id,
    summerSchool.data,
    summerSchool.attempted,
    summerSchool.loading,
    yokAnnouncements.data,
    yokAnnouncements.attempted,
    yokAnnouncements.loading
  ]);

  useEffect(() => {
    runtimeDiagnostic("feed.state", {
      tab: activeTab,
      visible: activeTab === "announcements" || activeTab === "yok" || activeTab === "summer",
      primaryLoading: announcements.loading,
      primaryAttempted: Boolean(announcements.attempted),
      primaryItemCount: announcements.data?.items.length ?? 0,
      primaryError: Boolean(announcements.error),
      secondaryLoading: yokAnnouncements.loading || summerSchool.loading,
    });
  }, [
    activeTab,
    announcements.attempted,
    announcements.data?.items.length,
    announcements.error,
    announcements.loading,
    summerSchool.loading,
    yokAnnouncements.loading,
  ]);

  useEffect(() => {
    const needsPublicCatalog = (authMode === "register" && authStage === "auth")
      || authStage === "academic_onboarding"
      || (Boolean(session) && (
        controlledActiveRoute === "Profile"
        || controlledActiveRoute === "AcademicProfileSettings"
      ));
    if (!needsPublicCatalog) return;

    if (!(universities.data?.length) && !universities.loading && !universities.attempted) {
      void loadUniversities();
    }
  }, [
    authMode,
    authStage,
    controlledActiveRoute,
    session?.user.id,
    universities.attempted,
    universities.data?.length,
    universities.loading
  ]);
}
