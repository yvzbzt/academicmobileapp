jest.mock("../../src/content/device-content-sync", () => ({ syncDeviceContent: jest.fn() }));
jest.mock("../../src/content/device-content-notification-ledger", () => ({
  acknowledgeDeviceContentNotifications: jest.fn(async () => undefined),
}));
jest.mock("../../src/calendar/device-academic-pdf", () => ({ hydrateDeviceAcademicPdfEvents: jest.fn() }));
jest.mock("../../src/notifications", () => ({ notifyNewDeviceContent: jest.fn() }));

import { createContentActions, mergeDepartmentSchedules } from "../../src/app/actions/content-actions";
import { syncDeviceContent } from "../../src/content/device-content-sync";
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
