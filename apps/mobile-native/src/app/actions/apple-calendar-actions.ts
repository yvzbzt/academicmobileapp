import { Platform } from "react-native";
import { googleCalendarDeletionCandidateSourceTypes } from "../../google-calendar/google-calendar-lifecycle";
import { type AccountGenerationSnapshot } from "../../auth/session-integrity";
import {
  normalizeTrustedApiContentEnvelope,
  normalizeTrustedContentCollection,
} from "../../content/content-trust";
import { type NativeCalendarContext } from "../../native-calendar";
import { StaleAccountRequestError, userMessageFromError } from "../app-errors";
import { type CalendarPayload, type AnnouncementCollectionApiPayload } from "../app-types";
import { normalizeCalendarPayloadForDisplay, trustedContentCollectionHasMore } from "../app-content";
import { buildNativeCalendarSyncEvents } from "../calendar-presentations";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "deviceIdRef" | "accountGuardRef" | "setAppleCalendarStoredState" | "setAppleCalendarLastResult"
  | "setAppleCalendarWarnings" | "setAppleCalendarError" | "setAppleCalendarPermission"
  | "setAppleCalendarState" | "nativeCalendarService" | "accountCleanupInProgressRef"
  | "appleCalendarNativeMutationRef" | "appleCalendarOperationRef" | "sessionRef"
  | "authenticatedRequestControllersRef" | "setAppleCalendarBusy" | "setMessage" | "setCalendar"
  | "setAnnouncements" | "appleCalendarPermission" | "appleCalendarStoredState"
> & Pick<ApplicationActions,
  "apiRequest"
>;

export function createAppleCalendarActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "nativeCalendarContext" | "restoreAppleCalendarConnection" | "beginAppleCalendarNativeMutation"
  | "waitForAppleCalendarNativeMutation" | "removeAppleManagedEventsForDeletion"
  | "syncAppleCalendar" | "disconnectAppleCalendar" | "openFirstManagedAppleCalendarEvent"
