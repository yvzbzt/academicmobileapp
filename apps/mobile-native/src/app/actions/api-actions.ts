import { type Dispatch, type SetStateAction } from "react";
import { nextRuntimeDiagnosticId, runtimeDiagnostic } from "../../performance/runtime-diagnostics";
import {
  type AuthOperation,
  type AccountGenerationSnapshot,
  classifyAuthError,
} from "../../auth/session-integrity";
import {
  normalizeAccountAuthProvider,
  shouldRefreshSessionAfterRecentAuthenticationFailure,
} from "../../auth/recent-authentication";
import {
  StaleAccountRequestError,
  ApiRequestError,
  readApiErrorPayload,
  parseApiErrorMessage,
  userMessageFromError,
} from "../app-errors";
import { type SessionPayload, type Loadable } from "../app-types";
import { setStoredValue, SESSION_STORAGE_KEY } from "../app-storage";
import { API_REQUEST_TIMEOUT_MS } from "../app-config";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "storageMutationQueueRef" | "accountCleanupInProgressRef" | "activeAuthenticatedMutationsRef"
  | "authenticatedRequestControllersRef" | "sessionRef" | "accountGuardRef" | "deviceIdRef"
  | "refreshSessionPromiseRef" | "notificationCoordinatorOwnerTokenRef" | "setAccountAuthProvider"
  | "setSession" | "setMessage" | "apiBaseUrl"
> & Pick<ApplicationActions,
  "clearExpiredSession"
>;

export function createApiActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "enqueueStorageMutation" | "trackAuthenticatedMutation" | "waitForAuthenticatedMutations"
  | "abortAuthenticatedRequests" | "refreshAuthenticatedSession" | "apiRequest" | "withLoadable"
