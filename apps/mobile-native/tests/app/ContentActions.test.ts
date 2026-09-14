jest.mock("../../src/content/device-content-sync", () => ({ syncDeviceContent: jest.fn() }));
jest.mock("../../src/content/device-content-notification-ledger", () => ({
  acknowledgeDeviceContentNotifications: jest.fn(async () => undefined),
}));
jest.mock("../../src/calendar/device-academic-pdf", () => ({ hydrateDeviceAcademicPdfEvents: jest.fn() }));
jest.mock("../../src/notifications", () => ({ notifyNewDeviceContent: jest.fn() }));

import { createContentActions, mergeDepartmentSchedules } from "../../src/app/actions/content-actions";
import { syncDeviceContent, type DeviceContentSyncResult } from "../../src/content/device-content-sync";
import { acknowledgeDeviceContentNotifications } from "../../src/content/device-content-notification-ledger";
import { notifyNewDeviceContent } from "../../src/notifications";
import { AccountGenerationGuard } from "../../src/auth/session-integrity";
import { createContentFeedRequestCoordinator } from "../../src/announcements/feed-model";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";

describe("device content notification wiring", () => {
  beforeEach(() => {
    jest.mocked(acknowledgeDeviceContentNotifications).mockClear();
    jest.mocked(notifyNewDeviceContent).mockReset();
    jest.mocked(syncDeviceContent).mockReset();
  });

  it("hands only the sync delta to the owner-scoped local notification boundary", async () => {
    const accountGuard = new AccountGenerationGuard();
    const ownerSnapshot = accountGuard.activate("owner-1");
    const item = trustedRecord();
    jest.mocked(syncDeviceContent).mockResolvedValue({
      collection: {
        items: [item],
        state: "fresh",
        omittedCount: 0,
        duplicateCount: 0,
        rawItemCount: 1,
      },
      manifest: null,
      cacheHit: false,
      failedSourceIds: [],
      newItems: [item],
    });
    jest.mocked(notifyNewDeviceContent).mockImplementation(async (input) => {
      input.onScheduledItems?.(input.items.map((candidate) => candidate.id));
      return "scheduled";
    });
    const lifecycle = {
      schemaVersion: 1 as const,
      ownerId: ownerSnapshot.ownerId,
      preferenceEnabled: true,
      permission: "granted" as const,
      registration: "registered" as const,
      active: true,
    };
    const actions = createContentActions({
      accountGuardRef: { current: accountGuard },
      accessToken: "test-token",
      withLoadable: async <T>(_setter: unknown, operation: () => Promise<T>) => operation(),
      trackAuthenticatedMutation: async <T>(operation: () => Promise<T>) => operation(),
      apiRequest: async <T>() => ({} as T),
      setCalendar: jest.fn(),
      setCourseSchedule: jest.fn(),
      setUpcoming: jest.fn(),
      contentFeedLimit: 20,
      contentFeedRequestCoordinatorRef: { current: createContentFeedRequestCoordinator() },
      registerUniversityId: "university-1",
      setAnnouncements: jest.fn(),
      setYokAnnouncements: jest.fn(),
      setSummerSchool: jest.fn(),
      contentFeedAbortControllerRef: { current: null },
      setContentFeedPagination: jest.fn(),
      contentFeedPagination: { loading: false },
      announcements: { loading: false },
      yokAnnouncements: { loading: false },
      setContentFeedLimit: jest.fn(),
      notificationLifecycleRef: { current: lifecycle },
      notificationPreferencesRef: { current: { enabled: true, categories: { announcement: true }, reminderOffsets: [] } },
    } as Parameters<typeof createContentActions>[0]);

    const collection = await actions.loadDeviceAnnouncementCollection(
      "test-token",
      ownerSnapshot,
      20,
      undefined,
      undefined,
      false,
    );

    expect(collection.items).toEqual([item]);
    expect(notifyNewDeviceContent).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: ownerSnapshot.ownerId,
      items: [item],
      lifecycle,
    }));
    expect(acknowledgeDeviceContentNotifications).toHaveBeenCalledWith(
      ownerSnapshot.ownerId,
      [item.id],
    );

    jest.mocked(syncDeviceContent).mockResolvedValueOnce({
      collection: {
        items: [item],
        state: "fresh",
        omittedCount: 0,
        duplicateCount: 0,
        rawItemCount: 1,
        hasMore: true,
      },
      manifest: null,
      cacheHit: true,
      failedSourceIds: [],
      newItems: [],
    });
    const incompleteCollection = await actions.loadDeviceAnnouncementCollection(
      "test-token",
      ownerSnapshot,
      20,
      undefined,
      undefined,
      false,
    );
    expect(incompleteCollection.hasMore).toBe(true);

    const excludedCategoryItem = {
      ...item,
      id: "device-source-1-2222222222222222",
      title: "Faculty item",
      scopeType: "faculty" as const,
      scopeId: "faculty-1",
    };
    jest.mocked(syncDeviceContent).mockResolvedValue({
      collection: {
        items: [item, excludedCategoryItem],
        state: "fresh",
        omittedCount: 0,
        duplicateCount: 0,
        rawItemCount: 2,
      },
      manifest: null,
      cacheHit: false,
      failedSourceIds: [],
      newItems: [item, excludedCategoryItem],
    });
    jest.mocked(acknowledgeDeviceContentNotifications).mockClear();
    jest.mocked(notifyNewDeviceContent).mockImplementationOnce(async (input) => {
      input.onScheduledItems?.([item.id]);
      return "scheduled";
    });
    await actions.loadDeviceAnnouncementCollection("test-token", ownerSnapshot, 20, undefined, undefined, false);
    expect(acknowledgeDeviceContentNotifications).toHaveBeenCalledWith(ownerSnapshot.ownerId, [item.id]);

    for (const unsettled of ["quiet_hours", "failed"] as const) {
      jest.mocked(acknowledgeDeviceContentNotifications).mockClear();
      jest.mocked(notifyNewDeviceContent).mockResolvedValueOnce(unsettled);
      await actions.loadDeviceAnnouncementCollection(
        "test-token",
        ownerSnapshot,
        20,
        undefined,
        undefined,
        false,
      );
      expect(acknowledgeDeviceContentNotifications).not.toHaveBeenCalled();
    }
  });

  it("does not let an older primary load overwrite a newer completion", async () => {
    const accountGuard = new AccountGenerationGuard();
    accountGuard.activate("owner-1");
    const older = deferred<DeviceContentSyncResult>();
    const latest = deferred<DeviceContentSyncResult>();
    const olderItem = trustedRecord();
    const latestItem = {
      ...trustedRecord(),
      id: "device-source-1-2222222222222222",
      title: "Latest item",
    };
    jest.mocked(syncDeviceContent)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => latest.promise);
    jest.mocked(notifyNewDeviceContent).mockResolvedValue("no_new_items");
    const setAnnouncements = jest.fn();
    const actions = createContentActions({
      accountGuardRef: { current: accountGuard },
      accessToken: "test-token",
      withLoadable: async <T>(
        setter: (value: unknown) => void,
        operation: () => Promise<T>,
        _ownerSnapshot?: unknown,
        _preserveDataOnRefresh?: boolean,
        isOperationCurrent: () => boolean = () => true,
      ) => {
        if (!isOperationCurrent()) return null;
        const data = await operation();
        if (!isOperationCurrent()) return null;
        setter({ loading: false, data, attempted: true, stale: false });
        return data;
      },
      trackAuthenticatedMutation: async <T>(operation: () => Promise<T>) => operation(),
      apiRequest: async <T>() => ({} as T),
      setCalendar: jest.fn(),
      setCourseSchedule: jest.fn(),
      setUpcoming: jest.fn(),
      contentFeedLimit: 20,
      contentFeedRequestCoordinatorRef: { current: createContentFeedRequestCoordinator() },
      registerUniversityId: "university-1",
      setAnnouncements,
      setYokAnnouncements: jest.fn(),
      setSummerSchool: jest.fn(),
      contentFeedAbortControllerRef: { current: null },
      setContentFeedPagination: jest.fn(),
      contentFeedPagination: { loading: false },
      announcements: { loading: false },
      yokAnnouncements: { loading: false },
      setContentFeedLimit: jest.fn(),
      notificationLifecycleRef: {
        current: {
          schemaVersion: 1,
          ownerId: null,
          preferenceEnabled: false,
          permission: "not_requested",
          registration: "unregistered",
          active: false,
        },
      },
      notificationPreferencesRef: { current: undefined },
    } as Parameters<typeof createContentActions>[0]);

    const olderLoad = actions.loadAnnouncements();
    const latestLoad = actions.loadAnnouncements();
    latest.resolve(syncResult(latestItem));
    await latestLoad;
    older.resolve(syncResult(olderItem));
    await olderLoad;

    expect(setAnnouncements).toHaveBeenCalledTimes(1);
    expect(setAnnouncements).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ items: [latestItem] }),
    }));
  });
});

