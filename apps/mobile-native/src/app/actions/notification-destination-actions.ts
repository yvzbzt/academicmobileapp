import { createVerifiedNotificationIntent } from "../../navigation";
import {
  createPendingNotificationDestinationRecord,
  serializePendingNotificationDestinationRecord,
  parsePendingNotificationDestinationRecord,
  isSamePendingNotificationDestinationRecord,
  resolveNotificationDestination,
  type ParsedNotificationDestination,
} from "../../notifications";
import { type AccountGenerationSnapshot } from "../../auth/session-integrity";
import { normalizeTrustedApiContentCollection } from "../../content/content-trust";
import { readDeviceContentCache } from "../../content/device-content-cache";
import { findDeviceContentNotificationRecord } from "../../content/device-content-notification-ledger";
import { isDeviceContentRecordId } from "../../content/device-saved-content";
import { buildCalendarItems } from "../../calendar/calendar-model";
import {
  deleteStoredValue,
  PENDING_NOTIFICATION_STORAGE_KEY,
  setStoredValue,
  getStoredValue,
} from "../app-storage";
import {
  type SessionPayload,
  type AnnouncementRecord,
  type EventRecord,
  type AnnouncementApiRecord,
} from "../app-types";
import { ApiRequestError } from "../app-errors";
import {
  normalizeEventRecordsForDisplay,
  appendTrustedContentItems,
  contentFeedDetailItem,
} from "../app-content";
import { navigationTargetForProtectedRoute } from "../app-routes";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationState } from "../useApplicationState";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationActions,
  "enqueueStorageMutation" | "apiRequest"
> & Pick<ApplicationState,
  "accountGuardRef" | "setAnnouncements" | "sessionRef" | "setNotificationDestinationNotice"
  | "routeIntentCoordinatorRef" | "notificationNavigationRequestRef"
  | "announcementDetailRequestGenerationRef" | "setActiveTrustedDetail"
  | "setAnnouncementDetailLoad" | "courseSchedule" | "calendar" | "setActiveCalendarDetail"
  | "requestAppRoute" | "setActiveTab" | "setMessage"
> & Pick<PersonalCalendarRuntime,
  "personalExamRuntime"
> & Pick<ApplicationDerivedState,
  "selectedUniversity"
>;

export function createNotificationDestinationActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "persistPendingNotificationDestination" | "readPendingNotificationDestination"
  | "pendingNotificationDestinationIsCurrent" | "clearPendingNotificationDestinationIfCurrent"
  | "resolvePendingNotificationForSession" | "receiveNotificationDestination"
  | "restorePendingNotificationForSession" | "retryPendingNotificationDestination"
