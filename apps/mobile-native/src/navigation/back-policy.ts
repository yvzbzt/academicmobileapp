import {
  appRoutes,
  isProtectedRoute,
  parentRouteFor,
  rootRouteForTab,
  tabForRoute,
  type AppRoute,
  type MainTabRouteName
} from "./routes";

export interface TabHistoryState {
  activeTab: MainTabRouteName;
  /** Oldest to newest, excluding the active tab. */
  history: MainTabRouteName[];
}

export type TabSelectionResult = {
  state: TabHistoryState;
  effect: "selected" | "reselected";
};

export type TabBackResult = {
  state: TabHistoryState;
  tab: MainTabRouteName;
  route: ReturnType<typeof rootRouteForTab>;
} | null;

export interface AndroidBackPolicyInput {
  route: AppRoute;
  tabHistory: TabHistoryState;
  signedIn: boolean;
  hasOpenOverlay?: boolean;
  canPopStack?: boolean;
}

export type AndroidBackDecision =
  | { action: "dismiss_overlay" }
  | { action: "pop_stack"; fallbackRoute: AppRoute }
  | { action: "replace"; route: AppRoute }
  | {
      action: "switch_tab";
      tab: MainTabRouteName;
      route: AppRoute;
      tabHistory: TabHistoryState;
    }
  | { action: "exit_app" }
  | { action: "ignore" };

export function createTabHistory(
  activeTab: MainTabRouteName = "HomeTab"
): TabHistoryState {
  return { activeTab, history: [] };
}

export function selectTab(
  state: TabHistoryState,
  nextTab: MainTabRouteName
): TabSelectionResult {
  const normalized = normalizeTabHistory(state);
  if (normalized.activeTab === nextTab) {
    return { state: normalized, effect: "reselected" };
  }

  return {
    effect: "selected",
    state: {
      activeTab: nextTab,
      history: [
        ...normalized.history.filter(
          (tab) => tab !== normalized.activeTab && tab !== nextTab
        ),
        normalized.activeTab
      ]
    }
  };
}

export function popTabHistory(state: TabHistoryState): TabBackResult {
  const normalized = normalizeTabHistory(state);
  const history = [...normalized.history];
  const previousTab = history.pop();
  if (previousTab) {
    return {
      tab: previousTab,
      route: rootRouteForTab(previousTab),
      state: { activeTab: previousTab, history }
    };
  }
  if (normalized.activeTab !== "HomeTab") {
    return {
      tab: "HomeTab",
      route: appRoutes.home(),
      state: createTabHistory()
    };
  }
  return null;
}

/**
 * Pure and side-effect free so the same result can be used for an Android
 * predictive-back preview and the committed system-back action.
 */
export function resolveAndroidBackPolicy(
  input: AndroidBackPolicyInput
): AndroidBackDecision {
  if (input.hasOpenOverlay) return { action: "dismiss_overlay" };
  if (input.route.name === "Hydration") return { action: "ignore" };
  if (input.route.name === "Unknown") {
    return {
      action: "replace",
      route: input.signedIn ? appRoutes.home() : appRoutes.login()
    };
  }

  const parentRoute = parentRouteFor(input.route);
  if (parentRoute) {
    return input.canPopStack
      ? { action: "pop_stack", fallbackRoute: parentRoute }
      : { action: "replace", route: parentRoute };
  }

  if (!input.signedIn) {
    return input.route.name === "Login"
      ? { action: "exit_app" }
      : { action: "replace", route: appRoutes.login() };
  }

  if (!isProtectedRoute(input.route)) {
    return { action: "replace", route: appRoutes.home() };
  }

  const routeTab = tabForRoute(input.route);
  const synchronizedHistory = input.tabHistory.activeTab === routeTab
    ? input.tabHistory
    : { ...input.tabHistory, activeTab: routeTab };
  const previous = popTabHistory(synchronizedHistory);
  if (!previous) return { action: "exit_app" };
  return {
    action: "switch_tab",
    tab: previous.tab,
    route: previous.route,
    tabHistory: previous.state
  };
}

export const previewAndroidBack = resolveAndroidBackPolicy;

export function allowsIosSwipeBack(route: AppRoute, hasBlockingOperation = false): boolean {
  return !hasBlockingOperation && parentRouteFor(route) !== null;
}

function normalizeTabHistory(state: TabHistoryState): TabHistoryState {
  const seen = new Set<MainTabRouteName>();
  const history: MainTabRouteName[] = [];
  for (const tab of state.history) {
    if (tab === state.activeTab || seen.has(tab)) continue;
    seen.add(tab);
    history.push(tab);
  }
  return { activeTab: state.activeTab, history };
}
