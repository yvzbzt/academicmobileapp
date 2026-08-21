import { describe, expect, it } from "vitest";
import {
  ACADEMIC_PULSE_ROUTE_URLS,
  ANNOUNCEMENT_ROUTE_NAMES,
  AUTH_ROUTE_NAMES,
  CALENDAR_ROUTE_NAMES,
  MAIN_TAB_ROUTE_NAMES,
  SETTINGS_ROUTE_NAMES,
  RouteIntentCoordinator,
  allowsIosSwipeBack,
  appRoutes,
  createTabHistory,
  createVerifiedNotificationIntent,
  guardRouteForOwner,
  isAppRoute,
  mapLegacyDestination,
  parseAcademicPulseRouteUrl,
  popTabHistory,
  previewAndroidBack,
  resolveAndroidBackPolicy,
  resolveRootRoute,
  rootRouteForTab,
  routeForVerifiedNotification,
  selectTab,
  tabForRoute,
  type AppRouteIntent,
  type RootRouteState
} from "../../apps/mobile-native/src/navigation";

const ownerA = { ownerId: "owner-a", generation: 4 };

describe("Phase 4 typed route graph", () => {
  it("publishes the approved auth, tab, content, calendar, and settings route families", () => {
    expect(AUTH_ROUTE_NAMES).toEqual([
      "Login",
      "Register",
      "Verification",
      "PasswordRecoveryRequest",
      "PasswordRecoveryCode",
      "PasswordRecoveryConfirm"
    ]);
    expect(MAIN_TAB_ROUTE_NAMES).toEqual([
      "HomeTab",
      "AnnouncementsTab",
      "CalendarTab",
      "ProfileTab"
    ]);
    expect(ANNOUNCEMENT_ROUTE_NAMES).toEqual([
      "Announcements",
      "SummerSchool",
      "YokAnnouncements",
      "AnnouncementDetail"
    ]);
    expect(CALENDAR_ROUTE_NAMES).toEqual(["Calendar", "CalendarEventDetail"]);
    expect(SETTINGS_ROUTE_NAMES).toEqual([
      "AcademicProfileSettings",
      "FollowedUniversitiesSettings",
      "NotificationSettings",
      "GoogleCalendarSettings",
      "AccountDataSettings"
    ]);
  });

  it("maps every legacy six-tab destination without deleting Summer School or YÖK", () => {
    expect(mapLegacyDestination("home")).toEqual({ name: "Home" });
    expect(mapLegacyDestination("announcements")).toEqual({ name: "Announcements" });
    expect(mapLegacyDestination("summer")).toEqual({ name: "SummerSchool" });
    expect(mapLegacyDestination("yok")).toEqual({ name: "YokAnnouncements" });
    expect(mapLegacyDestination("calendar")).toEqual({ name: "Calendar" });
    expect(mapLegacyDestination("profile")).toEqual({ name: "Profile" });
  });

  it("assigns every protected leaf to exactly one of the four tabs", () => {
    expect(tabForRoute(appRoutes.home())).toBe("HomeTab");
    expect(tabForRoute(appRoutes.announcementDetail("announcement-42"))).toBe("AnnouncementsTab");
    expect(tabForRoute(appRoutes.summerSchool())).toBe("AnnouncementsTab");
    expect(tabForRoute(appRoutes.yokAnnouncements())).toBe("AnnouncementsTab");
    expect(tabForRoute(appRoutes.calendarEventDetail("event-17"))).toBe("CalendarTab");
    expect(tabForRoute(appRoutes.notificationSettings())).toBe("ProfileTab");
    expect(MAIN_TAB_ROUTE_NAMES.map(rootRouteForTab)).toEqual([
      { name: "Home" },
      { name: "Announcements" },
      { name: "Calendar" },
      { name: "Profile" }
    ]);
  });

  it("accepts only exact, safe runtime route objects", () => {
    expect(isAppRoute(appRoutes.announcementDetail("announcement:42"))).toBe(true);
    expect(isAppRoute(appRoutes.calendarEventDetail("calendar-event.17"))).toBe(true);
    expect(isAppRoute(appRoutes.passwordRecoveryCode())).toBe(true);
    expect(isAppRoute(appRoutes.academicOnboarding())).toBe(true);
    expect(isAppRoute({ name: "Unknown" })).toBe(true);
    expect(isAppRoute({ name: "Unknown", rawUrl: "https://evil.example" })).toBe(false);
    expect(isAppRoute({ name: "AnnouncementDetail", params: { announcementId: "../unsafe" } })).toBe(false);
    expect(() => appRoutes.calendarEventDetail("../unsafe")).toThrow("safe route identifier");
  });
});

