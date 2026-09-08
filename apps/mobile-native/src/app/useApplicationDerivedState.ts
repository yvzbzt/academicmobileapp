import { useMemo } from "react";
import { type AppRootSurface, type AppVisibleRoute } from "../navigation/AppNavigator";
import { resolveRootRoute } from "../navigation";
import { GoogleCalendarService } from "../google-calendar/google-calendar-sync";
import {
  getVerificationTiming,
  getPasswordRecoveryTiming,
  isValidPasswordRecoveryEmail,
  validatePasswordRecoveryConfirmation,
} from "../auth/auth-recovery";
import { recentAuthenticationMethods, normalizeAccountAuthProvider } from "../auth/recent-authentication";
import {
  validateRegistrationForm,
  validateLoginForm,
  type AcademicOnboardingDraft,
  hasAcademicOnboardingChanges,
  classLevelOptionsForAcademicDepartment,
} from "../auth/auth-ui";
import {
  resolveAcademicProfileSummary,
  hasNotificationPreferenceChanges,
  type NotificationPreferenceSaveState,
  resolveNotificationTruth,
  resolveGoogleCalendarPresentation,
} from "../profile/profile-model";
import { selectAdditionalUniversityFollows } from "../profile/FollowedUniversitiesSettings";
import { normalizeTrustedContentCollection } from "../content/content-trust";
import { selectExamCountdownItems } from "../home/home-model";
import { selectUniversityAcademicCalendarEvents } from "../calendar/calendar-model";
import {
  isAcademicTemporalCurrentOrFuture,
  compareAcademicTemporalStart,
  isAcademicTemporalActiveOnDay,
} from "../temporal/academic-temporal";
import { GOOGLE_AUTH_CONFIGURED } from "./app-auth-providers";
import { DEFAULT_CATEGORY_OPTIONS } from "./app-config";
import { trustedContentCollectionHasMore, contentAvailabilityMessage } from "./app-content";
import { resolveAppleCalendarPresentation } from "./calendar-presentations";
import {
  routeForLegacyTab,
  visibleRouteForResolvedRoot,
  AUTHENTICATED_ROUTE_NAMES,
  AUTH_ROUTE_NAMES,
} from "./app-routes";
import type { ApplicationState } from "./useApplicationState";

type Dependencies = Pick<ApplicationState,
  "session" | "accountAuthProvider" | "appleAvailable" | "calendar" | "preferences"
  | "manualExamOwnerId" | "manualExamsHydrated" | "manualExams" | "announcements"
  | "yokAnnouncements" | "courseSchedule" | "summerSchool" | "contentFeedLimit" | "upcoming"
  | "universities" | "registerUniversityId" | "followedUniversities" | "selectedUniversityId"
  | "faculties" | "registerFacultyId" | "departments" | "registerDepartmentId" | "universitySearch"
  | "facultySearch" | "departmentSearch" | "fullName" | "email" | "password"
  | "registrationPasswordConfirmation" | "registerClassLevel" | "onboardingInitialDraft"
  | "alarmEnabled" | "alarmMode" | "categoryDraft" | "notificationPreferenceOutcome"
  | "notificationLifecycle" | "notificationPreferenceError" | "googleCalendarState"
  | "appleCalendarState" | "pendingVerification" | "verificationClockMs" | "pendingPasswordRecovery"
  | "passwordRecoveryClockMs" | "passwordRecoveryCode" | "newPassword" | "passwordConfirmation"
  | "accountGuardRef" | "hydrationStatus" | "sessionOwner" | "authMode" | "authStage"
  | "preloginWelcomeGate" | "authenticatedContextPending" | "activeTab" | "activeRoute"
  | "googleCalendarIntegration"
>;

