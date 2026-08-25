import { Ionicons } from "@expo/vector-icons";
import {
  CommonActions,
  NavigationContainer,
  TabActions,
  createNavigationContainerRef,
  getFocusedRouteNameFromRoute,
  type NavigationState,
  type PartialState,
  useFocusEffect,
  useNavigation,
  usePreventRemove,
  useScrollToTop,
} from "@react-navigation/native";
import {
  BottomTabBarHeightCallbackContext,
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import {
  useSafeAreaInsets,
  type Edge,
} from "react-native-safe-area-context";
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
} from "@react-navigation/native-stack";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  findNodeHandle,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ScrollView,
  type Text as NativeText,
} from "react-native";
import {
  NavigationSurface,
  Screen,
  referencePalette,
  usePlatformAdaptation,
  useReducedMotion,
  useTheme
} from "../design-system";
import { runtimeDiagnostic } from "../performance/runtime-diagnostics";
import { isSafeRouteIdentifier } from "./routes";
import {
  PRIMARY_TABS,
  primaryTabDefinition,
  resolveAppShellLayoutContract,
} from "./app-shell";
import { AdaptiveTopBar } from "./AdaptiveTopBar";
import { resolveNavigationTheme } from "./navigation-theme";

export type AppRootSurface =
  | "hydration_loading"
  | "hydration_error"
  | "introduction"
  | "auth"
  | "onboarding"
  | "authenticated";

export type AppVisibleRoute =
  | "BootstrapLoading"
  | "BootstrapError"
  | "Introduction"
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
  | "FollowedUniversitiesSettings"
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
  Introduction: undefined;
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
  FollowedUniversitiesSettings: undefined;
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
const ANDROID_TAB_PRESS_DEDUPE_MS = 500;
const ANDROID_TAB_PRESS_RETRY_DELAY_MS = 80;
const NAVIGATION_RAIL_WIDTH = 128;

interface RouteContentValue {
  activeRoute: AppVisibleRoute;
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
            setTimeout(() => navigation.dispatch(data.action), 0);
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
  const hasStackHeader = hasAuthenticatedShell && !isContentOwnedHeaderRoute(route);
  const hasFormLayout = isAuthOrOnboardingRoute(route)
    || route === "AcademicProfileSettings"
    || route === "FollowedUniversitiesSettings"
    || route === "AccountDataSettings";
  const authenticatedContentOwnsBottomChrome = hasAuthenticatedShell
    && !isPrimaryTabRootRoute(route);
  const authenticatedEdges = adaptation.navigationLayout === "navigation-rail"
    ? ["right", "bottom"] as const
    : authenticatedContentOwnsBottomChrome
      ? ["left", "right", "bottom"] as const
      : ["left", "right"] as const;
  const authenticatedScreenEdges: readonly Edge[] = hasStackHeader
    ? authenticatedEdges
    : ["top", ...authenticatedEdges];

  useFocusEffect(
    useCallback(() => {
      if (hasStackHeader) return undefined;
      const timer = setTimeout(() => {
        AccessibilityInfo.announceForAccessibility(
          `${routeAccessibilityTitle(route)} ekranı`,
        );
      }, 100);
      return () => clearTimeout(timer);
    }, [hasStackHeader, route]),
  );

  if (isBootstrap) {
    return (
      <Screen centered>
        <View style={styles.bootstrap}>{screens[route]}</View>
      </Screen>
    );
  }

  if (route === "Introduction") {
    return (
      <Screen edges={["top", "left", "right", "bottom"]} fullBleed>
        {globalFeedback}
        {screens[route]}
      </Screen>
    );
  }

  if (route === "Login") {
    return (
      <Screen
        edges={["top", "left", "right"]}
        fullBleed
        keyboardSafe
        readableWidth="form"
      >
        {globalFeedback}
        {screens[route]}
      </Screen>
    );
  }