describe("deterministic hydration, auth, and route guards", () => {
  it("keeps loading and recoverable error hydration above sessions and requested routes", () => {
    expect(resolveRootRoute(rootState({
      hydrationStatus: "loading",
      sessionOwner: ownerA,
      currentOwner: { ownerId: "owner-b", generation: ownerA.generation },
      authStage: "academic_onboarding",
      requestedRoute: appRoutes.notificationSettings()
    }))).toEqual({
      surface: "hydration",
      route: { name: "Hydration", params: { status: "loading" } },
      redirected: true,
      reason: "hydration_loading"
    });
    expect(resolveRootRoute(rootState({
      hydrationStatus: "error",
      sessionOwner: ownerA,
      currentOwner: { ownerId: ownerA.ownerId, generation: ownerA.generation + 1 },
      authStage: "academic_onboarding"
    }))).toMatchObject({
      surface: "hydration",
      route: { name: "Hydration", params: { status: "error" } },
      reason: "hydration_error"
    });
  });

  it("resolves signed-out Login and Register deterministically", () => {
    expect(resolveRootRoute(rootState({ authMode: "login" }))).toMatchObject({
      surface: "auth",
      route: { name: "Login" }
    });
    expect(resolveRootRoute(rootState({ authMode: "register" }))).toMatchObject({
      surface: "auth",
      route: { name: "Register" }
    });
  });

  it("restores verification only with its non-secret pending context", () => {
    expect(resolveRootRoute(rootState({
      authStage: "verify",
      hasPendingVerification: true
    }))).toMatchObject({
      route: { name: "Verification" },
      redirected: false,
      reason: "signed_out_auth_flow"
    });
    expect(resolveRootRoute(rootState({
      authStage: "verify",
      hasPendingVerification: false
    }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "verification_context_missing"
    });
  });

  it("requires an exact authenticated owner before opening academic onboarding", () => {
    expect(resolveRootRoute(rootState({ authStage: "academic_onboarding" }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "session_missing"
    });
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      authStage: "academic_onboarding"
    }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "current_owner_missing"
    });
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      authStage: "academic_onboarding"
    }))).toEqual({
      surface: "onboarding",
      route: { name: "AcademicOnboarding" },
      redirected: false,
      reason: "academic_onboarding_required"
    });
  });

  it("restores password code and confirmation only while recovery context exists", () => {
    expect(resolveRootRoute(rootState({
      authStage: "password_recovery_code",
      hasPendingPasswordRecovery: true
    }))).toMatchObject({ route: { name: "PasswordRecoveryCode" }, redirected: false });
    expect(resolveRootRoute(rootState({
      authStage: "password_recovery_code",
      hasPendingPasswordRecovery: false
    }))).toEqual({
      surface: "auth",
      route: { name: "PasswordRecoveryRequest" },
      redirected: true,
      reason: "password_recovery_context_missing"
    });
    expect(resolveRootRoute(rootState({
      authStage: "password_recovery_confirm",
      hasPendingPasswordRecovery: true
    }))).toMatchObject({ route: { name: "PasswordRecoveryConfirm" }, redirected: false });
    expect(resolveRootRoute(rootState({
      authStage: "password_recovery_confirm",
      hasPendingPasswordRecovery: false
    }))).toEqual({
      surface: "auth",
      route: { name: "PasswordRecoveryRequest" },
      redirected: true,
      reason: "password_recovery_context_missing"
    });
  });

  it("keeps an activated owner in academic onboarding and defers protected work", () => {
    const requestedRoute = appRoutes.calendar();
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      authStage: "academic_onboarding",
      requestedRoute
    }))).toEqual({
      surface: "onboarding",
      route: { name: "AcademicOnboarding" },
      redirected: true,
      reason: "academic_onboarding_required"
    });

    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      authStage: "auth",
      requestedRoute
    }))).toEqual({
      surface: "authenticated",
      route: { name: "Calendar" },
      redirected: false,
      reason: "signed_in_requested"
    });
  });

  it("guards protected routes while signed out and keeps the active recovery flow", () => {
    expect(resolveRootRoute(rootState({ requestedRoute: appRoutes.calendar() }))).toMatchObject({
      route: { name: "Login" },
      redirected: true,
      reason: "signed_out_protected_guard"
    });
    expect(resolveRootRoute(rootState({
      authStage: "verify",
      hasPendingVerification: true,
      requestedRoute: appRoutes.calendar()
    }))).toMatchObject({ route: { name: "Verification" } });
    expect(guardRouteForOwner(appRoutes.accountDataSettings(), null)).toEqual({
      route: { name: "Login" },
      allowed: false,
      reason: "authentication_required"
    });
  });

  it("opens a protected requested route for the exact signed-in owner", () => {
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      requestedRoute: appRoutes.announcementDetail("announcement-42")
    }))).toEqual({
      surface: "authenticated",
      route: { name: "AnnouncementDetail", params: { announcementId: "announcement-42" } },
      redirected: false,
      reason: "signed_in_requested"
    });
  });

  it("redirects auth/onboarding routes away from an existing session", () => {
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      requestedRoute: appRoutes.register()
    }))).toEqual({
      surface: "authenticated",
      route: { name: "Home" },
      redirected: true,
      reason: "signed_in_public_guard"
    });
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      authStage: "auth",
      requestedRoute: appRoutes.academicOnboarding()
    }))).toEqual({
      surface: "authenticated",
      route: { name: "Home" },
      redirected: true,
      reason: "signed_in_public_guard"
    });
    expect(guardRouteForOwner(appRoutes.academicOnboarding(), ownerA)).toMatchObject({
      route: { name: "Home" },
      allowed: false,
      reason: "already_authenticated"
    });
  });

  it("fails invalid session and current-owner records closed to authentication", () => {
    expect(resolveRootRoute(rootState({
      sessionOwner: { ownerId: "owner-a", generation: -1 },
      currentOwner: ownerA,
      requestedRoute: appRoutes.profile()
    }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "session_invalid"
    });
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: { ownerId: "../invalid", generation: 4 },
      requestedRoute: appRoutes.profile()
    }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "current_owner_invalid"
    });
  });

  it("fails a session/current-owner identity mismatch closed before onboarding or content", () => {
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: { ownerId: "owner-b", generation: ownerA.generation },
      authStage: "academic_onboarding",
      requestedRoute: appRoutes.calendar()
    }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "session_owner_mismatch"
    });
  });

  it("fails a credential-generation mismatch closed before onboarding or content", () => {
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: { ownerId: ownerA.ownerId, generation: ownerA.generation + 1 },
      authStage: "academic_onboarding",
      requestedRoute: appRoutes.announcementDetail("announcement-42")
    }))).toEqual({
      surface: "auth",
      route: { name: "Login" },
      redirected: true,
      reason: "credential_generation_mismatch"
    });
  });
});

