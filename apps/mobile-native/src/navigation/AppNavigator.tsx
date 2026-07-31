import { Ionicons } from "@expo/vector-icons";
import {
  CommonActions,
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { BackHandler, Platform, StyleSheet, View } from "react-native";
import {
  NavigationSurface,
  Screen,
  usePlatformAdaptation,
  useReducedMotion,
  useTheme
} from "../design-system";
import { isSafeRouteIdentifier } from "./routes";

export type AppRootSurface =
  | "hydration_loading"
  | "hydration_error"
  | "auth"
  | "onboarding"
  | "authenticated";

export type AppVisibleRoute =
  | "BootstrapLoading"
  | "BootstrapError"
  | "Login"
  | "Register"
  | "Verification"
  | "PasswordRecoveryRequest"
  | "PasswordRecoveryConfirm"
  | "ProfileConfirmation"
  | "Home"
  | "Announcements"
  | "SummerSchool"
  | "YokAnnouncements"
  | "AnnouncementDetail"
  | "Calendar"
  | "CalendarEventDetail"
  | "Profile"
  | "AcademicProfileSettings"
  | "NotificationSettings"
  | "GoogleCalendarSettings"
  | "AccountDataSettings"
  | "UnknownRoute";

export interface AppNavigationRequest {
  key: string;
  route: AppVisibleRoute;
  params?: Readonly<Record<string, string>>;
}

export type AppScreenSlots = Readonly<Record<AppVisibleRoute, ReactNode>>;

export interface AppNavigatorProps {
  rootSurface: AppRootSurface;
  activeRoute: AppVisibleRoute;
  screens: AppScreenSlots;
  globalFeedback?: ReactNode;
  navigationLocked?: boolean;
  request?: AppNavigationRequest | null;
  onRequestHandled?: (key: string) => void;
  onVisibleRouteChange?: (route: AppVisibleRoute) => void;
}

type RootStackParamList = {
  BootstrapLoading: undefined;
  BootstrapError: undefined;
  AuthFlow: undefined;
  OnboardingFlow: undefined;
  Authenticated: undefined;
  UnknownRoute: undefined;
};

type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Verification: undefined;
  PasswordRecoveryRequest: undefined;
  PasswordRecoveryConfirm: undefined;
};

type OnboardingStackParamList = {
  ProfileConfirmation: undefined;
};