  if (route === "Register") {
    return (
      <Screen
        contentStyle={styles.registerContent}
        edges={["top", "left", "right", "bottom"]}
        keyboardSafe
        readableWidth="form"
        style={styles.registerSurface}
      >
        {globalFeedback}
        {screens[route]}
      </Screen>
    );
  }

  if (route === "Home") {
    return (
      <Screen
        edges={[...authenticatedScreenEdges]}
        fullBleed
        style={styles.homeRootSurface}
        testID="home-root-surface"
      >
        {globalFeedback}
        {screens[route]}
      </Screen>
    );
  }

  if (route === "Announcements"
    || route === "SummerSchool"
    || route === "YokAnnouncements"
    || route === "AnnouncementDetail"
    || route === "Calendar"
    || route === "CalendarEventDetail") {
    return (
      <Screen edges={[...authenticatedScreenEdges]} fullBleed>
        {globalFeedback}
        {screens[route]}
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      edges={hasAuthenticatedShell ? [...authenticatedScreenEdges] : ["top", "left", "right", "bottom"]}
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
const IntroductionScreen = routeComponent("Introduction");
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
const FollowedUniversitiesSettingsScreen = routeComponent("FollowedUniversitiesSettings");
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
  const titleRef = useRef<NativeText | null>(null);
  const titleTargetRef = useRef<number | null>(null);
  const focusedRef = useRef(false);
  const routeFocusedRef = useRef(false);
  const focusTitle = useCallback((layoutTarget?: number) => {
    const target = layoutTarget
      ?? titleTargetRef.current
      ?? findNodeHandle(titleRef.current);
    if (typeof target !== "number" || target <= 0) return;
    focusedRef.current = true;
    AccessibilityInfo.setAccessibilityFocus(target);
  }, []);

  useFocusEffect(
    useCallback(() => {
      routeFocusedRef.current = true;
      focusedRef.current = false;
      const timer = setTimeout(() => {
        if (!focusedRef.current) focusTitle();
      }, 100);
      return () => {
        routeFocusedRef.current = false;
        clearTimeout(timer);
      };
    }, [focusTitle, route.key, title]),
  );

  return (
    <AdaptiveTopBar
      title={title}
      titleRef={titleRef}
      onTitleLayoutTarget={(target) => {
        titleTargetRef.current = target;
        if (routeFocusedRef.current && !focusedRef.current) focusTitle(target);
      }}
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
      <HomeStack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false, title: "Ana Sayfa" }}
      />
    </HomeStack.Navigator>
  );
}

function AnnouncementsNavigator() {
  const { activeRoute } = useRouteContent();
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <AnnouncementStack.Navigator
      initialRouteName={isAnnouncementStackRoute(activeRoute) ? activeRoute : "Announcements"}
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        gestureEnabled: !navigationLocked,
        header: renderShellStackHeader,
        headerBackTitle: "Gündem",
      }}
    >
      <AnnouncementStack.Screen
        name="Announcements"
        component={AnnouncementsScreen}
        options={{ headerShown: false, title: "Duyurular" }}
      />
      <AnnouncementStack.Screen name="SummerSchool" component={SummerSchoolScreen} options={{ title: "Yaz Okulu" }} />
      <AnnouncementStack.Screen name="YokAnnouncements" component={YokAnnouncementsScreen} options={{ title: "YÖK" }} />
      <AnnouncementStack.Screen name="AnnouncementDetail" component={AnnouncementDetailScreen} options={{ title: "Duyuru Detayı" }} />
    </AnnouncementStack.Navigator>
  );
}

