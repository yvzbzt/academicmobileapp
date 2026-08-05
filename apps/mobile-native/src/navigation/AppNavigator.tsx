import { Ionicons } from "@expo/vector-icons";
import {
  CommonActions,
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState,
  useNavigation,
  usePreventRemove,
  useScrollToTop,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
} from "@react-navigation/native-stack";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  Alert,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ScrollView,
} from "react-native";
import {
  NavigationSurface,
  Screen,
  usePlatformAdaptation,
  useReducedMotion,
  useTheme
} from "../design-system";
import { isSafeRouteIdentifier } from "./routes";
import {
  PRIMARY_TABS,
  primaryTabDefinition,
  resolveAppShellLayoutContract,
} from "./app-shell";
import { AdaptiveTopBar } from "./AdaptiveTopBar";

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
  | "PasswordRecoveryCode"
  | "PasswordRecoveryConfirm"
  | "AcademicOnboarding"
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
  routeLeaveGuard?: AppRouteLeaveGuard | null;
}

export interface AppRouteLeaveGuard {
  route: AppVisibleRoute;
  enabled: boolean;
  title: string;
  message: string;
  discardLabel: string;
  onDiscard: () => void;
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
  PasswordRecoveryCode: undefined;
  PasswordRecoveryConfirm: undefined;
};

type OnboardingStackParamList = {
  AcademicOnboarding: undefined;
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
  routeLeaveGuard?: AppRouteLeaveGuard | null;
}

const RouteContentContext = createContext<RouteContentValue | null>(null);

function useRouteContent(): RouteContentValue {
  const value = useContext(RouteContentContext);
  if (!value) throw new Error("Route content must be rendered inside AppNavigator.");
  return value;
}