describe("strict academicpulse route and notification resolution", () => {
  it("resolves only the explicit static tab, announcement, and settings allowlist", () => {
    expect(ACADEMIC_PULSE_ROUTE_URLS.map((url) => parseAcademicPulseRouteUrl(url))).toEqual([
      { kind: "route", route: { name: "Home" } },
      { kind: "route", route: { name: "Announcements" } },
      { kind: "route", route: { name: "Calendar" } },
      { kind: "route", route: { name: "Profile" } },
      { kind: "route", route: { name: "SummerSchool" } },
      { kind: "route", route: { name: "YokAnnouncements" } },
      { kind: "route", route: { name: "AcademicProfileSettings" } },
      { kind: "route", route: { name: "NotificationSettings" } },
      { kind: "route", route: { name: "GoogleCalendarSettings" } },
      { kind: "route", route: { name: "AccountDataSettings" } }
    ]);
  });

  it("delegates the exact versioned notification URL to the Phase 3 parser", () => {
    const result = parseAcademicPulseRouteUrl(
      "academicpulse://notification?schemaVersion=1&destinationType=announcement&destinationId=announcement-42&recipientOwnerId=owner-a"
    );
    expect(result).toEqual({
      kind: "notification",
      notification: {
        recipientOwnerId: "owner-a",
        destination: { schemaVersion: 1, type: "announcement", id: "announcement-42" }
      }
    });
    expect(result.kind === "notification" && "route" in result).toBe(false);
  });

  it("maps verified exact notification records to the corresponding detail stack", () => {
    expect(routeForVerifiedNotification({
      schemaVersion: 1,
      type: "announcement",
      id: "announcement-42"
    })).toEqual({
      name: "AnnouncementDetail",
      params: { announcementId: "announcement-42" }
    });
    expect(routeForVerifiedNotification({
      schemaVersion: 1,
      type: "calendar_event",
      id: "calendar-event:17"
    })).toEqual({
      name: "CalendarEventDetail",
      params: { eventId: "calendar-event:17" }
    });
  });

  it("returns a non-echoing Unknown route for malformed, extra, encoded, or unapproved links", () => {
    const malicious = "academicpulse://tab/home?token=secret-value";
    const invalidValues: unknown[] = [
      malicious,
      "academicpulse://tab/home#fragment",
      "academicpulse://tab/home/",
      "academicpulse://TAB/home",
      "academicpulse://tab/%68ome",
      "academicpulse://announcements/detail/announcement-42",
      "academicpulse://settings/unknown",
      "academicpulse://notification?schemaVersion=1&destinationType=announcement&destinationId=announcement-42&recipientOwnerId=owner-a&extra=yes",
      "https://example.com/tab/home",
      null
    ];
    for (const value of invalidValues) {
      expect(parseAcademicPulseRouteUrl(value)).toEqual({
        kind: "unknown",
        route: { name: "Unknown" }
      });
    }
    expect(JSON.stringify(parseAcademicPulseRouteUrl(malicious))).not.toContain("secret-value");
  });

  it("defers Unknown behind identity validation and then uses the safe fallback", () => {
    expect(resolveRootRoute(rootState({ requestedRoute: appRoutes.unknown() }))).toMatchObject({
      surface: "auth",
      route: { name: "Login" },
      reason: "signed_out_protected_guard"
    });
    expect(resolveRootRoute(rootState({
      sessionOwner: ownerA,
      currentOwner: ownerA,
      requestedRoute: appRoutes.unknown()
    }))).toMatchObject({
      surface: "unknown",
      route: { name: "Unknown" }
    });
  });
});

