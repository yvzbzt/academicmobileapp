import { describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarLifecycleGuard,
  authorizeAfterGoogleCalendarPreflight,
  executeGoogleCalendarLifecycle,
  evaluateGoogleCalendarPreflight,
  findDuplicateGoogleCalendarMappings,
  googleCalendarDeletionCandidateSourceTypes,
  planGoogleCalendarAccountSwitch,
  planGoogleCalendarExactMappingLookups,
  planGoogleCalendarLifecycle,
  readGoogleCalendarConnectionRecordV3,
  settledGoogleCalendarLifecycleState,
  type GoogleCalendarLifecycleIntent,
  type GoogleCalendarLifecycleStep,
  type GoogleCalendarPreflightInput
} from "../../apps/mobile-native/src/google-calendar/google-calendar-lifecycle";
import type { GoogleCalendarEventMapping } from "../../apps/mobile-native/src/google-calendar/google-calendar-sync";

describe("Google Calendar lifecycle persistence", () => {
  it("settles interrupted authorization without retaining a transient busy state", () => {
    expect(settledGoogleCalendarLifecycleState()).toBe("disconnected");
    expect(settledGoogleCalendarLifecycleState("checking")).toBe("disconnected");
    expect(settledGoogleCalendarLifecycleState("syncing")).toBe("disconnected");
    expect(settledGoogleCalendarLifecycleState("connected")).toBe("connected");
    expect(settledGoogleCalendarLifecycleState("partial")).toBe("partial");
  });

  it("accepts a current owner-scoped v3 record while discarding unknown credential fields", () => {
    const record = readGoogleCalendarConnectionRecordV3(JSON.stringify({
      schemaVersion: 3,
      ownerId: "app-user-1",
      googleAccountId: "google-account-1",
      accountEmail: "student@example.com",
      state: "connected",
      authorizationVerifiedAt: "2026-07-31T10:00:00.000Z",
      lastSyncedAt: "2026-07-31T10:01:00.000Z",
      accessToken: "must-not-survive",
      mappings: [mapping()]
    }), "app-user-1");

    expect(record).toEqual({
      schemaVersion: 3,
      ownerId: "app-user-1",
      googleAccountId: "google-account-1",
      accountEmail: "student@example.com",
      state: "connected",
      authorizationVerifiedAt: "2026-07-31T10:00:00.000Z",
      lastSyncedAt: "2026-07-31T10:01:00.000Z",
      mappings: [mapping()]
    });
    expect(JSON.stringify(record)).not.toContain("must-not-survive");
  });

  it("rejects wrong-owner, unverified-connected, malformed, and duplicate mapping records", () => {
    const base = {
      schemaVersion: 3,
      ownerId: "app-user-1",
      googleAccountId: "google-account-1",
      accountEmail: "student@example.com",
      state: "connected",
      authorizationVerifiedAt: "2026-07-31T10:00:00.000Z",
      mappings: [mapping()]
    };

    expect(readGoogleCalendarConnectionRecordV3(base, "app-user-2")).toBeNull();
    expect(readGoogleCalendarConnectionRecordV3({
      ...base,
      authorizationVerifiedAt: undefined
    }, "app-user-1")).toBeNull();
    expect(readGoogleCalendarConnectionRecordV3({
      ...base,
      mappings: [{ ...mapping(), googleEventId: "" }]
    }, "app-user-1")).toBeNull();
    expect(readGoogleCalendarConnectionRecordV3({
      ...base,
      mappings: [mapping(), { ...mapping(), googleEventId: "google-event-2" }]
    }, "app-user-1")).toBeNull();
  });

  it("detects duplicate source mappings and reused Google event IDs independently", () => {
    const duplicateSource = { ...mapping(), googleEventId: "google-event-2" };
    const duplicateEvent = {
      ...mapping(),
      sourceId: "academic-event:two",
      sourceType: "academic_event" as const
    };

    expect(findDuplicateGoogleCalendarMappings([mapping(), duplicateSource, duplicateEvent])).toEqual({
      sourceKeys: ['["academic_event","academic-event:one"]'],
      googleEventIds: ["google-event-1"],
      hasDuplicates: true
    });
  });
});