function CalendarNavigator() {
  const { activeRoute } = useRouteContent();
  const { navigationLocked } = useRouteContent();
  const reducedMotion = useReducedMotion();
  const theme = useTheme();
  return (
    <CalendarStack.Navigator
      initialRouteName={isCalendarStackRoute(activeRoute) ? activeRoute : "Calendar"}
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        gestureEnabled: !navigationLocked,
        header: renderShellStackHeader,
        headerBackTitle: "Takvim",
      }}
    >
      <CalendarStack.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ headerShown: false, title: "Takvim" }}
      />
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
      initialRouteName="Profile"
      screenOptions={{
        animation: reducedMotion ? "none" : "default",
        contentStyle: { backgroundColor: theme.colors.background.canvas },
        gestureEnabled: !navigationLocked,
        header: renderShellStackHeader,
        headerBackTitle: "Ayarlar",
      }}
    >
      <SettingsStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false, title: "Ayarlar" }}
      />
      <SettingsStack.Screen name="AcademicProfileSettings" component={AcademicProfileSettingsScreen} options={{ title: "Akademik Profil" }} />
      <SettingsStack.Screen name="FollowedUniversitiesSettings" component={FollowedUniversitiesSettingsScreen} options={{ title: "Üniversite Takipleri" }} />
      <SettingsStack.Screen
        name="NotificationSettings"
        component={NotificationSettingsScreen}
        options={{ headerShown: false, title: "Bildirim tercihleri" }}
      />
      <SettingsStack.Screen name="GoogleCalendarSettings" component={GoogleCalendarSettingsScreen} options={{ title: "Google Takvim" }} />
      <SettingsStack.Screen name="AccountDataSettings" component={AccountDataSettingsScreen} options={{ title: "Hesap ve veri" }} />
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
  const definition = primaryTabDefinition(route);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.tabIconIndicator}
    >
      <Ionicons
        name={focused ? definition.selectedIcon : definition.icon}
        color={color}
        size={size}
      />
    </View>
  );
}

