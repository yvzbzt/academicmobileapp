import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  ScrollView,
  Text,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  act,
  fireEvent,
  renderAsync,
  screen,
  waitFor,
} from "@testing-library/react-native";
import {
  AppNavigator,
  type AppNavigationRequest,
  type AppNavigatorProps,
  type AppScreenSlots,
  type AppVisibleRoute,
} from "../../src/navigation/AppNavigator";
import { ThemeProvider } from "../../src/design-system/theme";
import { darkTheme, lightTheme } from "../../src/design-system/tokens";
import { HomeDailyBrief } from "../../src/home/HomeDailyBrief";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";
import { resolveNavigationTheme } from "../../src/navigation/navigation-theme";
import {
  parseAcademicPulseRouteUrl,
  RouteIntentCoordinator,
  resolveRootRoute,
  type AppRouteIntent,
  type RouteOwner,
} from "../../src/navigation";

const visibleRoutes: AppVisibleRoute[] = [
  "BootstrapLoading",
  "BootstrapError",
  "Introduction",
  "Login",
  "Register",
  "Verification",
  "PasswordRecoveryRequest",
  "PasswordRecoveryCode",
  "PasswordRecoveryConfirm",
  "AcademicOnboarding",
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
  "UnknownRoute",
];

function createScreenSlots(): AppScreenSlots {
  return Object.fromEntries(
    visibleRoutes.map((route) => [
      route,
      <Text key={route} accessibilityRole="header">
        {`SCREEN:${route}`}
      </Text>,
    ]),
  ) as unknown as AppScreenSlots;
}

const screens = createScreenSlots();

interface TestSafeAreaMetrics {
  frame: { x: number; y: number; width: number; height: number };
  insets: { top: number; right: number; bottom: number; left: number };
}

interface NavigatorHarnessProps extends AppNavigatorProps {
  safeAreaMetrics?: TestSafeAreaMetrics;
}

function TabBarHeightEvidence() {
  const tabBarHeight = useBottomTabBarHeight();
  return (
    <>
      <Text accessibilityRole="header">SCREEN:Home</Text>
      <Text>{`TAB_HEIGHT:${tabBarHeight}`}</Text>
    </>
  );
}

function createProductionHomeScreens(): AppScreenSlots {
  return {
    ...screens,
    Home: (
      <HomeDailyBrief
        fullName="Deniz Yılmaz"
        profileComplete
        universityName="Örnek Üniversitesi"
        facultyName="Mühendislik Fakültesi"
        departmentName="Bilgisayar Mühendisliği"
        events={[
          {
            id: "today-registration",
            title: "Ders kayıtları",
            category: "course_registration",
            temporalKind: "date",
            startDate: "2026-08-04",
          },
          {
            id: "future-exam",
            title: "Final sınavı",
            category: "final_exam",
            temporalKind: "timestamp",
            startDate: "2026-08-06T06:30:00.000Z",
          },
        ]}
        manualExams={[]}
        announcements={[
          trustedHomeItem("important", "Ders kayıt tarihleri açıklandı", "2026-08-03T09:00:00.000Z"),
          trustedHomeItem("recent-1", "Kampüs yaşamından haberler", "2026-08-04T08:00:00.000Z"),
          trustedHomeItem("recent-2", "Kütüphane çalışma saatleri", "2026-08-02T08:00:00.000Z"),
          trustedHomeItem("recent-3", "Öğrenci toplulukları buluşması", "2026-08-01T08:00:00.000Z"),
        ]}
        calendarLoading={false}
        calendarAttempted
        announcementLoading={false}
        announcementAttempted
        announcementState="fresh"
        googleCalendarState="connected"
        notificationPermission="granted"
        notificationPreferenceEnabled
        notificationActive
        now={new Date("2026-08-04T09:00:00+03:00")}
        onCompleteProfile={jest.fn()}
        onOpenAnnouncement={jest.fn()}
        onOpenAnnouncements={jest.fn()}
        onOpenCalendar={jest.fn()}
        onCreatePersonalEvent={jest.fn()}
        onOpenGoogleCalendarSettings={jest.fn()}
        onOpenNotificationSettings={jest.fn()}
        onRefresh={jest.fn()}
      />
    ),
  };
}

function createTabBarEvidenceScreens(): AppScreenSlots {
  return { ...screens, Home: <TabBarHeightEvidence /> };
}