describe("Google Calendar preflight", () => {
  it.each([
    ["duplicate sync", { operationInProgress: true }, "duplicate_sync"],
    ["changed owner", { activeOwnerId: "app-user-2" }, "owner_changed"],
    ["missing profile", { academicProfile: {} }, "academic_profile_missing"],
    ["offline", {}, "network_unavailable"]
  ] as const)("blocks %s before authorization", (_label, overrides, reason) => {
    const result = evaluateGoogleCalendarPreflight(
      { ...preflightInput(), ...overrides },
      reason === "network_unavailable"
        ? { isConnected: true, isInternetReachable: false }
        : { isConnected: true, isInternetReachable: true }
    );
    expect(result).toEqual({ ready: false, reason });
  });

  it("treats fetch-only content as no content and never calls network or authorization providers", async () => {
    const network = { getState: vi.fn(async () => ({ isConnected: true })) };
    const authorization = { authorize: vi.fn(async () => ({ accessToken: "internal-token" })) };
    const input: GoogleCalendarPreflightInput = {
      ...preflightInput(),
      calendarEvents: [],
      trustedAnnouncements: [{
        id: "crawl-only",
        title: "Crawl only",
        link: "https://example.edu.tr/announcement/crawl-only",
        contentType: "announcement",
        fetchedAt: "2026-07-31T10:00:00.000Z"
      } as GoogleCalendarPreflightInput["trustedAnnouncements"][number] & { fetchedAt: string }]
    };

    const result = await authorizeAfterGoogleCalendarPreflight(input, { network, authorization });

    expect(result).toEqual({ ready: false, reason: "no_content" });
    expect(network.getState).not.toHaveBeenCalled();
    expect(authorization.authorize).not.toHaveBeenCalled();
  });

  it("allows an existing managed mapping to pass an empty-content cleanup preflight", () => {
    const result = evaluateGoogleCalendarPreflight({
      ...preflightInput(),
      calendarEvents: [],
      trustedAnnouncements: [],
      deletionEligibleSourceTypes: ["academic_event"],
      hasManagedMappingsForCleanup: true
    }, { isConnected: true, isInternetReachable: true });

    expect(result).toEqual({
      ready: true,
      items: [],
      deletionEligibleSourceTypes: ["academic_event"]
    });
  });

  it("checks network before invoking the injected authorization provider", async () => {
    const callOrder: string[] = [];
    const network = {
      getState: vi.fn(async () => {
        callOrder.push("network");
        return { isConnected: true, isInternetReachable: true };
      })
    };
    const authorization = {
      authorize: vi.fn(async () => {
        callOrder.push("authorization");
        return { accountId: "google-account-1", accessToken: "internal-token" };
      })
    };

    const result = await authorizeAfterGoogleCalendarPreflight(
      { ...preflightInput(), deletionEligibleSourceTypes: ["academic_event"] },
      { network, authorization }
    );

    expect(result).toEqual(expect.objectContaining({
      ready: true,
      deletionEligibleSourceTypes: ["academic_event"],
      authorization: { accountId: "google-account-1", accessToken: "internal-token" }
    }));
    expect(result.ready && result.items).toHaveLength(1);
    expect(callOrder).toEqual(["network", "authorization"]);
  });

  it("returns controlled network and authorization failures without provider payloads", async () => {
    const input = preflightInput();
    const networkFailure = await authorizeAfterGoogleCalendarPreflight(input, {
      network: { getState: async () => { throw new Error("secret-network-payload"); } },
      authorization: { authorize: async () => ({}) }
    });
    const authorizationFailure = await authorizeAfterGoogleCalendarPreflight(input, {
      network: { getState: async () => ({ isConnected: true }) },
      authorization: { authorize: async () => { throw new Error("secret-provider-token"); } }
    });

    expect(networkFailure).toEqual({ ready: false, reason: "network_check_failed" });
    expect(authorizationFailure).toEqual({ ready: false, reason: "authorization_failed" });
    expect(JSON.stringify([networkFailure, authorizationFailure])).not.toContain("secret");
  });
});

describe("Google Calendar account ownership", () => {
  it("plans account switching before opening a new account chooser", () => {
    expect(planGoogleCalendarAccountSwitch("cancel")).toEqual({
      proceed: false,
      removeManagedEvents: false,
      steps: []
    });
    expect(planGoogleCalendarAccountSwitch("leave_managed_events")).toEqual({
      proceed: true,
      removeManagedEvents: false,
      steps: ["disconnect", "select_account"]
    });
    expect(planGoogleCalendarAccountSwitch("remove_managed_events")).toEqual({
      proceed: true,
      removeManagedEvents: true,
      steps: ["remove_managed_events", "disconnect", "select_account"]
    });
  });

  it("blocks duplicate operations and rejects late completion after logout", () => {
    const guard = new GoogleCalendarLifecycleGuard();
    guard.activate("app-user-1");
    const pending = guard.begin("app-user-1");

    expect(pending).not.toBeNull();
    expect(guard.begin("app-user-1")).toBeNull();
    guard.invalidate();
    expect(guard.settle(pending!, { mappings: [mapping()] })).toEqual({
      accepted: false,
      reason: "owner_changed"
    });
  });

  it("releases a failed current operation without accepting a result", () => {
    const guard = new GoogleCalendarLifecycleGuard();
    guard.activate("app-user-1");
    const failed = guard.begin("app-user-1")!;

    guard.finish(failed);

    expect(guard.begin("app-user-1")).not.toBeNull();
  });

  it("rejects an old account completion after an A-to-B account switch", () => {
    const guard = new GoogleCalendarLifecycleGuard();
    guard.activate("app-user-a");
    const oldOperation = guard.begin("app-user-a")!;
    guard.activate("app-user-b");
    const currentOperation = guard.begin("app-user-b")!;

    expect(guard.settle(oldOperation, "old-user-metadata")).toEqual({
      accepted: false,
      reason: "owner_changed"
    });
    expect(guard.settle(currentOperation, "new-user-metadata")).toEqual({
      accepted: true,
      value: "new-user-metadata"
    });
    expect(guard.begin("app-user-b")).not.toBeNull();
  });
});

