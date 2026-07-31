import { useCallback, useRef, useState } from "react";
import type {
  AppNavigationRequest,
  AppVisibleRoute,
} from "./AppNavigator";

/**
 * Owns the short-lived UI request envelope that bridges feature state into
 * React Navigation. Route state is intentionally not persisted.
 */
export function useAppRouteRequest(initialRoute: AppVisibleRoute) {
  const [activeRoute, setActiveRoute] = useState<AppVisibleRoute>(initialRoute);
  const [navigationRequest, setNavigationRequest] =
    useState<AppNavigationRequest | null>(null);
  const sequenceRef = useRef(0);

  const requestAppRoute = useCallback((
    route: AppVisibleRoute,
    params?: Readonly<Record<string, string>>,
  ): string => {
    sequenceRef.current += 1;
    const key = `route-${sequenceRef.current}`;
    setNavigationRequest({ key, route, ...(params ? { params } : {}) });
    setActiveRoute(route);
    return key;
  }, []);

  const acknowledgeNavigationRequest = useCallback((requestKey: string): void => {
    setNavigationRequest((current) => current?.key === requestKey ? null : current);
  }, []);

  const clearNavigationRequest = useCallback((): void => {
    setNavigationRequest(null);
  }, []);

  return {
    acknowledgeNavigationRequest,
    activeRoute,
    clearNavigationRequest,
    navigationRequest,
    requestAppRoute,
    setActiveRoute,
  } as const;
}
