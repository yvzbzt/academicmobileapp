import { statusCodes, isErrorWithCode, GoogleSignin } from "@react-native-google-signin/google-signin";
import { Alert } from "react-native";
import {
  type GoogleCalendarSyncResult,
  GoogleCalendarSyncError,
} from "../../google-calendar/google-calendar-sync";
import {
  settledGoogleCalendarLifecycleState,
  googleCalendarDeletionCandidateSourceTypes,
  evaluateGoogleCalendarPreflight,
  findDuplicateGoogleCalendarMappings,
  planGoogleCalendarExactMappingLookups,
  type GoogleCalendarLifecycleState,
  type GoogleCalendarConnectionRecordV3,
  GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
  resolveGoogleCalendarAuthorizationErrorPresentation,
  planGoogleCalendarLifecycle,
  executeGoogleCalendarLifecycle,
  planGoogleCalendarAccountSwitch,
} from "../../google-calendar/google-calendar-lifecycle";
import { ExpoNetworkAdapter } from "../../notifications";
import {
  normalizeTrustedApiContentEnvelope,
  normalizeTrustedContentCollection,
  normalizeTrustedApiContentCollection,
} from "../../content/content-trust";
import {
  type UserProfile,
  type CalendarPayload,
  type AnnouncementCollectionApiPayload,
  type EventRecord,
  type AnnouncementApiRecord,
} from "../app-types";
import { StaleAccountRequestError, userMessageFromError, ApiRequestError } from "../app-errors";
import {
  normalizeCalendarPayloadForDisplay,
  trustedContentCollectionHasMore,
  normalizeEventRecordsForDisplay,
} from "../app-content";
import { mappingsMatchDesiredContent, googleCalendarUserMessage } from "../calendar-presentations";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "accountCleanupInProgressRef" | "sessionRef" | "accountGuardRef" | "setGoogleCalendarError"
  | "googleLifecycleGuardRef" | "googleCalendarIntegration" | "setMessage" | "setGoogleCalendarBusy"
  | "setGoogleCalendarState" | "authenticatedRequestControllersRef" | "setCalendar"
  | "setAnnouncements" | "setGoogleCalendarIntegration" | "setGoogleCalendarLastResult"
  | "setGoogleCalendarWarnings"
> & Pick<ApplicationActions,
  "apiRequest" | "readCurrentGoogleCalendarAuthorization" | "authorizeGoogleCalendar"
  | "queueGoogleSignOut" | "enqueueStorageMutation" | "persistGoogleCalendarConnection"
  | "enqueueGoogleSdkOperation" | "runAbortableGoogleCleanup"
  | "revokeGoogleCalendarAccessForConnection"
> & Pick<ApplicationDerivedState,
  "googleCalendarService"
>;