describe("Google Calendar exit orchestration policy", () => {
  it.each([
    [
      "disconnect_only" as const,
      "none",
      ["sign_out", "persist_disconnected_metadata"],
      true,
      true
    ],
    [
      "disconnect_and_remove" as const,
      "interactive_for_removal",
      [
        "request_authorization_for_removal",
        "remove_managed_events",
        "sign_out",
        "clear_connection_metadata"
      ],
      false,
      true
    ]
  ])("orchestrates %s in dependency order", async (
    intent,
    authorizationMode,
    expectedSteps,
    preservesManagedEvents,
    preservesGrant
  ) => {
    const policy = planGoogleCalendarLifecycle(intent);
    const observed: GoogleCalendarLifecycleStep[] = [];

    const result = await executeGoogleCalendarLifecycle(policy, {
      isOwnerCurrent: () => true,
      runStep: async (step) => { observed.push(step); }
    });

    expect(policy).toEqual(expect.objectContaining({
      authorizationMode,
      preservesManagedEvents,
      preservesGrant
    }));
    expect(observed).toEqual(expectedSteps);
    expect(result).toEqual({ complete: true, completedSteps: expectedSteps });
  });

  it("revokes only an existing authorization and never requests a new scope", async () => {
    const policy = planGoogleCalendarLifecycle("revoke_access");
    const observed: GoogleCalendarLifecycleStep[] = [];

    await executeGoogleCalendarLifecycle(policy, {
      isOwnerCurrent: () => true,
      runStep: (step) => { observed.push(step); }
    });

    expect(policy.authorizationMode).toBe("current_only");
    expect(policy.preservesManagedEvents).toBe(true);
    expect(policy.preservesGrant).toBe(false);
    expect(observed).toEqual([
      "read_current_authorization",
      "revoke_access",
      "persist_disconnected_metadata"
    ]);
    expect(observed).not.toContain("request_authorization_for_removal");
  });

  it("models both account-switch choices before selecting another account", () => {
    expect(planGoogleCalendarLifecycle("account_switch_leave_managed_events")).toEqual(
      expect.objectContaining({
        preservesManagedEvents: true,
        preservesGrant: true,
        steps: ["sign_out", "persist_disconnected_metadata", "select_account"]
      })
    );
    expect(planGoogleCalendarLifecycle("account_switch_remove_managed_events")).toEqual(
      expect.objectContaining({
        preservesManagedEvents: false,
        preservesGrant: true,
        steps: [
          "request_authorization_for_removal",
          "remove_managed_events",
          "sign_out",
          "clear_connection_metadata",
          "select_account"
        ]
      })
    );
  });

  it("leaves managed events and the provider grant intact on app logout", () => {
    expect(planGoogleCalendarLifecycle("logout")).toEqual({
      intent: "logout",
      authorizationMode: "none",
      preservesManagedEvents: true,
      preservesGrant: true,
      steps: ["clear_connection_metadata", "sign_out"]
    });
  });

  it.each([
    "personal_data_deletion",
    "account_deletion"
  ] as const)("orders removal before revoke for %s", async (intent) => {
    const observed: GoogleCalendarLifecycleStep[] = [];
    const result = await executeGoogleCalendarLifecycle(planGoogleCalendarLifecycle(intent), {
      isOwnerCurrent: () => true,
      runStep: (step) => { observed.push(step); }
    });

    expect(observed).toEqual([
      "read_current_authorization",
      "remove_managed_events",
      "revoke_access",
      "clear_connection_metadata",
      "sign_out"
    ]);
    expect(result.complete).toBe(true);
  });

  it.each([
    "personal_data_deletion",
    "account_deletion"
  ] as const)("does not revoke or discard retry metadata when removal fails for %s", async (intent) => {
    const observed: GoogleCalendarLifecycleStep[] = [];
    const providerFailure = new Error("provider-private-detail");
    const result = await executeGoogleCalendarLifecycle(planGoogleCalendarLifecycle(intent), {
      isOwnerCurrent: () => true,
      runStep: (step) => {
        observed.push(step);
        if (step === "remove_managed_events") throw providerFailure;
      }
    });

    expect(observed).toEqual(["read_current_authorization", "remove_managed_events"]);
    expect(result).toEqual({
      complete: false,
      reason: "step_failed",
      failedStep: "remove_managed_events",
      completedSteps: ["read_current_authorization"],
      error: providerFailure
    });
  });

  it("stops before the next mutation when the owning session is invalidated late", async () => {
    let ownerCurrent = true;
    const observed: GoogleCalendarLifecycleStep[] = [];
    const policy = planGoogleCalendarLifecycle("disconnect_only");

    const result = await executeGoogleCalendarLifecycle(policy, {
      isOwnerCurrent: () => ownerCurrent,
      runStep: async (step) => {
        observed.push(step);
        ownerCurrent = false;
      }
    });

    expect(observed).toEqual(["sign_out"]);
    expect(result).toEqual({
      complete: false,
      reason: "owner_changed",
      completedSteps: ["sign_out"]
    });
  });
});

