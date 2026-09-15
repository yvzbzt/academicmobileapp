import {
  canonicalizeOfficialAcademicUrl,
  normalizeTrustedApiContentEnvelope,
  type TrustedContentCollection,
} from "../../content/content-trust";
import { syncDeviceContent } from "../../content/device-content-sync";
import { acknowledgeDeviceContentNotifications } from "../../content/device-content-notification-ledger";
import { hydrateDeviceAcademicPdfEvents } from "../../calendar/device-academic-pdf";
import { notifyNewDeviceContent } from "../../notifications";
import { CONTENT_FEED_MAX_LIMIT, nextContentFeedLimit } from "../../announcements/feed-model";
import {
  type CalendarPayload,
  type DepartmentSchedulePayload,
  type EventRecord,
  type AnnouncementCollectionApiPayload,
  type SummerSchoolApiPayload,
  type Loadable,
} from "../app-types";
import {
  normalizeCalendarPayloadForDisplay,
  normalizeEventRecordsForDisplay,
  normalizeSummerSchoolPayloadForDisplay,
  trustedContentCollectionHasMore,
} from "../app-content";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "accountGuardRef" | "setCalendar" | "setCourseSchedule" | "setUpcoming" | "contentFeedLimit"
  | "contentFeedRequestCoordinatorRef" | "registerUniversityId" | "setAnnouncements"
  | "setYokAnnouncements" | "setSummerSchool" | "contentFeedAbortControllerRef"
  | "setContentFeedPagination" | "contentFeedPagination" | "announcements" | "yokAnnouncements"
  | "setContentFeedLimit" | "notificationLifecycleRef" | "notificationPreferencesRef"
> & Pick<ApplicationDerivedState,
  "accessToken"
> & Pick<ApplicationActions,
  "withLoadable" | "apiRequest" | "trackAuthenticatedMutation"
>;

export function createContentActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "loadMyCalendar" | "loadCourseSchedule" | "loadUpcoming" | "loadAnnouncements"
  | "loadYokAnnouncements" | "loadSummerSchool" | "refreshSummerSchool" | "refreshContentFeed"
  | "loadMoreContentFeed" | "loadDeviceAnnouncementCollection"