describe("owner and generation bound route intents", () => {
  it("consumes a regular intent only for its exact owner generation", () => {
    const coordinator = new RouteIntentCoordinator();
    const intent: AppRouteIntent = {
      id: "link-1",
      source: "deep_link",
      route: appRoutes.notificationSettings()
    };
    expect(coordinator.enqueue(intent, ownerA.ownerId, ownerA.generation)).toBe("enqueued");
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toEqual(intent);
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toBeNull();
  });

  it("prioritizes verified notification work while retaining FIFO for regular intents", () => {
    const coordinator = new RouteIntentCoordinator();
    const profileIntent: AppRouteIntent = { source: "internal", route: appRoutes.profile() };
    const settingsIntent: AppRouteIntent = { source: "deep_link", route: appRoutes.notificationSettings() };
    const notificationIntent = createVerifiedNotificationIntent({
      schemaVersion: 1,
      type: "calendar_event",
      id: "calendar-event-17"
    }, "notification-17");

    expect(coordinator.enqueue(profileIntent, ownerA)).toBe("enqueued");
    expect(coordinator.enqueue(settingsIntent, ownerA)).toBe("enqueued");
    expect(coordinator.enqueue(notificationIntent, ownerA)).toBe("enqueued");
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toEqual(notificationIntent);
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toEqual(profileIntent);
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toEqual(settingsIntent);
  });

  it("deduplicates optional IDs, semantic routes, and already-consumed intents", () => {
    const coordinator = new RouteIntentCoordinator();
    const first: AppRouteIntent = { id: "route-1", source: "legacy", route: appRoutes.calendar() };
    expect(coordinator.enqueue(first, ownerA)).toBe("enqueued");
    expect(coordinator.enqueue(first, ownerA)).toBe("deduplicated");
    expect(coordinator.enqueue({
      id: "route-2",
      source: "internal",
      route: appRoutes.calendar()
    }, ownerA)).toBe("deduplicated");
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toEqual(first);
    expect(coordinator.enqueue(first, ownerA)).toBe("deduplicated");
  });

  it("promotes a pending detail route when its exact verified notification arrives", () => {
    const coordinator = new RouteIntentCoordinator();
    expect(coordinator.enqueue({
      source: "internal",
      route: appRoutes.announcementDetail("announcement-42")
    }, ownerA)).toBe("enqueued");
    const verified = createVerifiedNotificationIntent({
      schemaVersion: 1,
      type: "announcement",
      id: "announcement-42"
    }, "notification-42");
    expect(coordinator.enqueue(verified, ownerA)).toBe("promoted");
    expect(coordinator.pendingCountFor(ownerA.ownerId, ownerA.generation)).toBe(1);
    expect(coordinator.consumeFor(ownerA.ownerId, ownerA.generation)).toEqual(verified);
  });

  it("clears pending and dedupe state before rebinding to another owner or generation", () => {
    const coordinator = new RouteIntentCoordinator();
    const intent: AppRouteIntent = { source: "internal", route: appRoutes.profile() };
    expect(coordinator.enqueue(intent, ownerA)).toBe("enqueued");
    expect(coordinator.consumeFor("owner-b", 1)).toBeNull();
    expect(coordinator.pendingCountFor(ownerA.ownerId, ownerA.generation)).toBe(0);
    expect(coordinator.enqueue(intent, ownerA)).toBe("rejected_stale_owner");
    expect(coordinator.enqueue(intent, "owner-b", 1)).toBe("enqueued");

    expect(coordinator.consumeFor("owner-b", 2)).toBeNull();
    expect(coordinator.enqueue(intent, "owner-b", 2)).toBe("enqueued");
  });

  it("makes matching invalidation authoritative and stale invalidation harmless", () => {
    const coordinator = new RouteIntentCoordinator();
    const intent: AppRouteIntent = { source: "internal", route: appRoutes.home() };
    expect(coordinator.enqueue(intent, ownerA)).toBe("enqueued");
    coordinator.invalidate("owner-b", 1);
    expect(coordinator.pendingCountFor(ownerA.ownerId, ownerA.generation)).toBe(1);
    coordinator.invalidate(ownerA.ownerId, ownerA.generation);
    expect(coordinator.pendingCountFor(ownerA.ownerId, ownerA.generation)).toBe(0);
    expect(coordinator.enqueue(intent, "owner-b", 1)).toBe("enqueued");
    coordinator.invalidate();
    expect(coordinator.pendingCountFor("owner-b", 1)).toBe(0);
  });

  it("rejects unverified notifications, auth bypasses, malformed IDs, and stale owners", () => {
    const coordinator = new RouteIntentCoordinator();
    expect(coordinator.enqueue({
      source: "notification",
      verified: false,
      route: appRoutes.announcementDetail("announcement-42")
    } as unknown as AppRouteIntent, ownerA)).toBe("rejected_invalid");
    expect(coordinator.enqueue({
      source: "internal",
      route: appRoutes.login()
    } as unknown as AppRouteIntent, ownerA)).toBe("rejected_invalid");
    expect(coordinator.enqueue({
      id: "../unsafe",
      source: "internal",
      route: appRoutes.home()
    } as AppRouteIntent, ownerA)).toBe("rejected_invalid");
    expect(coordinator.enqueue({ source: "internal", route: appRoutes.home() }, "../owner", 1)).toBe("rejected_invalid");

    expect(coordinator.enqueue({ source: "internal", route: appRoutes.home() }, ownerA)).toBe("enqueued");
    expect(coordinator.enqueue({ source: "internal", route: appRoutes.calendar() }, "owner-b", 1)).toBe("rejected_stale_owner");
  });
});