describe("Google Calendar capped-source reconciliation", () => {
  it("never treats source-only or unknown calendar responses as deletion-complete", () => {
    expect(googleCalendarDeletionCandidateSourceTypes({
      calendarSourceStatus: "source_only",
      announcementState: "partial"
    })).toEqual([]);
    expect(googleCalendarDeletionCandidateSourceTypes({
      calendarSourceStatus: "parsed",
      announcementState: "fresh"
    })).toEqual(["academic_event", "announcement", "event"]);
  });

  it("requests exact records for managed items omitted beyond a 100-item response", () => {
    const desiredItems = Array.from({ length: 100 }, (_, index) => ({
      sourceId: `announcement:item-${index}`,
      sourceType: "announcement" as const
    }));
    const mappings: GoogleCalendarEventMapping[] = Array.from({ length: 101 }, (_, index) => ({
      sourceId: `announcement:item-${index}`,
      sourceType: "announcement",
      googleEventId: `google-${index}`,
      fingerprint: `fingerprint-${index}`
    }));

    expect(planGoogleCalendarExactMappingLookups(
      mappings,
      desiredItems,
      ["announcement"]
    )).toEqual({
      lookups: [{
        sourceType: "announcement",
        sourceId: "announcement:item-100",
        recordId: "item-100"
      }],
      malformedSourceTypes: []
    });
  });

  it("requests an exact calendar record for a managed item omitted beyond the 200-item response cap", () => {
    const desiredItems = Array.from({ length: 200 }, (_, index) => ({
      sourceId: `academic-event:event-${index}`,
      sourceType: "academic_event" as const
    }));
    const mappings: GoogleCalendarEventMapping[] = [{
      sourceId: "academic-event:event-200",
      sourceType: "academic_event",
      googleEventId: "google-200",
      fingerprint: "fingerprint-200"
    }];

    expect(planGoogleCalendarExactMappingLookups(
      mappings,
      desiredItems,
      ["academic_event"]
    )).toEqual({
      lookups: [{
        sourceType: "academic_event",
        sourceId: "academic-event:event-200",
        recordId: "event-200"
      }],
      malformedSourceTypes: []
    });
  });

  it("blocks family deletion when an omitted managed mapping has a malformed source ID", () => {
    expect(planGoogleCalendarExactMappingLookups(
      [{ ...mapping(), sourceId: "legacy-without-prefix" }],
      [],
      ["academic_event"]
    )).toEqual({
      lookups: [],
      malformedSourceTypes: ["academic_event"]
    });
  });
});

function mapping(): GoogleCalendarEventMapping {
  return {
    sourceId: "academic-event:one",
    sourceType: "academic_event",
    googleEventId: "google-event-1",
    fingerprint: "abcdef12"
  };
}

function preflightInput(): GoogleCalendarPreflightInput {
  return {
    ownerId: "app-user-1",
    activeOwnerId: "app-user-1",
    operationInProgress: false,
    academicProfile: { universityId: "university-1" },
    calendarEvents: [{
      id: "academic-1",
      title: "Academic date",
      category: "course_registration",
      startDate: "2026-09-01T00:00:00.000Z"
    }],
    trustedAnnouncements: []
  };
}
