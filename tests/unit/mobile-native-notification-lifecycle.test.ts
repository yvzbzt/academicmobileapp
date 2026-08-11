import { describe, expect, it, vi } from "vitest";
import {
  NotificationLifecycleCoordinator,
  isNotificationDeliveryActive,
  mapNotificationPermission,
  parseNotificationLifecycleState,
  serializeNotificationLifecycleState,
  type NativeNotificationPermissionSnapshot,
  type NotificationBackendAdapter,
  type NotificationPermissionAdapter,
  type NotificationTokenAdapter
} from "../../apps/mobile-native/src/notifications/notification-lifecycle";

const granted: NativeNotificationPermissionSnapshot = {
  available: true,
  status: "granted",
  canAskAgain: false
};

describe("notification permission lifecycle", () => {
  it("maps every required permission outcome without prompting", () => {
    expect(mapNotificationPermission(granted)).toBe("granted");
    expect(mapNotificationPermission({ available: true, status: "denied", canAskAgain: true })).toBe("denied");
    expect(mapNotificationPermission({ available: true, status: "denied", canAskAgain: false })).toBe("permanently_denied");
    expect(mapNotificationPermission({ available: false, status: "undetermined", canAskAgain: false })).toBe("unavailable");
    expect(mapNotificationPermission({ available: true, status: "undetermined", canAskAgain: true })).toBe("not_requested");
  });

  it("inspects hydration state without requesting permission or obtaining a token", async () => {
    const fixture = createFixture({
      inspect: { available: true, status: "undetermined", canAskAgain: true }
    });
    await fixture.coordinator.activateOwner("owner-a", true);

    const state = await fixture.coordinator.registerIfAlreadyGranted();

    expect(state.permission).toBe("not_requested");
    expect(state.registration).toBe("unregistered");
    expect(state.active).toBe(false);
    expect(fixture.permission.requestCount).toBe(0);
    expect(fixture.tokens.getCount).toBe(0);
    expect(fixture.backend.registered).toHaveLength(0);
  });

  it.each([
    ["denied", { available: true, status: "denied", canAskAgain: true }],
    ["permanently_denied", { available: true, status: "denied", canAskAgain: false }],
    ["unavailable", { available: false, status: "undetermined", canAskAgain: false }]
  ] as const)("represents %s after explicit enable intent", async (expected, requested) => {
    const fixture = createFixture({
      inspect: { available: true, status: "undetermined", canAskAgain: true },
      request: requested
    });
    await fixture.coordinator.activateOwner("owner-a", false);

    const state = await fixture.coordinator.enableAfterUserIntent({
      ownerId: "owner-a",
      intent: "enable_notifications"
    });

    expect(state.permission).toBe(expected);
    expect(state.active).toBe(false);
    expect(fixture.permission.requestCount).toBe(1);
    expect(fixture.backend.registered).toHaveLength(0);
  });

  it("registers only after explicit intent and derives active from all three gates", async () => {
    const fixture = createFixture({
      inspect: { available: true, status: "undetermined", canAskAgain: true },
      request: granted
    });
    await fixture.coordinator.activateOwner("owner-a", false);

    const state = await fixture.coordinator.enableAfterUserIntent({
      ownerId: "owner-a",
      intent: "enable_notifications"
    });

    expect(state).toEqual(expect.objectContaining({
      ownerId: "owner-a",
      preferenceEnabled: true,
      permission: "granted",
      registration: "registered",
      active: true
    }));
    expect(fixture.backend.registered).toEqual([{
      ownerId: "owner-a",
      installationId: "installation-1",
      platform: "android",
      token: "secret-token-initial"
    }]);
    expect(isNotificationDeliveryActive({
      preferenceEnabled: true,
      permission: "granted",
      registration: "unregistered"
    })).toBe(false);
  });

  it("represents inspection and request errors with controlled states", async () => {
    const inspection = createFixture({ inspectError: new Error("provider detail") });
    await inspection.coordinator.activateOwner("owner-a", true);
    expect(await inspection.coordinator.inspectPermission()).toEqual(expect.objectContaining({
      permission: "error",
      errorCode: "permission_inspection_failed",
      active: false
    }));

    const request = createFixture({
      inspect: { available: true, status: "undetermined", canAskAgain: true },
      requestError: new Error("provider detail")
    });
    await request.coordinator.activateOwner("owner-a", false);
    expect(await request.coordinator.enableAfterUserIntent({
      ownerId: "owner-a",
      intent: "enable_notifications"
    })).toEqual(expect.objectContaining({
      permission: "error",
      errorCode: "permission_request_failed",
      active: false
    }));
  });
});