> {
  const {
    accountGuardRef,
    accessToken,
    withLoadable,
    trackAuthenticatedMutation,
    setCalendar,
    apiRequest,
    setCourseSchedule,
    setUpcoming,
    contentFeedLimit,
    contentFeedRequestCoordinatorRef,
    registerUniversityId,
    setAnnouncements,
    setYokAnnouncements,
    setSummerSchool,
    contentFeedAbortControllerRef,
    setContentFeedPagination,
    contentFeedPagination,
    announcements,
    yokAnnouncements,
    setContentFeedLimit,
    notificationLifecycleRef,
    notificationPreferencesRef,
  } = dependencies;

  async function loadMyCalendar(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setCalendar,
      () => apiRequest<CalendarPayload>("/calendar/my", {}, token, { ownerSnapshot })
        .then(hydrateCalendarPdfPayload)
        .then(normalizeCalendarPayloadForDisplay),
      ownerSnapshot,
      preserveDataOnRefresh
    );
  }

  async function loadCourseSchedule(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setCourseSchedule,
      () => Promise.all([
        apiRequest<DepartmentSchedulePayload>("/calendar/my/course-schedules", {}, token, { ownerSnapshot }),
        apiRequest<DepartmentSchedulePayload>("/calendar/my/exam-schedules", {}, token, { ownerSnapshot })
      ]).then(async ([coursePayload, examPayload]) => {
        const [hydratedCoursePayload, hydratedExamPayload] = await Promise.all([
          hydrateDepartmentPdfPayload(coursePayload, "Bölüm ders programı"),
          hydrateDepartmentPdfPayload(examPayload, "Bölüm sınav programı"),
        ]);
        return mergeDepartmentSchedules(hydratedCoursePayload, hydratedExamPayload);
      }),
      ownerSnapshot,
      preserveDataOnRefresh
    );
  }

  async function loadUpcoming(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setUpcoming,
      () => apiRequest<EventRecord[]>("/calendar/upcoming?limit=10", {}, token, { ownerSnapshot })
        .then(normalizeEventRecordsForDisplay),
      ownerSnapshot,
      preserveDataOnRefresh
    );
  }

  async function loadAnnouncements(
    tokenOverride?: string,
    universityIdOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined && universityIdOverride === undefined,
    limitOverride = contentFeedLimit,
    signal?: AbortSignal,
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration(),
    forceManifestRevalidation = false,
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token || !ownerSnapshot || !contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;
    const primaryLoadLease = contentFeedRequestCoordinatorRef.current.beginPrimaryLoad(requestGeneration);
    if (!primaryLoadLease) return;

    await withLoadable(
      setAnnouncements,
      () => loadDeviceAnnouncementCollection(
        token,
        ownerSnapshot,
        limitOverride,
        signal,
        requestGeneration,
        forceManifestRevalidation,
      ),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isPrimaryLoadCurrent(primaryLoadLease)
    );
  }

  async function loadDeviceAnnouncementCollection(
    token: string,
    ownerSnapshot: NonNullable<ReturnType<typeof accountGuardRef.current.capture>>,
    _limit: number,
    signal: AbortSignal | undefined,
    requestGeneration: number | undefined,
    force: boolean,
  ): Promise<TrustedContentCollection> {
    const isCurrent = () => accountGuardRef.current.isCurrent(ownerSnapshot)
      && (requestGeneration === undefined
        || contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration));
    const result = await trackAuthenticatedMutation(async () => {
      const synced = await syncDeviceContent({
        ownerId: ownerSnapshot.ownerId,
        force,
        loadManifest: (knownVersion) => apiRequest<unknown>(
          `/announcements/my/source-manifest${knownVersion ? `?knownVersion=${encodeURIComponent(knownVersion)}` : ""}`,
          signal ? { signal } : {},
          token,
          { ownerSnapshot },
        ),
        fetchOptions: { ...(signal ? { signal } : {}) },
        isCurrent,
      });
      let scheduledItemIds: readonly string[] = [];
      const delivery = await notifyNewDeviceContent({
        ownerId: ownerSnapshot.ownerId,
        items: synced.newItems,
        lifecycle: notificationLifecycleRef.current,
        ...(notificationPreferencesRef.current ? { preferences: notificationPreferencesRef.current } : {}),
        getCurrentDeliveryState: () => ({
          lifecycle: notificationLifecycleRef.current,
          ...(notificationPreferencesRef.current ? { preferences: notificationPreferencesRef.current } : {}),
        }),
        onScheduledItems: (itemIds) => { scheduledItemIds = itemIds; },
        isCurrent,
      });
      if (delivery === "scheduled" && scheduledItemIds.length > 0 && isCurrent()) {
        await acknowledgeDeviceContentNotifications(
          ownerSnapshot.ownerId,
          scheduledItemIds,
        );
      }
      return synced;
    });
    // Device recipes already bound each source snapshot. Keep every source in
    // the searchable collection; FlatList virtualizes the rendered rows.
    return result.collection;
  }

  async function loadYokAnnouncements(
    preserveDataOnRefresh = true,
    limitOverride = contentFeedLimit,
    signal?: AbortSignal,
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration()
  ): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;
    await withLoadable(
      setYokAnnouncements,
      () => apiRequest<AnnouncementCollectionApiPayload>(
        `/announcements/yok/trusted?limit=${limitOverride}`,
        signal ? { signal } : {},
        undefined,
        { ownerSnapshot }
      )
        .then(normalizeTrustedApiContentEnvelope),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)
    );
  }

  async function loadSummerSchool(
    tokenOverride?: string,
    universityIdOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined && universityIdOverride === undefined,
    signal?: AbortSignal,
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token || !contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setSummerSchool({ loading: false });
      return;
    }

    await withLoadable(
      setSummerSchool,
      () => apiRequest<SummerSchoolApiPayload>(
        "/calendar/summer-school/my",
        signal ? { signal } : {},
        token,
        { ownerSnapshot }
      )
        .then(normalizeSummerSchoolPayloadForDisplay),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)
    );
  }

  async function refreshSummerSchool(): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) return;
    await Promise.all([
      loadMyCalendar(undefined, ownerSnapshot, true),
      loadSummerSchool(undefined, undefined, ownerSnapshot, true)
    ]);
  }

  async function refreshContentFeed(): Promise<void> {
    const requestLease = contentFeedRequestCoordinatorRef.current.beginRefresh();
    if (!requestLease) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) {
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }
    contentFeedAbortControllerRef.current?.abort();
    const requestController = new AbortController();
    contentFeedAbortControllerRef.current = requestController;
    setContentFeedPagination({ loading: false });
    try {
      await Promise.allSettled([
        loadAnnouncements(undefined, undefined, ownerSnapshot, true, contentFeedLimit, requestController.signal, undefined, true),
        loadYokAnnouncements(true, contentFeedLimit, requestController.signal),
        loadSummerSchool(undefined, undefined, ownerSnapshot, true, requestController.signal)
      ]);
    } finally {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
    }
  }

  async function loadMoreContentFeed(): Promise<void> {
    if (contentFeedPagination.loading || contentFeedLimit >= CONTENT_FEED_MAX_LIMIT) return;
    const requestLease = contentFeedRequestCoordinatorRef.current.beginPagination();
    if (!requestLease) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    const token = accessToken;
    if (!ownerSnapshot || !token) {
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }
    const requestController = new AbortController();
    contentFeedAbortControllerRef.current = requestController;

    const nextLimit = nextContentFeedLimit(contentFeedLimit);
    const requests: Array<{
      kind: "academic" | "yok";
      promise: Promise<TrustedContentCollection>;
    }> = [];
    if (trustedContentCollectionHasMore(announcements.data, contentFeedLimit)) {
      requests.push({
        kind: "academic",
        promise: loadDeviceAnnouncementCollection(
          token,
          ownerSnapshot,
          nextLimit,
          requestController.signal,
          requestLease.generation,
          false,
        )
      });
    }
    if (trustedContentCollectionHasMore(yokAnnouncements.data, contentFeedLimit)) {
      requests.push({
        kind: "yok",
        promise: apiRequest<AnnouncementCollectionApiPayload>(
          `/announcements/yok/trusted?limit=${nextLimit}`,
          { signal: requestController.signal },
          undefined,
          { ownerSnapshot }
        ).then(normalizeTrustedApiContentEnvelope)
      });
    }
    if (requests.length === 0) {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }

    setContentFeedPagination({ loading: true });
    const results = await Promise.allSettled(requests.map((request) => request.promise));
    if (
      !accountGuardRef.current.isCurrent(ownerSnapshot)
      || !contentFeedRequestCoordinatorRef.current.isCurrent(requestLease)
    ) {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      return;
    }

    let failed = false;
    results.forEach((result, index) => {
      const request = requests[index];
      if (!request) return;
      if (result.status === "rejected") {
        failed = true;
        return;
      }
      const nextState: Loadable<TrustedContentCollection> = {
        loading: false,
        data: result.value,
        attempted: true,
        stale: false
      };
      if (request.kind === "academic") setAnnouncements(nextState);
      else setYokAnnouncements(nextState);
    });

    if (failed) {
      if (contentFeedAbortControllerRef.current === requestController) {
        contentFeedAbortControllerRef.current = null;
      }
      contentFeedRequestCoordinatorRef.current.finish(requestLease);
      setContentFeedPagination({
        loading: false,
        error: "Daha fazla içerik yüklenemedi. Mevcut doğrulanmış kayıtlar korunuyor."
      });
      return;
    }
    if (contentFeedAbortControllerRef.current === requestController) {
      contentFeedAbortControllerRef.current = null;
    }
    contentFeedRequestCoordinatorRef.current.finish(requestLease);
    setContentFeedLimit(nextLimit);
    setContentFeedPagination({ loading: false });
  }

  return {
    loadMyCalendar,
    loadCourseSchedule,
    loadUpcoming,
    loadAnnouncements,
    loadYokAnnouncements,
    loadSummerSchool,
    refreshSummerSchool,
    refreshContentFeed,
    loadMoreContentFeed,
    loadDeviceAnnouncementCollection
  };
}