type HomeStackParamList = { Home: undefined };
type AnnouncementStackParamList = {
  Announcements: undefined;
  SummerSchool: undefined;
  YokAnnouncements: undefined;
  AnnouncementDetail: { announcementId: string };
};
type CalendarStackParamList = {
  Calendar: undefined;
  CalendarEventDetail: { eventId: string };
};
type SettingsStackParamList = {
  Profile: undefined;
  AcademicProfileSettings: undefined;
  NotificationSettings: undefined;
  GoogleCalendarSettings: undefined;
  AccountDataSettings: undefined;
};
type MainTabParamList = {
  HomeTab: undefined;
  AnnouncementsTab: undefined;
  CalendarTab: undefined;
  ProfileTab: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const AnnouncementStack = createNativeStackNavigator<AnnouncementStackParamList>();
const CalendarStack = createNativeStackNavigator<CalendarStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
const MainTabs = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

interface RouteContentValue {
  screens: AppScreenSlots;
  globalFeedback?: ReactNode;
  navigationLocked: boolean;
}

const RouteContentContext = createContext<RouteContentValue | null>(null);

function useRouteContent(): RouteContentValue {
  const value = useContext(RouteContentContext);
  if (!value) throw new Error("Route content must be rendered inside AppNavigator.");
  return value;
}

function RoutedScreen({ route }: { route: AppVisibleRoute }) {
  const { screens, globalFeedback } = useRouteContent();
  const isBootstrap = route === "BootstrapLoading" || route === "BootstrapError";
  const hasNativeHeader = route === "SummerSchool"
    || route === "YokAnnouncements"
    || route === "AnnouncementDetail"
    || route === "CalendarEventDetail"
    || route === "AcademicProfileSettings"
    || route === "NotificationSettings"
    || route === "GoogleCalendarSettings"
    || route === "AccountDataSettings";

  if (isBootstrap) {
    return (
      <Screen centered>
        <View style={styles.bootstrap}>{screens[route]}</View>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      edges={hasNativeHeader ? ["left", "right", "bottom"] : ["top", "left", "right", "bottom"]}
      contentStyle={styles.content}
      scrollViewProps={{
        contentInsetAdjustmentBehavior: "automatic",
        keyboardDismissMode: Platform.OS === "ios" ? "interactive" : "on-drag"
      }}
    >
      {globalFeedback}
      {screens[route]}
    </Screen>
  );
}

const routeComponent = (route: AppVisibleRoute) => function RouteComponent() {
  return <RoutedScreen route={route} />;
};

const BootstrapLoadingScreen = routeComponent("BootstrapLoading");
const BootstrapErrorScreen = routeComponent("BootstrapError");
const LoginScreen = routeComponent("Login");
const RegisterScreen = routeComponent("Register");
const VerificationScreen = routeComponent("Verification");
const PasswordRecoveryRequestScreen = routeComponent("PasswordRecoveryRequest");
const PasswordRecoveryConfirmScreen = routeComponent("PasswordRecoveryConfirm");
const ProfileConfirmationScreen = routeComponent("ProfileConfirmation");
const HomeScreen = routeComponent("Home");
const AnnouncementsScreen = routeComponent("Announcements");
const SummerSchoolScreen = routeComponent("SummerSchool");
const YokAnnouncementsScreen = routeComponent("YokAnnouncements");
const AnnouncementDetailScreen = routeComponent("AnnouncementDetail");
const CalendarScreen = routeComponent("Calendar");
const CalendarEventDetailScreen = routeComponent("CalendarEventDetail");
const ProfileScreen = routeComponent("Profile");
const AcademicProfileSettingsScreen = routeComponent("AcademicProfileSettings");
const NotificationSettingsScreen = routeComponent("NotificationSettings");
const GoogleCalendarSettingsScreen = routeComponent("GoogleCalendarSettings");
const AccountDataSettingsScreen = routeComponent("AccountDataSettings");
const UnknownRouteScreen = routeComponent("UnknownRoute");

function AuthNavigator() {
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <AuthStack.Navigator
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        headerShown: false,
        gestureEnabled: !navigationLocked
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="Verification" component={VerificationScreen} />
      <AuthStack.Screen name="PasswordRecoveryRequest" component={PasswordRecoveryRequestScreen} />
      <AuthStack.Screen name="PasswordRecoveryConfirm" component={PasswordRecoveryConfirmScreen} />
    </AuthStack.Navigator>
  );
}

function OnboardingNavigator() {
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <OnboardingStack.Navigator
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        headerShown: false,
        gestureEnabled: !navigationLocked
      }}
    >
      <OnboardingStack.Screen name="ProfileConfirmation" component={ProfileConfirmationScreen} />
    </OnboardingStack.Navigator>
  );
}

function HomeNavigator() {
  const theme = useTheme();
  return (
    <HomeStack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        headerShown: false
      }}
    >
      <HomeStack.Screen name="Home" component={HomeScreen} />
    </HomeStack.Navigator>
  );
}

function AnnouncementsNavigator() {
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <AnnouncementStack.Navigator
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        gestureEnabled: !navigationLocked,
        headerBackTitle: "Gündem",
        headerStyle: { backgroundColor: theme.colors.background.surface },
        headerTintColor: theme.colors.text.primary,
        headerTitleStyle: theme.typography.cardTitle
      }}
    >
      <AnnouncementStack.Screen name="Announcements" component={AnnouncementsScreen} options={{ headerShown: false }} />
      <AnnouncementStack.Screen name="SummerSchool" component={SummerSchoolScreen} options={{ title: "Yaz Okulu" }} />
      <AnnouncementStack.Screen name="YokAnnouncements" component={YokAnnouncementsScreen} options={{ title: "YÖK" }} />
      <AnnouncementStack.Screen name="AnnouncementDetail" component={AnnouncementDetailScreen} options={{ title: "Duyuru" }} />
    </AnnouncementStack.Navigator>
  );
}