describe("notification device ownership", () => {
  it("registers token rotation for the current owner and detaches when disabled", async () => {
    const fixture = createFixture({ inspect: granted });
    await fixture.coordinator.activateOwner("owner-a", true);
    await fixture.coordinator.registerIfAlreadyGranted();
    fixture.coordinator.startTokenRotationListener();

    fixture.tokens.rotate("secret-token-rotated");
    await waitFor(() => fixture.backend.registered.length === 2);
    const disabled = await fixture.coordinator.setPreferenceEnabled(false);

    expect(fixture.backend.registered[1]).toEqual(expect.objectContaining({
      ownerId: "owner-a",
      token: "secret-token-rotated"
    }));
    expect(fixture.backend.detached).toContainEqual({
      ownerId: "owner-a",
      installationId: "installation-1",
      platform: "android"
    });
    expect(disabled.preferenceEnabled).toBe(false);
    expect(disabled.registration).toBe("unregistered");
    expect(disabled.active).toBe(false);
  });

  it("makes delivery inactive when a rotated token cannot be registered", async () => {
    const fixture = createFixture({ inspect: granted });
    await fixture.coordinator.activateOwner("owner-a", true);
    await fixture.coordinator.registerIfAlreadyGranted();
    fixture.coordinator.startTokenRotationListener();
    fixture.backend.registerError = new Error("provider detail");

    fixture.tokens.rotate("secret-token-rotated");
    await waitFor(() => fixture.coordinator.getState().registration === "error");

    expect(fixture.coordinator.getState()).toEqual(expect.objectContaining({
      preferenceEnabled: true,
      permission: "granted",
      registration: "error",
      active: false,
      errorCode: "registration_failed"
    }));
  });

  it("detaches a previously registered installation when permission is revoked on resume", async () => {
    const permission = new MutablePermissionAdapter(granted);
    const tokens = new FakeTokenAdapter();
    const backend = new FakeBackendAdapter();
    const coordinator = new NotificationLifecycleCoordinator({
      installationId: "installation-1",
      platform: "android",
      permissionAdapter: permission,
      tokenAdapter: tokens,
      backendAdapter: backend
    });
    await coordinator.activateOwner("owner-a", true);
    expect((await coordinator.registerIfAlreadyGranted()).active).toBe(true);

    permission.inspected = { available: true, status: "denied", canAskAgain: false };
    const resumed = await coordinator.registerIfAlreadyGranted();

    expect(resumed.permission).toBe("permanently_denied");
    expect(resumed.registration).toBe("unregistered");
    expect(resumed.active).toBe(false);
    expect(backend.detached).toContainEqual(expect.objectContaining({ ownerId: "owner-a" }));
    expect(permission.requestCount).toBe(0);
  });

  it("detaches a stale installation when the hydrated preference is disabled even if OS permission remains granted", async () => {
    const fixture = createFixture({ inspect: granted });
    await fixture.coordinator.activateOwner("owner-a", false);

    const state = await fixture.coordinator.registerIfAlreadyGranted();

    expect(state).toEqual(expect.objectContaining({
      ownerId: "owner-a",
      preferenceEnabled: false,
      permission: "granted",
      registration: "unregistered",
      active: false
    }));
    expect(fixture.tokens.getCount).toBe(0);
    expect(fixture.backend.registered).toHaveLength(0);
    expect(fixture.backend.detached).toContainEqual(expect.objectContaining({ ownerId: "owner-a" }));
  });

  it("detaches the previous owner before an account switch can become active", async () => {
    const fixture = createFixture({ inspect: granted });
    await fixture.coordinator.activateOwner("owner-a", true);
    await fixture.coordinator.registerIfAlreadyGranted();

    await fixture.coordinator.activateOwner("owner-b", true);
    const ownerB = await fixture.coordinator.registerIfAlreadyGranted();

    expect(fixture.backend.detached).toContainEqual(expect.objectContaining({ ownerId: "owner-a" }));
    expect(fixture.backend.registered.at(-1)).toEqual(expect.objectContaining({ ownerId: "owner-b" }));
    expect(ownerB.ownerId).toBe("owner-b");
    expect(ownerB.active).toBe(true);
  });

  it("surfaces a detach failure so logout and deletion cleanup cannot claim success", async () => {
    const fixture = createFixture({ inspect: granted, detachError: new Error("provider detail") });
    await fixture.coordinator.activateOwner("owner-a", true);
    await fixture.coordinator.registerIfAlreadyGranted();

    const detached = await fixture.coordinator.detachCurrentOwner();

    expect(detached).toEqual(expect.objectContaining({
      ownerId: "owner-a",
      registration: "error",
      active: false,
      errorCode: "detach_failed"
    }));
  });

  it("rejects late registration settlement after logout and cleans the old association", async () => {
    const registerGate = deferred<void>();
    const fixture = createFixture({ inspect: granted, registerGate });
    await fixture.coordinator.activateOwner("owner-a", true);
    const registration = fixture.coordinator.registerIfAlreadyGranted();
    await waitFor(() => fixture.backend.registered.length === 1);

    const logout = fixture.coordinator.clearOwner();
    registerGate.resolve();
    await Promise.all([registration, logout]);

    const state = fixture.coordinator.getState();
    expect(state.ownerId).toBeNull();
    expect(state.registration).toBe("unregistered");
    expect(state.active).toBe(false);
    expect(fixture.backend.detached.filter((entry) => entry.ownerId === "owner-a").length).toBeGreaterThan(0);
  });

  it("never returns, serializes, or logs a push token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createFixture({ inspect: granted });
    await fixture.coordinator.activateOwner("owner-a", true);

    const state = await fixture.coordinator.registerIfAlreadyGranted();
    const serialized = serializeNotificationLifecycleState(state);
    const restored = parseNotificationLifecycleState(serialized);

    expect(JSON.stringify(state)).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-token");
    expect(restored).toEqual(expect.objectContaining({
      ownerId: "owner-a",
      preferenceEnabled: true,
      permission: "not_requested",
      registration: "unregistered",
      active: false
    }));
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

function createFixture(input: {
  inspect?: NativeNotificationPermissionSnapshot;
  request?: NativeNotificationPermissionSnapshot;
  inspectError?: Error;
  requestError?: Error;
  registerGate?: Promise<void>;
  detachError?: Error;
  registerError?: Error;
} = {}) {
  const permission = new FakePermissionAdapter(
    input.inspect ?? granted,
    input.request ?? granted,
    input.inspectError,
    input.requestError
  );
  const tokens = new FakeTokenAdapter();
  const backend = new FakeBackendAdapter(input.registerGate, input.detachError, input.registerError);
  const coordinator = new NotificationLifecycleCoordinator({
    installationId: "installation-1",
    platform: "android",
    permissionAdapter: permission,
    tokenAdapter: tokens,
    backendAdapter: backend
  });
  return { coordinator, permission, tokens, backend };
}

class FakePermissionAdapter implements NotificationPermissionAdapter {
  requestCount = 0;

  constructor(
    private readonly inspected: NativeNotificationPermissionSnapshot,
    private readonly requested: NativeNotificationPermissionSnapshot,
    private readonly inspectError?: Error,
    private readonly requestError?: Error
  ) {}

  async inspect(): Promise<NativeNotificationPermissionSnapshot> {
    if (this.inspectError) throw this.inspectError;
    return this.inspected;
  }

  async request(): Promise<NativeNotificationPermissionSnapshot> {
    this.requestCount += 1;
    if (this.requestError) throw this.requestError;
    return this.requested;
  }
}

class MutablePermissionAdapter implements NotificationPermissionAdapter {
  requestCount = 0;

  constructor(public inspected: NativeNotificationPermissionSnapshot) {}

  async inspect(): Promise<NativeNotificationPermissionSnapshot> {
    return this.inspected;
  }

  async request(): Promise<NativeNotificationPermissionSnapshot> {
    this.requestCount += 1;
    return this.inspected;
  }
}

class FakeTokenAdapter implements NotificationTokenAdapter {
  getCount = 0;
  private listener: ((token: string) => void) | null = null;

  async getToken(): Promise<string> {
    this.getCount += 1;
    return "secret-token-initial";
  }

  onTokenRefresh(listener: (token: string) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  rotate(token: string): void {
    this.listener?.(token);
  }
}

class FakeBackendAdapter implements NotificationBackendAdapter {
  registered: Array<Parameters<NotificationBackendAdapter["registerDevice"]>[0]> = [];
  detached: Array<Parameters<NotificationBackendAdapter["detachDevice"]>[0]> = [];
  registerError?: Error;

  constructor(
    private readonly registerGate?: Promise<void>,
    private readonly detachError?: Error,
    registerError?: Error
  ) {
    this.registerError = registerError;
  }

  async registerDevice(input: Parameters<NotificationBackendAdapter["registerDevice"]>[0]): Promise<void> {
    this.registered.push(input);
    await this.registerGate;
    if (this.registerError) throw this.registerError;
  }

  async detachDevice(input: Parameters<NotificationBackendAdapter["detachDevice"]>[0]): Promise<void> {
    this.detached.push(input);
    if (this.detachError) throw this.detachError;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}