describe("calendar document loading", () => {
  it("keeps course and exam events tied to their own verified source", () => {
    const merged = mergeDepartmentSchedules(
      {
        profile: { universityId: "uni", facultyId: "faculty", departmentId: "department" },
        events: [{
          id: "course-1",
          title: "Veri Yapıları",
          category: "course_schedule",
          startDate: "2026-09-15T09:00:00+03:00",
        }],
        sourceUrl: "https://example.edu.tr/course.pdf",
        sourceStatus: "parsed",
        pdfProcessingMode: "device_text",
      },
      {
        profile: { universityId: "uni", facultyId: "faculty", departmentId: "department" },
        events: [{
          id: "exam-1",
          title: "Veri Yapıları Finali",
          category: "final_exam",
          startDate: "2027-01-05T10:00:00+03:00",
        }],
        sourceUrl: "https://example.edu.tr/exam.pdf",
        sourceStatus: "parsed",
        pdfProcessingMode: "server_ocr",
      },
    );

    expect(merged).toMatchObject({
      sourceUrl: "https://example.edu.tr/course.pdf",
      examSourceUrl: "https://example.edu.tr/exam.pdf",
      pdfProcessingMode: "device_text",
      examPdfProcessingMode: "server_ocr",
      examSourceStatus: "parsed",
    });
    expect(merged.events).toEqual([
      expect.objectContaining({
        id: "course-1",
        sourceLabel: "Bölüm ders programı",
        sourceUrl: "https://example.edu.tr/course.pdf",
      }),
      expect.objectContaining({
        id: "exam-1",
        sourceLabel: "Bölüm sınav programı",
        sourceUrl: "https://example.edu.tr/exam.pdf",
      }),
    ]);
  });

  it("drops an unsafe exam source URL instead of attaching it to an event", () => {
    const merged = mergeDepartmentSchedules(
      {
        profile: { universityId: "uni" },
        events: [],
        sourceStatus: "missing",
      },
      {
        profile: { universityId: "uni" },
        events: [{
          id: "exam-unsafe",
          title: "Final",
          category: "final_exam",
          startDate: "2027-01-05",
        }],
        sourceUrl: "javascript:alert(1)",
        sourceStatus: "parsed",
      },
    );

    expect(merged.examSourceUrl).toBeUndefined();
    expect(merged.events[0]).not.toHaveProperty("sourceUrl");
  });
});

function trustedRecord(): TrustedMobileContentRecord {
  return {
    id: "device-source-1-1111111111111111",
    sourceId: "source-1",
    sourceName: "Example University",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "New item",
    link: "https://example.edu.tr/item",
    canonicalUrl: "https://example.edu.tr/item",
    canonicalUrlAliases: [],
    officialSourceUrl: "https://example.edu.tr/announcements",
    sourceRelationships: [{
      sourceId: "source-1",
      sourceName: "Example University",
      officialSourceUrl: "https://example.edu.tr/announcements",
      scopeType: "university",
      scopeId: "university-1",
      canonicalUrl: "https://example.edu.tr/item",
    }],
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}

function syncResult(item: TrustedMobileContentRecord): DeviceContentSyncResult {
  return {
    collection: {
      items: [item],
      state: "fresh",
      omittedCount: 0,
      duplicateCount: 0,
      rawItemCount: 1,
    },
    manifest: null,
    cacheHit: false,
    failedSourceIds: [],
    newItems: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