function CalendarNavigator() {
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <CalendarStack.Navigator
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        gestureEnabled: !navigationLocked,
        headerBackTitle: "Takvim",
        headerStyle: { backgroundColor: theme.colors.background.surface },
        headerTintColor: theme.colors.text.primary,
        headerTitleStyle: theme.typography.cardTitle
      }}
    >
      <CalendarStack.Screen name="Calendar" component={CalendarScreen} options={{ headerShown: false }} />
      <CalendarStack.Screen name="CalendarEventDetail" component={CalendarEventDetailScreen} options={{ title: "Takvim Ayrıntısı" }} />
    </CalendarStack.Navigator>
  );
}

function SettingsNavigator() {
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <SettingsStack.Navigator
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        gestureEnabled: !navigationLocked,
        headerBackTitle: "Profil",
        headerStyle: { backgroundColor: theme.colors.background.surface },
        headerTintColor: theme.colors.text.primary,
        headerTitleStyle: theme.typography.cardTitle
      }}
    >
      <SettingsStack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <SettingsStack.Screen name="AcademicProfileSettings" component={AcademicProfileSettingsScreen} options={{ title: "Akademik Profil" }} />
      <SettingsStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: "Bildirimler" }} />
      <SettingsStack.Screen name="GoogleCalendarSettings" component={GoogleCalendarSettingsScreen} options={{ title: "Google Takvim" }} />
      <SettingsStack.Screen name="AccountDataSettings" component={AccountDataSettingsScreen} options={{ title: "Hesap ve Veri" }} />
    </SettingsStack.Navigator>
  );
}

const tabIcons: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
  HomeTab: "home-outline",
  AnnouncementsTab: "newspaper-outline",
  CalendarTab: "calendar-outline",
  ProfileTab: "person-outline"
};

function AuthenticatedNavigator() {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const useNavigationRail = adaptation.navigationLayout === "navigation-rail";
  return (
    <MainTabs.Navigator
      initialRouteName="HomeTab"
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background.canvas },
        tabBarHideOnKeyboard: true,
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons
            name={focused ? tabIcons[route.name].replace("-outline", "") as keyof typeof Ionicons.glyphMap : tabIcons[route.name]}
            color={color}
            size={size}
          />
        ),
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarActiveTintColor: theme.colors.action.primary,
        tabBarInactiveTintColor: theme.colors.text.secondary,
        tabBarActiveBackgroundColor: theme.colors.state.selected,
        tabBarPosition: useNavigationRail ? "left" : "bottom",
        tabBarVariant: useNavigationRail ? "material" : "uikit",
        tabBarStyle: {
          backgroundColor: "transparent",
          borderColor: theme.colors.border.default
        },
        tabBarBackground: () => (
          <NavigationSurface
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            kind="tab-bar"
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          >
            {null}
          </NavigationSurface>
        )
      })}
    >
      <MainTabs.Screen name="HomeTab" component={HomeNavigator} options={{ title: "Ana Sayfa" }} />
      <MainTabs.Screen name="AnnouncementsTab" component={AnnouncementsNavigator} options={{ title: "Duyurular" }} />
      <MainTabs.Screen name="CalendarTab" component={CalendarNavigator} options={{ title: "Takvim" }} />
      <MainTabs.Screen name="ProfileTab" component={SettingsNavigator} options={{ title: "Profil" }} />
    </MainTabs.Navigator>
  );
}