> {
  const {
    storageMutationQueueRef,
    accountCleanupInProgressRef,
    activeAuthenticatedMutationsRef,
    authenticatedRequestControllersRef,
    sessionRef,
    accountGuardRef,
    deviceIdRef,
    refreshSessionPromiseRef,
    notificationCoordinatorOwnerTokenRef,
    setAccountAuthProvider,
    setSession,
    clearExpiredSession,
    setMessage,
    apiBaseUrl
  } = dependencies;

  function enqueueStorageMutation<T>(action: () => Promise<T>): Promise<T> {
    const next = storageMutationQueueRef.current.catch(() => undefined).then(action);
    storageMutationQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }

  function trackAuthenticatedMutation<T>(action: () => Promise<T>): Promise<T> {
    if (accountCleanupInProgressRef.current) return Promise.reject(new StaleAccountRequestError());
    const operation = action();
    activeAuthenticatedMutationsRef.current.add(operation);
    const remove = () => activeAuthenticatedMutationsRef.current.delete(operation);
    operation.then(remove, remove);
    return operation;
  }

  async function waitForAuthenticatedMutations(): Promise<void> {
    while (activeAuthenticatedMutationsRef.current.size > 0) {
      await Promise.allSettled([...activeAuthenticatedMutationsRef.current]);
    }
  }

  function abortAuthenticatedRequests(): void {
    for (const controller of authenticatedRequestControllersRef.current) controller.abort();
    authenticatedRequestControllersRef.current.clear();
  }

  async function refreshAuthenticatedSession(expiredAccessToken?: string): Promise<SessionPayload | null> {
    const currentSession = sessionRef.current;
    const snapshot = accountGuardRef.current.capture();
    const currentDeviceId = deviceIdRef.current;
    if (!currentSession || !snapshot || !currentDeviceId) return null;
    if (expiredAccessToken && currentSession.accessToken !== expiredAccessToken) return currentSession;
    if (refreshSessionPromiseRef.current) return refreshSessionPromiseRef.current;

    let refreshPromise!: Promise<SessionPayload | null>;
    refreshPromise = (async () => {
      let sessionWasRotated = false;
      try {
        const nextSession = await apiRequest<SessionPayload>(
          "/auth/refresh-token",
          {
            method: "POST",
            body: JSON.stringify({
              refreshToken: currentSession.refreshToken,
              deviceId: currentDeviceId
            })
          },
          undefined,
          {
            skipAuthRefresh: true,
            authOperation: "refresh_session",
            ownerSnapshot: snapshot
          }
        );
        sessionWasRotated = true;
        if (!accountGuardRef.current.isCurrent(snapshot) || nextSession.user.id !== snapshot.ownerId) return null;
        await enqueueStorageMutation(async () => {
          if (!accountGuardRef.current.isCurrent(snapshot) || accountCleanupInProgressRef.current) return;
          await setStoredValue(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
        });
        if (!accountGuardRef.current.isCurrent(snapshot)) return null;
        sessionRef.current = nextSession;
        notificationCoordinatorOwnerTokenRef.current = nextSession;
        setAccountAuthProvider(normalizeAccountAuthProvider(nextSession.user.authProvider));
        setSession(nextSession);
        return nextSession;
      } catch (error) {
        if (error instanceof StaleAccountRequestError || !accountGuardRef.current.isCurrent(snapshot)) return null;
        if (sessionWasRotated) {
          await clearExpiredSession("Oturum yenilendi ancak cihazda güvenli biçimde saklanamadı. Lütfen tekrar giriş yap.");
        } else if (
          error instanceof ApiRequestError
          && (error.code === "session_expired" || error.code === "disabled_account")
        ) {
          await clearExpiredSession(error.message);
        } else {
          setMessage({ text: "Oturum şu anda yenilenemedi. Bağlantını kontrol edip tekrar dene.", tone: "error" });
        }
        return null;
      } finally {
        if (refreshSessionPromiseRef.current === refreshPromise) refreshSessionPromiseRef.current = null;
      }
    })();
    refreshSessionPromiseRef.current = refreshPromise;
    return refreshPromise;
  }

  async function apiRequest<T>(
    path: string,
    options: RequestInit = {},
    token?: string,
    requestOptions: {
      skipAuthRefresh?: boolean;
      authOperation?: AuthOperation;
      ownerSnapshot?: AccountGenerationSnapshot | null;
      detached?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<T> {
    const diagnosticId = nextRuntimeDiagnosticId();
    const diagnosticStartedAt = Date.now();
    const diagnosticPath = path.split("?", 1)[0] ?? path;
    const diagnosticMethod = options.method ?? "GET";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined)
    };

    if (token) headers.Authorization = `Bearer ${token}`;

    const ownerSnapshot = requestOptions.ownerSnapshot ?? (
      token && !requestOptions.detached ? accountGuardRef.current.capture() : null
    );
    if (token && !requestOptions.detached && !ownerSnapshot) throw new StaleAccountRequestError();
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

    const effectiveTimeoutMs = requestOptions.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
    runtimeDiagnostic("api.start", {
      id: diagnosticId,
      method: diagnosticMethod,
      path: diagnosticPath,
      authenticated: Boolean(token),
      timeoutMs: effectiveTimeoutMs,
    });
    const controller = ownerSnapshot || effectiveTimeoutMs > 0 ? new AbortController() : null;
    const upstreamSignal = options.signal;
    const abortFromUpstream = () => controller?.abort();
    let requestTimedOut = false;
    const timeout = effectiveTimeoutMs > 0 && controller
      ? setTimeout(() => {
        requestTimedOut = true;
        controller.abort();
      }, effectiveTimeoutMs)
      : null;
    if (controller) {
      authenticatedRequestControllersRef.current.add(controller);
      if (upstreamSignal?.aborted) controller.abort();
      else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    }

    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers,
        ...(controller ? { signal: controller.signal } : {})
      });
      runtimeDiagnostic("api.response", {
        id: diagnosticId,
        method: diagnosticMethod,
        path: diagnosticPath,
        status: response.status,
        elapsedMs: Date.now() - diagnosticStartedAt,
      });
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      if (!response.ok) {
        const body = await response.text();
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        const payload = readApiErrorPayload(body);
        if (
          token
          && !requestOptions.skipAuthRefresh
          && shouldRefreshSessionAfterRecentAuthenticationFailure(response.status, payload.errorCode)
        ) {
          const refreshedSession = await refreshAuthenticatedSession(token);
          if (refreshedSession && (!ownerSnapshot || accountGuardRef.current.isCurrent(ownerSnapshot))) {
            return apiRequest<T>(path, options, refreshedSession.accessToken, {
              ...requestOptions,
              skipAuthRefresh: true,
              ownerSnapshot
            });
          }
        }
        const details = {
          ...(payload.details ?? {}),
          ...(payload.resendAvailableAt ? { resendAvailableAt: payload.resendAvailableAt } : {})
        };
        if (requestOptions.authOperation) {
          const controlled = classifyAuthError({
            operation: requestOptions.authOperation,
            status: response.status,
            body: payload
          });
          throw new ApiRequestError(controlled.message, response.status, controlled.code, details);
        }
        throw new ApiRequestError(
          parseApiErrorMessage(body, `${response.status} ${response.statusText}`, response.status),
          response.status,
          payload.errorCode,
          details
        );
      }

      const data = (await response.json()) as T;
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      runtimeDiagnostic("api.success", {
        id: diagnosticId,
        method: diagnosticMethod,
        path: diagnosticPath,
        status: response.status,
        elapsedMs: Date.now() - diagnosticStartedAt,
      });
      return data;
    } catch (error) {
      runtimeDiagnostic("api.failure", {
        id: diagnosticId,
        method: diagnosticMethod,
        path: diagnosticPath,
        timedOut: requestTimedOut,
        aborted: Boolean(controller?.signal.aborted),
        errorType: error instanceof Error ? error.name : "unknown",
        elapsedMs: Date.now() - diagnosticStartedAt,
      });
      if (requestTimedOut) {
        throw new ApiRequestError("Sunucu zamanında yanıt vermedi. Lütfen tekrar dene.", 0, "network_unavailable");
      }
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) {
        throw new StaleAccountRequestError();
      }
      if (error instanceof StaleAccountRequestError || error instanceof ApiRequestError) throw error;
      if (controller?.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new StaleAccountRequestError();
      }
      throw new ApiRequestError("Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.", 0);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (controller) authenticatedRequestControllersRef.current.delete(controller);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }

  async function withLoadable<T>(
    setter: Dispatch<SetStateAction<Loadable<T>>>,
    action: () => Promise<T>,
    ownerSnapshot: AccountGenerationSnapshot | null = accountGuardRef.current.capture(),
    preserveDataOnRefresh = false,
    isOperationCurrent: () => boolean = () => true
  ): Promise<T | null> {
    if ((ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) || !isOperationCurrent()) return null;
    setter((previous) => preserveDataOnRefresh && previous.data !== undefined
      ? { loading: true, data: previous.data, attempted: true, stale: Boolean(previous.stale) }
      : { loading: true, attempted: true });
    try {
      const data = await action();
      if ((ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) || !isOperationCurrent()) return null;
      setter({ loading: false, data, attempted: true, stale: false });
      return data;
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot))
        || !isOperationCurrent()
      ) {
        return null;
      }
      const message = userMessageFromError(error, "İşlem tamamlanamadı. Lütfen tekrar dene.");
      setter((previous) => preserveDataOnRefresh && previous.data !== undefined
        ? { loading: false, data: previous.data, error: message, attempted: true, stale: true }
        : { loading: false, error: message, attempted: true, stale: false });
      return null;
    }
  }

  return {
    enqueueStorageMutation,
    trackAuthenticatedMutation,
    waitForAuthenticatedMutations,
    abortAuthenticatedRequests,
    refreshAuthenticatedSession,
    apiRequest,
    withLoadable
  };
}