describe("tab history and platform back policy", () => {
  it("keeps a deterministic MRU tab history and treats reselect separately", () => {
    const home = createTabHistory();
    const announcements = selectTab(home, "AnnouncementsTab");
    const calendar = selectTab(announcements.state, "CalendarTab");
    const announcementsAgain = selectTab(calendar.state, "AnnouncementsTab");
    expect(announcements.effect).toBe("selected");
    expect(announcementsAgain.state).toEqual({
      activeTab: "AnnouncementsTab",
      history: ["HomeTab", "CalendarTab"]
    });
    expect(selectTab(announcementsAgain.state, "AnnouncementsTab")).toEqual({
      effect: "reselected",
      state: announcementsAgain.state
    });
  });

  it("pops tab history before falling back to Home and then app exit", () => {
    const state = selectTab(
      selectTab(createTabHistory(), "AnnouncementsTab").state,
      "CalendarTab"
    ).state;
    const firstBack = popTabHistory(state);
    expect(firstBack).toMatchObject({
      tab: "AnnouncementsTab",
      route: { name: "Announcements" },
      state: { activeTab: "AnnouncementsTab", history: ["HomeTab"] }
    });
    const secondBack = popTabHistory(firstBack!.state);
    expect(secondBack).toMatchObject({ tab: "HomeTab", route: { name: "Home" } });
    expect(popTabHistory(secondBack!.state)).toBeNull();
  });

  it("dismisses an overlay before changing a nested route or tab", () => {
    expect(resolveAndroidBackPolicy({
      route: appRoutes.calendarEventDetail("event-17"),
      tabHistory: createTabHistory("CalendarTab"),
      signedIn: true,
      hasOpenOverlay: true,
      canPopStack: true
    })).toEqual({ action: "dismiss_overlay" });
  });

  it("pops a native stack when possible and otherwise uses a deterministic parent", () => {
    const input = {
      route: appRoutes.calendarEventDetail("event-17"),
      tabHistory: createTabHistory("CalendarTab"),
      signedIn: true
    };
    expect(resolveAndroidBackPolicy({ ...input, canPopStack: true })).toEqual({
      action: "pop_stack",
      fallbackRoute: { name: "Calendar" }
    });
    expect(resolveAndroidBackPolicy({ ...input, canPopStack: false })).toEqual({
      action: "replace",
      route: { name: "Calendar" }
    });
    expect(resolveAndroidBackPolicy({
      ...input,
      route: appRoutes.passwordRecoveryConfirm(),
      signedIn: false
    })).toEqual({
      action: "replace",
      route: { name: "PasswordRecoveryCode" }
    });
    expect(resolveAndroidBackPolicy({
      ...input,
      route: appRoutes.passwordRecoveryCode(),
      signedIn: false
    })).toEqual({
      action: "replace",
      route: { name: "PasswordRecoveryRequest" }
    });
  });

  it("switches through tab history and exits only from the Home root", () => {
    const calendarState = selectTab(createTabHistory(), "CalendarTab").state;
    expect(resolveAndroidBackPolicy({
      route: appRoutes.calendar(),
      tabHistory: calendarState,
      signedIn: true
    })).toMatchObject({
      action: "switch_tab",
      tab: "HomeTab",
      route: { name: "Home" }
    });
    expect(resolveAndroidBackPolicy({
      route: appRoutes.home(),
      tabHistory: createTabHistory(),
      signedIn: true
    })).toEqual({ action: "exit_app" });
    expect(resolveAndroidBackPolicy({
      route: appRoutes.login(),
      tabHistory: createTabHistory(),
      signedIn: false
    })).toEqual({ action: "exit_app" });
  });

  it("handles hydration and Unknown without leaking or looping", () => {
    expect(resolveAndroidBackPolicy({
      route: appRoutes.hydration("loading"),
      tabHistory: createTabHistory(),
      signedIn: false
    })).toEqual({ action: "ignore" });
    expect(resolveAndroidBackPolicy({
      route: appRoutes.unknown(),
      tabHistory: createTabHistory(),
      signedIn: true
    })).toEqual({ action: "replace", route: { name: "Home" } });
    expect(resolveAndroidBackPolicy({
      route: appRoutes.unknown(),
      tabHistory: createTabHistory(),
      signedIn: false
    })).toEqual({ action: "replace", route: { name: "Login" } });
  });

  it("provides an immutable predictive-back preview and appropriate iOS swipe policy", () => {
    const tabHistory = selectTab(createTabHistory(), "ProfileTab").state;
    const before = structuredClone(tabHistory);
    expect(previewAndroidBack({
      route: appRoutes.profile(),
      tabHistory,
      signedIn: true
    })).toMatchObject({ action: "switch_tab", tab: "HomeTab" });
    expect(tabHistory).toEqual(before);

    expect(allowsIosSwipeBack(appRoutes.notificationSettings())).toBe(true);
    expect(allowsIosSwipeBack(appRoutes.announcementDetail("announcement-42"))).toBe(true);
    expect(allowsIosSwipeBack(appRoutes.passwordRecoveryConfirm())).toBe(true);
    expect(allowsIosSwipeBack(appRoutes.passwordRecoveryCode())).toBe(true);
    expect(allowsIosSwipeBack(appRoutes.home())).toBe(false);
    expect(allowsIosSwipeBack(appRoutes.notificationSettings(), true)).toBe(false);
  });
});

function rootState(overrides: Partial<RootRouteState> = {}): RootRouteState {
  return {
    hydrationStatus: "ready",
    sessionOwner: null,
    currentOwner: null,
    authMode: "login",
    authStage: "auth",
    hasPendingVerification: false,
    hasPendingPasswordRecovery: false,
    ...overrides
  };
}