export async function hydrateCalendarPdfPayload(payload: CalendarPayload): Promise<CalendarPayload> {
  const universityId = payload.calendar.universityId
    ?? payload.events.find((event) => event.universityId)?.universityId;
  if (!universityId) return payload;
  const events = await hydrateDeviceAcademicPdfEvents({
    processingMode: payload.pdfProcessingMode,
    source: payload.devicePdf,
    serverEvents: payload.events,
    context: { universityId, sourceLabel: "Akademik takvim" },
  });
  return {
    ...payload,
    events,
    ...(events.length > 0 ? { sourceStatus: "parsed" as const } : {}),
  };
}

async function hydrateDepartmentPdfPayload(
  payload: DepartmentSchedulePayload,
  sourceLabel: string,
): Promise<DepartmentSchedulePayload> {
  const events = await hydrateDeviceAcademicPdfEvents({
    processingMode: payload.pdfProcessingMode,
    source: payload.devicePdf,
    serverEvents: payload.events,
    context: {
      universityId: payload.profile.universityId,
      ...(payload.profile.facultyId ? { facultyId: payload.profile.facultyId } : {}),
      ...(payload.profile.departmentId ? { departmentId: payload.profile.departmentId } : {}),
      sourceLabel,
    },
  });
  return {
    ...payload,
    events,
    ...(events.length > 0 ? { sourceStatus: "parsed" as const } : {}),
  };
}