function RoutedScreen({ route }: { route: AppVisibleRoute }) {
  const { screens, globalFeedback, routeLeaveGuard } = useRouteContent();
  const adaptation = usePlatformAdaptation();
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView | null>(null);
  const leaveAlertVisibleRef = useRef(false);
  useScrollToTop(scrollRef);
  const guardEnabled = Boolean(
    routeLeaveGuard?.enabled && routeLeaveGuard.route === route,
  );
  usePreventRemove(guardEnabled, ({ data }) => {
    if (!routeLeaveGuard || leaveAlertVisibleRef.current) return;
    leaveAlertVisibleRef.current = true;
    Alert.alert(
      routeLeaveGuard.title,
      routeLeaveGuard.message,
      [
        {
          text: "Vazgeç",
          style: "cancel",
          onPress: () => {
            leaveAlertVisibleRef.current = false;
          },
        },
        {
          text: routeLeaveGuard.discardLabel,
          style: "destructive",
          onPress: () => {
            leaveAlertVisibleRef.current = false;
            routeLeaveGuard.onDiscard();
            navigation.dispatch(data.action);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          leaveAlertVisibleRef.current = false;
        },
      },
    );
  });
  const isBootstrap = route === "BootstrapLoading" || route === "BootstrapError";
  const hasAuthenticatedShell = isAuthenticatedRoute(route);
  const hasFormLayout = isAuthOrOnboardingRoute(route)
    || route === "AcademicProfileSettings"
    || route === "AccountDataSettings";
  const authenticatedEdges = adaptation.navigationLayout === "navigation-rail"
    ? ["right", "bottom"] as const
    : ["left", "right"] as const;

  if (isBootstrap) {
    return (
      <Screen centered>
        <View style={styles.bootstrap}>{screens[route]}</View>
      </Screen>
    );
  }

  if (route === "Home"
    || route === "Announcements"
    || route === "AnnouncementDetail"
    || route === "Calendar"
    || route === "CalendarEventDetail") {
    return (
      <Screen edges={[...authenticatedEdges]} fullBleed>
        {globalFeedback}
        {screens[route]}
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      edges={hasAuthenticatedShell ? [...authenticatedEdges] : ["top", "left", "right", "bottom"]}
      keyboardSafe={hasFormLayout}
      readableWidth={hasFormLayout ? "form" : "content"}
      contentStyle={styles.content}
      scrollViewRef={scrollRef}
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
const PasswordRecoveryCodeScreen = routeComponent("PasswordRecoveryCode");
const PasswordRecoveryConfirmScreen = routeComponent("PasswordRecoveryConfirm");
const AcademicOnboardingScreen = routeComponent("AcademicOnboarding");
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

function ShellStackHeader({
  back,
  navigation,
  options,
  route,
}: NativeStackHeaderProps) {
  const { navigationLocked } = useRouteContent();
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const title = options.title ?? route.name;

  return (
    <AdaptiveTopBar
      title={title}
      leadingAction={back ? {
        accessibilityHint: back.title
          ? `${back.title} ekran\u0131na d\u00f6ner.`
          : "\u00d6nceki ekrana d\u00f6ner.",
        accessibilityLabel: "Geri d\u00f6n",
        disabled: navigationLocked,
        icon: (
          <Ionicons
            color={theme.colors.text.primary}
            name={adaptation.platform === "ios" ? "chevron-back" : "arrow-back"}
            size={22}
          />
        ),
        onPress: () => navigation.goBack(),
      } : undefined}
    />
  );
}

function renderShellStackHeader(props: NativeStackHeaderProps) {
  return <ShellStackHeader {...props} />;
}

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
      <AuthStack.Screen name="PasswordRecoveryCode" component={PasswordRecoveryCodeScreen} />
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
      <OnboardingStack.Screen name="AcademicOnboarding" component={AcademicOnboardingScreen} />
    </OnboardingStack.Navigator>
  );
}

function HomeNavigator() {
  const theme = useTheme();
  return (
    <HomeStack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        header: renderShellStackHeader
      }}
    >
      <HomeStack.Screen name="Home" component={HomeScreen} options={{ title: "Ana Sayfa" }} />
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
        header: renderShellStackHeader,
        headerBackTitle: "Gündem",
      }}
    >
      <AnnouncementStack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: "Duyurular" }} />
      <AnnouncementStack.Screen name="SummerSchool" component={SummerSchoolScreen} options={{ title: "Yaz Okulu" }} />
      <AnnouncementStack.Screen name="YokAnnouncements" component={YokAnnouncementsScreen} options={{ title: "YÖK" }} />
      <AnnouncementStack.Screen name="AnnouncementDetail" component={AnnouncementDetailScreen} options={{ title: "İçerik" }} />
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
        header: renderShellStackHeader,
        headerBackTitle: "Takvim",
      }}
    >
      <CalendarStack.Screen name="Calendar" component={CalendarScreen} options={{ title: "Takvim" }} />
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
        header: renderShellStackHeader,
        headerBackTitle: "Profil",
      }}
    >
      <SettingsStack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profil" }} />
      <SettingsStack.Screen name="AcademicProfileSettings" component={AcademicProfileSettingsScreen} options={{ title: "Akademik Profil" }} />
      <SettingsStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: "Bildirimler" }} />
      <SettingsStack.Screen name="GoogleCalendarSettings" component={GoogleCalendarSettingsScreen} options={{ title: "Google Takvim" }} />
      <SettingsStack.Screen name="AccountDataSettings" component={AccountDataSettingsScreen} options={{ title: "Hesap ve Veri" }} />
    </SettingsStack.Navigator>
  );
}

function ShellTabIcon({
  color,
  focused,
  route,
  size,
}: {
  color: string;
  focused: boolean;
  route: keyof MainTabParamList;
  size: number;
}) {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const definition = primaryTabDefinition(route);
  const usesMaterialIndicator = adaptation.platform === "android";

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tabIconIndicator,
        usesMaterialIndicator && styles.tabIconIndicatorAndroid,
        focused && usesMaterialIndicator && {
          backgroundColor: theme.colors.state.selected,
        },
      ]}
    >
      <Ionicons
        name={focused ? definition.selectedIcon : definition.icon}
        color={color}
        size={size}
      />
    </View>
  );
}

