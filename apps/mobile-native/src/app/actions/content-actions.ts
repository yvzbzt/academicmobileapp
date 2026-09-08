import {
  canonicalizeOfficialAcademicUrl,
  normalizeTrustedContentCollection,
  normalizeTrustedApiContentEnvelope,
  type TrustedContentCollection,
} from "../../content/content-trust";
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
  | "setContentFeedLimit"
> & Pick<ApplicationDerivedState,
  "accessToken"
> & Pick<ApplicationActions,
  "withLoadable" | "apiRequest"
>;

export function createContentActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "loadMyCalendar" | "loadCourseSchedule" | "loadUpcoming" | "loadAnnouncements"
  | "loadYokAnnouncements" | "loadSummerSchool" | "refreshSummerSchool" | "refreshContentFeed"
  | "loadMoreContentFeed"
> {
  const {
    accountGuardRef,
    accessToken,
    withLoadable,
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
    setContentFeedLimit
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
      () => apiRequest<DepartmentSchedulePayload>("/calendar/my/course-schedules", {}, token, { ownerSnapshot })
        .then((payload) => {
          const { sourceUrl: rawSourceUrl, ...safePayload } = payload;
          const sourceUrl = canonicalizeOfficialAcademicUrl(rawSourceUrl);
          return {
            ...safePayload,
            events: normalizeEventRecordsForDisplay(payload.events),
            ...(sourceUrl ? { sourceUrl } : {})
          };
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
    requestGeneration = contentFeedRequestCoordinatorRef.current.captureGeneration()
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token || !contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)) return;

    const universityId = universityIdOverride ?? registerUniversityId;
    if (!universityId) {
      setAnnouncements({ loading: false, data: normalizeTrustedContentCollection([]), attempted: true, stale: false });
      return;
    }

    await withLoadable(
      setAnnouncements,
      () => apiRequest<AnnouncementCollectionApiPayload>(
        `/announcements/my/trusted?limit=${limitOverride}`,
        signal ? { signal } : {},
        token,
        { ownerSnapshot }
      )
        .then(normalizeTrustedApiContentEnvelope),
      ownerSnapshot,
      preserveDataOnRefresh,
      () => contentFeedRequestCoordinatorRef.current.isGenerationCurrent(requestGeneration)
    );
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
        loadAnnouncements(undefined, undefined, ownerSnapshot, true, contentFeedLimit, requestController.signal),
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
    if (!ownerSnapshot || !token || !registerUniversityId) {
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
        promise: apiRequest<AnnouncementCollectionApiPayload>(
          `/announcements/my/trusted?limit=${nextLimit}`,
          { signal: requestController.signal },
          token,
          { ownerSnapshot }
        ).then(normalizeTrustedApiContentEnvelope)
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
    loadMoreContentFeed
  };
}
