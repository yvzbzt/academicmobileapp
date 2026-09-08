import * as SecureStore from "expo-secure-store";
import { createApiActions } from "../../src/app/actions/api-actions";
import { ApiRequestError, StaleAccountRequestError } from "../../src/app/app-errors";
import { SESSION_STORAGE_KEY } from "../../src/app/app-storage";
import type { Loadable, SessionPayload } from "../../src/app/app-types";
import { AccountGenerationGuard } from "../../src/auth/session-integrity";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

type Dependencies = Parameters<typeof createApiActions>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function session(ownerId = "student-a", suffix = "old"): SessionPayload {
  return {
    accessToken: `test-access-${suffix}`,
    refreshToken: `test-refresh-${suffix}`,
    expiresInSeconds: 900,
    user: {
      id: ownerId,
      email: `${ownerId}@example.test`,
      fullName: "Test Student",
      role: "student",
      authProvider: "password",
    },
  };
}

function harness(initial = session()) {
  const ownerGuard = new AccountGenerationGuard();
  ownerGuard.activate(initial.user.id);
  const dependencies: Dependencies = {
    storageMutationQueueRef: { current: Promise.resolve() },
    accountCleanupInProgressRef: { current: false },
    activeAuthenticatedMutationsRef: { current: new Set() },
    authenticatedRequestControllersRef: { current: new Set() },
    sessionRef: { current: initial },
    accountGuardRef: { current: ownerGuard },
    deviceIdRef: { current: "test-installation" },
    refreshSessionPromiseRef: { current: null },
    notificationCoordinatorOwnerTokenRef: { current: initial },
    setAccountAuthProvider: jest.fn(),
    setSession: jest.fn(),
    clearExpiredSession: jest.fn(async () => undefined),
    setMessage: jest.fn(),
    apiBaseUrl: "https://api.example.test",
  };
  return { dependencies, actions: createApiActions(dependencies), ownerGuard };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("extracted application API actions", () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch");
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  });

  it("shares a single refresh across concurrent requests and persists rotation before retrying", async () => {
    const { actions, dependencies } = harness();
    const nextSession = session("student-a", "rotated");
    const refreshStarted = deferred<void>();
    const refreshReply = deferred<Response>();
    const storageStarted = deferred<void>();
    const storageFinished = deferred<void>();
    jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async () => {
      storageStarted.resolve();
      await storageFinished.promise;
    });
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith("/auth/refresh-token")) {
        refreshStarted.resolve();
        return refreshReply.promise;
      }
      const authorization = new Headers(options?.headers).get("Authorization");
      return authorization === `Bearer ${nextSession.accessToken}`
        ? response({ path: String(input) })
        : response({ errorCode: "AUTH_TOKEN_EXPIRED" }, 401);
    });

    const results = Promise.all([
      actions.apiRequest<{ path: string }>("/calendar/my", {}, "test-access-old"),
      actions.apiRequest<{ path: string }>("/announcements/my/trusted", {}, "test-access-old"),
    ]);
    await refreshStarted.promise;
    refreshReply.resolve(response(nextSession));
    await storageStarted.promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dependencies.setSession).not.toHaveBeenCalled();
    expect(dependencies.sessionRef.current?.accessToken).toBe("test-access-old");

    storageFinished.resolve();
    await expect(results).resolves.toEqual([
      { path: "https://api.example.test/calendar/my" },
      { path: "https://api.example.test/announcements/my/trusted" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh-token"))).toHaveLength(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    expect(dependencies.sessionRef.current).toEqual(nextSession);
    expect(dependencies.notificationCoordinatorOwnerTokenRef.current).toBe(dependencies.sessionRef.current);
    expect(dependencies.refreshSessionPromiseRef.current).toBeNull();
    expect(dependencies.authenticatedRequestControllersRef.current.size).toBe(0);
  });

  it("keeps the refresh single-flight shared across new per-render action factories", async () => {
    const { actions, dependencies } = harness();
    const responseGate = deferred<Response>();
    fetchMock.mockReturnValue(responseGate.promise);
    const first = actions.refreshAuthenticatedSession("test-access-old");
    const rerenderedActions = createApiActions(dependencies);
    const second = rerenderedActions.refreshAuthenticatedSession("test-access-old");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    responseGate.resolve(response(session("student-a", "new")));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(dependencies.setSession).toHaveBeenCalledTimes(1);
  });

  it("reuses an already rotated session instead of rotating again for a late old-token failure", async () => {
    const { actions, dependencies } = harness(session("student-a", "new"));
    await expect(actions.refreshAuthenticatedSession("test-access-old")).resolves.toBe(dependencies.sessionRef.current);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("retries a rejected authenticated request at most once", async () => {
    const { actions } = harness();
    fetchMock.mockImplementation(async (url) => String(url).endsWith("/auth/refresh-token")
      ? response(session("student-a", "new"))
      : response({ errorCode: "AUTH_TOKEN_EXPIRED" }, 401));
    await expect(actions.apiRequest("/me", {}, "test-access-old")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh-token"))).toHaveLength(1);
  });

  it("does not treat a wrong recent-authentication password as an expired session", async () => {
    const { actions, dependencies } = harness();
    fetchMock.mockResolvedValue(response({ errorCode: "AUTH_INVALID_CREDENTIALS" }, 401));
    await expect(actions.apiRequest("/auth/reauthenticate", { method: "POST" }, "test-access-old"))
      .rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dependencies.clearExpiredSession).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("rejects an old account response even when the transport ignores cancellation", async () => {
    const { actions, dependencies, ownerGuard } = harness();
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);
    const request = actions.apiRequest("/me", {}, "test-access-old");
    const rejection = expect(request).rejects.toBeInstanceOf(StaleAccountRequestError);
    ownerGuard.activate("student-b");
    gate.resolve(response({ id: "student-a", privateData: "old account only" }));
    await rejection;
    expect(dependencies.authenticatedRequestControllersRef.current.size).toBe(0);
    expect(dependencies.setSession).not.toHaveBeenCalled();
  });

  it("does not publish or persist a refresh response after the owner generation changes", async () => {
    const { actions, dependencies, ownerGuard } = harness();
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);
    const refresh = actions.refreshAuthenticatedSession("test-access-old");
    const otherSession = session("student-b", "other");
    ownerGuard.activate(otherSession.user.id);
    dependencies.sessionRef.current = otherSession;
    dependencies.notificationCoordinatorOwnerTokenRef.current = otherSession;
    gate.resolve(response(session("student-a", "late")));
    await expect(refresh).resolves.toBeNull();
    expect(dependencies.sessionRef.current).toBe(otherSession);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(dependencies.setSession).not.toHaveBeenCalled();
    expect(dependencies.clearExpiredSession).not.toHaveBeenCalled();
  });

  it("fails closed when a rotated token cannot be durably stored", async () => {
    const { actions, dependencies } = harness();
    fetchMock.mockResolvedValue(response(session("student-a", "rotated")));
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(actions.refreshAuthenticatedSession("test-access-old")).resolves.toBeNull();
    expect(dependencies.clearExpiredSession).toHaveBeenCalledWith(
      "Oturum yenilendi ancak cihazda güvenli biçimde saklanamadı. Lütfen tekrar giriş yap.",
    );
    expect(dependencies.setSession).not.toHaveBeenCalled();
    expect(dependencies.sessionRef.current?.accessToken).toBe("test-access-old");
    expect(dependencies.refreshSessionPromiseRef.current).toBeNull();
  });

  it("preserves trusted visible data on refresh failure and suppresses stale-owner settlements", async () => {
    const { actions, ownerGuard } = harness();
    let visible: Loadable<string[]> = { loading: false, data: ["trusted"] };
    const setter = jest.fn((update: React.SetStateAction<Loadable<string[]>>) => {
      visible = typeof update === "function" ? update(visible) : update;
    });
    await expect(actions.withLoadable(setter, async () => { throw new Error("Offline"); }, ownerGuard.capture(), true))
      .resolves.toBeNull();
    expect(visible).toMatchObject({ loading: false, data: ["trusted"], stale: true, attempted: true });

    const gate = deferred<string[]>();
    const loading = actions.withLoadable(setter, () => gate.promise, ownerGuard.capture(), true);
    const callsBeforeOwnerChange = setter.mock.calls.length;
    ownerGuard.activate("student-b");
    gate.resolve(["student-a private content"]);
    await expect(loading).resolves.toBeNull();
    expect(setter).toHaveBeenCalledTimes(callsBeforeOwnerChange);
    expect(visible.data).toEqual(["trusted"]);
  });

  it("serializes storage mutations across factories and continues after a rejected write", async () => {
    const { actions, dependencies } = harness();
    const gate = deferred<void>();
    const order: string[] = [];
    const first = actions.enqueueStorageMutation(async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-failed");
      throw new Error("Write failed");
    });
    const rejection = expect(first).rejects.toThrow("Write failed");
    const second = createApiActions(dependencies).enqueueStorageMutation(async () => {
      order.push("second");
      return "saved";
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await rejection;
    await expect(second).resolves.toBe("saved");
    expect(order).toEqual(["first-start", "first-failed", "second"]);
  });
});