function ShellTabLabel({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  const adaptation = usePlatformAdaptation();
  const { fontScale, width } = useWindowDimensions();
  const contract = resolveAppShellLayoutContract({
    platform: adaptation.platform,
    windowWidth: width,
    fontScale,
  });

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={contract.navigationLabelMaxFontSizeMultiplier}
      numberOfLines={contract.navigationLabelLines}
      style={[
        styles.tabLabel,
        {
          color,
          fontSize: contract.navigationLabelFontSize,
          lineHeight: contract.navigationLabelFontSize + 4,
        },
      ]}
    >
      {label}
    </Text>
  );
}

const tabNavigators: Record<keyof MainTabParamList, () => React.JSX.Element> = {
  HomeTab: HomeNavigator,
  AnnouncementsTab: AnnouncementsNavigator,
  CalendarTab: CalendarNavigator,
  ProfileTab: SettingsNavigator,
};

function AuthenticatedNavigator() {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale, width } = useWindowDimensions();
  const useNavigationRail = adaptation.navigationLayout === "navigation-rail";
  const shellLayout = resolveAppShellLayoutContract({
    platform: adaptation.platform,
    windowWidth: width,
    fontScale,
  });
  const bottomNavigationHeight =
    !useNavigationRail && shellLayout.bottomNavigationContentHeight
      ? shellLayout.bottomNavigationContentHeight + insets.bottom
      : undefined;
  return (
    <MainTabs.Navigator
      initialRouteName="HomeTab"
      backBehavior="history"
      screenOptions={({ route }) => {
        const definition = primaryTabDefinition(route.name);
        return {
          headerShown: false,
          sceneStyle: { backgroundColor: theme.colors.background.canvas },
          tabBarAccessibilityLabel: definition.label,
          tabBarActiveBackgroundColor: "transparent",
          tabBarActiveTintColor: theme.colors.action.primary,
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
          ),
          tabBarHideOnKeyboard: true,
          tabBarIcon: ({ color, size, focused }) => (
            <ShellTabIcon
              color={color}
              focused={focused}
              route={route.name}
              size={size}
            />
          ),
          tabBarInactiveBackgroundColor: "transparent",
          tabBarInactiveTintColor: theme.colors.text.secondary,
          tabBarItemStyle: styles.tabItem,
          tabBarLabel: ({ color }) => (
            <ShellTabLabel color={color} label={definition.label} />
          ),
          tabBarPosition: useNavigationRail ? "left" : "bottom",
          tabBarStyle: {
            backgroundColor: "transparent",
            borderColor: theme.colors.border.default,
            height: bottomNavigationHeight,
          },
          tabBarVariant: useNavigationRail ? "material" : "uikit",
        };
      }}
    >
      {PRIMARY_TABS.map((definition) => (
        <MainTabs.Screen
          key={definition.route}
          name={definition.route}
          component={tabNavigators[definition.route]}
          options={{ title: definition.label }}
        />
      ))}
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
    case "PasswordRecoveryCode":
    case "PasswordRecoveryConfirm":
      return CommonActions.navigate("AuthFlow", { screen: request.route });
    case "AcademicOnboarding":
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
  onVisibleRouteChange,
  routeLeaveGuard,
}: AppNavigatorProps) {
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const handledRequestKeyRef = useRef<string | null>(null);
  const lastControlledRouteRef = useRef<string | null>(null);
  const contextValue = useMemo<RouteContentValue>(() => ({
    screens,
    globalFeedback,
    navigationLocked,
    routeLeaveGuard,
  }), [globalFeedback, navigationLocked, routeLeaveGuard, screens]);

  useEffect(() => {
    if (!ready || !navigationRef.isReady()) return;
    if (!isControlledBaseRoute(activeRoute)) return;
    const controlledKey = `${rootSurface}:${activeRoute}`;
    if (lastControlledRouteRef.current === controlledKey) return;
    lastControlledRouteRef.current = controlledKey;
    if (getLeafRouteName(navigationRef.getRootState()) === activeRoute) return;
    navigationRef.dispatch(requestAction({ key: controlledKey, route: activeRoute }));
  }, [activeRoute, ready, rootSurface]);

  useEffect(() => {
    if (!ready || !request || !navigationRef.isReady()) return;
    if (!requestMatchesRootSurface(request.route, rootSurface)) return;
    if (handledRequestKeyRef.current === request.key) return;
    const visibleRoute = getLeafRouteName(navigationRef.getRootState());
    if (request.route === "Profile" && isNestedProfileSettingsRoute(visibleRoute)) {
      navigationRef.goBack();
    } else if (
      !isControlledBaseRoute(request.route)
      || visibleRoute !== request.route
    ) {
      navigationRef.dispatch(requestAction(request));
    }
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
    || route === "PasswordRecoveryCode"
    || route === "PasswordRecoveryConfirm"
    || route === "AcademicOnboarding"
    || route === "Home"
    || route === "Announcements"
    || route === "SummerSchool"
    || route === "YokAnnouncements"
    || route === "Calendar"
    || route === "Profile";
}

function isNestedProfileSettingsRoute(route: string | undefined): boolean {
  return route === "AcademicProfileSettings"
    || route === "NotificationSettings"
    || route === "GoogleCalendarSettings"
    || route === "AccountDataSettings";
}

function requestMatchesRootSurface(route: AppVisibleRoute, surface: AppRootSurface): boolean {
  if (route === "UnknownRoute") return true;
  if (route === "BootstrapLoading") return surface === "hydration_loading";
  if (route === "BootstrapError") return surface === "hydration_error";
  if (route === "AcademicOnboarding") return surface === "onboarding";
  if (route === "Login"
    || route === "Register"
    || route === "Verification"
    || route === "PasswordRecoveryRequest"
    || route === "PasswordRecoveryCode"
    || route === "PasswordRecoveryConfirm") {
    return surface === "auth";
  }
  return surface === "authenticated";
}

function isVisibleRoute(value: string): value is AppVisibleRoute {
  return [
    "BootstrapLoading", "BootstrapError", "Login", "Register", "Verification",
    "PasswordRecoveryRequest", "PasswordRecoveryCode", "PasswordRecoveryConfirm",
    "AcademicOnboarding",
    "Home", "Announcements", "SummerSchool", "YokAnnouncements", "AnnouncementDetail",
    "Calendar", "CalendarEventDetail", "Profile", "AcademicProfileSettings",
    "NotificationSettings", "GoogleCalendarSettings", "AccountDataSettings", "UnknownRoute"
  ].includes(value);
}

function isAuthOrOnboardingRoute(route: AppVisibleRoute): boolean {
  return route === "Login"
    || route === "Register"
    || route === "Verification"
    || route === "PasswordRecoveryRequest"
    || route === "PasswordRecoveryCode"
    || route === "PasswordRecoveryConfirm"
    || route === "AcademicOnboarding";
}

function isAuthenticatedRoute(route: AppVisibleRoute): boolean {
  return route === "Home"
    || route === "Announcements"
    || route === "SummerSchool"
    || route === "YokAnnouncements"
    || route === "AnnouncementDetail"
    || route === "Calendar"
    || route === "CalendarEventDetail"
    || route === "Profile"
    || route === "AcademicProfileSettings"
    || route === "NotificationSettings"
    || route === "GoogleCalendarSettings"
    || route === "AccountDataSettings";
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
    minHeight: 48,
  },
  tabLabel: {
    fontWeight: "600",
    marginTop: 1,
    maxWidth: 76,
    textAlign: "center",
  },
  tabIconIndicator: {
    alignItems: "center",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    minWidth: 44,
    paddingHorizontal: 8,
  },
  tabIconIndicatorAndroid: {
    minWidth: 64,
  },
});
