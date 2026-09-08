import { Platform } from "react-native";
import { runtimeDiagnostic } from "../../performance/runtime-diagnostics";
import {
  NotificationLifecycleCoordinator,
  type NotificationBackendAdapter,
  ExpoNotificationPermissionAdapter,
  FirebaseNotificationTokenAdapter,
  subscribeToForegroundRemoteNotifications,
  configureForegroundNotificationPresentation,
  configureAndroidNotificationChannels,
  notificationReminderRulesForMutation,
} from "../../notifications";
import { type AccountGenerationSnapshot } from "../../auth/session-integrity";
import { StaleAccountRequestError, userMessageFromError } from "../app-errors";
import { type NotificationPreferencePayload, type SessionPayload, type AlarmMode } from "../app-types";
import { DEFAULT_REMINDER_OFFSETS, DEFAULT_REMINDER_RULES } from "../app-config";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "setNotificationLifecycle" | "notificationCoordinatorRef" | "notificationCoordinatorOwnerTokenRef"
  | "accountGuardRef" | "notificationUnsubscribeRef" | "notificationRotationUnsubscribeRef"
  | "notificationForegroundUnsubscribeRef" | "sessionRef" | "setAlarmEnabled" | "setCleanupIssue"
  | "setMessage" | "setPreferences" | "notificationReconcilePromiseRef"
  | "notificationFailClosedPromiseRef" | "categoryDraftRef" | "setCategoryDraft"
  | "setNotificationPreferenceOutcome" | "setNotificationPreferenceError" | "alarmModeRef"
  | "setAlarmMode" | "alarmEnabledRef" | "accountCleanupInProgressRef" | "preferences" | "setBusy"
> & Pick<ApplicationActions,
  "apiRequest" | "withLoadable" | "trackAuthenticatedMutation"
> & Pick<PersonalCalendarRuntime,
  "personalCalendarReminderCoordinator"
> & Pick<ApplicationDerivedState,
  "accessToken" | "availableCategories" | "initialNotificationPreference"
>;

export function createNotificationActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "ensureNotificationCoordinator" | "detachNotificationOwnerForCleanup" | "loadPreferences"
  | "writeNotificationPreferences" | "reconcileNotificationDelivery"
  | "disableNotificationDeliveryFailClosed" | "updateCategory" | "updateAlarmMode"
  | "updateAlarmEnabled" | "discardNotificationPreferenceChanges" | "saveAlarmSettings"
  | "retryNotificationSettings"