function getLeafRouteName(
  state: NavigationState | PartialState<NavigationState> | undefined
): string | undefined {
  if (!state || state.routes.length === 0) return undefined;
  const index = state.index ?? state.routes.length - 1;
  const route = state.routes[index];
  return getLeafRouteName(route.state) ?? route.name;
}

function requestAction(request: AppNavigationRequest) {
  const params = request.params ?? {};
  switch (request.route) {
    case "Login":
    case "Register":
    case "Verification":
    case "PasswordRecoveryRequest":
    case "PasswordRecoveryConfirm":
      return CommonActions.navigate("AuthFlow", { screen: request.route });
    case "ProfileConfirmation":
      return CommonActions.navigate("OnboardingFlow", { screen: request.route });
    case "Home":
      return CommonActions.navigate("Authenticated", { screen: "HomeTab", params: { screen: "Home" } });
    case "Announcements":
    case "SummerSchool":
    case "YokAnnouncements":
      return CommonActions.navigate("Authenticated", {
        screen: "AnnouncementsTab",
        params: { screen: request.route }
      });
    case "AnnouncementDetail":
      if (!isSafeRouteIdentifier(params.announcementId)) {
        return CommonActions.navigate("UnknownRoute");
      }
      return CommonActions.navigate("Authenticated", {
        screen: "AnnouncementsTab",
        params: {
          screen: "AnnouncementDetail",
          params: { announcementId: params.announcementId }
        }
      });
    case "Calendar":
      return CommonActions.navigate("Authenticated", { screen: "CalendarTab", params: { screen: "Calendar" } });
    case "CalendarEventDetail":
      if (!isSafeRouteIdentifier(params.eventId)) {
        return CommonActions.navigate("UnknownRoute");
      }
      return CommonActions.navigate("Authenticated", {
        screen: "CalendarTab",
        params: {
          screen: "CalendarEventDetail",
          params: { eventId: params.eventId }
        }
      });
    case "Profile":
    case "AcademicProfileSettings":
    case "NotificationSettings":
    case "GoogleCalendarSettings":
    case "AccountDataSettings":
      return CommonActions.navigate("Authenticated", {
        screen: "ProfileTab",
        params: { screen: request.route }
      });
    case "UnknownRoute":
      return CommonActions.navigate("UnknownRoute");
    case "BootstrapLoading":
      return CommonActions.navigate("BootstrapLoading");
    case "BootstrapError":
      return CommonActions.navigate("BootstrapError");
  }
}

function rootScreen(surface: AppRootSurface): keyof RootStackParamList {
  switch (surface) {
    case "hydration_loading": return "BootstrapLoading";
    case "hydration_error": return "BootstrapError";
    case "auth": return "AuthFlow";
    case "onboarding": return "OnboardingFlow";
    case "authenticated": return "Authenticated";
  }
}

