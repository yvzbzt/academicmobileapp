import { GoogleSignin, isCancelledResponse } from "@react-native-google-signin/google-signin";
import {
  GoogleCalendarSyncError,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
} from "../../google-calendar/google-calendar-sync";
import {
  readGoogleCalendarConnectionRecordV3,
  type GoogleCalendarConnectionRecordV3,
  GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
  type GoogleCalendarLifecycleState,
  GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED,
} from "../../google-calendar/google-calendar-lifecycle";
import { type AccountGenerationSnapshot } from "../../auth/session-integrity";
import { StaleAccountRequestError } from "../app-errors";
import {
  getStoredValue,
  LEGACY_GOOGLE_CALENDAR_STORAGE_KEY,
  deleteStoredValue,
  createGoogleCalendarStorageKey,
  createGoogleCalendarV2StorageKey,
  setStoredValue,
} from "../app-storage";
import { type LegacyGoogleCalendarConnectionRecord } from "../app-types";
import { GOOGLE_AUTH_CONFIGURED, clearGoogleAccountSelection } from "../app-auth-providers";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "accountGuardRef" | "setGoogleCalendarIntegration" | "setGoogleCalendarLastResult"
  | "setGoogleCalendarWarnings" | "setGoogleCalendarError" | "setGoogleCalendarState"
  | "authenticatedRequestControllersRef" | "googleSdkQueueRef" | "googleSdkEpochRef"
> & Pick<ApplicationActions,
  "enqueueStorageMutation"
> & Pick<ApplicationDerivedState,
  "googleCalendarService"
>;

export function createGoogleCalendarConnectionActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "restoreGoogleCalendarConnection" | "enqueueGoogleSdkOperation"
  | "readCurrentGoogleCalendarAuthorization" | "queueGoogleSignOut"
  | "revokeGoogleCalendarAccessForConnection" | "persistGoogleCalendarConnection"
  | "readStoredGoogleCalendarConnection" | "removeGoogleManagedEventsForDeletion"
  | "runAbortableGoogleCleanup" | "authorizeGoogleCalendar"