> {
  const {
    setNotificationLifecycle,
    notificationCoordinatorRef,
    notificationCoordinatorOwnerTokenRef,
    accountGuardRef,
    apiRequest,
    notificationUnsubscribeRef,
    notificationRotationUnsubscribeRef,
    notificationForegroundUnsubscribeRef,
    sessionRef,
    setAlarmEnabled,
    setCleanupIssue,
    setMessage,
    personalCalendarReminderCoordinator,
    accessToken,
    withLoadable,
    setPreferences,
    notificationReconcilePromiseRef,
    notificationFailClosedPromiseRef,
    categoryDraftRef,
    setCategoryDraft,
    setNotificationPreferenceOutcome,
    setNotificationPreferenceError,
    alarmModeRef,
    setAlarmMode,
    availableCategories,
    alarmEnabledRef,
    initialNotificationPreference,
    accountCleanupInProgressRef,
    preferences,
    setBusy,
    trackAuthenticatedMutation
  } = dependencies;

  function ensureNotificationCoordinator(installationId: string): NotificationLifecycleCoordinator | null {
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
      setNotificationLifecycle((previous) => ({
        ...previous,
        permission: "unavailable",
        registration: "unregistered",
        active: false
      }));
      return null;
    }
    if (notificationCoordinatorRef.current) return notificationCoordinatorRef.current;

    const backendAdapter: NotificationBackendAdapter = {
      registerDevice: async ({ ownerId, installationId: currentInstallationId, platform, token }) => {
        const ownerSession = notificationCoordinatorOwnerTokenRef.current;
        const ownerSnapshot = accountGuardRef.current.capture();
        if (
          !ownerSession
          || ownerSession.user.id !== ownerId
          || !ownerSnapshot
          || ownerSnapshot.ownerId !== ownerId
        ) throw new StaleAccountRequestError();
        await apiRequest<{ status: "registered" }>(
          "/devices/register",
          {
            method: "POST",
            body: JSON.stringify({ platform, token, deviceId: currentInstallationId })
          },
          ownerSession.accessToken,
          { ownerSnapshot }
        );
      },
      detachDevice: async ({ ownerId, installationId: currentInstallationId }) => {
        const ownerSession = notificationCoordinatorOwnerTokenRef.current;
        if (!ownerSession || ownerSession.user.id !== ownerId) throw new StaleAccountRequestError();
        await apiRequest<{ status: "unregistered" }>(
          "/devices/current",
          {
            method: "DELETE",
            body: JSON.stringify({ deviceId: currentInstallationId })
          },
          ownerSession.accessToken,
          { skipAuthRefresh: true, detached: true }
        );
      }
    };

    try {
      const coordinator = new NotificationLifecycleCoordinator({
        installationId,
        platform: Platform.OS,
        permissionAdapter: new ExpoNotificationPermissionAdapter(),
        tokenAdapter: new FirebaseNotificationTokenAdapter(),
        backendAdapter
      });
      notificationCoordinatorRef.current = coordinator;
      notificationUnsubscribeRef.current = coordinator.subscribe((state) => {
        setNotificationLifecycle(state);
        const rotationEligible = state.preferenceEnabled && state.permission === "granted";
        if (rotationEligible && !notificationRotationUnsubscribeRef.current) {
          notificationRotationUnsubscribeRef.current = coordinator.startTokenRotationListener();
        } else if (!rotationEligible && notificationRotationUnsubscribeRef.current) {
          notificationRotationUnsubscribeRef.current();
          notificationRotationUnsubscribeRef.current = null;
        }
        const foregroundEligible = state.active;
        if (foregroundEligible && !notificationForegroundUnsubscribeRef.current) {
          notificationForegroundUnsubscribeRef.current = subscribeToForegroundRemoteNotifications();
        } else if (!foregroundEligible && notificationForegroundUnsubscribeRef.current) {
          notificationForegroundUnsubscribeRef.current();
          notificationForegroundUnsubscribeRef.current = null;
        }
        if (state.preferenceEnabled && state.registration === "error") {
          const currentSession = sessionRef.current;
          if (currentSession?.user.id === state.ownerId) {
            void disableNotificationDeliveryFailClosed(currentSession, coordinator).catch(() => {
              setAlarmEnabled(false);
              setCleanupIssue({
                action: "notification_settings",
                failedTargets: ["device_registration"],
                ownerId: currentSession.user.id
              });
              setMessage({
                text: "Cihaz kaydı doğrulanamadığı için bildirim teslimatı güvenli biçimde kapatılamadı. Lütfen tekrar dene.",
                tone: "error"
              });
            });
          }
        }
      });
      configureForegroundNotificationPresentation();
      void configureAndroidNotificationChannels().catch(() => undefined);
      return coordinator;
    } catch {
      setNotificationLifecycle({
        schemaVersion: 1,
        ownerId: null,
        preferenceEnabled: false,
        permission: "unavailable",
        registration: "error",
        active: false,
        errorCode: "token_unavailable"
      });
      return null;
    }
  }

  async function detachNotificationOwnerForCleanup(): Promise<void> {
    const ownerId = sessionRef.current?.user.id;
    const coordinator = notificationCoordinatorRef.current;
    if (coordinator?.getState().ownerId) {
      const detached = await coordinator.detachCurrentOwner();
      if (detached.registration === "error") throw new Error("DEVICE_DETACH_FAILED");
      await coordinator.clearOwner();
    }
    if (ownerId) await personalCalendarReminderCoordinator.cancelOwner(ownerId);
  }

  async function loadPreferences(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture()
  ): Promise<NotificationPreferencePayload | null> {
    const token = tokenOverride ?? accessToken;
    if (!token) return null;

    return withLoadable(
      setPreferences,
      () => apiRequest<NotificationPreferencePayload>("/notification-preferences", {}, token, { ownerSnapshot }),
      ownerSnapshot
    );
  }

  async function writeNotificationPreferences(
    currentSession: SessionPayload,
    existing: NotificationPreferencePayload,
    enabled: boolean,
    ownerSnapshot: AccountGenerationSnapshot
  ): Promise<NotificationPreferencePayload> {
    return apiRequest<NotificationPreferencePayload>(
      "/notification-preferences",
      {
        method: "PATCH",
        body: JSON.stringify({
          enabled,
          ...(enabled ? { deliveryConsentVersion: "phase3-v1" } : {}),
          categories: existing.categories,
          reminderOffsets: existing.reminderOffsets.length ? existing.reminderOffsets : DEFAULT_REMINDER_OFFSETS,
          reminderRules: notificationReminderRulesForMutation(existing.reminderRules, DEFAULT_REMINDER_RULES),
          quietHours: existing.quietHours ?? {
            enabled: true,
            start: "22:00",
            end: "07:00",
            timezone: "Europe/Istanbul"
          }
        })
      },
      currentSession.accessToken,
      { ownerSnapshot }
    );
  }

  async function reconcileNotificationDelivery(
    currentSession: SessionPayload,
    coordinator: NotificationLifecycleCoordinator,
    knownPreferences?: NotificationPreferencePayload,
    knownSnapshot?: AccountGenerationSnapshot
  ): Promise<void> {
    const inFlight = notificationReconcilePromiseRef.current;
    if (inFlight?.ownerId === currentSession.user.id) {
      runtimeDiagnostic("notification.reconcile_joined");
      return inFlight.operation;
    }

    const diagnosticStartedAt = Date.now();
    runtimeDiagnostic("notification.reconcile_start", {
      preferenceKnown: Boolean(knownPreferences),
    });
    const operation = (async () => {
      const ownerSnapshot = knownSnapshot ?? accountGuardRef.current.capture();
      if (!ownerSnapshot || ownerSnapshot.ownerId !== currentSession.user.id) return;
      let currentPreferences = knownPreferences;
      if (!currentPreferences) {
        currentPreferences = await apiRequest<NotificationPreferencePayload>(
          "/notification-preferences",
          {},
          currentSession.accessToken,
          { ownerSnapshot }
        );
        setPreferences({ loading: false, data: currentPreferences, attempted: true, stale: false });
      }
      const coordinatorState = coordinator.getState();
      if (
        coordinatorState.ownerId !== currentSession.user.id
        || coordinatorState.preferenceEnabled !== currentPreferences.enabled
      ) {
        await coordinator.activateOwner(currentSession.user.id, currentPreferences.enabled);
      }
      const deliveryState = await coordinator.registerIfAlreadyGranted();
      if (currentPreferences.enabled && !deliveryState.active) {
        await disableNotificationDeliveryFailClosed(
          currentSession,
          coordinator,
          currentPreferences,
          ownerSnapshot
        );
      }
    })();
    notificationReconcilePromiseRef.current = {
      ownerId: currentSession.user.id,
      operation,
    };
    try {
      await operation;
      runtimeDiagnostic("notification.reconcile_success", {
        elapsedMs: Date.now() - diagnosticStartedAt,
      });
    } catch (error) {
      runtimeDiagnostic("notification.reconcile_failure", {
        elapsedMs: Date.now() - diagnosticStartedAt,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    } finally {
      if (notificationReconcilePromiseRef.current?.operation === operation) {
        notificationReconcilePromiseRef.current = null;
      }
    }
  }

  function disableNotificationDeliveryFailClosed(
    currentSession: SessionPayload,
    coordinator: NotificationLifecycleCoordinator,
    knownPreferences?: NotificationPreferencePayload,
    knownSnapshot?: AccountGenerationSnapshot
  ): Promise<void> {
    if (notificationFailClosedPromiseRef.current) return notificationFailClosedPromiseRef.current;
    const operation = (async () => {
      const ownerSnapshot = knownSnapshot ?? accountGuardRef.current.capture();
      if (
        !ownerSnapshot
        || ownerSnapshot.ownerId !== currentSession.user.id
        || coordinator.getState().ownerId !== currentSession.user.id
      ) return;
      const detachedState = await coordinator.setPreferenceEnabled(false);
      const currentPreferences = knownPreferences ?? await apiRequest<NotificationPreferencePayload>(
        "/notification-preferences",
        {},
        currentSession.accessToken,
        { ownerSnapshot }
      );
      const updated = await writeNotificationPreferences(
        currentSession,
        currentPreferences,
        false,
        ownerSnapshot
      );
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      setPreferences({ loading: false, data: updated, attempted: true, stale: false });
      setAlarmEnabled(false);
      if (detachedState.registration === "error") {
        setCleanupIssue({
          action: "notification_settings",
          failedTargets: ["device_registration"],
          ownerId: currentSession.user.id
        });
      }
    })();
    notificationFailClosedPromiseRef.current = operation;
    void operation.finally(() => {
      if (notificationFailClosedPromiseRef.current === operation) {
        notificationFailClosedPromiseRef.current = null;
      }
    }).catch(() => undefined);
    return operation;
  }

  function updateCategory(category: string, enabled: boolean): void {
    const next = { ...categoryDraftRef.current, [category]: enabled };
    categoryDraftRef.current = next;
    setCategoryDraft(next);
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
  }

  function updateAlarmMode(mode: AlarmMode): void {
    alarmModeRef.current = mode;
    setAlarmMode(mode);
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
    if (mode === "all_calendar") {
      const everythingOn: Record<string, boolean> = {};
      for (const category of availableCategories) everythingOn[category] = true;
      categoryDraftRef.current = everythingOn;
      setCategoryDraft(everythingOn);
    }
  }

  function updateAlarmEnabled(enabled: boolean): void {
    alarmEnabledRef.current = enabled;
    setAlarmEnabled(enabled);
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
  }

  function discardNotificationPreferenceChanges(): void {
    alarmEnabledRef.current = initialNotificationPreference.enabled;
    alarmModeRef.current = initialNotificationPreference.mode;
    categoryDraftRef.current = { ...initialNotificationPreference.categories };
    setAlarmEnabled(initialNotificationPreference.enabled);
    setAlarmMode(initialNotificationPreference.mode);
    setCategoryDraft({ ...initialNotificationPreference.categories });
    setNotificationPreferenceOutcome("saved");
    setNotificationPreferenceError(undefined);
    setMessage(null);
  }

  async function saveAlarmSettings(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession?.accessToken || !ownerSnapshot) {
      setMessage({ text: "Alarm ayarları için giriş yapmalısın.", tone: "error" });
      return;
    }
    if (accountCleanupInProgressRef.current) return;

    const desiredEnabled = alarmEnabledRef.current;
    const desiredMode = alarmModeRef.current;
    const desiredCategories = { ...categoryDraftRef.current };
    const categoryPayload: Record<string, boolean> = {};
    for (const category of availableCategories) {
      categoryPayload[category] = desiredMode === "all_calendar" ? true : Boolean(desiredCategories[category]);
    }

    const existing = preferences.data;
    const reminderOffsets = existing?.reminderOffsets.length ? existing.reminderOffsets : DEFAULT_REMINDER_OFFSETS;
    const reminderRules = notificationReminderRulesForMutation(existing?.reminderRules, DEFAULT_REMINDER_RULES);

    try {
      setBusy(true);
      setNotificationPreferenceOutcome("saving");
      setNotificationPreferenceError(undefined);
      const coordinator = notificationCoordinatorRef.current;
      if (desiredEnabled) {
        if (!coordinator) {
          setAlarmEnabled(false);
          setNotificationPreferenceOutcome("error");
          setNotificationPreferenceError("Push bildirimleri bu platformda kullanılamıyor; teslimat açılmadı.");
          setMessage({ text: "Push bildirimleri bu platformda kullanılamıyor; teslimat açılmadı.", tone: "error" });
          return;
        }
        if (coordinator.getState().ownerId !== currentSession.user.id) {
          await coordinator.activateOwner(currentSession.user.id, false);
        }
        const enabledState = await coordinator.enableAfterUserIntent({
          ownerId: currentSession.user.id,
          intent: "enable_notifications"
        });
        if (!enabledState.active) {
          await disableNotificationDeliveryFailClosed(
            currentSession,
            coordinator,
            existing,
            ownerSnapshot
          );
          setAlarmEnabled(false);
          setNotificationPreferenceOutcome("error");
          setNotificationPreferenceError("Bildirim izni veya cihaz kaydı geçerli olmadığı için teslimat açılmadı.");
          setMessage({
            text: enabledState.permission === "permanently_denied"
              ? "Bildirim izni cihaz ayarlarından kapalı. Teslimat açılmadı."
              : enabledState.permission === "denied"
                ? "Bildirim izni verilmedi. Teslimat açılmadı."
                : "Bu cihaz teslimat için kaydedilemedi. Bildirimler açılmadı.",
            tone: "error"
          });
          return;
        }
      }
      const updated = await trackAuthenticatedMutation(() => apiRequest<NotificationPreferencePayload>(
        "/notification-preferences",
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: desiredEnabled && Boolean(coordinator?.getState().active),
            ...(desiredEnabled && coordinator?.getState().active
              ? { deliveryConsentVersion: "phase3-v1" }
              : {}),
            categories: categoryPayload,
            reminderOffsets,
            reminderRules,
            quietHours: existing?.quietHours ?? {
              enabled: true,
              start: "22:00",
              end: "07:00",
              timezone: "Europe/Istanbul"
            }
          })
        },
        currentSession.accessToken,
        { ownerSnapshot }
      ));

      if (!desiredEnabled && coordinator) {
        const detachedState = await coordinator.setPreferenceEnabled(false);
        if (detachedState.registration === "error") {
          setCleanupIssue({
            action: "notification_settings",
            failedTargets: ["device_registration"],
            ownerId: currentSession.user.id
          });
          setPreferences({ loading: false, data: updated, attempted: true, stale: false });
          setNotificationPreferenceOutcome("error");
          setNotificationPreferenceError("Tercih kapatıldı; cihaz kaydının kaldırıldığı doğrulanamadı.");
          setMessage({
            text: "Bildirim tercihi kapatıldı; cihaz kaydının sunucudan kaldırıldığı doğrulanamadı.",
            tone: "error"
          });
          return;
        }
      }
      setPreferences({ loading: false, data: updated, attempted: true, stale: false });
      setNotificationPreferenceOutcome("saved");
      setNotificationPreferenceError(undefined);
      setMessage({
        text: updated.enabled
          ? "Bildirim izni, cihaz kaydı ve alarm tercihleri doğrulandı."
          : "Bildirim teslimatı kapatıldı; cihaz kaydı kaldırıldı.",
        tone: "success"
      });
    } catch (error) {
      if (desiredEnabled) await notificationCoordinatorRef.current?.setPreferenceEnabled(false).catch(() => undefined);
      if (error instanceof StaleAccountRequestError) return;
      const controlledNotificationError = userMessageFromError(error, "Alarm ayarları kaydedilemedi");
      setNotificationPreferenceOutcome("error");
      setNotificationPreferenceError(controlledNotificationError);
      setMessage({
        text: userMessageFromError(error, "Alarm ayarları kaydedilemedi"),
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  }

  async function retryNotificationSettings(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) return;
    setNotificationPreferenceOutcome("idle");
    setNotificationPreferenceError(undefined);
    const loaded = await loadPreferences(currentSession.accessToken, ownerSnapshot);
    const coordinator = notificationCoordinatorRef.current;
    if (!loaded || !coordinator || !accountGuardRef.current.isCurrent(ownerSnapshot)) return;
    try {
      await reconcileNotificationDelivery(currentSession, coordinator, loaded, ownerSnapshot);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      const controlledError = userMessageFromError(error, "Bildirim durumu doğrulanamadı");
      setNotificationPreferenceOutcome("error");
      setNotificationPreferenceError(controlledError);
    }
  }

  return {
    ensureNotificationCoordinator,
    detachNotificationOwnerForCleanup,
    loadPreferences,
    writeNotificationPreferences,
    reconcileNotificationDelivery,
    disableNotificationDeliveryFailClosed,
    updateCategory,
    updateAlarmMode,
    updateAlarmEnabled,
    discardNotificationPreferenceChanges,
    saveAlarmSettings,
    retryNotificationSettings
  };
}