export function AppNavigator({
  rootSurface,
  activeRoute,
  screens,
  globalFeedback,
  navigationLocked = false,
  request,
  onRequestHandled,
  onVisibleRouteChange
}: AppNavigatorProps) {
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const handledRequestKeyRef = useRef<string | null>(null);
  const lastControlledRouteRef = useRef<string | null>(null);
  const contextValue = useMemo<RouteContentValue>(() => ({
    screens,
    globalFeedback,
    navigationLocked
  }), [globalFeedback, navigationLocked, screens]);

  useEffect(() => {
    if (!ready || !navigationRef.isReady()) return;
    if (!isControlledBaseRoute(activeRoute)) return;
    const controlledKey = `${rootSurface}:${activeRoute}`;
    if (lastControlledRouteRef.current === controlledKey) return;
    lastControlledRouteRef.current = controlledKey;
    navigationRef.dispatch(requestAction({ key: controlledKey, route: activeRoute }));
  }, [activeRoute, ready, rootSurface]);

  useEffect(() => {
    if (!ready || !request || !navigationRef.isReady()) return;
    if (!requestMatchesRootSurface(request.route, rootSurface)) return;
    if (handledRequestKeyRef.current === request.key) return;
    navigationRef.dispatch(requestAction(request));
    handledRequestKeyRef.current = request.key;
    onRequestHandled?.(request.key);
  }, [onRequestHandled, ready, request, rootSurface]);

  useEffect(() => {
    if (!navigationLocked || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [navigationLocked]);

  const reportVisibleRoute = () => {
    const leaf = getLeafRouteName(navigationRef.getRootState());
    if (leaf && isVisibleRoute(leaf)) onVisibleRouteChange?.(leaf);
  };

  return (
    <RouteContentContext.Provider value={contextValue}>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          setReady(true);
          reportVisibleRoute();
        }}
        onStateChange={reportVisibleRoute}
      >
        <RootStack.Navigator
          initialRouteName={rootScreen(rootSurface)}
          screenOptions={{
            animation: reducedMotion ? "none" : "default",
            animationTypeForReplace: "pop",
            contentStyle: { backgroundColor: theme.colors.background.canvas },
            headerShown: false
          }}
        >
          {rootSurface === "hydration_loading" && (
            <RootStack.Screen name="BootstrapLoading" component={BootstrapLoadingScreen} />
          )}
          {rootSurface === "hydration_error" && (
            <RootStack.Screen name="BootstrapError" component={BootstrapErrorScreen} />
          )}
          {rootSurface === "auth" && (
            <RootStack.Screen name="AuthFlow" component={AuthNavigator} />
          )}
          {rootSurface === "onboarding" && (
            <RootStack.Screen name="OnboardingFlow" component={OnboardingNavigator} />
          )}
          {rootSurface === "authenticated" && (
            <RootStack.Screen name="Authenticated" component={AuthenticatedNavigator} />
          )}
          <RootStack.Screen name="UnknownRoute" component={UnknownRouteScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    </RouteContentContext.Provider>
  );
}

function isControlledBaseRoute(route: AppVisibleRoute): boolean {
  return route === "BootstrapLoading"
    || route === "BootstrapError"
    || route === "Login"
    || route === "Register"
    || route === "Verification"
    || route === "PasswordRecoveryRequest"
    || route === "PasswordRecoveryConfirm"
    || route === "ProfileConfirmation"
    || route === "Home"
    || route === "Announcements"
    || route === "SummerSchool"
    || route === "YokAnnouncements"
    || route === "Calendar"
    || route === "Profile";
}

function requestMatchesRootSurface(route: AppVisibleRoute, surface: AppRootSurface): boolean {
  if (route === "UnknownRoute") return true;
  if (route === "BootstrapLoading") return surface === "hydration_loading";
  if (route === "BootstrapError") return surface === "hydration_error";
  if (route === "ProfileConfirmation") return surface === "onboarding";
  if (route === "Login"
    || route === "Register"
    || route === "Verification"
    || route === "PasswordRecoveryRequest"
    || route === "PasswordRecoveryConfirm") {
    return surface === "auth";
  }
  return surface === "authenticated";
}

function isVisibleRoute(value: string): value is AppVisibleRoute {
  return [
    "BootstrapLoading", "BootstrapError", "Login", "Register", "Verification",
    "PasswordRecoveryRequest", "PasswordRecoveryConfirm", "ProfileConfirmation",
    "Home", "Announcements", "SummerSchool", "YokAnnouncements", "AnnouncementDetail",
    "Calendar", "CalendarEventDetail", "Profile", "AcademicProfileSettings",
    "NotificationSettings", "GoogleCalendarSettings", "AccountDataSettings", "UnknownRoute"
  ].includes(value);
}

const styles = StyleSheet.create({
  bootstrap: {
    alignSelf: "stretch",
    flex: 1,
    justifyContent: "center"
  },
  content: {
    gap: 14
  },
  tabItem: {
    minHeight: Platform.OS === "ios" ? 44 : 48
  },
  tabLabel: {
    fontSize: Platform.OS === "ios" ? 11 : 12,
    fontWeight: "600"
  }
});
