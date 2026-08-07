import {
  appRoutes,
  isAppRoute,
  isAuthRoute,
  isOnboardingRoute,
  isProtectedRoute,
  isValidRouteOwner,
  routeKey,
  type AppRoute,
  type AuthRoute,
  type RouteOwner
} from "./routes";

export type RouteAuthMode = "login" | "register";
export type RouteAuthStage =
  | "auth"
  | "verify"
  | "academic_onboarding"
  | "password_recovery_request"
  | "password_recovery_code"
  | "password_recovery_confirm";

export type RootRouteSurface =
  | "hydration"
  | "auth"
  | "onboarding"
  | "authenticated"
  | "unknown";

export type RootRouteReason =
  | "hydration_loading"
  | "hydration_error"
  | "session_missing"
  | "session_invalid"
  | "current_owner_missing"
  | "current_owner_invalid"
  | "session_owner_mismatch"
  | "credential_generation_mismatch"
  | "signed_in_default"
  | "signed_in_requested"
  | "signed_in_public_guard"
  | "signed_out_auth_flow"
  | "signed_out_requested"
  | "signed_out_protected_guard"
  | "academic_onboarding_required"
  | "verification_context_missing"
  | "password_recovery_context_missing"
  | "unknown_destination";

export interface RootRouteState {
  hydrationStatus: "loading" | "ready" | "error";
  sessionOwner: RouteOwner | null;
  currentOwner: RouteOwner | null;
  authMode: RouteAuthMode;
  authStage: RouteAuthStage;
  hasPendingVerification: boolean;
  hasPendingPasswordRecovery: boolean;
  requestedRoute?: AppRoute | null;
}

export interface RootRouteResolution {
  surface: RootRouteSurface;
  route: AppRoute;
  redirected: boolean;
  reason: RootRouteReason;
}

export interface RouteGuardResolution {
  route: AppRoute;
  allowed: boolean;
  reason: "allowed" | "authentication_required" | "already_authenticated";
}

export function resolveRootRoute(state: RootRouteState): RootRouteResolution {
  if (state.hydrationStatus !== "ready") {
    return {
      surface: "hydration",
      route: appRoutes.hydration(state.hydrationStatus),
      redirected: Boolean(state.requestedRoute),
      reason: state.hydrationStatus === "loading" ? "hydration_loading" : "hydration_error"
    };
  }

  const requestedRoute = state.requestedRoute === undefined || state.requestedRoute === null
    ? null
    : isAppRoute(state.requestedRoute)
      ? state.requestedRoute
      : appRoutes.unknown();

  if (!state.sessionOwner) {
    return resolveMissingSessionRoute(state, requestedRoute);
  }
  if (!isValidRouteOwner(state.sessionOwner.ownerId, state.sessionOwner.generation)) {
    return failClosedIdentityResolution("session_invalid");
  }
  if (!state.currentOwner) {
    return failClosedIdentityResolution("current_owner_missing");
  }
  if (!isValidRouteOwner(state.currentOwner.ownerId, state.currentOwner.generation)) {
    return failClosedIdentityResolution("current_owner_invalid");
  }
  if (state.sessionOwner.ownerId !== state.currentOwner.ownerId) {
    return failClosedIdentityResolution("session_owner_mismatch");
  }
  if (state.sessionOwner.generation !== state.currentOwner.generation) {
    return failClosedIdentityResolution("credential_generation_mismatch");
  }

  if (state.authStage === "academic_onboarding") {
    return academicOnboardingResolution(requestedRoute);
  }

  return resolveSignedInRoute(requestedRoute, state.currentOwner);
}

function resolveMissingSessionRoute(
  state: RootRouteState,
  requestedRoute: AppRoute | null
): RootRouteResolution {
  const authResolution = resolveSignedOutAuthRoute(state);
  if (state.authStage !== "auth") return authResolution;
  if (!requestedRoute) return authResolution;

  if (
    requestedRoute.name === "Unknown"
    || isProtectedRoute(requestedRoute)
    || isOnboardingRoute(requestedRoute)
    || requestedRoute.name === "Hydration"
  ) {
    return {
      ...authResolution,
      redirected: true,
      reason: requestedRoute.name === "AcademicOnboarding"
        ? "session_missing"
        : "signed_out_protected_guard"
    };
  }
  if (requestedRoute.name === "Verification" && !state.hasPendingVerification) {
    return {
      surface: "auth",
      route: appRoutes.login(),
      redirected: true,
      reason: "verification_context_missing"
    };
  }
  if (
    (requestedRoute.name === "PasswordRecoveryCode"
      || requestedRoute.name === "PasswordRecoveryConfirm")
    && !state.hasPendingPasswordRecovery
  ) {
    return {
      surface: "auth",
      route: appRoutes.passwordRecoveryRequest(),
      redirected: true,
      reason: "password_recovery_context_missing"
    };
  }

  return {
    surface: "auth",
    route: requestedRoute,
    redirected: false,
    reason: "signed_out_requested"
  };
}