function ShellBottomTabBar({
  descriptors,
  insets,
  navigation,
  state,
}: BottomTabBarProps) {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const lastAndroidTabPressRef = useRef<{ routeKey: string; handledAt: number } | null>(null);
  const { fontScale, width } = useWindowDimensions();
  const contract = resolveAppShellLayoutContract({
    platform: adaptation.platform,
    windowWidth: width,
    fontScale,
  });
  const contentHeight = contract.bottomNavigationContentHeight ?? 64;
  const barHeight = contentHeight + insets.bottom;
  const activeTabRoute = state.routes[state.index];
  const activeTabDefinition = activeTabRoute
    ? primaryTabDefinition(activeTabRoute.name as keyof MainTabParamList)
    : null;
  const focusedContentRoute = activeTabRoute
    ? getFocusedRouteNameFromRoute(activeTabRoute) ?? activeTabDefinition?.rootRoute
    : undefined;
  const contentOwnsBottomChrome = Boolean(
    activeTabDefinition && focusedContentRoute !== activeTabDefinition.rootRoute,
  );
  const activeTint = theme.colors.action.primary;
  const inactiveTint = theme.colors.text.secondary;
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height);
  }, [onHeightChange]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (contentOwnsBottomChrome) onHeightChange?.(0);
  }, [contentOwnsBottomChrome, onHeightChange]);

  useEffect(() => {
    runtimeDiagnostic("navigation.tab_visible", {
      route: activeTabRoute?.name ?? "unknown",
      index: state.index,
    });
  }, [activeTabRoute?.name, state.index]);

  const renderTab = (routeIndex: number) => {
    const route = state.routes[routeIndex];
    if (!route) return null;
    const definition = primaryTabDefinition(route.name as keyof MainTabParamList);
    const descriptor = descriptors[route.key];
    const focused = state.index === routeIndex;
    const color = focused ? activeTint : inactiveTint;
    const onPress = () => {
      runtimeDiagnostic("navigation.tab_press", {
        route: route.name,
        focused,
        platform: Platform.OS,
      });
      let androidPressToken: number | null = null;
      if (Platform.OS === "android") {
        const now = Date.now();
        const previous = lastAndroidTabPressRef.current;
        if (previous?.routeKey === route.key && now - previous.handledAt < ANDROID_TAB_PRESS_DEDUPE_MS) return;
        lastAndroidTabPressRef.current = { routeKey: route.key, handledAt: now };
        androidPressToken = now;
      }
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        const jumpToRoute = () => navigation.dispatch(TabActions.jumpTo(route.name, route.params));
        runtimeDiagnostic("navigation.tab_dispatch", { route: route.name });
        jumpToRoute();
        if (Platform.OS === "android" && androidPressToken !== null) {
          setTimeout(() => {
            const previous = lastAndroidTabPressRef.current;
            if (previous?.routeKey !== route.key || previous.handledAt !== androidPressToken) return;
            const tabState = navigation.getState();
            const targetIndex = tabState.routes.findIndex((candidate) => candidate.key === route.key);
            if (targetIndex >= 0 && tabState.index !== targetIndex) jumpToRoute();
          }, ANDROID_TAB_PRESS_RETRY_DELAY_MS);
        }
      }
    };
    const onLongPress = () => {
      navigation.emit({ type: "tabLongPress", target: route.key });
    };

    return (
      <TouchableOpacity
        activeOpacity={0.72}
        key={route.key}
        accessibilityHint={`${definition.label} sekmesini açar.`}
        accessibilityLabel={descriptor.options.tabBarAccessibilityLabel ?? definition.label}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        delayPressIn={0}
        onLongPress={onLongPress}
        onPress={onPress}
        onPressIn={Platform.OS === "android" ? onPress : undefined}
        style={styles.tabItem}
        testID={descriptor.options.tabBarButtonTestID}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.tabActiveIndicator, !focused && styles.tabActiveIndicatorHidden]}
        />
        <ShellTabIcon color={color} focused={focused} route={definition.route} size={25} />
        <ShellTabLabel color={color} label={definition.label} />
      </TouchableOpacity>
    );
  };

  if (contentOwnsBottomChrome) return null;

  return (
    <NavigationSurface
      accessibilityElementsHidden={keyboardVisible}
      accessibilityLabel="Ana gezinme"
      accessibilityRole="tablist"
      importantForAccessibility={keyboardVisible ? "no-hide-descendants" : "auto"}
      kind="tab-bar"
      onLayout={handleLayout}
      pointerEvents={keyboardVisible ? "none" : "auto"}
      style={[
        styles.bottomTabBar,
        {
          backgroundColor: theme.colors.background.surfaceRaised,
          borderColor: theme.colors.border.subtle,
          height: keyboardVisible ? 0 : barHeight,
          opacity: keyboardVisible ? 0 : 1,
          overflow: keyboardVisible ? "hidden" : "visible",
          paddingBottom: keyboardVisible ? 0 : insets.bottom,
          paddingLeft: Math.max(insets.left, 4),
          paddingRight: Math.max(insets.right, 4),
        },
      ]}
    >
      {state.routes.map((_route, routeIndex) => renderTab(routeIndex))}
    </NavigationSurface>
  );
}

function renderShellBottomTabBar(props: BottomTabBarProps) {
  return <ShellBottomTabBar {...props} />;
}