export function createGoogleCalendarActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "syncGoogleCalendar" | "disconnectGoogleCalendar" | "promptGoogleCalendarAccountSwitch"
> {
  const {
    accountCleanupInProgressRef,
    sessionRef,
    accountGuardRef,
    setGoogleCalendarError,
    googleLifecycleGuardRef,
    googleCalendarIntegration,
    setMessage,
    setGoogleCalendarBusy,
    setGoogleCalendarState,
    authenticatedRequestControllersRef,
    apiRequest,
    setCalendar,
    setAnnouncements,
    readCurrentGoogleCalendarAuthorization,
    authorizeGoogleCalendar,
    queueGoogleSignOut,
    googleCalendarService,
    enqueueStorageMutation,
    persistGoogleCalendarConnection,
    setGoogleCalendarIntegration,
    setGoogleCalendarLastResult,
    setGoogleCalendarWarnings,
    enqueueGoogleSdkOperation,
    runAbortableGoogleCleanup,
    revokeGoogleCalendarAccessForConnection
  } = dependencies;

  async function syncGoogleCalendar(forceAccountSelection = false): Promise<void> {
    if (accountCleanupInProgressRef.current) return;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession?.accessToken || !ownerSnapshot) {
      setGoogleCalendarError("Google Takvim bağlantısı için yeniden giriş yapmalısın.");
      return;
    }

    const operationSnapshot = googleLifecycleGuardRef.current.begin(currentSession.user.id);
    if (!operationSnapshot) {
      setGoogleCalendarError("Google Takvim işlemi zaten devam ediyor.");
      return;
    }
    const expectedGoogleAccountId = googleCalendarIntegration?.ownerId === currentSession.user.id
      ? googleCalendarIntegration.googleAccountId
      : null;
    const authorizationInterruptionState = settledGoogleCalendarLifecycleState(
      googleCalendarIntegration?.state,
    );

    setGoogleCalendarError(null);
    setMessage(null);
    setGoogleCalendarBusy(true);
    setGoogleCalendarState("syncing");
    let googleAccessToken: string | undefined;
    const syncController = new AbortController();
    authenticatedRequestControllersRef.current.add(syncController);

    try {
      const [networkResult, profileResult, calendarResult, announcementResult] = await Promise.allSettled([
        new ExpoNetworkAdapter().getState(syncController.signal),
        apiRequest<UserProfile>(
          "/me",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        ),
        apiRequest<CalendarPayload>(
          "/calendar/my",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        ),
        apiRequest<AnnouncementCollectionApiPayload>(
          "/announcements/my/trusted?limit=100",
          { signal: syncController.signal },
          currentSession.accessToken,
          { ownerSnapshot }
        )
      ]);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (profileResult.status === "rejected") throw profileResult.reason;
      if (calendarResult.status === "rejected" && announcementResult.status === "rejected") {
        throw calendarResult.reason;
      }

      const normalizedCalendar = calendarResult.status === "fulfilled"
        ? normalizeCalendarPayloadForDisplay(calendarResult.value)
        : null;
      const calendarEvents = normalizedCalendar?.events ?? [];
      const trustedAnnouncements = announcementResult.status === "fulfilled"
        ? normalizeTrustedApiContentEnvelope(announcementResult.value)
        : null;
      const announcementSnapshotComplete = Boolean(
        trustedAnnouncements
        && !trustedContentCollectionHasMore(trustedAnnouncements, 100),
      );
      const announcementItems = trustedAnnouncements?.items ?? [];
      const deletionCandidateSourceTypes = googleCalendarDeletionCandidateSourceTypes({
        calendarSourceStatus: normalizedCalendar?.sourceStatus,
        announcementState: announcementSnapshotComplete ? trustedAnnouncements?.state : "partial"
      });
      const warnings: string[] = [];

      if (calendarResult.status === "fulfilled") {
        if (normalizedCalendar?.sourceStatus !== "parsed") {
          warnings.push("Akademik takvim kaynağı tam olarak ayrıştırılmadığı için bu gruptan silme yapılmadı.");
        }
        setCalendar({
          loading: false,
          data: normalizedCalendar ?? normalizeCalendarPayloadForDisplay(calendarResult.value),
          attempted: true,
          stale: false
        });
      } else {
        warnings.push("Akademik takvim kaynağı bu eşitlemede alınamadı.");
        setCalendar({
          loading: false,
          error: userMessageFromError(calendarResult.reason, "Akademik takvim şu anda alınamadı."),
          attempted: true,
          stale: false
        });
      }
      if (announcementResult.status === "fulfilled") {
        if (trustedAnnouncements?.state !== "fresh" || !announcementSnapshotComplete) {
          warnings.push("Duyuru kaynakları kısmi, eski veya sayfalı olduğu için bu gruptan silme yapılmadı.");
        }
        setAnnouncements({
          loading: false,
          data: trustedAnnouncements ?? normalizeTrustedContentCollection([]),
          attempted: true,
          stale: false
        });
      } else {
        warnings.push("Duyuru ve etkinlik kaynakları bu eşitlemede alınamadı.");
        setAnnouncements({
          loading: false,
          error: userMessageFromError(announcementResult.reason, "Duyurular şu anda alınamadı."),
          attempted: true,
          stale: false
        });
      }

      if (networkResult.status === "rejected") {
        setGoogleCalendarError("Ağ durumu doğrulanamadı. Google hesap izni istenmedi.");
        setGoogleCalendarState(authorizationInterruptionState);
        return;
      }
      const preflight = evaluateGoogleCalendarPreflight({
        ownerId: currentSession.user.id,
        activeOwnerId: ownerSnapshot.ownerId,
        operationInProgress: false,
        academicProfile: profileResult.value,
        calendarEvents,
        trustedAnnouncements: announcementItems,
        deletionEligibleSourceTypes: [],
        hasManagedMappingsForCleanup: Boolean(
          googleCalendarIntegration?.mappings.some((mapping) => (
            deletionCandidateSourceTypes.includes(mapping.sourceType)
          ))
        )
      }, {
        isConnected: networkResult.value.connected,
        isInternetReachable: networkResult.value.internetReachable
      });
      if (!preflight.ready) {
        const preflightMessages: Record<typeof preflight.reason, string> = {
          duplicate_sync: "Google Takvim işlemi zaten devam ediyor.",
          owner_changed: "Hesap değiştiği için Google Takvim işlemi iptal edildi.",
          academic_profile_missing: "Google izni istenmedi. Önce profilinden üniversiteni seç.",
          no_content: "Google izni istenmedi. Profiline ait aktarılabilir, kaynak tarihli içerik bulunamadı.",
          network_unavailable: "İnternet bağlantısı yok. Google hesap izni istenmedi.",
          network_check_failed: "Ağ durumu doğrulanamadı. Google hesap izni istenmedi.",
          authorization_failed: "Google Takvim yetkilendirmesi tamamlanamadı."
        };
        setGoogleCalendarError(preflightMessages[preflight.reason]);
        setGoogleCalendarState(authorizationInterruptionState);
        return;
      }
      if (
        googleCalendarIntegration
        && findDuplicateGoogleCalendarMappings(googleCalendarIntegration.mappings).hasDuplicates
      ) {
        setGoogleCalendarError("Kaydedilmiş Google Takvim eşlemesinde çakışma bulundu. Yeniden bağlanmadan işlem yapılmadı.");
        setGoogleCalendarState("error");
        return;
      }

      // This is the first point at which account or scope UI may be shown.
      const emptyManagedCleanup = preflight.items.length === 0 && Boolean(googleCalendarIntegration);
      const authorization = emptyManagedCleanup
        ? await readCurrentGoogleCalendarAuthorization()
        : await authorizeGoogleCalendar(forceAccountSelection);
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      if (
        (emptyManagedCleanup || !forceAccountSelection)
        && expectedGoogleAccountId
        && authorization.googleAccountId !== expectedGoogleAccountId
      ) {
        await queueGoogleSignOut();
        throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
      }
      googleAccessToken = authorization.accessToken;
      const verification = await googleCalendarService.verifyAuthorization({
        accessToken: authorization.accessToken,
        ownerId: currentSession.user.id,
        signal: syncController.signal
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      const exactLookupPlan = planGoogleCalendarExactMappingLookups(
        verification.mappings,
        preflight.items,
        deletionCandidateSourceTypes
      );
      const deletionBlockedSourceTypes = new Set(exactLookupPlan.malformedSourceTypes);
      const reconciledCalendarEvents = [...calendarEvents];
      const reconciledAnnouncementItems = [...announcementItems];
      const exactLookupResults: Array<{
        sourceType: "academic_event" | "announcement" | "event";
        recordId: string;
        status: "found" | "missing" | "error";
        calendarEvent?: EventRecord;
        announcement?: AnnouncementApiRecord;
      }> = [];
      for (let offset = 0; offset < exactLookupPlan.lookups.length; offset += 8) {
        const batch = exactLookupPlan.lookups.slice(offset, offset + 8);
        exactLookupResults.push(...await Promise.all(batch.map(async (lookup) => {
          try {
            if (lookup.sourceType === "academic_event") {
              const calendarEvent = await apiRequest<EventRecord>(
                `/calendar/my/trusted/${encodeURIComponent(lookup.recordId)}`,
                { signal: syncController.signal },
                currentSession.accessToken,
                { ownerSnapshot }
              );
              return { ...lookup, status: "found" as const, calendarEvent };
            }
            const announcement = await apiRequest<AnnouncementApiRecord>(
              `/announcements/my/trusted/${encodeURIComponent(lookup.recordId)}`,
              { signal: syncController.signal },
              currentSession.accessToken,
              { ownerSnapshot }
            );
            return { ...lookup, status: "found" as const, announcement };
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
              return { ...lookup, status: "missing" as const };
            }
            return { ...lookup, status: "error" as const };
          }
        })));
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      }

      for (const lookup of exactLookupResults) {
        if (lookup.status === "error") {
          deletionBlockedSourceTypes.add(lookup.sourceType);
          continue;
        }
        if (lookup.status !== "found") continue;
        if (lookup.sourceType === "academic_event") {
          if (!lookup.calendarEvent || lookup.calendarEvent.id !== lookup.recordId) {
            deletionBlockedSourceTypes.add(lookup.sourceType);
            continue;
          }
          const normalized = normalizeEventRecordsForDisplay([lookup.calendarEvent]);
          if (normalized[0] && !reconciledCalendarEvents.some((event) => event.id === normalized[0]?.id)) {
            reconciledCalendarEvents.push(normalized[0]);
          }
          continue;
        }
        if (!lookup.announcement || lookup.announcement.id !== lookup.recordId) {
          deletionBlockedSourceTypes.add(lookup.sourceType);
          continue;
        }
        const normalized = normalizeTrustedApiContentCollection([lookup.announcement]).items[0];
        if (normalized && !reconciledAnnouncementItems.some((item) => item.id === normalized.id)) {
          reconciledAnnouncementItems.push(normalized);
        }
      }

      const deletionEligibleSourceTypes = deletionCandidateSourceTypes
        .filter((sourceType) => !deletionBlockedSourceTypes.has(sourceType));
      if (deletionBlockedSourceTypes.size > 0) {
        warnings.push("Eksik eşlemeler kesin olarak doğrulanamadığı için ilgili Google Takvim kayıtları silinmedi.");
      }
      const reconciledPreflight = evaluateGoogleCalendarPreflight({
        ownerId: currentSession.user.id,
        activeOwnerId: ownerSnapshot.ownerId,
        operationInProgress: false,
        academicProfile: profileResult.value,
        calendarEvents: reconciledCalendarEvents,
        trustedAnnouncements: reconciledAnnouncementItems,
        deletionEligibleSourceTypes,
        hasManagedMappingsForCleanup: verification.mappings.some((mapping) => (
          deletionEligibleSourceTypes.includes(mapping.sourceType)
        ))
      }, {
        isConnected: networkResult.value.connected,
        isInternetReachable: networkResult.value.internetReachable
      });
      if (!reconciledPreflight.ready) {
        throw new Error("GOOGLE_CALENDAR_RECONCILIATION_INCOMPLETE");
      }

      let result: GoogleCalendarSyncResult;
      if (mappingsMatchDesiredContent(
        reconciledPreflight.items,
        verification.mappings,
        reconciledPreflight.deletionEligibleSourceTypes
      )) {
        result = {
          created: 0,
          updated: 0,
          deleted: 0,
          skipped: reconciledPreflight.items.length,
          failed: 0,
          total: reconciledPreflight.items.length,
          verified: reconciledPreflight.items.length,
          partial: false,
          failures: [],
          mappings: verification.mappings
        };
      } else {
        result = await googleCalendarService.sync({
          accessToken: authorization.accessToken,
          ownerId: currentSession.user.id,
          calendarEvents: reconciledCalendarEvents,
          announcements: reconciledAnnouncementItems,
          deletionEligibleSourceTypes: reconciledPreflight.deletionEligibleSourceTypes,
          signal: syncController.signal
        });
      }
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      const lifecycleState: GoogleCalendarLifecycleState = result.partial || warnings.length > 0
        ? "partial"
        : "connected";
      const connection: GoogleCalendarConnectionRecordV3 = {
        schemaVersion: GOOGLE_CALENDAR_CONNECTION_SCHEMA_VERSION,
        ownerId: currentSession.user.id,
        googleAccountId: authorization.googleAccountId,
        accountEmail: authorization.accountEmail,
        state: lifecycleState,
        authorizationVerifiedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
        mappings: result.mappings
      };
      await enqueueStorageMutation(async () => {
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
        await persistGoogleCalendarConnection(connection);
      });
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();
      setGoogleCalendarIntegration(connection);
      setGoogleCalendarState(lifecycleState);
      setGoogleCalendarLastResult(result);
      setGoogleCalendarWarnings(warnings);

      if (result.total === 0) {
        setMessage({
          text: result.deleted > 0
            ? `${result.deleted} kaldırılmış kaynak kaydı Google Takvim'den temizlendi.`
            : "Google Takvim'de kaldırılması gereken uygulama kaydı bulunmadı.",
          tone: "success"
        });
      } else if (result.verified === 0) {
        setGoogleCalendarError("Aktarılabilir içerik bulundu ancak Google Takvim'de doğrulanamadı.");
      } else {
        setMessage({
          text: `${result.verified} kayıt ${authorization.accountEmail} hesabının Google Takvimi'nde doğrulandı.`,
          tone: "success"
        });
      }
    } catch (error) {
      const authorizationErrorPresentation = resolveGoogleCalendarAuthorizationErrorPresentation(
        error,
        statusCodes.SIGN_IN_CANCELLED,
      );
      if (
        error instanceof StaleAccountRequestError
        || (error instanceof Error && error.name === "AbortError")
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) {
        return;
      } else if (authorizationErrorPresentation.kind === "cancelled") {
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError(authorizationErrorPresentation.persistentError);
      } else if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError("Google Play Hizmetleri bu cihazda hazır değil veya güncellenmeli.");
      } else if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) {
        setGoogleCalendarState(authorizationInterruptionState);
        setGoogleCalendarError("Google hesabı seçimi zaten devam ediyor.");
      } else if (error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH") {
        setGoogleCalendarState("expired");
        setGoogleCalendarError("Google hesabı değişmiş. Devam etmek için hesabını yeniden seç.");
      } else {
        if (
          googleAccessToken
          && error instanceof GoogleCalendarSyncError
          && error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
        ) {
          await enqueueGoogleSdkOperation(() => GoogleSignin.clearCachedAccessToken(googleAccessToken as string)).catch(() => null);
        }
        setGoogleCalendarState(
          error instanceof GoogleCalendarSyncError && error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
            ? "expired"
            : "error"
        );
        setGoogleCalendarError(googleCalendarUserMessage(error));
      }
    } finally {
      googleLifecycleGuardRef.current.settle(operationSnapshot, true);
      authenticatedRequestControllersRef.current.delete(syncController);
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setGoogleCalendarBusy(false);
    }
  }

  async function disconnectGoogleCalendar(options: {
    removeManagedEvents: boolean;
    revokeAccess: boolean;
  }): Promise<boolean> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || accountCleanupInProgressRef.current) return false;
    const operationSnapshot = googleLifecycleGuardRef.current.begin(currentSession.user.id);
    if (!operationSnapshot) {
      setGoogleCalendarError("Google Takvim işlemi zaten devam ediyor.");
      return false;
    }
    const operationController = new AbortController();
    authenticatedRequestControllersRef.current.add(operationController);
    const assertCurrentOperation = () => {
      if (
        !accountGuardRef.current.isCurrent(ownerSnapshot)
        || !googleLifecycleGuardRef.current.isCurrent(operationSnapshot)
      ) throw new StaleAccountRequestError();
    };
    setGoogleCalendarBusy(true);
    setGoogleCalendarError(null);
    const lifecyclePolicy = planGoogleCalendarLifecycle(
      options.removeManagedEvents
        ? "disconnect_and_remove"
        : options.revokeAccess
          ? "revoke_access"
          : "disconnect_only"
    );
    try {
      let authorization: Awaited<ReturnType<typeof authorizeGoogleCalendar>> | null = null;
      const disconnectedRecord = googleCalendarIntegration && !options.removeManagedEvents
        ? { ...googleCalendarIntegration, state: "disconnected" as const }
        : null;
      const execution = await executeGoogleCalendarLifecycle(lifecyclePolicy, {
        isOwnerCurrent: () => (
          accountGuardRef.current.isCurrent(ownerSnapshot)
          && googleLifecycleGuardRef.current.isCurrent(operationSnapshot)
        ),
        runStep: async (step) => {
          if (step === "request_authorization_for_removal") {
            authorization = await authorizeGoogleCalendar(false);
            if (
              googleCalendarIntegration
              && authorization.googleAccountId !== googleCalendarIntegration.googleAccountId
            ) throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
            return;
          }
          if (step === "read_current_authorization") {
            authorization = await readCurrentGoogleCalendarAuthorization();
            if (
              googleCalendarIntegration
              && authorization.googleAccountId !== googleCalendarIntegration.googleAccountId
            ) throw new Error("GOOGLE_CALENDAR_ACCOUNT_MISMATCH");
            return;
          }
          if (step === "remove_managed_events") {
            if (!authorization) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
            const removal = await googleCalendarService.removeManagedEvents({
              accessToken: authorization.accessToken,
              ownerId: currentSession.user.id,
              signal: operationController.signal
            });
            assertCurrentOperation();
            if (removal.partial || removal.remaining > 0) {
              const partialRecord = googleCalendarIntegration
                ? { ...googleCalendarIntegration, state: "partial" as const, mappings: removal.mappings }
                : null;
              if (partialRecord) {
                await enqueueStorageMutation(async () => {
                  assertCurrentOperation();
                  await persistGoogleCalendarConnection(partialRecord);
                  assertCurrentOperation();
                });
              }
              assertCurrentOperation();
              if (partialRecord) setGoogleCalendarIntegration(partialRecord);
              setGoogleCalendarState("partial");
              setGoogleCalendarError("Uygulamanın eklediği bazı Google Takvim kayıtları kaldırılamadı. Bağlantı korunuyor; tekrar deneyebilirsin.");
              throw new Error("GOOGLE_CALENDAR_REMOVE_PARTIAL");
            }
            return;
          }
          if (step === "revoke_access") {
            if (!googleCalendarIntegration) throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
            await runAbortableGoogleCleanup((signal) => (
              revokeGoogleCalendarAccessForConnection(googleCalendarIntegration, signal)
            ));
            return;
          }
          if (step === "sign_out") {
            await runAbortableGoogleCleanup((signal) => queueGoogleSignOut(signal));
            return;
          }
          if (step === "persist_disconnected_metadata") {
            await enqueueStorageMutation(async () => {
              assertCurrentOperation();
              await persistGoogleCalendarConnection(disconnectedRecord, currentSession.user.id);
              assertCurrentOperation();
            });
            return;
          }
          if (step === "clear_connection_metadata") {
            await enqueueStorageMutation(async () => {
              assertCurrentOperation();
              await persistGoogleCalendarConnection(null, currentSession.user.id);
              assertCurrentOperation();
            });
            return;
          }
          throw new Error("GOOGLE_CALENDAR_UNEXPECTED_LIFECYCLE_STEP");
        }
      });
      if (!execution.complete) {
        if (execution.reason === "owner_changed") throw new StaleAccountRequestError();
        throw execution.error;
      }
      assertCurrentOperation();
      setGoogleCalendarIntegration(disconnectedRecord);
      setGoogleCalendarLastResult(null);
      setGoogleCalendarWarnings([]);
      setGoogleCalendarState("disconnected");
      setMessage({
        text: options.removeManagedEvents
          ? "Uygulamanın Google Takvim'e eklediği kayıtlar kaldırıldı ve bağlantı kesildi."
          : options.revokeAccess
            ? "Google Takvim erişimi geri alındı; daha önce eklenmiş kayıtlar korundu."
            : "Google Takvim bağlantısı kesildi; daha önce eklenmiş kayıtlar korundu.",
        tone: "info"
      });
      return true;
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || (error instanceof Error && error.name === "AbortError")
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return false;
      if (error instanceof Error && error.message === "GOOGLE_CALENDAR_REMOVE_PARTIAL") return false;
      setGoogleCalendarState(error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH" ? "expired" : "error");
      setGoogleCalendarError(
        error instanceof Error && error.message === "GOOGLE_CALENDAR_ACCOUNT_MISMATCH"
          ? "Açık Google hesabı bu bağlantıyla eşleşmiyor. Kayıtlara dokunulmadı."
          : googleCalendarUserMessage(error)
      );
      return false;
    } finally {
      googleLifecycleGuardRef.current.settle(operationSnapshot, true);
      authenticatedRequestControllersRef.current.delete(operationController);
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setGoogleCalendarBusy(false);
    }
  }

  function promptGoogleCalendarAccountSwitch(): void {
    const continueSwitch = async (choice: "leave_managed_events" | "remove_managed_events") => {
      const plan = planGoogleCalendarAccountSwitch(choice);
      if (!plan.proceed) return;
      if (await disconnectGoogleCalendar({
        removeManagedEvents: plan.removeManagedEvents,
        revokeAccess: false
      })) {
        await syncGoogleCalendar(true);
      }
    };
    Alert.alert(
      "Google hesabını değiştir",
      "Eski hesaptaki uygulama kayıtları kalsın mı, yoksa hesap seçiciyi açmadan önce kaldırılsın mı? Kalan kayıtlar artık bu bağlantı tarafından otomatik temizlenmez; o hesabı yeniden bağlayarak yönetebilirsin. Kişisel etkinliklere dokunulmaz.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Kayıtlar Kalsın",
          onPress: () => void continueSwitch("leave_managed_events")
        },
        {
          text: "Kayıtları Kaldır",
          style: "destructive",
          onPress: () => void continueSwitch("remove_managed_events")
        }
      ]
    );
  }

  return {
    syncGoogleCalendar,
    disconnectGoogleCalendar,
    promptGoogleCalendarAccountSwitch
  };
}