export function resolveSignedOutAuthRoute(
  state: Pick<
    RootRouteState,
    "authMode" | "authStage" | "hasPendingVerification" | "hasPendingPasswordRecovery"
  >
): RootRouteResolution {
  switch (state.authStage) {
    case "verify":
      if (!state.hasPendingVerification) {
        return authResolution(appRoutes.login(), true, "verification_context_missing");
      }
      return authResolution(appRoutes.verification());
    case "academic_onboarding":
      return authResolution(appRoutes.login(), true, "session_missing");
    case "password_recovery_request":
      return authResolution(appRoutes.passwordRecoveryRequest());
    case "password_recovery_code":
      if (!state.hasPendingPasswordRecovery) {
        return authResolution(
          appRoutes.passwordRecoveryRequest(),
          true,
          "password_recovery_context_missing"
        );
      }
      return authResolution(appRoutes.passwordRecoveryCode());
    case "password_recovery_confirm":
      if (!state.hasPendingPasswordRecovery) {
        return authResolution(
          appRoutes.passwordRecoveryRequest(),
          true,
          "password_recovery_context_missing"
        );
      }
      return authResolution(appRoutes.passwordRecoveryConfirm());
    case "auth":
      return authResolution(
        state.authMode === "register" ? appRoutes.register() : appRoutes.login()
      );
  }
}

function failClosedIdentityResolution(
  reason: Extract<
    RootRouteReason,
    | "session_invalid"
    | "current_owner_missing"
    | "current_owner_invalid"
    | "session_owner_mismatch"
    | "credential_generation_mismatch"
  >
): RootRouteResolution {
  return authResolution(appRoutes.login(), true, reason);
}

function academicOnboardingResolution(
  requestedRoute: AppRoute | null = null
): RootRouteResolution {
  const route = appRoutes.academicOnboarding();
  return {
    surface: "onboarding",
    route,
    redirected: requestedRoute !== null && routeKey(requestedRoute) !== routeKey(route),
    reason: "academic_onboarding_required"
  };
}

export function guardRouteForOwner(
  route: AppRoute,
  owner: RouteOwner | null
): RouteGuardResolution {
  const isSignedIn = isValidRouteOwner(owner?.ownerId, owner?.generation);
  if (isSignedIn) {
    if (isAuthRoute(route) || isOnboardingRoute(route) || route.name === "Hydration") {
      return {
        route: appRoutes.home(),
        allowed: false,
        reason: "already_authenticated"
      };
    }
    return { route, allowed: true, reason: "allowed" };
  }

  if (isProtectedRoute(route) || route.name === "Hydration") {
    return {
      route: appRoutes.login(),
      allowed: false,
      reason: "authentication_required"
    };
  }
  return { route, allowed: true, reason: "allowed" };
}

function resolveSignedInRoute(
  requestedRoute: AppRoute | null,
  owner: RouteOwner
): RootRouteResolution {
  if (!requestedRoute) {
    return {
      surface: "authenticated",
      route: appRoutes.home(),
      redirected: false,
      reason: "signed_in_default"
    };
  }

  const guarded = guardRouteForOwner(requestedRoute, owner);
  if (guarded.route.name === "Unknown") {
    return {
      surface: "unknown",
      route: guarded.route,
      redirected: false,
      reason: "unknown_destination"
    };
  }
  return {
    surface: "authenticated",
    route: guarded.route,
    redirected: !guarded.allowed || routeKey(guarded.route) !== routeKey(requestedRoute),
    reason: guarded.allowed ? "signed_in_requested" : "signed_in_public_guard"
  };
}

function authResolution(
  route: AuthRoute,
  redirected = false,
  reason: RootRouteReason = "signed_out_auth_flow"
): RootRouteResolution {
  return {
    surface: "auth",
    route,
    redirected,
    reason
  };
}
