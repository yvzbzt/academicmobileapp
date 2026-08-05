import { useMemo, type ReactNode } from "react";
import { Alert, BackHandler, FlatList, Keyboard, KeyboardAvoidingView, Platform, Text } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
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
import { HomeDailyBrief } from "../../src/home/HomeDailyBrief";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";

const visibleRoutes: AppVisibleRoute[] = [
  "BootstrapLoading",
  "BootstrapError",
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
  "NotificationSettings",
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
  return {
    id,
    sourceId: "trusted-student-affairs",
    sourceName: "Öğrenci İşleri Daire Başkanlığı",
    scopeType: "university",
    scopeId: "university-1",
    contentType: "announcement",
    title,
    summary: "Doğrulanmış akademik içerik özeti.",
    link: `https://example.edu.tr/duyuru/${id}`,
    canonicalUrl: `https://example.edu.tr/duyuru/${id}`,
    publicationKind: "timestamp",
    publishedAt,
    trustStatus: "trusted",
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
  { label: "Profil", route: "Profile" },
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
  it("starts in login and honors a one-shot auth route request", async () => {
    const onRequestHandled = jest.fn();
    const onVisibleRouteChange = jest.fn();
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
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
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

  it("maps exactly four Turkish tab controls to their authenticated roots", async () => {
    await renderNavigator({
      activeRoute: "Home",
      rootSurface: "authenticated",
    });
    await expectVisibleRoute("Home");

    expect(screen.getAllByRole("button")).toHaveLength(4);
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

    for (const label of ["Ana Sayfa", "Duyurular", "Takvim", "Profil"]) {
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
    expect(onRequestHandled).toHaveBeenCalledWith("announcement-42");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    await expectVisibleRoute("Announcements");
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
    expectSelectedTab("Duyurular");

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
    expectSelectedTab("Duyurular");
    expect(onRequestHandled.mock.calls).toEqual([
      ["summer-school"],
      ["yok-announcements"],
    ]);
  });

  it("preserves independent nested histories while switching tabs", async () => {
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

    await pressTab("Duyurular");
    await expectVisibleRoute("AnnouncementDetail");
    expectSelectedTab("Duyurular");

    await pressTab("Takvim");
    await expectVisibleRoute("CalendarEventDetail");
    expectSelectedTab("Takvim");
    expect(onRequestHandled.mock.calls).toEqual([
      ["announcement-history"],
      ["calendar-history"],
    ]);
  });

  it("reselects a nested tab back to its root without pushing another route", async () => {
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
    expectSelectedTab("Duyurular");

    await pressTab("Duyurular");
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
    expect(screen.getByText("TAB_HEIGHT:114")).toBeVisible();

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
    expectSelectedTab("Takvim");
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
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(0);
    expectSelectedTab("Profil");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]!()).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });

    await expectVisibleRoute("Profile");
    expectSelectedTab("Profil");
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
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(0);
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
    expectSelectedTab("Profil");
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
    const onRequestHandled = jest.fn();
    await renderNavigator({
      activeRoute: "Announcements",
      onRequestHandled,
      request: {
        key: "malformed-detail",
        params: { announcementId: "../unsafe" },
        route: "AnnouncementDetail",
      },
      rootSurface: "authenticated",
    });

    await expectVisibleRoute("UnknownRoute");
    expect(onRequestHandled).toHaveBeenCalledWith("malformed-detail");
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
});
