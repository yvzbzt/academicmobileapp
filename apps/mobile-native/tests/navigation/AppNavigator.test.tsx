import { useMemo, type ReactNode } from "react";
import { BackHandler, Text } from "react-native";
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

const visibleRoutes: AppVisibleRoute[] = [
  "BootstrapLoading",
  "BootstrapError",
  "Login",
  "Register",
  "Verification",
  "PasswordRecoveryRequest",
  "PasswordRecoveryConfirm",
  "ProfileConfirmation",
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

function NavigatorHarness(props: AppNavigatorProps) {
  const stableScreens = useMemo(() => screens, []);
  return (
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
  );
}

async function renderNavigator(props: Omit<AppNavigatorProps, "screens">) {
  return renderAsync(<NavigatorHarness {...props} screens={screens} />);
}

function expectVisibleRoute(route: AppVisibleRoute) {
  return waitFor(() => {
    expect(
      screen.getByRole("header", { name: `SCREEN:${route}` }),
    ).toBeVisible();
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
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label}, tab,`) }),
      ).toBeVisible();
    }

    fireEvent.press(
      screen.getByRole("button", { name: /^Duyurular, tab,/ }),
    );
    await expectVisibleRoute("Announcements");

    fireEvent.press(screen.getByRole("button", { name: /^Takvim, tab,/ }));
    await expectVisibleRoute("Calendar");

    expect(hardwareBackHandlers).toHaveLength(1);
    await act(async () => {
      expect(hardwareBackHandlers[0]()).toBe(true);
    });
    await expectVisibleRoute("Announcements");
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

  it("holds protected post-auth work until the authenticated route tree exists", async () => {
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
        activeRoute="Home"
        onRequestHandled={onRequestHandled}
        request={protectedRequest}
        rootSurface="authenticated"
        screens={screens}
      />,
    );

    await expectVisibleRoute("CalendarEventDetail");
    expect(onRequestHandled).toHaveBeenCalledWith("pending-calendar-event");
  });
});