> {
  const {
    accountGuardRef,
    setGoogleCalendarIntegration,
    setGoogleCalendarLastResult,
    setGoogleCalendarWarnings,
    setGoogleCalendarError,
    setGoogleCalendarState,
    enqueueStorageMutation,
    authenticatedRequestControllersRef,
    googleCalendarService,
    googleSdkQueueRef,
    googleSdkEpochRef
  } = dependencies;

  async function restoreGoogleCalendarConnection(
    ownerId?: string,
    ownerSnapshot?: AccountGenerationSnapshot | null
  ): Promise<void> {
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setGoogleCalendarIntegration(null);
    setGoogleCalendarLastResult(null);
    setGoogleCalendarWarnings([]);
    setGoogleCalendarError(null);
    setGoogleCalendarState(ownerId ? "checking" : "disconnected");
    const legacy = await getStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
    if (!ownerId) {
      if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      setGoogleCalendarState("disconnected");
      return;
    }

    const storageKey = createGoogleCalendarStorageKey(ownerId);
    const v2StorageKey = createGoogleCalendarV2StorageKey(ownerId);
    const stored = await getStoredValue(storageKey);
    const storedV2 = await getStoredValue(v2StorageKey);
    const parsedV3 = stored ? readGoogleCalendarConnectionRecordV3(stored, ownerId) : null;
    const legacyCandidate = storedV2 ?? legacy;
    let parsedLegacy: LegacyGoogleCalendarConnectionRecord | null = null;
    try {
      const parsed = legacyCandidate ? JSON.parse(legacyCandidate) as Partial<LegacyGoogleCalendarConnectionRecord> : null;
      parsedLegacy = parsed
        && parsed.ownerId === ownerId
        && typeof parsed.accountEmail === "string"
        && Boolean(parsed.accountEmail.trim())
        && typeof parsed.lastSyncedAt === "string"
        && !Number.isNaN(Date.parse(parsed.lastSyncedAt))
        ? parsed as LegacyGoogleCalendarConnectionRecord
        : null;
    } catch {
      parsedLegacy = null;
    }
    if (!parsedV3 && !parsedLegacy) {
      await enqueueStorageMutation(async () => {
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        if (stored) await deleteStoredValue(storageKey);
        if (storedV2) await deleteStoredValue(v2StorageKey);
        if (legacy) await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      });
      setGoogleCalendarState("disconnected");
      return;
    }

    if (parsedV3?.state === "disconnected") {
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setGoogleCalendarIntegration(parsedV3);
      setGoogleCalendarState("disconnected");
      await enqueueStorageMutation(async () => {
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        await deleteStoredValue(v2StorageKey).catch(() => undefined);
        await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY).catch(() => undefined);
      });
      return;
    }

    if (!GOOGLE_AUTH_CONFIGURED) {
      if (parsedV3) setGoogleCalendarIntegration({ ...parsedV3, state: "expired" });
      setGoogleCalendarState("expired");
      return;
    }

    const restoreController = new AbortController();
    authenticatedRequestControllersRef.current.add(restoreController);
    try {
      const authorization = await readCurrentGoogleCalendarAuthorization();
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (
        (parsedV3 && parsedV3.googleAccountId !== authorization.googleAccountId)
        || (parsedLegacy && parsedLegacy.accountEmail.trim().toLowerCase() !== authorization.accountEmail.trim().toLowerCase())
      ) {
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      const verification = await googleCalendarService.verifyAuthorization({
        accessToken: authorization.accessToken,
        ownerId,
        signal: restoreController.signal
      });
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const record: GoogleCalendarConnectionRecordV3 = {
        schemaVersion: GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
        ownerId,
        googleAccountId: authorization.googleAccountId,
        accountEmail: authorization.accountEmail,
        state: "connected",
        authorizationVerifiedAt: new Date().toISOString(),
        ...(parsedV3?.lastSyncedAt
          ? { lastSyncedAt: parsedV3.lastSyncedAt }
          : parsedLegacy?.lastSyncedAt
            ? { lastSyncedAt: parsedLegacy.lastSyncedAt }
            : {}),
        mappings: verification.mappings
      };
      await enqueueStorageMutation(async () => {
        if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) {
          throw new StaleAccountRequestError();
        }
        await persistGoogleCalendarConnection(record);
        await deleteStoredValue(v2StorageKey).catch(() => undefined);
        await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY).catch(() => undefined);
      });
      if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setGoogleCalendarIntegration(record);
      setGoogleCalendarState("connected");
    } catch (error) {
      if (error instanceof StaleAccountRequestError || (error instanceof Error && error.name === "AbortError")) {
        throw new StaleAccountRequestError();
      }
      if (!parsedV3) {
        await enqueueStorageMutation(async () => {
          if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
          await deleteStoredValue(v2StorageKey).catch(() => undefined);
          await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY).catch(() => undefined);
        });
      } else {
        const state: GoogleCalendarLifecycleState = error instanceof GoogleCalendarSyncError
          && error.code !== "GOOGLE_CALENDAR_AUTH_EXPIRED"
          ? "error"
          : "expired";
        setGoogleCalendarIntegration({ ...parsedV3, state });
        setGoogleCalendarState(state);
      }
      setGoogleCalendarError(
        error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH"
          ? "Google hesabı değişmiş. Devam etmek için hesabını yeniden seç."
          : "Google Takvim bağlantısı canlı olarak doğrulanamadı. Yeniden bağlanabilirsin."
      );
      if (!parsedV3) setGoogleCalendarState("disconnected");
    } finally {
      authenticatedRequestControllersRef.current.delete(restoreController);
    }
  }

  function enqueueGoogleSdkOperation<T>(action: () => Promise<T>): Promise<T> {
    const next = googleSdkQueueRef.current.catch(() => undefined).then(action);
    googleSdkQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }

  function readCurrentGoogleCalendarAuthorization(): Promise<{
    accessToken: string;
    accountEmail: string;
    googleAccountId: string;
  }> {
    return enqueueGoogleSdkOperation(async () => {
      const currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser?.user.id || !currentUser.user.email) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      const tokens = await GoogleSignin.getTokens();
      if (!tokens.accessToken) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      return {
        accessToken: tokens.accessToken,
        accountEmail: currentUser.user.email,
        googleAccountId: currentUser.user.id
      };
    });
  }

  function queueGoogleSignOut(signal?: AbortSignal): Promise<void> {
    if (!GOOGLE_AUTH_CONFIGURED) return Promise.resolve();
    const epoch = googleSdkEpochRef.current;
    return enqueueGoogleSdkOperation(async () => {
      if (signal?.aborted || googleSdkEpochRef.current !== epoch) return;
      await GoogleSignin.signOut();
    });
  }

  function revokeGoogleCalendarAccessForConnection(
    connection: GoogleCalendarConnectionRecordV3,
    signal?: AbortSignal
  ): Promise<void> {
    return enqueueGoogleSdkOperation(async () => {
      if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
      const currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser?.user.id || currentUser.user.id !== connection.googleAccountId) {
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      const tokens = await GoogleSignin.getTokens();
      if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
      if (!tokens.accessToken || GoogleSignin.getCurrentUser()?.user.id !== connection.googleAccountId) {
        throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      }
      await GoogleSignin.revokeAccess();
    });
  }

  async function persistGoogleCalendarConnection(
    record: GoogleCalendarConnectionRecordV3 | null,
    ownerId = record?.ownerId
  ): Promise<void> {
    if (!record) {
      if (ownerId) {
        await deleteStoredValue(createGoogleCalendarStorageKey(ownerId));
        await deleteStoredValue(createGoogleCalendarV2StorageKey(ownerId));
      }
      await deleteStoredValue(LEGACY_GOOGLE_CALENDAR_STORAGE_KEY);
      return;
    }
    await setStoredValue(createGoogleCalendarStorageKey(record.ownerId), JSON.stringify(record));
  }

  async function readStoredGoogleCalendarConnection(ownerId: string): Promise<GoogleCalendarConnectionRecordV3 | null> {
    const stored = await getStoredValue(createGoogleCalendarStorageKey(ownerId));
    return stored ? readGoogleCalendarConnectionRecordV3(stored, ownerId) : null;
  }

  async function removeGoogleManagedEventsForDeletion(
    ownerId: string,
    connection: GoogleCalendarConnectionRecordV3,
    signal?: AbortSignal
  ): Promise<void> {
    const authorization = await readCurrentGoogleCalendarAuthorization();
    if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
    if (authorization.googleAccountId !== connection.googleAccountId) {
      throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
    }
    const removal = await googleCalendarService.removeManagedEvents({
      accessToken: authorization.accessToken,
      ownerId,
      signal
    });
    if (signal?.aborted) throw Object.assign(new Error("Google cleanup aborted."), { name: "AbortError" });
    if (removal.partial || removal.remaining > 0) {
      await persistGoogleCalendarConnection({
        ...connection,
        state: "partial",
        mappings: removal.mappings
      });
      throw new Error("GOOGLE_CALENDAR_REMOVE_PARTIAL");
    }
    await persistGoogleCalendarConnection({
      ...connection,
      state: "partial",
      mappings: []
    });
  }

  async function runAbortableGoogleCleanup(
    action: (signal: AbortSignal) => Promise<void>,
    timeoutMs = 8_000
  ): Promise<void> {
    const controller = new AbortController();
    let rejectTimeout!: (reason?: unknown) => void;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout(new Error("Google cleanup timed out."));
    }, timeoutMs);
    try {
      await Promise.race([action(controller.signal), timeoutFailure]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function authorizeGoogleCalendar(forceAccountSelection: boolean): Promise<{
    accessToken: string;
    accountEmail: string;
    googleAccountId: string;
  }> {
    return enqueueGoogleSdkOperation(async () => {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      if (forceAccountSelection) await clearGoogleAccountSelection();
      let currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser) {
        const signInResult = await GoogleSignin.signIn();
        if (isCancelledResponse(signInResult)) {
          throw new Error(GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED);
        }
        currentUser = signInResult.data;
      }

      const scopeResult = await GoogleSignin.addScopes({
        scopes: [GOOGLE_CALENDAR_EVENTS_SCOPE]
      });
      if (scopeResult && isCancelledResponse(scopeResult)) {
        throw new Error(GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED);
      }

      const tokens = await GoogleSignin.getTokens();
      const selectedUser = GoogleSignin.getCurrentUser()?.user ?? currentUser.user;
      if (!tokens.accessToken || !selectedUser.email || !selectedUser.id) {
        throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
      }
      return {
        accessToken: tokens.accessToken,
        accountEmail: selectedUser.email,
        googleAccountId: selectedUser.id
      };
    });
  }

  return {
    restoreGoogleCalendarConnection,
    enqueueGoogleSdkOperation,
    readCurrentGoogleCalendarAuthorization,
    queueGoogleSignOut,
    revokeGoogleCalendarAccessForConnection,
    persistGoogleCalendarConnection,
    readStoredGoogleCalendarConnection,
    removeGoogleManagedEventsForDeletion,
    runAbortableGoogleCleanup,
    authorizeGoogleCalendar
  };
}