export function useApplicationDerivedState(dependencies: Dependencies) {
  const {
    session,
    accountAuthProvider,
    appleAvailable,
    calendar,
    preferences,
    manualExamOwnerId,
    manualExamsHydrated,
    manualExams,
    announcements,
    yokAnnouncements,
    courseSchedule,
    summerSchool,
    contentFeedLimit,
    upcoming,
    universities,
    registerUniversityId,
    followedUniversities,
    selectedUniversityId,
    faculties,
    registerFacultyId,
    departments,
    registerDepartmentId,
    universitySearch,
    facultySearch,
    departmentSearch,
    fullName,
    email,
    password,
    registrationPasswordConfirmation,
    registerClassLevel,
    onboardingInitialDraft,
    alarmEnabled,
    alarmMode,
    categoryDraft,
    notificationPreferenceOutcome,
    notificationLifecycle,
    notificationPreferenceError,
    googleCalendarState,
    appleCalendarState,
    pendingVerification,
    verificationClockMs,
    pendingPasswordRecovery,
    passwordRecoveryClockMs,
    passwordRecoveryCode,
    newPassword,
    passwordConfirmation,
    accountGuardRef,
    hydrationStatus,
    sessionOwner,
    authMode,
    authStage,
    preloginWelcomeGate,
    authenticatedContextPending,
    activeTab,
    activeRoute,
    googleCalendarIntegration
  } = dependencies;

  const accessToken = session?.accessToken;

  const availableRecentAuthMethods = recentAuthenticationMethods(
    accountAuthProvider ?? normalizeAccountAuthProvider(session?.user.authProvider),
    GOOGLE_AUTH_CONFIGURED,
    appleAvailable
  );

  const googleCalendarService = useMemo(() => new GoogleCalendarService(), []);

  const availableCategories = useMemo(() => {
    const keys = new Set<string>(DEFAULT_CATEGORY_OPTIONS);
    for (const event of calendar.data?.events ?? []) keys.add(event.category);
    for (const category of Object.keys(preferences.data?.categories ?? {})) keys.add(category);
    return [...keys];
  }, [calendar.data?.events, preferences.data?.categories]);

  const examCountdownItems = useMemo(() => {
    const visibleManualExams = session?.user.id === manualExamOwnerId && manualExamsHydrated
      ? manualExams
      : [];
    return selectExamCountdownItems(calendar.data?.events ?? [], visibleManualExams, new Date());
  }, [calendar.data?.events, manualExams, manualExamOwnerId, manualExamsHydrated, session?.user.id]);

  const announcementFeed = useMemo(
    () => announcements.data?.items ?? [],
    [announcements.data]
  );

  const yokAnnouncementItems = useMemo(
    () => yokAnnouncements.data?.items ?? [],
    [yokAnnouncements.data]
  );

  const summerSchoolEvents = useMemo(
    () => (calendar.data?.events ?? []).filter((event) => event.category.startsWith("summer_school")),
    [calendar.data?.events]
  );

  const universityAcademicCalendarEvents = useMemo(
    () => [
      ...selectUniversityAcademicCalendarEvents(calendar.data?.events ?? []).map((event) => ({
        ...event,
        ...(calendar.data?.calendar.sourceUrl ? { sourceUrl: calendar.data.calendar.sourceUrl } : {})
      })),
      ...(courseSchedule.data?.events ?? []).map((event) => ({
        ...event,
        sourceLabel: "Bölüm ders programı",
        ...(courseSchedule.data?.profile.facultyId ? { facultyId: courseSchedule.data.profile.facultyId } : {}),
        ...(courseSchedule.data?.profile.departmentId ? { departmentId: courseSchedule.data.profile.departmentId } : {}),
        ...(courseSchedule.data?.sourceUrl ? { sourceUrl: courseSchedule.data.sourceUrl } : {})
      }))
    ],
    [calendar.data, courseSchedule.data]
  );

  const summerSchoolAnnouncements = useMemo(
    () => normalizeTrustedContentCollection([
      ...(summerSchool.data?.ownAnnouncements ?? []),
      ...(summerSchool.data?.sameDepartmentAnnouncements ?? [])
    ]).items,
    [summerSchool.data]
  );

  const contentFeedHasRetainedData = announcementFeed.length > 0
    || yokAnnouncementItems.length > 0
    || summerSchoolAnnouncements.length > 0;

  const contentFeedHasMore = trustedContentCollectionHasMore(announcements.data, contentFeedLimit)
    || trustedContentCollectionHasMore(yokAnnouncements.data, contentFeedLimit);

  const contentFeedSecondaryErrors = [yokAnnouncements.error, summerSchool.error]
    .filter((value): value is string => Boolean(value));

  const contentFeedSourceErrors = [
    announcements.error,
    ...(contentFeedHasRetainedData ? contentFeedSecondaryErrors : [])
  ].filter((value): value is string => Boolean(value));

  const contentFeedError = contentFeedSourceErrors.join(" ") || undefined;

  const contentFeedPartial = announcements.data?.state === "partial"
    || (
      contentFeedHasRetainedData
      && (
        yokAnnouncements.data?.state === "partial"
        || summerSchool.data?.contentState === "partial"
      )
    )
    || (
      contentFeedHasRetainedData
      && contentFeedSourceErrors.length > 0
      && contentFeedSourceErrors.length < 3
    );

  const contentFeedStale = Boolean(
    announcements.stale
    || announcements.data?.state === "stale"
    || (
      contentFeedHasRetainedData
      && (
        yokAnnouncements.stale
        || summerSchool.stale
        || yokAnnouncements.data?.state === "stale"
        || summerSchool.data?.contentState === "stale"
      )
    )
  );

  const contentFeedSecondaryLoading = yokAnnouncements.loading
    || summerSchool.loading;

  const contentFeedLoading = Boolean(
    announcements.loading
    || (contentFeedHasRetainedData && contentFeedSecondaryLoading)
  );

  const contentFeedAttempted = Boolean(announcements.attempted);

  const yokAvailabilityMessage = contentAvailabilityMessage(yokAnnouncements.data?.state, yokAnnouncements.stale);

  const summerAvailabilityMessage = contentAvailabilityMessage(summerSchool.data?.contentState, summerSchool.stale);

  const summerDateAvailabilityMessage = contentAvailabilityMessage(undefined, calendar.stale);

  const calendarAvailabilityMessage = contentAvailabilityMessage(undefined, calendar.stale);

  const upcomingAvailabilityMessage = contentAvailabilityMessage(undefined, upcoming.stale);

  const nextUpcomingEvent = useMemo(() => {
    const now = new Date();
    return (upcoming.data ?? [])
      .filter((event) => isAcademicTemporalCurrentOrFuture(event, now))
      .sort(compareAcademicTemporalStart)[0];
  }, [upcoming.data]);

  const todayEventCount = useMemo(() => {
    const today = new Date();
    return (calendar.data?.events ?? [])
      .filter((event) => isAcademicTemporalActiveOnDay(event, today))
      .length;
  }, [calendar.data?.events]);

  const nextExam = examCountdownItems[0];

  const selectedUniversity = useMemo(
    () => (universities.data ?? []).find((item) => item.id === registerUniversityId),
    [universities.data, registerUniversityId]
  );

  const additionalFollowedUniversities = useMemo(
    () => selectAdditionalUniversityFollows(
      followedUniversities.data ?? [],
      selectedUniversityId || registerUniversityId,
    ),
    [followedUniversities.data, registerUniversityId, selectedUniversityId],
  );

  const selectedFaculty = useMemo(
    () => (faculties.data ?? []).find((item) => item.id === registerFacultyId),
    [faculties.data, registerFacultyId]
  );

  const selectedDepartment = useMemo(
    () => (departments.data ?? []).find((item) => item.id === registerDepartmentId),
    [departments.data, registerDepartmentId]
  );

  const filteredUniversities = useMemo(() => {
    const query = universitySearch.trim().toLocaleLowerCase("tr-TR");
    const list = universities.data ?? [];
    if (!query) return list.slice(0, 30);

    return list
      .filter((item) => `${item.name} ${item.city}`.toLocaleLowerCase("tr-TR").includes(query))
      .slice(0, 30);
  }, [universities.data, universitySearch]);

  const filteredFaculties = useMemo(() => {
    const query = facultySearch.trim().toLocaleLowerCase("tr-TR");
    const list = faculties.data ?? [];
    if (!query) return list;

    return list.filter((item) => item.name.toLocaleLowerCase("tr-TR").includes(query));
  }, [faculties.data, facultySearch]);

  const filteredDepartments = useMemo(() => {
    const query = departmentSearch.trim().toLocaleLowerCase("tr-TR");
    const list = departments.data ?? [];
    if (!query) return list;

    return list.filter((item) => item.name.toLocaleLowerCase("tr-TR").includes(query));
  }, [departments.data, departmentSearch]);

  const registrationValidation = validateRegistrationForm({
    fullName,
    email,
    password,
    passwordConfirmation: registrationPasswordConfirmation
  });

  const loginValidation = validateLoginForm({ email, password });

  const registerIdentityReady = registrationValidation.valid;

  const loginReady = loginValidation.valid;

  const academicOnboardingDraft = useMemo<AcademicOnboardingDraft>(() => ({
    universityId: registerUniversityId,
    facultyId: registerFacultyId,
    departmentId: registerDepartmentId,
    classLevel: registerClassLevel
  }), [registerUniversityId, registerFacultyId, registerDepartmentId, registerClassLevel]);

  const academicProfileDirty = hasAcademicOnboardingChanges(
    onboardingInitialDraft,
    academicOnboardingDraft
  );

  const academicClassLevelOptions = useMemo(
    () => classLevelOptionsForAcademicDepartment(selectedDepartment),
    [selectedDepartment]
  );

  const academicProfileSummary = resolveAcademicProfileSummary(
    academicOnboardingDraft,
    {
      universityName: selectedUniversity?.name,
      facultyName: selectedFaculty?.name,
      departmentName: selectedDepartment?.name
    }
  );

  const initialNotificationPreference = useMemo(() => {
    const categories: Record<string, boolean> = {};
    for (const category of availableCategories) {
      categories[category] = preferences.data?.categories[category] !== false;
    }
    return {
      enabled: preferences.data?.enabled ?? false,
      mode: availableCategories.every((category) => categories[category] !== false)
        ? "all_calendar" as const
        : "selected_fields" as const,
      categories
    };
  }, [availableCategories, preferences.data]);

  const currentNotificationPreference = useMemo(() => ({
    enabled: alarmEnabled,
    mode: alarmMode,
    categories: categoryDraft
  }), [alarmEnabled, alarmMode, categoryDraft]);

  const notificationPreferenceDirty = hasNotificationPreferenceChanges(
    initialNotificationPreference,
    currentNotificationPreference
  );

  const notificationPreferenceSaveState: NotificationPreferenceSaveState =
    preferences.loading && !preferences.data
      ? "loading"
      : notificationPreferenceOutcome === "saving"
        ? "saving"
        : notificationPreferenceOutcome === "error" || Boolean(preferences.error)
          ? "error"
          : notificationPreferenceDirty
            ? "dirty"
            : "saved";

  const notificationTruth = resolveNotificationTruth({
    preferenceEnabled: notificationLifecycle.preferenceEnabled,
    permission: notificationLifecycle.permission,
    registration: notificationLifecycle.registration,
    saveState: notificationPreferenceSaveState,
    errorMessage: notificationPreferenceError ?? preferences.error
  });

  const googleCalendarPresentation = resolveGoogleCalendarPresentation(googleCalendarState);

  const appleCalendarPresentation = resolveAppleCalendarPresentation(appleCalendarState);

  const verificationTiming = pendingVerification
    ? getVerificationTiming(pendingVerification, verificationClockMs)
    : null;

  const passwordRecoveryTiming = pendingPasswordRecovery
    ? getPasswordRecoveryTiming(pendingPasswordRecovery, passwordRecoveryClockMs)
    : null;

  const passwordRecoveryRequestReady = isValidPasswordRecoveryEmail(email);

  const passwordRecoveryConfirmationValidation = validatePasswordRecoveryConfirmation({
    code: passwordRecoveryCode,
    newPassword,
    passwordConfirmation
  });

  const passwordRecoveryConfirmReady = passwordRecoveryConfirmationValidation.valid
    && !passwordRecoveryTiming?.expired;

  const currentRouteOwner = accountGuardRef.current.capture();

  const rootRouteResolution = resolveRootRoute({
    hydrationStatus,
    sessionOwner: session ? sessionOwner : null,
    currentOwner: currentRouteOwner,
    authMode,
    authStage,
    hasPendingVerification: Boolean(pendingVerification),
    hasPendingPasswordRecovery: Boolean(pendingPasswordRecovery)
  });

  const shouldShowPreloginWelcome = hydrationStatus === "ready"
    && !session
    && (preloginWelcomeGate === "pending" || preloginWelcomeGate === "saving")
    && rootRouteResolution.surface === "auth"
    && authMode === "login"
    && authStage === "auth"
    && !pendingVerification
    && !pendingPasswordRecovery;

  const navigatorRootSurface: AppRootSurface = shouldShowPreloginWelcome
    ? "introduction"
    : rootRouteResolution.surface === "hydration"
      ? rootRouteResolution.route.name === "Hydration" && rootRouteResolution.route.params.status === "error"
        ? "hydration_error"
        : "hydration_loading"
      : authenticatedContextPending
        && (rootRouteResolution.surface === "authenticated" || rootRouteResolution.surface === "onboarding")
        ? "hydration_loading"
        : rootRouteResolution.surface === "authenticated"
          ? "authenticated"
          : rootRouteResolution.surface === "onboarding"
            ? "onboarding"
            : "auth";

  const expectedBaseRoute: AppVisibleRoute = navigatorRootSurface === "hydration_loading"
    ? "BootstrapLoading"
    : navigatorRootSurface === "hydration_error"
      ? "BootstrapError"
      : navigatorRootSurface === "introduction"
        ? "Introduction"
        : navigatorRootSurface === "authenticated"
          ? routeForLegacyTab(activeTab)
          : visibleRouteForResolvedRoot(rootRouteResolution.route);

  const controlledActiveRoute = navigatorRootSurface === "authenticated"
    ? (AUTHENTICATED_ROUTE_NAMES.has(activeRoute) ? activeRoute : expectedBaseRoute)
    : navigatorRootSurface === "introduction"
      ? "Introduction"
      : navigatorRootSurface === "auth"
        ? (AUTH_ROUTE_NAMES.has(activeRoute) ? activeRoute : expectedBaseRoute)
        : navigatorRootSurface === "onboarding"
          ? "AcademicOnboarding"
          : expectedBaseRoute;

  const googleCalendarLive = Boolean(
    googleCalendarIntegration
    && (googleCalendarState === "connected" || googleCalendarState === "partial")
    && googleCalendarIntegration.authorizationVerifiedAt
  );

  return {
    accessToken,
    availableRecentAuthMethods,
    googleCalendarService,
    availableCategories,
    examCountdownItems,
    announcementFeed,
    yokAnnouncementItems,
    summerSchoolEvents,
    universityAcademicCalendarEvents,
    summerSchoolAnnouncements,
    contentFeedHasRetainedData,
    contentFeedHasMore,
    contentFeedSecondaryErrors,
    contentFeedSourceErrors,
    contentFeedError,
    contentFeedPartial,
    contentFeedStale,
    contentFeedSecondaryLoading,
    contentFeedLoading,
    contentFeedAttempted,
    yokAvailabilityMessage,
    summerAvailabilityMessage,
    summerDateAvailabilityMessage,
    calendarAvailabilityMessage,
    upcomingAvailabilityMessage,
    nextUpcomingEvent,
    todayEventCount,
    nextExam,
    selectedUniversity,
    additionalFollowedUniversities,
    selectedFaculty,
    selectedDepartment,
    filteredUniversities,
    filteredFaculties,
    filteredDepartments,
    registrationValidation,
    loginValidation,
    registerIdentityReady,
    loginReady,
    academicOnboardingDraft,
    academicProfileDirty,
    academicClassLevelOptions,
    academicProfileSummary,
    initialNotificationPreference,
    currentNotificationPreference,
    notificationPreferenceDirty,
    notificationPreferenceSaveState,
    notificationTruth,
    googleCalendarPresentation,
    appleCalendarPresentation,
    verificationTiming,
    passwordRecoveryTiming,
    passwordRecoveryRequestReady,
    passwordRecoveryConfirmationValidation,
    passwordRecoveryConfirmReady,
    currentRouteOwner,
    rootRouteResolution,
    shouldShowPreloginWelcome,
    navigatorRootSurface,
    expectedBaseRoute,
    controlledActiveRoute,
    googleCalendarLive
  };
}

export type ApplicationDerivedState = ReturnType<typeof useApplicationDerivedState>;