function ShellTabLabel({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
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
        theme.typography.navLabel,
        styles.tabLabel,
        adaptation.navigationLayout === "navigation-rail" && styles.railTabLabel,
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

function isAnnouncementStackRoute(route: AppVisibleRoute): route is keyof AnnouncementStackParamList {
  return route === "Announcements"
    || route === "SummerSchool"
    || route === "YokAnnouncements"
    || route === "AnnouncementDetail";
}

function isCalendarStackRoute(route: AppVisibleRoute): route is keyof CalendarStackParamList {
  return route === "Calendar" || route === "CalendarEventDetail";
}

function isSettingsStackRoute(route: AppVisibleRoute): route is keyof SettingsStackParamList {
  return route === "Profile"
    || route === "AcademicProfileSettings"
    || route === "FollowedUniversitiesSettings"
    || route === "NotificationSettings"
    || route === "GoogleCalendarSettings"
    || route === "AccountDataSettings";
}

function tabRouteForVisibleRoute(route: AppVisibleRoute): keyof MainTabParamList {
  if (isAnnouncementStackRoute(route)) return "AnnouncementsTab";
  if (isCalendarStackRoute(route)) return "CalendarTab";
  if (isSettingsStackRoute(route)) return "ProfileTab";
  return "HomeTab";
}

function AuthenticatedNavigator() {
  const { activeRoute } = useRouteContent();
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
      initialRouteName={tabRouteForVisibleRoute(activeRoute)}
      backBehavior="history"
      tabBar={useNavigationRail ? undefined : renderShellBottomTabBar}
      screenOptions={({ route }) => {
        const definition = primaryTabDefinition(route.name);
        const focusedContentRoute = getFocusedRouteNameFromRoute(route) ?? definition.rootRoute;
        const contentOwnsBottomChrome = focusedContentRoute !== definition.rootRoute;
        return {
          headerShown: false,
          freezeOnBlur: true,
          lazy: true,
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
          tabBarItemStyle: useNavigationRail ? styles.railTabItem : styles.tabItem,
          tabBarLabel: ({ color }) => (
            <ShellTabLabel color={color} label={definition.label} />
          ),
          tabBarLabelPosition: useNavigationRail ? "below-icon" : undefined,
          tabBarPosition: useNavigationRail ? "left" : "bottom",
          tabBarStyle: {
            backgroundColor: "transparent",
            borderColor: theme.colors.border.subtle,
            display: contentOwnsBottomChrome ? "none" : "flex",
            height: bottomNavigationHeight,
            maxWidth: useNavigationRail ? NAVIGATION_RAIL_WIDTH : undefined,
            minWidth: useNavigationRail ? NAVIGATION_RAIL_WIDTH : undefined,
            paddingBottom: useNavigationRail ? Math.max(insets.bottom, 8) : undefined,
            paddingTop: useNavigationRail ? Math.max(insets.top, 12) : undefined,
            width: useNavigationRail ? NAVIGATION_RAIL_WIDTH : undefined,
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

function expectedSafeRequestLeaf(request: AppNavigationRequest): AppVisibleRoute {
  const params = request.params ?? {};
  if (request.route === "AnnouncementDetail" && !isSafeRouteIdentifier(params.announcementId)) {
    return "UnknownRoute";
  }
  if (request.route === "CalendarEventDetail" && !isSafeRouteIdentifier(params.eventId)) {
    return "UnknownRoute";
  }
  return request.route;
}

function requestAction(request: AppNavigationRequest) {
  const params = request.params ?? {};
  switch (request.route) {
    case "Introduction":
      return CommonActions.navigate("Introduction");
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
      if (expectedSafeRequestLeaf(request) === "UnknownRoute") {
        return CommonActions.navigate("UnknownRoute");
      }
      return CommonActions.navigate("Authenticated", {
        screen: "AnnouncementsTab",
        params: {
          screen: "AnnouncementDetail",
          params: { announcementId: params.announcementId },
          initial: false
        }
      });
    case "Calendar":
      return CommonActions.navigate("Authenticated", { screen: "CalendarTab", params: { screen: "Calendar" } });
    case "CalendarEventDetail":
      if (expectedSafeRequestLeaf(request) === "UnknownRoute") {
        return CommonActions.navigate("UnknownRoute");
      }
      return CommonActions.navigate("Authenticated", {
        screen: "CalendarTab",
        params: {
          screen: "CalendarEventDetail",
          params: { eventId: params.eventId },
          initial: false
        }
      });
    case "Profile":
      return CommonActions.navigate("Authenticated", {
        screen: "ProfileTab",
        params: { screen: "Profile" }
      });
    case "AcademicProfileSettings":
    case "FollowedUniversitiesSettings":
    case "NotificationSettings":
    case "GoogleCalendarSettings":
    case "AccountDataSettings":
      return CommonActions.navigate("Authenticated", {
        screen: "ProfileTab",
        params: {
          screen: request.route,
          initial: false,
        }
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
    case "introduction": return "Introduction";
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
  const navigationTheme = useMemo(() => resolveNavigationTheme(theme), [theme]);
  const [ready, setReady] = useState(false);
  const handledRequestKeysRef = useRef(new Set<string>());
  const pendingRequestRef = useRef<{ key: string; expectedLeaf: AppVisibleRoute } | null>(null);
  const lastControlledRouteRef = useRef<string | null>(null);
  const contextValue = useMemo<RouteContentValue>(() => ({
    activeRoute,
    screens,
    globalFeedback,
    navigationLocked,
    routeLeaveGuard,
  }), [activeRoute, globalFeedback, navigationLocked, routeLeaveGuard, screens]);

  const acknowledgeVisibleRequest = useCallback((leaf: string | undefined): void => {
    if (!leaf || !request || !requestMatchesRootSurface(request.route, rootSurface)) return;
    const pending = pendingRequestRef.current;
    if (
      !pending
      || pending.key !== request.key
      || pending.expectedLeaf !== leaf
      || handledRequestKeysRef.current.has(request.key)
    ) return;
    handledRequestKeysRef.current.add(request.key);
    pendingRequestRef.current = null;
    onRequestHandled?.(request.key);
  }, [onRequestHandled, request, rootSurface]);

  const reportVisibleRoute = useCallback(() => {
    const leaf = getLeafRouteName(navigationRef.getRootState());
    if (!leaf || !isVisibleRoute(leaf)) return;
    onVisibleRouteChange?.(leaf);
    acknowledgeVisibleRequest(leaf);
  }, [acknowledgeVisibleRequest, onVisibleRouteChange]);

  useEffect(() => {
    if (!ready || !navigationRef.isReady()) return;
    // Authenticated tab and stack navigation already reports its visible leaf
    // upstream. Re-dispatching that delayed value can bounce a slow first mount
    // back to the previously visible tab.
    if (rootSurface === "authenticated") return;
    if (!isControlledBaseRoute(activeRoute)) return;
    const controlledKey = `${rootSurface}:${activeRoute}`;
    if (lastControlledRouteRef.current === controlledKey) return;
    lastControlledRouteRef.current = controlledKey;
    if (getLeafRouteName(navigationRef.getRootState()) === activeRoute) return;
    navigationRef.dispatch(requestAction({ key: controlledKey, route: activeRoute }));
  }, [activeRoute, ready, rootSurface]);

  useEffect(() => {
    if (!request) {
      pendingRequestRef.current = null;
      return;
    }
    if (!ready || !navigationRef.isReady()) return;
    if (
      !requestMatchesRootSurface(request.route, rootSurface)
      || handledRequestKeysRef.current.has(request.key)
    ) {
      if (pendingRequestRef.current?.key === request.key) pendingRequestRef.current = null;
      return;
    }
    const expectedLeaf = expectedSafeRequestLeaf(request);
    pendingRequestRef.current = { key: request.key, expectedLeaf };
    const visibleRoute = getLeafRouteName(navigationRef.getRootState());
    if (request.route === "Profile" && isNestedProfileSettingsRoute(visibleRoute)) {
      navigationRef.goBack();
    } else if (
      !isControlledBaseRoute(request.route)
      || visibleRoute !== request.route
    ) {
      navigationRef.dispatch(requestAction(request));
    } else {
      acknowledgeVisibleRequest(visibleRoute);
    }
  }, [acknowledgeVisibleRequest, ready, request, rootSurface]);

  useEffect(() => {
    if (!navigationLocked || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [navigationLocked]);

  return (
    <RouteContentContext.Provider value={contextValue}>
      <NavigationContainer
        ref={navigationRef}
        theme={navigationTheme}
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
          {rootSurface === "introduction" && (
            <RootStack.Screen name="Introduction" component={IntroductionScreen} />
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
    || route === "Introduction"
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
    || route === "FollowedUniversitiesSettings"
    || route === "NotificationSettings"
    || route === "GoogleCalendarSettings"
    || route === "AccountDataSettings";
}

function requestMatchesRootSurface(route: AppVisibleRoute, surface: AppRootSurface): boolean {
  if (route === "UnknownRoute") return surface === "authenticated";
  if (route === "BootstrapLoading") return surface === "hydration_loading";
  if (route === "BootstrapError") return surface === "hydration_error";
  if (route === "Introduction") return surface === "introduction";
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
    "BootstrapLoading", "BootstrapError", "Introduction", "Login", "Register", "Verification",
    "PasswordRecoveryRequest", "PasswordRecoveryCode", "PasswordRecoveryConfirm",
    "AcademicOnboarding",
    "Home", "Announcements", "SummerSchool", "YokAnnouncements", "AnnouncementDetail",
    "Calendar", "CalendarEventDetail", "Profile", "AcademicProfileSettings", "FollowedUniversitiesSettings",
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
    || route === "FollowedUniversitiesSettings"
    || route === "NotificationSettings"
    || route === "GoogleCalendarSettings"
    || route === "AccountDataSettings";
}

function isPrimaryTabRootRoute(route: AppVisibleRoute): boolean {
  return route === "Home"
    || route === "Announcements"
    || route === "Calendar"
    || route === "Profile";
}

function isContentOwnedHeaderRoute(route: AppVisibleRoute): boolean {
  return isPrimaryTabRootRoute(route) || route === "NotificationSettings";
}

const ROUTE_ACCESSIBILITY_TITLES: Readonly<Record<AppVisibleRoute, string>> = {
  BootstrapLoading: "Uygulama hazırlanıyor",
  BootstrapError: "Başlangıç tamamlanamadı",
  Introduction: "Akademik Takvim tanıtımı",
  Login: "Giriş",
  Register: "Kayıt",
  Verification: "E-posta doğrulama",
  PasswordRecoveryRequest: "Şifre kurtarma",
  PasswordRecoveryCode: "Şifre kurtarma kodu",
  PasswordRecoveryConfirm: "Yeni şifre",
  AcademicOnboarding: "Akademik profil",
  Home: "Ana Sayfa",
  Announcements: "Duyurular",
  SummerSchool: "Yaz Okulu",
  YokAnnouncements: "YÖK Duyuruları",
  AnnouncementDetail: "Duyuru Detayı",
  Calendar: "Takvim",
  CalendarEventDetail: "Takvim Ayrıntısı",
  Profile: "Profil",
  AcademicProfileSettings: "Akademik Profil",
  FollowedUniversitiesSettings: "Üniversite Takipleri",
  NotificationSettings: "Bildirim tercihleri",
  GoogleCalendarSettings: "Google Takvim",
  AccountDataSettings: "Hesap ve Veri",
  UnknownRoute: "Sayfa bulunamadı",
};

function routeAccessibilityTitle(route: AppVisibleRoute): string {
  return ROUTE_ACCESSIBILITY_TITLES[route];
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
  homeRootSurface: {
    backgroundColor: referencePalette.academicBlueDeep,
  },
  registerSurface: {
    backgroundColor: referencePalette.white,
  },
  registerContent: {
    backgroundColor: referencePalette.white,
    justifyContent: "center",
  },
  tabItem: {
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-start",
    minHeight: 48,
    paddingTop: 10,
    position: "relative",
  },
  railTabItem: {
    alignItems: "center",
    flex: 0,
    height: 78,
    justifyContent: "center",
    minHeight: 72,
    paddingHorizontal: 8,
    paddingTop: 0,
    width: "100%",
  },
  tabLabel: {
    marginTop: 1,
    maxWidth: 76,
    textAlign: "center",
  },
  railTabLabel: {
    maxWidth: 100,
  },
  tabIconIndicator: {
    alignItems: "center",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    minWidth: 32,
  },
  bottomTabBar: {
    alignItems: "flex-start",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    elevation: 12,
    flexDirection: "row",
    overflow: "visible",
    paddingTop: 4,
    shadowColor: referencePalette.navy,
    shadowOffset: { height: -5, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  tabActiveIndicator: {
    backgroundColor: referencePalette.academicBlue,
    borderRadius: 999,
    height: 4,
    left: "24%",
    position: "absolute",
    right: "24%",
    top: 0,
  },
  tabActiveIndicatorHidden: {
    opacity: 0,
  },
});