> {
  const {
    enqueueStorageMutation,
    accountGuardRef,
    personalExamRuntime,
    apiRequest,
    setAnnouncements,
    sessionRef,
    setNotificationDestinationNotice,
    routeIntentCoordinatorRef,
    notificationNavigationRequestRef,
    announcementDetailRequestGenerationRef,
    setActiveTrustedDetail,
    setAnnouncementDetailLoad,
    courseSchedule,
    calendar,
    selectedUniversity,
    setActiveCalendarDetail,
    requestAppRoute,
    setActiveTab,
    setMessage
  } = dependencies;

  async function persistPendingNotificationDestination(
    record: ReturnType<typeof createPendingNotificationDestinationRecord> | null
  ): Promise<void> {
    await enqueueStorageMutation(async () => {
      if (!record) {
        await deleteStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
        return;
      }
      await setStoredValue(
        PENDING_NOTIFICATION_STORAGE_KEY,
        serializePendingNotificationDestinationRecord(record)
      );
    });
  }

  async function readPendingNotificationDestination(): Promise<ReturnType<typeof createPendingNotificationDestinationRecord> | null> {
    return enqueueStorageMutation(async () => {
      const stored = await getStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
      const record = parsePendingNotificationDestinationRecord(stored);
      if (stored && !record) await deleteStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
      return record;
    });
  }

  async function pendingNotificationDestinationIsCurrent(
    expected: ReturnType<typeof createPendingNotificationDestinationRecord>
  ): Promise<boolean> {
    return enqueueStorageMutation(async () => {
      const current = parsePendingNotificationDestinationRecord(
        await getStoredValue(PENDING_NOTIFICATION_STORAGE_KEY)
      );
      return isSamePendingNotificationDestinationRecord(current, expected);
    });
  }

  async function clearPendingNotificationDestinationIfCurrent(
    expected: ReturnType<typeof createPendingNotificationDestinationRecord>
  ): Promise<boolean> {
    return enqueueStorageMutation(async () => {
      const current = parsePendingNotificationDestinationRecord(
        await getStoredValue(PENDING_NOTIFICATION_STORAGE_KEY)
      );
      if (!isSamePendingNotificationDestinationRecord(current, expected)) return false;
      await deleteStoredValue(PENDING_NOTIFICATION_STORAGE_KEY);
      return true;
    });
  }

  async function resolvePendingNotificationForSession(
    record: ReturnType<typeof createPendingNotificationDestinationRecord>,
    currentSession: SessionPayload,
    ownerSnapshot: AccountGenerationSnapshot
  ): Promise<void> {
    let destinationTitle: string | undefined;
    let destinationAnnouncement: AnnouncementRecord | undefined;
    let destinationCalendarEvent: EventRecord | undefined;
    let destinationPersonalCalendarItem: Parameters<typeof buildCalendarItems>[0]["personalExams"][number] | undefined;
    const resolution = await resolveNotificationDestination({
      record,
      currentOwner: { ownerId: ownerSnapshot.ownerId, generation: ownerSnapshot.generation },
      getCurrentOwner: () => {
        const current = accountGuardRef.current.capture();
        return current ? { ownerId: current.ownerId, generation: current.generation } : null;
      },
      isAvailable: async (destination) => {
        if (destination.type === "calendar_event") {
          if (destination.id.startsWith("personal:")) {
            const personalId = destination.id.slice("personal:".length);
            const personalState = personalExamRuntime.getSnapshot();
            const match = personalState.ownerId === ownerSnapshot.ownerId && personalState.hydrated
              ? personalState.exams.find((item) => item.id === personalId)
              : undefined;
            if (match) {
              destinationTitle = match.title;
              destinationPersonalCalendarItem = match;
            }
            return Boolean(match);
          }
          let payload: EventRecord;
          try {
            payload = await apiRequest<EventRecord>(
              `/calendar/my/trusted/${encodeURIComponent(destination.id)}`,
              {},
              currentSession.accessToken,
              { ownerSnapshot }
            );
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) return false;
            throw error;
          }
          const match = normalizeEventRecordsForDisplay([payload])
            .find((event) => event.id === destination.id);
          if (match) {
            destinationTitle = match.title;
            destinationCalendarEvent = match;
          }
          return Boolean(match);
        }

        if (isDeviceContentRecordId(destination.id)) {
          const cached = await readDeviceContentCache(ownerSnapshot.ownerId);
          const match = cached?.items.find((item) => item.id === destination.id)
            ?? await findDeviceContentNotificationRecord(ownerSnapshot.ownerId, destination.id);
          if (match) {
            destinationTitle = match.title;
            destinationAnnouncement = match;
            setAnnouncements((previous) => ({
              loading: false,
              data: appendTrustedContentItems(previous.data, [match]),
              attempted: true,
              stale: false
            }));
          }
          return Boolean(match);
        }

        let payload: AnnouncementApiRecord;
        try {
          payload = await apiRequest<AnnouncementApiRecord>(
            `/announcements/my/trusted/${encodeURIComponent(destination.id)}`,
            {},
            currentSession.accessToken,
            { ownerSnapshot }
          );
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 404) return false;
          throw error;
        }
        const normalized = normalizeTrustedApiContentCollection([payload]);
        const match = normalized.items.find((item) => item.id === destination.id);
        if (match) {
          destinationTitle = match.title;
          destinationAnnouncement = match;
        }
        setAnnouncements((previous) => ({
          loading: false,
          data: appendTrustedContentItems(previous.data, normalized.items),
          attempted: true,
          stale: false
        }));
        return Boolean(match);
      }
    });

    if (resolution.status === "ignored") return;
    if (
      !accountGuardRef.current.isCurrent(ownerSnapshot)
      || sessionRef.current?.user.id !== ownerSnapshot.ownerId
    ) return;
    if (resolution.status === "unavailable") {
      if (resolution.reason === "lookup_error") {
        if (!await pendingNotificationDestinationIsCurrent(record)) return;
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
        setNotificationDestinationNotice({
          status: "temporarily_unavailable",
          destination: resolution.destination
        });
        return;
      }
      if (!await clearPendingNotificationDestinationIfCurrent(record).catch(() => false)) return;
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      setNotificationDestinationNotice({ status: "unavailable", destination: resolution.destination });
      return;
    }
    if (resolution.status === "open") {
      if (!await pendingNotificationDestinationIsCurrent(record).catch(() => false)) return;
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      const notificationIntent = createVerifiedNotificationIntent(resolution.destination);
      const enqueueResult = routeIntentCoordinatorRef.current.enqueue(notificationIntent, ownerSnapshot);
      if (enqueueResult !== "enqueued" && enqueueResult !== "promoted") {
        const inFlightRequest = notificationNavigationRequestRef.current;
        if (
          enqueueResult === "deduplicated"
          && inFlightRequest
          && accountGuardRef.current.isCurrent(inFlightRequest.ownerSnapshot)
          && inFlightRequest.record.destination.type === record.destination.type
          && inFlightRequest.record.destination.id === record.destination.id
        ) {
          // The newest duplicate replaced the durable record. Keep it until the
          // already-mounted semantic destination acknowledges its visible leaf.
          notificationNavigationRequestRef.current = { ...inFlightRequest, record };
          return;
        }
        await clearPendingNotificationDestinationIfCurrent(record).catch(() => false);
        return;
      }
      const selectedIntent = routeIntentCoordinatorRef.current.consumeFor(
        ownerSnapshot.ownerId,
        ownerSnapshot.generation
      );
      if (!selectedIntent || selectedIntent.source !== "notification") return;
      const target = navigationTargetForProtectedRoute(selectedIntent.route);
      if (resolution.destination.type === "announcement") {
        announcementDetailRequestGenerationRef.current += 1;
        setActiveTrustedDetail((previous) => previous?.type === "announcement" ? null : previous);
        const detailItem = destinationAnnouncement
          ? contentFeedDetailItem(destinationAnnouncement, "academic")
          : null;
        if (detailItem) {
          setAnnouncementDetailLoad(null);
          setActiveTrustedDetail({
            type: "announcement",
            id: detailItem.record.id,
            title: detailItem.record.title,
            item: detailItem
          });
        } else {
          setAnnouncementDetailLoad({
            id: resolution.destination.id,
            loading: false,
            error: "Güvenilir içerik doğrulanamadı."
          });
        }
      } else if (resolution.destination.type === "calendar_event") {
        announcementDetailRequestGenerationRef.current += 1;
        setAnnouncementDetailLoad(null);
        const detailItem = destinationPersonalCalendarItem
          ? buildCalendarItems({
            academicEvents: [],
            personalExams: [destinationPersonalCalendarItem],
            academicSourceLabel: "Kişisel takvim"
          })[0]
          : destinationCalendarEvent
            ? buildCalendarItems({
              academicEvents: [{
                ...destinationCalendarEvent,
                ...(destinationCalendarEvent.category === "course_schedule"
                  ? { sourceLabel: "Bölüm ders programı" }
                  : isDepartmentExamScheduleEvent(destinationCalendarEvent)
                    ? { sourceLabel: "Bölüm sınav programı" }
                  : {}),
                ...(destinationCalendarEvent.category === "course_schedule" && courseSchedule.data?.sourceUrl
                  ? { sourceUrl: courseSchedule.data.sourceUrl }
                  : isDepartmentExamScheduleEvent(destinationCalendarEvent) && courseSchedule.data?.examSourceUrl
                    ? { sourceUrl: courseSchedule.data.examSourceUrl }
                  : calendar.data?.calendar.sourceUrl
                    ? { sourceUrl: calendar.data.calendar.sourceUrl }
                    : {})
              }],
              personalExams: [],
              academicSourceLabel: calendar.data?.calendar.title
                ?? selectedUniversity?.name
                ?? "Resmî akademik takvim"
            })[0]
            : undefined;
        setActiveCalendarDetail(detailItem ?? null);
      }
      const requestKey = requestAppRoute(
        target.route,
        target.params
      );
      notificationNavigationRequestRef.current = { requestKey, record, ownerSnapshot };
      setNotificationDestinationNotice({
        status: "opened",
        destination: resolution.destination,
        ...(destinationTitle ? { title: destinationTitle } : {})
      });
      setActiveTab(target.legacyTab);
    }
  }

  async function receiveNotificationDestination(parsed: ParsedNotificationDestination | null): Promise<void> {
    if (!parsed) return;
    const record = createPendingNotificationDestinationRecord({
      destination: parsed.destination,
      ownerId: parsed.recipientOwnerId
    });
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) {
      try {
        await persistPendingNotificationDestination(record);
      } catch {
        setMessage({
          text: "Bildirim hedefi bu cihazda saklanamadı. Bildirimi yeniden açmayı deneyebilirsin.",
          tone: "error"
        });
        return;
      }
      const resumedSession = sessionRef.current;
      const resumedSnapshot = accountGuardRef.current.capture();
      if (
        resumedSession?.user.id === record.ownerId
        && resumedSnapshot?.ownerId === record.ownerId
      ) {
        await resolvePendingNotificationForSession(record, resumedSession, resumedSnapshot);
      }
      return;
    }
    if (ownerSnapshot.ownerId !== record.ownerId || currentSession.user.id !== record.ownerId) {
      await clearPendingNotificationDestinationIfCurrent(record).catch(() => false);
      return;
    }
    try {
      await persistPendingNotificationDestination(record);
    } catch {
      setMessage({
        text: "Bildirim hedefi bu cihazda saklanamadı. Bildirimi yeniden açmayı deneyebilirsin.",
        tone: "error"
      });
      return;
    }
    await resolvePendingNotificationForSession(record, currentSession, ownerSnapshot);
  }

  async function restorePendingNotificationForSession(
    currentSession: SessionPayload,
    ownerSnapshot: AccountGenerationSnapshot
  ): Promise<void> {
    const record = await readPendingNotificationDestination();
    if (!record) return;
    if (record.ownerId !== currentSession.user.id) {
      await clearPendingNotificationDestinationIfCurrent(record);
      return;
    }
    await resolvePendingNotificationForSession(record, currentSession, ownerSnapshot);
  }

  async function retryPendingNotificationDestination(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot) return;
    await restorePendingNotificationForSession(currentSession, ownerSnapshot).catch(() => {
      setNotificationDestinationNotice((previous) => previous
        ? { ...previous, status: "temporarily_unavailable" }
        : previous);
    });
  }

  return {
    persistPendingNotificationDestination,
    readPendingNotificationDestination,
    pendingNotificationDestinationIsCurrent,
    clearPendingNotificationDestinationIfCurrent,
    resolvePendingNotificationForSession,
    receiveNotificationDestination,
    restorePendingNotificationForSession,
    retryPendingNotificationDestination
  };
}

function isDepartmentExamScheduleEvent(event: { category: string; departmentId?: string }): boolean {
  return Boolean(event.departmentId) && [
    "department_exam_schedule",
    "midterm_exam",
    "final_exam",
    "makeup_exam",
    "single_course_exam",
  ].includes(event.category);
}