function trustedHomeItem(id: string, title: string, publishedAt: string): TrustedMobileContentRecord {
  const canonicalUrl = `https://example.edu.tr/duyuru/${id}`;
  const officialSourceUrl = "https://example.edu.tr/duyurular";
  return {
    id,
    sourceId: "trusted-student-affairs",
    sourceName: "Öğrenci İşleri Daire Başkanlığı",
    scopeType: "university",
    scopeId: "university-1",
    contentType: "announcement",
    title,
    summary: "Doğrulanmış akademik içerik özeti.",
    link: canonicalUrl,
    canonicalUrl,
    officialSourceUrl,
    sourceRelationships: [{
      sourceId: "trusted-student-affairs",
      sourceName: "Öğrenci İşleri Daire Başkanlığı",
      officialSourceUrl,
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl,
    }],
    publicationKind: "timestamp",
    publishedAt,
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}

function currentProductionListOffset(list: FlatList<unknown>): number | undefined {
  return (list as unknown as {
    _listRef?: { _scrollMetrics?: { offset?: number } };
  })._listRef?._scrollMetrics?.offset;
}

const primaryTabRoutes = [
  { label: "Ana Sayfa", route: "Home" },
  { label: "Duyurular", route: "Announcements" },
  { label: "Takvim", route: "Calendar" },
  { label: "Ayarlar", route: "Profile" },
] as const satisfies ReadonlyArray<{
  label: string;
  route: AppVisibleRoute;
}>;

function NavigatorHarness({ safeAreaMetrics, screens: screenSlots, ...props }: NavigatorHarnessProps) {
  const stableScreens = useMemo(() => screenSlots, [screenSlots]);
  return (
    <SafeAreaProvider {...(safeAreaMetrics ? { initialMetrics: safeAreaMetrics } : {})}>
      <ThemeProvider
        liquidGlassAvailable={false}
        platform="android"
        preference="light"
        reducedMotion
        reducedTransparency={false}
        systemMode="light"
        windowWidth={390}
      >
        <AppNavigator {...props} screens={stableScreens} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

interface ProductionRoutingHarnessProps {
  hydrationStatus: "loading" | "ready" | "error";
  sessionOwner: RouteOwner | null;
  currentOwner: RouteOwner | null;
  authStage?: "auth" | "academic_onboarding";
  contextReady?: boolean;
  delivery?: { token: string; intent: AppRouteIntent; recipientOwnerId?: string } | null;
  navigationLocked?: boolean;
  onAcknowledged: (key: string) => void;
}

function ProductionRoutingHarness({
  hydrationStatus,
  sessionOwner,
  currentOwner,
  authStage = "auth",
  contextReady = true,
  delivery,
  navigationLocked = false,
  onAcknowledged,
}: ProductionRoutingHarnessProps) {
  const coordinatorRef = useRef(new RouteIntentCoordinator());
  const unclaimedIntentRef = useRef<ProductionRoutingHarnessProps["delivery"]>(null);
  const previousExactOwnerRef = useRef<RouteOwner | null>(null);
  const [request, setRequest] = useState<AppNavigationRequest | null>(null);
  const [activeRoute, setActiveRoute] = useState<AppVisibleRoute>("BootstrapLoading");
  const resolution = resolveRootRoute({
    hydrationStatus,
    sessionOwner,
    currentOwner,
    authMode: "login",
    authStage,
    hasPendingVerification: false,
    hasPendingPasswordRecovery: false,
  });
  const exactOwner = sessionOwner
    && currentOwner
    && sessionOwner.ownerId === currentOwner.ownerId
    && sessionOwner.generation === currentOwner.generation
    ? currentOwner
    : null;
  const rootSurface = resolution.surface === "hydration"
    ? hydrationStatus === "error" ? "hydration_error" : "hydration_loading"
    : !contextReady && (resolution.surface === "authenticated" || resolution.surface === "onboarding")
      ? "hydration_loading"
      : resolution.surface === "authenticated"
        ? "authenticated"
        : resolution.surface === "onboarding"
          ? "onboarding"
          : "auth";
  const baseRoute: AppVisibleRoute = rootSurface === "hydration_loading"
    ? "BootstrapLoading"
    : rootSurface === "hydration_error"
      ? "BootstrapError"
      : rootSurface === "authenticated"
        ? "Home"
        : rootSurface === "onboarding"
          ? "AcademicOnboarding"
          : "Login";

  useEffect(() => {
    const previousOwner = previousExactOwnerRef.current;
    if (
      previousOwner
      && (!exactOwner
        || previousOwner.ownerId !== exactOwner.ownerId
        || previousOwner.generation !== exactOwner.generation)
    ) {
      coordinatorRef.current.invalidate(previousOwner.ownerId, previousOwner.generation);
      unclaimedIntentRef.current = null;
      setRequest(null);
    }
    previousExactOwnerRef.current = exactOwner;
  }, [exactOwner?.ownerId, exactOwner?.generation]);

  useEffect(() => {
    if (!delivery) return;
    if (!exactOwner) {
      unclaimedIntentRef.current = delivery;
      return;
    }
    if (delivery.recipientOwnerId && delivery.recipientOwnerId !== exactOwner.ownerId) {
      unclaimedIntentRef.current = null;
      return;
    }
    coordinatorRef.current.enqueue(delivery.intent, exactOwner);
  }, [delivery?.token]);

  useEffect(() => {
    if (!exactOwner) return;
    const unclaimed = unclaimedIntentRef.current;
    if (unclaimed) {
      unclaimedIntentRef.current = null;
      if (!unclaimed.recipientOwnerId || unclaimed.recipientOwnerId === exactOwner.ownerId) {
        coordinatorRef.current.enqueue(unclaimed.intent, exactOwner);
      }
    }
    if (rootSurface !== "authenticated") return;
    const selected = coordinatorRef.current.consumeFor(exactOwner.ownerId, exactOwner.generation);
    if (!selected) return;
    setRequest(navigationRequestForIntent(selected, `intent:${delivery?.token ?? "resumed"}`));
  }, [delivery?.token, exactOwner?.ownerId, exactOwner?.generation, rootSurface]);

  return (
    <NavigatorHarness
      activeRoute={rootSurface === "authenticated" && isProtectedVisibleRoute(activeRoute)
        ? activeRoute
        : baseRoute}
      navigationLocked={navigationLocked}
      onRequestHandled={(key) => {
        onAcknowledged(key);
        setRequest(null);
      }}
      onVisibleRouteChange={setActiveRoute}
      request={request}
      rootSurface={rootSurface}
      screens={screens}
    />
  );
}

function navigationRequestForIntent(intent: AppRouteIntent, key: string): AppNavigationRequest {
  switch (intent.route.name) {
    case "AnnouncementDetail":
      return { key, route: "AnnouncementDetail", params: { announcementId: intent.route.params.announcementId } };
    case "CalendarEventDetail":
      return { key, route: "CalendarEventDetail", params: { eventId: intent.route.params.eventId } };
    case "Unknown":
      return { key, route: "UnknownRoute" };
    default:
      return { key, route: intent.route.name };
  }
}

function isProtectedVisibleRoute(route: AppVisibleRoute): boolean {
  return ![
    "BootstrapLoading", "BootstrapError", "Login", "Register", "Verification",
    "PasswordRecoveryRequest", "PasswordRecoveryCode", "PasswordRecoveryConfirm",
    "AcademicOnboarding", "UnknownRoute",
  ].includes(route);
}

async function renderNavigator(
  props: Omit<AppNavigatorProps, "screens">,
  options: { screenSlots?: AppScreenSlots; safeAreaMetrics?: TestSafeAreaMetrics } = {},
) {
  return renderAsync(
    <NavigatorHarness
      {...props}
      screens={options.screenSlots ?? screens}
      {...(options.safeAreaMetrics ? { safeAreaMetrics: options.safeAreaMetrics } : {})}
    />,
  );
}

function getTabControl(label: string) {
  return screen.getByRole("button", { name: label });
}

function getTabBarContainer() {
  const customBar = screen.queryByLabelText("Ana gezinme", {
    includeHiddenElements: true,
  });
  if (customBar) return customBar;
  let node = getTabControl("Ana Sayfa");
  while (node.parent && node.props.pointerEvents !== "auto" && node.props.pointerEvents !== "none") {
    node = node.parent;
  }
  return node;
}

async function pressTab(label: string) {
  await act(async () => {
    fireEvent.press(getTabControl(label));
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  });
}

function expectSelectedTab(label: string) {
  for (const tab of primaryTabRoutes) {
    const control = getTabControl(tab.label);
    if (tab.label === label) expect(control).toBeSelected();
    else expect(control).not.toBeSelected();
  }
}

function expectPrimaryTabsHidden() {
  expect(screen.queryByLabelText("Ana gezinme", { includeHiddenElements: true })).toBeNull();
  for (const tab of primaryTabRoutes) {
    expect(screen.queryByRole("button", { name: tab.label })).toBeNull();
  }
}

async function expectVisibleRoute(route: AppVisibleRoute) {
  await waitFor(() => {
    expect(
      screen.getByRole("header", { name: `SCREEN:${route}` }),
    ).toBeVisible();
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  });
}

function captureHardwareBackHandlers() {
  const handlers: Array<() => boolean | null | undefined> = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((event, handler) => {
    if (event === "hardwareBackPress") handlers.push(handler);
    return { remove: jest.fn() };
  });
  return handlers;
}

function captureKeyboardHandlers() {
  const handlers: Record<string, Array<() => void>> = {};
  jest.spyOn(Keyboard, "addListener").mockImplementation((event, listener) => {
    (handlers[event] ??= []).push(() => listener({} as never));
    return { remove: jest.fn() } as never;
  });
  return handlers;
}

describe("AppNavigator", () => {
  it("maps both system appearances to semantic navigation surfaces", () => {
    expect(resolveNavigationTheme(lightTheme)).toMatchObject({
      dark: false,
      colors: {
        background: lightTheme.colors.background.canvas,
        border: lightTheme.colors.border.subtle,
        card: lightTheme.colors.background.surfaceRaised,
        notification: lightTheme.colors.status.error,
        primary: lightTheme.colors.action.primary,
        text: lightTheme.colors.text.primary,
      },
    });
    expect(resolveNavigationTheme(darkTheme)).toMatchObject({
      dark: true,
      colors: {
        background: darkTheme.colors.background.canvas,
        border: darkTheme.colors.border.subtle,
        card: darkTheme.colors.background.surfaceRaised,
        notification: darkTheme.colors.status.error,
        primary: darkTheme.colors.action.primary,
        text: darkTheme.colors.text.primary,
      },
    });
  });

  it("renders Login as a fixed viewport without a scrolling container", async () => {
    await renderNavigator({
      activeRoute: "Login",
      rootSurface: "auth",
    });

    await expectVisibleRoute("Login");
    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
    expect(screen.UNSAFE_getAllByType(SafeAreaView).some((view) => (
      view.props.edges?.includes("top")
      && view.props.edges?.includes("left")
      && view.props.edges?.includes("right")
      && !view.props.edges?.includes("bottom")
    ))).toBe(true);
  });

  it("exposes Introduction and replaces it with the auth root without back history", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onVisibleRouteChange = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Introduction",
      onVisibleRouteChange,
      rootSurface: "introduction",
    });

    await expectVisibleRoute("Introduction");
    expectPrimaryTabsHidden();

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Login"
        onVisibleRouteChange={onVisibleRouteChange}
        rootSurface="auth"
        screens={screens}
      />,
    );

    await expectVisibleRoute("Login");
    expect(screen.queryByRole("header", { name: "SCREEN:Introduction" })).toBeNull();
    expectPrimaryTabsHidden();
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Introduction");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Login");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]!()).toBe(false);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Login");
  });

  it("announces headerless roots and focuses the real heading on pushed routes", async () => {
    const focusSpy = jest
      .spyOn(AccessibilityInfo, "setAccessibilityFocus")
      .mockImplementation(() => undefined);
    const announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);

    try {
      const authenticated = await renderNavigator({
        activeRoute: "Home",
        rootSurface: "authenticated",
      });
      await expectVisibleRoute("Home");
      expect(screen.queryByRole("header", { name: "Ana Sayfa" })).toBeNull();
      const homeRoot = screen.getByTestId("home-root-surface");
      expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toContain("top");
      expect(homeRoot).toHaveStyle({ backgroundColor: "#0758E9" });
      await waitFor(() => {
        expect(announceSpy).toHaveBeenLastCalledWith("Ana Sayfa ekranı");
      });
      announceSpy.mockClear();

      await authenticated.rerenderAsync(
        <NavigatorHarness
          activeRoute="Home"
          request={{ key: "open-summer-school-heading", route: "SummerSchool" }}
          rootSurface="authenticated"
          screens={screens}
        />,
      );
      await expectVisibleRoute("SummerSchool");
      focusSpy.mockClear();
      fireEvent(screen.getByRole("header", { name: "Yaz Okulu" }), "layout", {
        nativeEvent: { layout: { height: 32, width: 160, x: 0, y: 0 } },
        target: 502,
      });
      expect(focusSpy).toHaveBeenLastCalledWith(502);
      expect(announceSpy).not.toHaveBeenCalled();

      await authenticated.unmountAsync();
      announceSpy.mockClear();
      await renderNavigator({
        activeRoute: "Login",
        rootSurface: "auth",
      });
      await expectVisibleRoute("Login");
      await waitFor(() => {
        expect(announceSpy).toHaveBeenLastCalledWith("Giriş ekranı");
      });
    } finally {
      focusSpy.mockRestore();
      announceSpy.mockRestore();
    }
  });

  it("announces the Profile root with its visible title", async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);

    try {
      const view = await renderNavigator({
        activeRoute: "Profile",
        rootSurface: "authenticated",
      });
      await expectVisibleRoute("Profile");
      await waitFor(() => {
        expect(announceSpy).toHaveBeenLastCalledWith("Profil ekranı");
      });
      await view.unmountAsync();
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("acknowledges a visible auth route once even after an intervening request", async () => {
    const lifecycle: string[] = [];
    const onRequestHandled = jest.fn((key: string) => lifecycle.push(`handled:${key}`));
    const onVisibleRouteChange = jest.fn((route: AppVisibleRoute) => lifecycle.push(`visible:${route}`));
    const request: AppNavigationRequest = {
      key: "open-register",
      route: "Register",
    };

    const view = await renderNavigator({
      activeRoute: "Login",
      onRequestHandled,
      onVisibleRouteChange,
      rootSurface: "auth",
    });
    await expectVisibleRoute("Login");
    lifecycle.length = 0;

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Login"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={request}
        rootSurface="auth"
        screens={screens}
      />,
    );

    await expectVisibleRoute("Register");
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
    expect(onRequestHandled).toHaveBeenCalledWith("open-register");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Register");
    expect(lifecycle.indexOf("visible:Register")).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf("handled:open-register"))
      .toBeGreaterThan(lifecycle.indexOf("visible:Register"));

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Login"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={{ key: "return-login", route: "Login" }}
        rootSurface="auth"
        screens={screens}
      />,
    );
    await expectVisibleRoute("Login");
    expect(onRequestHandled.mock.calls).toEqual([
      ["open-register"],
      ["return-login"],
    ]);

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Login"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={{ ...request }}
        rootSurface="auth"
        screens={screens}
      />,
    );
    await expectVisibleRoute("Login");
    expect(onRequestHandled.mock.calls).toEqual([
      ["open-register"],
      ["return-login"],
    ]);
  });

  it("registers the recovery code step and academic onboarding stack", async () => {
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "PasswordRecoveryRequest",
      onRequestHandled,
      rootSurface: "auth",
    });
    await expectVisibleRoute("PasswordRecoveryRequest");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="PasswordRecoveryRequest"
        onRequestHandled={onRequestHandled}
        request={{ key: "open-recovery-code", route: "PasswordRecoveryCode" }}
        rootSurface="auth"
        screens={screens}
      />,
    );
    await expectVisibleRoute("PasswordRecoveryCode");
    expect(onRequestHandled).toHaveBeenCalledWith("open-recovery-code");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="PasswordRecoveryCode"
        onRequestHandled={onRequestHandled}
        request={{ key: "open-recovery-confirm", route: "PasswordRecoveryConfirm" }}
        rootSurface="auth"
        screens={screens}
      />,
    );
    await expectVisibleRoute("PasswordRecoveryConfirm");
    expect(onRequestHandled).toHaveBeenCalledWith("open-recovery-confirm");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="AcademicOnboarding"
        onRequestHandled={onRequestHandled}
        rootSurface="onboarding"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AcademicOnboarding");
  });

  it("keeps exactly four Turkish tab routes without an unrelated center action", async () => {
    await renderNavigator({
      activeRoute: "Home",
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Home");

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Takvime yeni öğe ekle" })).toBeNull();
    expectSelectedTab("Ana Sayfa");

    for (const tab of primaryTabRoutes.slice(1)) {
      await pressTab(tab.label);
      await expectVisibleRoute(tab.route);
      expectSelectedTab(tab.label);
    }

    await pressTab("Ana Sayfa");
    await expectVisibleRoute("Home");
    expectSelectedTab("Ana Sayfa");
  });

  it("exposes four accessible authenticated tabs and switches their routes", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onVisibleRouteChange = jest.fn();
    await renderNavigator({
      activeRoute: "Home",
      onVisibleRouteChange,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Home");

    for (const label of ["Ana Sayfa", "Duyurular", "Takvim", "Ayarlar"]) {
      expect(getTabControl(label)).toBeVisible();
    }
    expectSelectedTab("Ana Sayfa");

    await pressTab("Duyurular");
    await expectVisibleRoute("Announcements");
    expectSelectedTab("Duyurular");

    await pressTab("Takvim");
    await expectVisibleRoute("Calendar");
    expectSelectedTab("Takvim");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Announcements");
    expectSelectedTab("Duyurular");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Announcements");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Calendar");
  });

  it("opens an announcement detail request and returns to its list", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Announcements",
      onRequestHandled,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Announcements");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onRequestHandled={onRequestHandled}
        request={{
          key: "announcement-42",
          params: { announcementId: "42" },
          route: "AnnouncementDetail",
        }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );

    await expectVisibleRoute("AnnouncementDetail");
    expect(screen.getAllByRole("header", { name: "Duyuru Detayı" })).toHaveLength(1);
    expectPrimaryTabsHidden();
    expect(onRequestHandled).toHaveBeenCalledWith("announcement-42");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Announcements");
    expectSelectedTab("Duyurular");
  });

  it("leaves Notification Settings chrome to its exact in-screen top bar", async () => {
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Profile",
      onRequestHandled,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Profile");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Profile"
        onRequestHandled={onRequestHandled}
        request={{ key: "open-notification-settings", route: "NotificationSettings" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );

    await expectVisibleRoute("NotificationSettings");
    expect(screen.queryByRole("header", { name: "Bildirim tercihleri" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Geri dön" })).toBeNull();
    expect(screen.UNSAFE_getAllByType(SafeAreaView).some((view) => (
      view.props.edges?.includes("top") && view.props.edges?.includes("bottom")
    ))).toBe(true);
    expectPrimaryTabsHidden();
    expect(onRequestHandled).toHaveBeenCalledWith("open-notification-settings");
  });

  it("keeps Summer School and YÖK reachable inside the Announcements tab", async () => {
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Announcements",
      onRequestHandled,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Announcements");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onRequestHandled={onRequestHandled}
        request={{ key: "summer-school", route: "SummerSchool" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("SummerSchool");
    expectPrimaryTabsHidden();

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onRequestHandled={onRequestHandled}
        request={{ key: "yok-announcements", route: "YokAnnouncements" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("YokAnnouncements");
    expectPrimaryTabsHidden();
    expect(onRequestHandled.mock.calls).toEqual([
      ["summer-school"],
      ["yok-announcements"],
    ]);
  });

  it("hides primary tabs on detail routes and restores them after Back", async () => {
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Announcements",
      onRequestHandled,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Announcements");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onRequestHandled={onRequestHandled}
        request={{
          key: "announcement-history",
          params: { announcementId: "announcement-42" },
          route: "AnnouncementDetail",
        }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AnnouncementDetail");
    expectPrimaryTabsHidden();

    fireEvent.press(screen.getByRole("button", { name: "Geri dön" }));
    await expectVisibleRoute("Announcements");
    expectSelectedTab("Duyurular");
    await pressTab("Takvim");
    await expectVisibleRoute("Calendar");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onRequestHandled={onRequestHandled}
        request={{
          key: "calendar-history",
          params: { eventId: "event-17" },
          route: "CalendarEventDetail",
        }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("CalendarEventDetail");
    expectPrimaryTabsHidden();
    fireEvent.press(screen.getByRole("button", { name: "Geri dön" }));
    await expectVisibleRoute("Calendar");
    expectSelectedTab("Takvim");
    expect(onRequestHandled.mock.calls).toEqual([
      ["announcement-history"],
      ["calendar-history"],
    ]);
  });

  it("returns from a nested destination without exposing an overlapping tab reselect", async () => {
    const onVisibleRouteChange = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Announcements",
      onVisibleRouteChange,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Announcements");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onVisibleRouteChange={onVisibleRouteChange}
        request={{
          key: "reselect-announcement",
          params: { announcementId: "announcement-42" },
          route: "AnnouncementDetail",
        }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AnnouncementDetail");
    expectPrimaryTabsHidden();

    fireEvent.press(screen.getByRole("button", { name: "Geri dön" }));
    await expectVisibleRoute("Announcements");
    expectSelectedTab("Duyurular");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("AnnouncementDetail");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Announcements");
  });

  it("keeps repeated Home root taps on the virtualized root without adding history", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onVisibleRouteChange = jest.fn();
    await renderNavigator({
      activeRoute: "Home",
      onVisibleRouteChange,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Home");
    const visibleRouteCallCount = onVisibleRouteChange.mock.calls.length;

    await pressTab("Ana Sayfa");
    await pressTab("Ana Sayfa");

    expect(onVisibleRouteChange).toHaveBeenCalledTimes(visibleRouteCallCount);
    expectSelectedTab("Ana Sayfa");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(false);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Home");
  });

  it("reselects the current root FlatList to top while preserving it across tab switches", async () => {
    const view = await renderNavigator(
      { activeRoute: "Home", rootSurface: "authenticated" },
      { screenSlots: createProductionHomeScreens() },
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Öğrenci günlük özeti")).toBeVisible();
    });

    const initialListNode = view.UNSAFE_getByType(FlatList);
    const initialListInstance = initialListNode.instance as FlatList<unknown>;
    const scrollToOffset = jest
      .spyOn(initialListInstance, "scrollToOffset")
      .mockImplementation(() => undefined);
    fireEvent.scroll(screen.getByLabelText("Öğrenci günlük özeti"), {
      timeStamp: 1_000,
      nativeEvent: {
        contentOffset: { x: 0, y: 276 },
        contentSize: { height: 2400, width: 390 },
        layoutMeasurement: { height: 700, width: 390 },
        zoomScale: 1,
      },
    });
    await waitFor(() => expect(currentProductionListOffset(initialListInstance)).toBe(276));

    await pressTab("Duyurular");
    await expectVisibleRoute("Announcements");
    await pressTab("Ana Sayfa");
    await waitFor(() => {
      expect(screen.getByLabelText("Öğrenci günlük özeti")).toBeVisible();
    });

    expect(view.UNSAFE_getByType(FlatList).instance).toBe(initialListInstance);
    expect(currentProductionListOffset(initialListInstance)).toBe(276);
    expect(scrollToOffset).not.toHaveBeenCalled();

    await pressTab("Ana Sayfa");
    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    });
  });

  it("includes the Android bottom inset and hides then restores the tab bar for the keyboard", async () => {
    const keyboardHandlers = captureKeyboardHandlers();
    await renderNavigator(
      { activeRoute: "Home", rootSurface: "authenticated" },
      {
        screenSlots: createTabBarEvidenceScreens(),
        safeAreaMetrics: {
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 24, right: 0, bottom: 34, left: 0 },
        },
      },
    );
    await expectVisibleRoute("Home");
    expect(screen.getByText("TAB_HEIGHT:98")).toBeVisible();

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    expect(keyboardHandlers[showEvent]).toHaveLength(1);
    expect(keyboardHandlers[hideEvent]).toHaveLength(1);
    expect(getTabBarContainer().props.pointerEvents).toBe("auto");

    act(() => keyboardHandlers[showEvent]![0]!());
    await waitFor(() => {
      expect(getTabBarContainer().props.pointerEvents).toBe("none");
    });

    act(() => keyboardHandlers[hideEvent]![0]!());
    await waitFor(() => {
      expect(getTabBarContainer().props.pointerEvents).toBe("auto");
    });
  });

  it("returns from a nested calendar destination with Android hardware Back", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Calendar",
      onRequestHandled,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Calendar");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Calendar"
        onRequestHandled={onRequestHandled}
        request={{
          key: "calendar-event-back",
          params: { eventId: "event-17" },
          route: "CalendarEventDetail",
        }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("CalendarEventDetail");
    expectPrimaryTabsHidden();
    expect(onRequestHandled).toHaveBeenCalledWith("calendar-event-back");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Calendar");
    expectSelectedTab("Takvim");
  });

  it("returns from a clean settings destination to Profile with accessible Android Back", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onRequestHandled = jest.fn();
    const onVisibleRouteChange = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Profile",
      onRequestHandled,
      onVisibleRouteChange,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Profile");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Profile"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={{ key: "open-academic-settings", route: "AcademicProfileSettings" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AcademicProfileSettings");
    expect(screen.getByRole("button", { name: "Geri d\u00f6n" })).toBeEnabled();
    expectPrimaryTabsHidden();

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]!()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });

    await expectVisibleRoute("Profile");
    expectSelectedTab("Ayarlar");
    expect(onRequestHandled).toHaveBeenCalledWith("open-academic-settings");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("AcademicProfileSettings");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Profile");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Profile"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={{ key: "open-account-data-settings", route: "AccountDataSettings" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AccountDataSettings");
    expectPrimaryTabsHidden();
  });

  it("keeps the Settings root behind an account request from an unopened tab", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onRequestHandled = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Home",
      onRequestHandled,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Home");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Home"
        onRequestHandled={onRequestHandled}
        request={{ key: "drawer-account", route: "AccountDataSettings" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );

    await expectVisibleRoute("AccountDataSettings");
    expect(screen.getByRole("button", { name: "Geri d\u00f6n" })).toBeEnabled();
    expectPrimaryTabsHidden();
    expect(onRequestHandled).toHaveBeenCalledWith("drawer-account");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]!()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });

    await expectVisibleRoute("Profile");
    expectSelectedTab("Ayarlar");
  });

  it("owns Apple Calendar settings in the protected Profile stack", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const onRequestHandled = jest.fn();
    const onVisibleRouteChange = jest.fn();
    const view = await renderNavigator({
      activeRoute: "Home",
      onRequestHandled,
      onVisibleRouteChange,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Home");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Home"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={{ key: "open-apple-calendar-settings", route: "AppleCalendarSettings" }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );

    await expectVisibleRoute("AppleCalendarSettings");
    expect(screen.getByRole("header", { name: "Apple Takvim" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Geri d\u00f6n" })).toBeEnabled();
    expectPrimaryTabsHidden();
    expect(onRequestHandled).toHaveBeenCalledWith("open-apple-calendar-settings");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("AppleCalendarSettings");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]!()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });

    await expectVisibleRoute("Profile");
    expectSelectedTab("Ayarlar");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("Profile");
  });

  it("intercepts dirty settings Back, keeps Cancel in place, then discards before leaving", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onDiscard = jest.fn();
    const guard = {
      route: "AcademicProfileSettings" as const,
      enabled: true,
      title: "Kaydedilmemi\u015f de\u011fi\u015fiklikler",
      message: "Kaydetmeden ayr\u0131lmak istiyor musunuz?",
      discardLabel: "De\u011fi\u015fiklikleri sil",
      onDiscard,
    };
    const view = await renderNavigator({
      activeRoute: "Profile",
      rootSurface: "authenticated",
      routeLeaveGuard: guard,
    });
    await expectVisibleRoute("Profile");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Profile"
        request={{ key: "open-dirty-academic-settings", route: "AcademicProfileSettings" }}
        rootSurface="authenticated"
        routeLeaveGuard={guard}
        screens={screens}
      />,
    );
    await expectVisibleRoute("AcademicProfileSettings");
    expect(screen.getByRole("button", { name: "Geri d\u00f6n" })).toBeEnabled();

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]!()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenLastCalledWith(
      guard.title,
      guard.message,
      expect.arrayContaining([
        expect.objectContaining({ style: "cancel" }),
        expect.objectContaining({ text: guard.discardLabel, style: "destructive" }),
      ]),
      expect.objectContaining({ cancelable: true }),
    );
    expect(screen.getByRole("header", { name: "SCREEN:AcademicProfileSettings" })).toBeVisible();
    expect(onDiscard).not.toHaveBeenCalled();

    const cancelButton = alert.mock.calls[0]![2]!.find((button) => button.style === "cancel");
    act(() => cancelButton?.onPress?.());
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole("header", { name: "SCREEN:AcademicProfileSettings" })).toBeVisible();

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Profile"
        request={{ key: "explicit-cancel-dirty-settings", route: "Profile" }}
        rootSurface="authenticated"
        routeLeaveGuard={guard}
        screens={screens}
      />,
    );
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("header", { name: "SCREEN:AcademicProfileSettings" })).toBeVisible();

    const discardButton = alert.mock.calls[1]![2]!.find(
      (button) => button.style === "destructive",
    );
    await act(async () => {
      discardButton?.onPress?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });

    expect(onDiscard).toHaveBeenCalledTimes(1);
    await expectVisibleRoute("Profile");
    expectSelectedTab("Ayarlar");
  });

  it("keeps the top-bar Back action disabled while navigation is locked", async () => {
    const lockedRequest: AppNavigationRequest = {
      key: "locked-announcement-detail",
      params: { announcementId: "announcement-42" },
      route: "AnnouncementDetail",
    };
    const view = await renderNavigator({
      activeRoute: "Announcements",
      navigationLocked: true,
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Announcements");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        navigationLocked
        request={lockedRequest}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AnnouncementDetail");

    const lockedBack = screen.getByRole("button", { name: "Geri d\u00f6n" });
    expect(lockedBack).toBeDisabled();
    await act(async () => {
      fireEvent.press(lockedBack);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("AnnouncementDetail");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        navigationLocked={false}
        request={lockedRequest}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    const unlockedBack = screen.getByRole("button", { name: "Geri d\u00f6n" });
    expect(unlockedBack).toBeEnabled();
    await act(async () => {
      fireEvent.press(unlockedBack);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Announcements");
  });

  it("routes unsupported destinations to the safe unknown fallback", async () => {
    const onVisibleRouteChange = jest.fn();
    await renderNavigator({
      activeRoute: "Home",
      onVisibleRouteChange,
      request: { key: "unknown-link", route: "UnknownRoute" },
      rootSurface: "authenticated",
    });

    await expectVisibleRoute("UnknownRoute");
    expect(onVisibleRouteChange).toHaveBeenCalledWith("UnknownRoute");
    expect(screen.queryByRole("header", { name: "SCREEN:Home" })).toBeNull();
  });

  it("fails a malformed detail identifier closed to the unknown route", async () => {
    const lifecycle: string[] = [];
    const onRequestHandled = jest.fn((key: string) => lifecycle.push(`handled:${key}`));
    const onVisibleRouteChange = jest.fn((route: AppVisibleRoute) => lifecycle.push(`visible:${route}`));
    const malformedRequest: AppNavigationRequest = {
      key: "malformed-detail",
      params: { announcementId: "../unsafe" },
      route: "AnnouncementDetail",
    };
    const view = await renderNavigator({
      activeRoute: "Announcements",
      onRequestHandled,
      onVisibleRouteChange,
      request: malformedRequest,
      rootSurface: "authenticated",
    });

    await expectVisibleRoute("UnknownRoute");
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
    expect(onRequestHandled).toHaveBeenCalledWith("malformed-detail");
    expect(lifecycle.indexOf("visible:UnknownRoute")).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf("handled:malformed-detail"))
      .toBeGreaterThan(lifecycle.indexOf("visible:UnknownRoute"));

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Announcements"
        onRequestHandled={onRequestHandled}
        onVisibleRouteChange={onVisibleRouteChange}
        request={{ ...malformedRequest }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("UnknownRoute");
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
  });

  it("defers protected work through hydration, auth, and onboarding, then handles it once", async () => {
    const onRequestHandled = jest.fn();
    const protectedRequest: AppNavigationRequest = {
      key: "pending-calendar-event",
      params: { eventId: "event-17" },
      route: "CalendarEventDetail",
    };
    const view = await renderNavigator({
      activeRoute: "BootstrapLoading",
      onRequestHandled,
      request: protectedRequest,
      rootSurface: "hydration_loading",
    });

    await expectVisibleRoute("BootstrapLoading");
    expect(onRequestHandled).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Login"
        onRequestHandled={onRequestHandled}
        request={{ ...protectedRequest }}
        rootSurface="auth"
        screens={screens}
      />,
    );
    await expectVisibleRoute("Login");
    expect(onRequestHandled).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="AcademicOnboarding"
        onRequestHandled={onRequestHandled}
        request={{ ...protectedRequest }}
        rootSurface="onboarding"
        screens={screens}
      />,
    );
    await expectVisibleRoute("AcademicOnboarding");
    expect(onRequestHandled).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Home"
        onRequestHandled={onRequestHandled}
        request={protectedRequest}
        rootSurface="authenticated"
        screens={screens}
      />,
    );

    await expectVisibleRoute("CalendarEventDetail");
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
    expect(onRequestHandled).toHaveBeenCalledWith("pending-calendar-event");

    await view.rerenderAsync(
      <NavigatorHarness
        activeRoute="Home"
        onRequestHandled={onRequestHandled}
        request={{ ...protectedRequest }}
        rootSurface="authenticated"
        screens={screens}
      />,
    );
    await expectVisibleRoute("CalendarEventDetail");
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
  });

  it("mounts the production resolver, intent coordinator, and navigator through announcement readiness exactly once", async () => {
    const hardwareBackHandlers = captureHardwareBackHandlers();
    const owner = { ownerId: "owner-a", generation: 7 };
    const onAcknowledged = jest.fn();
    const delivery = {
      token: "announcement-delivery-1",
      recipientOwnerId: owner.ownerId,
      intent: {
        source: "notification" as const,
        verified: true as const,
        route: { name: "AnnouncementDetail" as const, params: { announcementId: "announcement-42" } },
      },
    };
    const view = await renderAsync(
      <ProductionRoutingHarness
        contextReady={false}
        currentOwner={null}
        delivery={delivery}
        hydrationStatus="loading"
        onAcknowledged={onAcknowledged}
        sessionOwner={null}
      />,
    );

    await expectVisibleRoute("BootstrapLoading");
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        currentOwner={null}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={null}
      />,
    );
    await expectVisibleRoute("Login");
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        authStage="academic_onboarding"
        contextReady
        currentOwner={owner}
        delivery={delivery}
        hydrationStatus="ready"
        navigationLocked
        onAcknowledged={onAcknowledged}
        sessionOwner={owner}
      />,
    );
    await expectVisibleRoute("AcademicOnboarding");
    expect(screen.queryByRole("header", { name: "SCREEN:AnnouncementDetail" })).toBeNull();
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        contextReady
        currentOwner={owner}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={owner}
      />,
    );
    await expectVisibleRoute("AnnouncementDetail");
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    expect(onAcknowledged).toHaveBeenCalledWith("intent:announcement-delivery-1");

    await view.rerenderAsync(
      <ProductionRoutingHarness
        contextReady
        currentOwner={owner}
        delivery={{ ...delivery, token: "announcement-delivery-duplicate" }}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={owner}
      />,
    );
    await expectVisibleRoute("AnnouncementDetail");
    expect(onAcknowledged).toHaveBeenCalledTimes(1);

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Announcements");
  });

  it("invalidates an owner-bound protected intent when logout occurs before onboarding readiness", async () => {
    const owner = { ownerId: "owner-a", generation: 9 };
    const onAcknowledged = jest.fn();
    const delivery = {
      token: "logout-before-ready",
      recipientOwnerId: owner.ownerId,
      intent: {
        source: "notification" as const,
        verified: true as const,
        route: { name: "AnnouncementDetail" as const, params: { announcementId: "owner-a-pending" } },
      },
    };
    const view = await renderAsync(
      <ProductionRoutingHarness
        authStage="academic_onboarding"
        currentOwner={owner}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={owner}
      />,
    );

    await expectVisibleRoute("AcademicOnboarding");
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        currentOwner={null}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={null}
      />,
    );
    await expectVisibleRoute("Login");
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        currentOwner={owner}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={owner}
      />,
    );
    await expectVisibleRoute("Home");
    expect(screen.queryByRole("header", { name: "SCREEN:AnnouncementDetail" })).toBeNull();
    expect(onAcknowledged).not.toHaveBeenCalled();
  });

  it("resumes a signed-out calendar link and drops prior-owner work on account switch", async () => {
    const ownerA = { ownerId: "owner-a", generation: 11 };
    const ownerB = { ownerId: "owner-b", generation: 12 };
    const onAcknowledged = jest.fn();
    const calendarDelivery = {
      token: "calendar-signed-out",
      intent: {
        source: "deep_link" as const,
        route: { name: "CalendarEventDetail" as const, params: { eventId: "event-17" } },
      },
    };
    const view = await renderAsync(
      <ProductionRoutingHarness
        currentOwner={null}
        delivery={calendarDelivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={null}
      />,
    );

    await expectVisibleRoute("Login");
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        currentOwner={ownerA}
        delivery={calendarDelivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={ownerA}
      />,
    );
    await expectVisibleRoute("CalendarEventDetail");
    expect(onAcknowledged).toHaveBeenCalledTimes(1);

    const priorOwnerDelivery = {
      token: "prior-owner-notification",
      recipientOwnerId: ownerA.ownerId,
      intent: {
        source: "notification" as const,
        verified: true as const,
        route: { name: "AnnouncementDetail" as const, params: { announcementId: "owner-a-only" } },
      },
    };
    await view.rerenderAsync(
      <ProductionRoutingHarness
        authStage="academic_onboarding"
        currentOwner={ownerA}
        delivery={priorOwnerDelivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={ownerA}
      />,
    );
    await expectVisibleRoute("AcademicOnboarding");

    await view.rerenderAsync(
      <ProductionRoutingHarness
        currentOwner={ownerB}
        delivery={priorOwnerDelivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={ownerB}
      />,
    );
    await expectVisibleRoute("Home");
    expect(screen.queryByRole("header", { name: "SCREEN:AnnouncementDetail" })).toBeNull();
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed", "academicpulse://tab/home?token=secret-value"],
    ["unknown", "academicpulse://settings/not-approved"],
  ])("defers a %s destination through sign-in before showing the safe fallback", async (_kind, url) => {
    const resolution = parseAcademicPulseRouteUrl(url);
    expect(resolution).toEqual({ kind: "unknown", route: { name: "Unknown" } });
    if (resolution.kind !== "unknown") throw new Error("Expected a fail-closed route.");
    const owner = { ownerId: "owner-safe-fallback", generation: 4 };
    const onAcknowledged = jest.fn();
    const delivery = {
      token: `${_kind}-link`,
      intent: { source: "deep_link" as const, route: resolution.route },
    };
    const view = await renderAsync(
      <ProductionRoutingHarness
        currentOwner={null}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={null}
      />,
    );

    await expectVisibleRoute("Login");
    expect(onAcknowledged).not.toHaveBeenCalled();

    await view.rerenderAsync(
      <ProductionRoutingHarness
        currentOwner={owner}
        delivery={delivery}
        hydrationStatus="ready"
        onAcknowledged={onAcknowledged}
        sessionOwner={owner}
      />,
    );
    await expectVisibleRoute("UnknownRoute");
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    expect(onAcknowledged).toHaveBeenCalledWith(`intent:${_kind}-link`);
  });
});