> {
  const {
    deviceIdRef,
    accountGuardRef,
    setAppleCalendarStoredState,
    setAppleCalendarLastResult,
    setAppleCalendarWarnings,
    setAppleCalendarError,
    setAppleCalendarPermission,
    setAppleCalendarState,
    nativeCalendarService,
    accountCleanupInProgressRef,
    appleCalendarNativeMutationRef,
    appleCalendarOperationRef,
    sessionRef,
    authenticatedRequestControllersRef,
    setAppleCalendarBusy,
    setMessage,
    apiRequest,
    setCalendar,
    setAnnouncements,
    appleCalendarPermission,
    appleCalendarStoredState
  } = dependencies;

  function nativeCalendarContext(ownerId: string): NativeCalendarContext {
    const normalizedOwnerId = ownerId.trim();
    const currentDeviceId = deviceIdRef.current.trim();
    if (!normalizedOwnerId || !currentDeviceId) throw new Error("Apple Takvim hesap bağlamı hazır değil.");
    return { userId: normalizedOwnerId, deviceId: currentDeviceId, platform: "ios" };
  }

  async function restoreAppleCalendarConnection(
    ownerId?: string,
    ownerSnapshot?: AccountGenerationSnapshot | null,
  ): Promise<void> {
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    setAppleCalendarStoredState({ mappings: {} });
    setAppleCalendarLastResult(null);
    setAppleCalendarWarnings([]);
    setAppleCalendarError(null);

    if (Platform.OS !== "ios") {
      setAppleCalendarPermission({ status: "unavailable", granted: false, canAskAgain: false });
      setAppleCalendarState("unavailable");
      return;
    }
    if (!ownerId) {
      setAppleCalendarPermission({ status: "not_determined", granted: false, canAskAgain: true });
      setAppleCalendarState("disconnected");
      return;
    }

    setAppleCalendarState("checking");
    const context = nativeCalendarContext(ownerId);
    const available = await nativeCalendarService.isAvailable(context);
    if (!available) {
      setAppleCalendarPermission({ status: "unavailable", granted: false, canAskAgain: false });
      setAppleCalendarState("unavailable");
      return;
    }

    const [permission, storedState] = await Promise.all([
      nativeCalendarService.getPermissionStatus(),
      nativeCalendarService.loadState(context),
    ]);
    if (ownerSnapshot && !accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
    const integration = storedState.integration;
    if (integration && (
      integration.userId !== context.userId
      || integration.deviceId !== context.deviceId
      || integration.platform !== context.platform
    )) {
      setAppleCalendarStoredState({ mappings: {} });
      setAppleCalendarPermission(permission);
      setAppleCalendarState("error");
      throw new Error("Apple Takvim kayıt sahibi doğrulanamadı; mevcut kayıtlar korunuyor.");
    }

    const conflicts = Object.values(storedState.mappings).filter((mapping) => (
      mapping.status && mapping.status !== "managed"
    )).length;
    setAppleCalendarStoredState(storedState);
    setAppleCalendarPermission(permission);
    if (conflicts > 0) {
      setAppleCalendarWarnings([`${conflicts} kayıt kullanıcı değişikliği nedeniyle korunarak atlandı.`]);
    }
    if (!permission.granted && permission.status === "denied") {
      setAppleCalendarState("denied");
    } else if (integration?.enabled && permission.granted) {
      setAppleCalendarState(conflicts > 0 ? "partial" : "connected");
    } else if (Object.keys(storedState.mappings).length > 0) {
      setAppleCalendarState("partial");
    } else {
      setAppleCalendarState("disconnected");
    }
  }

  function beginAppleCalendarNativeMutation(): () => void {
    if (accountCleanupInProgressRef.current || appleCalendarNativeMutationRef.current) {
      throw new StaleAccountRequestError();
    }
    let finishPromise!: () => void;
    const operation = new Promise<void>((resolve) => {
      finishPromise = resolve;
    });
    appleCalendarNativeMutationRef.current = operation;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (appleCalendarNativeMutationRef.current === operation) {
        appleCalendarNativeMutationRef.current = null;
      }
      finishPromise();
    };
  }

  async function waitForAppleCalendarNativeMutation(): Promise<void> {
    await appleCalendarNativeMutationRef.current;
  }

  async function removeAppleManagedEventsForDeletion(ownerId: string): Promise<void> {
    if (Platform.OS !== "ios") return;
    const context = nativeCalendarContext(ownerId);
    const result = await nativeCalendarService.disconnect({ ...context, removeNativeEvents: true });
    const remaining = await nativeCalendarService.loadState(context);
    if (result.failed > 0 || result.conflicted > 0 || Object.keys(remaining.mappings).length > 0) {
      throw new Error("APPLE_CALENDAR_REMOVE_PARTIAL");
    }
  }

  async function syncAppleCalendar(): Promise<void> {
    if (Platform.OS !== "ios") {
      setAppleCalendarState("unavailable");
      setAppleCalendarError("Apple Takvim bağlantısı yalnızca iPhone ve iPad cihazlarında kullanılabilir.");
      return;
    }
    if (accountCleanupInProgressRef.current || appleCalendarOperationRef.current) return;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession?.accessToken || !ownerSnapshot) {
      setAppleCalendarError("Apple Takvim bağlantısı için yeniden giriş yapmalısın.");
      return;
    }

    const context = nativeCalendarContext(currentSession.user.id);
    const operationController = new AbortController();
    let finishAuthenticatedMutation: (() => void) | null = null;
    appleCalendarOperationRef.current = true;
    authenticatedRequestControllersRef.current.add(operationController);
    setAppleCalendarBusy(true);
    setAppleCalendarError(null);
    setAppleCalendarWarnings([]);
    setMessage(null);

    try {
      const [calendarResult, announcementResult] = await Promise.allSettled([
        apiRequest<CalendarPayload>(
          "/calendar/my",
          { signal: operationController.signal },
          currentSession.accessToken,
          { ownerSnapshot },
        ),
        apiRequest<AnnouncementCollectionApiPayload>(
          "/announcements/my/trusted?limit=100",
          { signal: operationController.signal },
          currentSession.accessToken,
          { ownerSnapshot },
        ),
      ]);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (calendarResult.status === "rejected" && announcementResult.status === "rejected") {
        throw calendarResult.reason;
      }

      const normalizedCalendar = calendarResult.status === "fulfilled"
        ? normalizeCalendarPayloadForDisplay(calendarResult.value)
        : null;
      const trustedAnnouncements = announcementResult.status === "fulfilled"
        ? normalizeTrustedApiContentEnvelope(announcementResult.value)
        : null;
      const announcementSnapshotComplete = Boolean(
        trustedAnnouncements
        && !trustedContentCollectionHasMore(trustedAnnouncements, 100),
      );
      const calendarEvents = normalizedCalendar?.events ?? [];
      const announcementItems = trustedAnnouncements?.items ?? [];
      const deletionEligibleSourceTypes = googleCalendarDeletionCandidateSourceTypes({
        calendarSourceStatus: normalizedCalendar?.sourceStatus,
        announcementState: announcementSnapshotComplete ? trustedAnnouncements?.state : "partial",
      });
      const warnings: string[] = [];

      if (calendarResult.status === "fulfilled") {
        setCalendar({ loading: false, data: normalizedCalendar!, attempted: true, stale: false });
        if (normalizedCalendar?.sourceStatus !== "parsed") {
          warnings.push("Akademik takvim kaynağı tam ayrıştırılmadığı için bu gruptan silme yapılmadı.");
        }
      } else {
        warnings.push("Akademik takvim kaynağı bu eşitlemede alınamadı.");
      }
      if (announcementResult.status === "fulfilled") {
        setAnnouncements({
          loading: false,
          data: trustedAnnouncements ?? normalizeTrustedContentCollection([]),
          attempted: true,
          stale: false,
        });
        if (trustedAnnouncements?.state !== "fresh" || !announcementSnapshotComplete) {
          warnings.push("Duyuru kaynakları kısmi, eski veya sayfalı olduğu için bu gruptan silme yapılmadı.");
        }
      } else {
        warnings.push("Duyuru ve etkinlik kaynakları bu eşitlemede alınamadı.");
      }

      const events = buildNativeCalendarSyncEvents(calendarEvents, announcementItems);
      try {
        finishAuthenticatedMutation = beginAppleCalendarNativeMutation();
      } catch {
        throw new StaleAccountRequestError();
      }
      const existingState = await nativeCalendarService.loadState(context);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (events.length === 0 && Object.keys(existingState.mappings).length === 0) {
        setAppleCalendarWarnings(warnings);
        setAppleCalendarState(existingState.integration?.enabled ? "connected" : "disconnected");
        setAppleCalendarError("Takvime aktarılabilecek kaynak tarihli akademik kayıt bulunamadı.");
        return;
      }

      let permission = await nativeCalendarService.getPermissionStatus();
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setAppleCalendarPermission(permission);
      if (!permission.granted && permission.status === "denied" && !permission.canAskAgain) {
        setAppleCalendarState("denied");
        setAppleCalendarError("Takvim erişimi cihaz ayarlarından kapalı. Ayarları açıp tam erişim vermelisin.");
        return;
      }

      let connectedState = existingState;
      if (!existingState.integration?.enabled || !permission.granted) {
        setAppleCalendarState("checking");
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        connectedState = await nativeCalendarService.connect({
          ...context,
          autoSyncEnabled: false,
          reminderMinutesBefore: [],
        });
        permission = await nativeCalendarService.getPermissionStatus();
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        setAppleCalendarPermission(permission);
        if (!permission.granted || !connectedState.integration?.enabled) {
          setAppleCalendarStoredState(connectedState);
          setAppleCalendarState(permission.status === "denied" ? "denied" : "disconnected");
          setAppleCalendarError("Apple Takvim eşitlemesi için tam takvim erişimi verilmedi.");
          return;
        }
      }

      setAppleCalendarStoredState(connectedState);
      setAppleCalendarState("syncing");
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const result = await nativeCalendarService.syncEvents({
        ...context,
        events,
        removeStale: true,
        deletionEligibleSourceTypes,
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const storedState = await nativeCalendarService.loadState(context);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const conflictCount = Object.values(storedState.mappings).filter((mapping) => (
        mapping.status && mapping.status !== "managed"
      )).length;
      if (conflictCount > 0 && result.conflicted === 0) {
        warnings.push(`${conflictCount} kullanıcı değişikliği korunarak atlandı.`);
      }
      if (result.conflicted > 0) {
        warnings.push(`${result.conflicted} kayıt Apple Takvim'de kullanıcı tarafından değiştirildiği için üzerine yazılmadı.`);
      }
      if (result.failed > 0) {
        warnings.push(`${result.failed} kayıt doğrulanamadı; kişisel etkinliklere dokunulmadı.`);
      }
      setAppleCalendarStoredState(storedState);
      setAppleCalendarLastResult(result);
      setAppleCalendarWarnings(warnings);
      setAppleCalendarState(result.failed > 0 || result.conflicted > 0 || warnings.length > 0 ? "partial" : "connected");
      setMessage({
        text: `Apple Takvim eşitlemesi tamamlandı: ${result.created} yeni, ${result.updated} güncellenen, ${result.deleted} kaldırılan kayıt.`,
        tone: result.failed > 0 || result.conflicted > 0 ? "info" : "success",
      });
    } catch (error) {
      if (error instanceof StaleAccountRequestError || operationController.signal.aborted) return;
      const permission = await nativeCalendarService.getPermissionStatus().catch(() => appleCalendarPermission);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      setAppleCalendarPermission(permission);
      setAppleCalendarState(permission.status === "denied" ? "denied" : "error");
      setAppleCalendarError(
        permission.status === "denied"
          ? "Takvim erişimi cihaz ayarlarından kapalı. Tam erişim verip tekrar dene."
          : userMessageFromError(error, "Apple Takvim eşitlemesi tamamlanamadı."),
      );
    } finally {
      authenticatedRequestControllersRef.current.delete(operationController);
      appleCalendarOperationRef.current = false;
      finishAuthenticatedMutation?.();
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setAppleCalendarBusy(false);
    }
  }

  async function disconnectAppleCalendar(removeManagedEvents: boolean): Promise<void> {
    if (Platform.OS !== "ios" || appleCalendarOperationRef.current) return;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) return;
    const context = nativeCalendarContext(currentSession.user.id);
    let finishAuthenticatedMutation: (() => void) | null = null;
    try {
      finishAuthenticatedMutation = beginAppleCalendarNativeMutation();
    } catch {
      return;
    }
    appleCalendarOperationRef.current = true;
    setAppleCalendarBusy(true);
    setAppleCalendarError(null);
    try {
      const result = await nativeCalendarService.disconnect({ ...context, removeNativeEvents: removeManagedEvents });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const storedState = await nativeCalendarService.loadState(context);
      setAppleCalendarStoredState(storedState);
      setAppleCalendarLastResult(result);
      if (Object.keys(storedState.mappings).length > 0 || result.failed > 0 || result.conflicted > 0) {
        setAppleCalendarState("partial");
        setAppleCalendarWarnings(["Kullanıcı tarafından değiştirilen veya doğrulanamayan kayıtlar güvenlik amacıyla korundu."]);
      } else {
        setAppleCalendarState("disconnected");
        setAppleCalendarWarnings([]);
      }
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setAppleCalendarState("error");
      setAppleCalendarError(userMessageFromError(error, "Apple Takvim bağlantısı değiştirilemedi."));
      throw error;
    } finally {
      appleCalendarOperationRef.current = false;
      finishAuthenticatedMutation?.();
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setAppleCalendarBusy(false);
    }
  }

  async function openFirstManagedAppleCalendarEvent(): Promise<void> {
    const currentSession = sessionRef.current;
    if (Platform.OS !== "ios" || !currentSession) return;
    const firstMapping = Object.values(appleCalendarStoredState.mappings).find((mapping) => mapping.status === "managed")
      ?? Object.values(appleCalendarStoredState.mappings)[0];
    if (!firstMapping) {
      setAppleCalendarError("Apple Takvim'de açılabilecek yönetilen kayıt bulunamadı.");
      return;
    }
    try {
      await nativeCalendarService.openEvent(
        nativeCalendarContext(currentSession.user.id),
        firstMapping.appEventId,
        { allowsEditing: false },
      );
    } catch (error) {
      setAppleCalendarError(userMessageFromError(error, "Apple Takvim kaydı açılamadı."));
    }
  }

  return {
    nativeCalendarContext,
    restoreAppleCalendarConnection,
    beginAppleCalendarNativeMutation,
    waitForAppleCalendarNativeMutation,
    removeAppleManagedEventsForDeletion,
    syncAppleCalendar,
    disconnectAppleCalendar,
    openFirstManagedAppleCalendarEvent
  };
}
