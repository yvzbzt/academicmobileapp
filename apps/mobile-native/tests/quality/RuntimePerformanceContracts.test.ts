import fs from "node:fs";
import path from "node:path";

describe("mobile runtime performance contracts", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
  const navigatorSource = fs.readFileSync(
    path.resolve(__dirname, "../../src/navigation/AppNavigator.tsx"),
    "utf8",
  );
  it("warms only Home data while the initial shell becomes interactive", () => {
    const warmup = appSource.slice(
      appSource.indexOf("function warmAuthenticatedContext"),
      appSource.indexOf("async function bootstrapAuthenticatedContext"),
    );

    expect(warmup).toContain("loadMyCalendar");
    expect(warmup).not.toContain("loadAnnouncements");
    expect(warmup).toContain("InteractionManager.runAfterInteractions");
    expect(warmup).toContain("}, 1_500)");
    expect(warmup).not.toContain("loadYokAnnouncements");
    expect(warmup).not.toContain("loadSummerSchool");
  });

  it("starts the user announcement feed when the announcements experience becomes visible", () => {
    const visibilityEffect = appSource.slice(
      appSource.indexOf("const announcementsExperienceVisible"),
      appSource.indexOf("const needsPublicCatalog"),
    );
    const userFeedLoad = visibilityEffect.indexOf("loadAnnouncements(undefined, registerUniversityId)");
    const deferredSecondaryStart = visibilityEffect.indexOf("InteractionManager.runAfterInteractions");
    const deferredSecondaryLoads = visibilityEffect.slice(deferredSecondaryStart);

    expect(visibilityEffect).toContain("activeTab === \"announcements\"");
    expect(userFeedLoad).toBeGreaterThan(0);
    expect(deferredSecondaryStart).toBeGreaterThan(userFeedLoad);
    expect(visibilityEffect).toContain("if (announcements.loading || !announcements.attempted) return");
    expect(visibilityEffect).toContain("}, 1_200)");
    expect(deferredSecondaryLoads).toContain("loadYokAnnouncements");
    expect(deferredSecondaryLoads).toContain("loadSummerSchool");
  });

  it("does not eager-load announcements while saving academic profile changes", () => {
    const universitySelection = appSource.slice(
      appSource.indexOf("async function selectUniversity"),
      appSource.indexOf("async function selectFaculty"),
    );
    const facultySelection = appSource.slice(
      appSource.indexOf("async function selectFaculty"),
      appSource.indexOf("async function selectDepartment"),
    );
    const departmentSelection = appSource.slice(
      appSource.indexOf("async function selectDepartment"),
      appSource.indexOf("async function loadMyCalendar"),
    );
    const profileSave = appSource.slice(
      appSource.indexOf("async function saveAcademicProfileSettings"),
      appSource.indexOf("function renderAuthOnboardingScreen"),
    );

    expect(universitySelection).not.toContain("loadAnnouncements");
    expect(facultySelection).not.toContain("loadAnnouncements");
    expect(departmentSelection).not.toContain("loadAnnouncements");
    expect(profileSave).not.toContain("loadAnnouncements");
  });

  it("does not gate the main announcements tab on secondary feeds", () => {
    const feedState = appSource.slice(
      appSource.indexOf("const contentFeedHasRetainedData"),
      appSource.indexOf("const yokAvailabilityMessage"),
    );

    expect(feedState).toContain("const contentFeedAttempted = Boolean(announcements.attempted)");
    expect(feedState).toContain("contentFeedHasRetainedData && contentFeedSecondaryLoading");
    expect(feedState).not.toContain("announcements.attempted\n    && yokAnnouncements.attempted");
  });

  it("restores independent authenticated startup state concurrently", () => {
    const hydration = appSource.slice(
      appSource.indexOf("async function hydrateApplication"),
      appSource.indexOf("async function restoreSession"),
    );

    expect(hydration).toContain("restoreSession(storedSessionValue)");
    expect(hydration).toContain("const [contextReady] = await Promise.all([");
    expect(hydration).toContain("bootstrapAuthenticatedContext(restoredSession.accessToken, snapshot)");
    expect(hydration).toContain("restoreManualExams(restoredSession.user.id, snapshot).catch");
    expect(hydration).toContain("restoreGoogleCalendarConnection(restoredSession.user.id, snapshot).catch");
  });

  it("keeps startup lazy and freezes inactive tab trees after navigation", () => {
    expect(navigatorSource).not.toContain("navigation.preload(route)");
    expect(navigatorSource).toContain("freezeOnBlur: true");
    expect(navigatorSource).toContain("lazy: true");
  });

  it("does not replay delayed controlled routes into authenticated tab navigation", () => {
    const controlledRouteEffect = navigatorSource.slice(
      navigatorSource.indexOf("if (!ready || !navigationRef.isReady()) return"),
      navigatorSource.indexOf("}, [activeRoute, ready, rootSurface])"),
    );

    expect(controlledRouteEffect).toContain('if (rootSurface === "authenticated") return');
  });

  it("keeps Android bottom tab presses responsive before press release can be cancelled", () => {
    const shellTabBar = navigatorSource.slice(
      navigatorSource.indexOf("function ShellBottomTabBar"),
      navigatorSource.indexOf("function renderShellBottomTabBar"),
    );

    expect(shellTabBar).toContain("lastAndroidTabPressRef");
    expect(shellTabBar).toContain("<TouchableOpacity");
    expect(shellTabBar).toContain("delayPressIn={0}");
    expect(shellTabBar).toContain("onPressIn={Platform.OS === \"android\" ? onPress : undefined}");
    expect(shellTabBar).toContain("TabActions.jumpTo(route.name, route.params)");
    expect(shellTabBar).toContain("ANDROID_TAB_PRESS_DEDUPE_MS");
    expect(shellTabBar).toContain("ANDROID_TAB_PRESS_RETRY_DELAY_MS");
    expect(shellTabBar).toContain("tabState.index !== targetIndex");
    expect(shellTabBar).not.toContain("<Pressable");
  });

  it("does not block Google sign-in on a provider sign-out", () => {
    const googleStart = appSource.indexOf("const nativeAuth = await enqueueGoogleSdkOperation");
    const providerSignIn = appSource.indexOf("const result = await GoogleSignin.signIn()", googleStart);
    const providerPreparation = appSource.slice(googleStart, providerSignIn);

    expect(googleStart).toBeGreaterThan(0);
    expect(providerSignIn).toBeGreaterThan(googleStart);
    expect(providerPreparation).toContain("GoogleSignin.hasPlayServices");
    expect(providerPreparation).not.toContain("clearGoogleAccountSelection");
    expect(appSource).toContain("offlineAccess: false");
  });
});
