const mockIsDeviceContentSaved = jest.fn<Promise<boolean>, [string, string]>();
const mockSetDeviceContentSaved = jest.fn<Promise<void>, [string, string, boolean]>();
const mockReadDeviceContentCache = jest.fn<Promise<unknown>, [string]>();

jest.mock("../../src/content/device-saved-content", () => ({
  isDeviceContentRecordId: (value: string) => /^device-.+-[a-f\d]{16}$/u.test(value),
  isDeviceContentSaved: (...args: [string, string]) => mockIsDeviceContentSaved(...args),
  setDeviceContentSaved: (...args: [string, string, boolean]) => mockSetDeviceContentSaved(...args),
}));

jest.mock("../../src/content/device-content-cache", () => ({
  readDeviceContentCache: (...args: [string]) => mockReadDeviceContentCache(...args),
}));

import { createContentNavigationActions } from "../../src/app/actions/content-navigation-actions";

const deviceId = "device-source-1-0123456789abcdef";

function dependencies(saved = false) {
  const ownerSnapshot = { ownerId: "owner-1", generation: 1 };
  const setAnnouncementSaveStatus = jest.fn();
  const setActiveTrustedDetail = jest.fn();
  const apiRequest = jest.fn();
  return {
    ownerSnapshot,
    setAnnouncementSaveStatus,
    setActiveTrustedDetail,
    apiRequest,
    value: {
      announcementDetailRequestGenerationRef: { current: 0 },
      announcementSaveRequestGenerationRef: { current: 0 },
      setAnnouncementDetailLoad: jest.fn(),
      setAnnouncementSaveStatus,
      setActiveTrustedDetail,
      contentFeedAbortControllerRef: { current: null },
      contentFeedRequestCoordinatorRef: { current: { reset: jest.fn() } },
      setAnnouncements: jest.fn(),
      setYokAnnouncements: jest.fn(),
      setSummerSchool: jest.fn(),
      setContentFeedPagination: jest.fn(),
      requestAppRoute: jest.fn(),
      setMessage: jest.fn(),
      sessionRef: { current: { user: { id: "owner-1" }, accessToken: "token" } },
      accountGuardRef: {
        current: {
          capture: () => ownerSnapshot,
          isCurrent: (candidate: typeof ownerSnapshot) => candidate === ownerSnapshot,
        },
      },
      announcementSaveStatus: {
        id: deviceId,
        saved,
        loading: false,
        mutating: false,
      },
      apiRequest,
      trackAuthenticatedMutation: async <T,>(action: () => Promise<T>) => action(),
      announcementFeed: [],
    },
  };
}

describe("device content navigation save actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads device save state locally without calling the legacy backend endpoint", async () => {
    mockIsDeviceContentSaved.mockResolvedValueOnce(true);
    const fixture = dependencies();
    const actions = createContentNavigationActions(fixture.value as never);

    actions.loadAnnouncementSavedStatus(deviceId);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockIsDeviceContentSaved).toHaveBeenCalledWith("owner-1", deviceId);
    expect(fixture.apiRequest).not.toHaveBeenCalled();
    expect(fixture.setAnnouncementSaveStatus).toHaveBeenLastCalledWith({
      id: deviceId,
      saved: true,
      loading: false,
      mutating: false,
    });
  });

  it("toggles device save state locally without sending a backend mutation", async () => {
    mockSetDeviceContentSaved.mockResolvedValueOnce();
    const fixture = dependencies(false);
    const actions = createContentNavigationActions(fixture.value as never);

    await actions.toggleAnnouncementSaved(deviceId);

    expect(mockSetDeviceContentSaved).toHaveBeenCalledWith("owner-1", deviceId, true);
    expect(fixture.apiRequest).not.toHaveBeenCalled();
    expect(fixture.setAnnouncementSaveStatus).toHaveBeenLastCalledWith({
      id: deviceId,
      saved: true,
      loading: false,
      mutating: false,
    });
  });

  it("restores a cold device detail from the owner cache without querying the backend", async () => {
    mockIsDeviceContentSaved.mockResolvedValueOnce(false);
    mockReadDeviceContentCache.mockResolvedValueOnce({
      items: [{
        id: deviceId,
        sourceId: "source-1",
        sourceName: "Example University",
        contentType: "announcement",
        scopeType: "university",
        scopeId: "university-1",
        title: "Cached announcement",
        link: "https://example.edu.tr/announcements/item",
        canonicalUrl: "https://example.edu.tr/announcements/item",
        canonicalUrlAliases: [],
        officialSourceUrl: "https://example.edu.tr/announcements",
        sourceRelationships: [{
          sourceId: "source-1",
          sourceName: "Example University",
          officialSourceUrl: "https://example.edu.tr/announcements",
          scopeType: "university",
          scopeId: "university-1",
          canonicalUrl: "https://example.edu.tr/announcements/item",
        }],
        freshness: "fresh",
        trustStatus: "trusted",
        sourceStatus: "active",
        sourceTrustStatus: "trusted",
      }],
    });
    const fixture = dependencies();
    const actions = createContentNavigationActions(fixture.value as never);

    actions.loadProtectedAnnouncementDetail(deviceId);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockReadDeviceContentCache).toHaveBeenCalledWith("owner-1");
    expect(fixture.apiRequest).not.toHaveBeenCalled();
    expect(fixture.setActiveTrustedDetail).toHaveBeenCalledWith(expect.objectContaining({
      type: "announcement",
      id: deviceId,
      title: "Cached announcement",
    }));
  });
});