export function mergeDepartmentSchedules(
  coursePayload: DepartmentSchedulePayload,
  examPayload: DepartmentSchedulePayload
): DepartmentSchedulePayload {
  const courseSourceUrl = canonicalizeOfficialAcademicUrl(coursePayload.sourceUrl);
  const examSourceUrl = canonicalizeOfficialAcademicUrl(examPayload.sourceUrl);
  const events = [
    ...normalizeEventRecordsForDisplay(coursePayload.events).map((event) => ({
      ...event,
      sourceLabel: "Bölüm ders programı",
      ...(courseSourceUrl ? { sourceUrl: courseSourceUrl } : {})
    })),
    ...normalizeEventRecordsForDisplay(examPayload.events).map((event) => ({
      ...event,
      sourceLabel: "Bölüm sınav programı",
      ...(examSourceUrl ? { sourceUrl: examSourceUrl } : {})
    }))
  ];
  return {
    profile: coursePayload.profile,
    events: [...new Map(events.map((event) => [event.id, event])).values()],
    sourceStatus: coursePayload.sourceStatus,
    ...(courseSourceUrl ? { sourceUrl: courseSourceUrl } : {}),
    ...(coursePayload.pdfProcessingMode ? { pdfProcessingMode: coursePayload.pdfProcessingMode } : {}),
    ...(coursePayload.devicePdf ? { devicePdf: coursePayload.devicePdf } : {}),
    examSourceStatus: examPayload.sourceStatus,
    ...(examSourceUrl ? { examSourceUrl } : {}),
    ...(examPayload.pdfProcessingMode ? { examPdfProcessingMode: examPayload.pdfProcessingMode } : {}),
    ...(examPayload.devicePdf ? { examDevicePdf: examPayload.devicePdf } : {})
  };
}
