import { useNetworkState } from "expo-network";
import { useScrollToTop } from "@react-navigation/native";
import {
  act,
  fireEvent,
  renderAsync,
  screen,
  within,
} from "@testing-library/react-native";
import { AccessibilityInfo, FlatList } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  AnnouncementsFeed,
  type AnnouncementsFeedProps,
} from "../../src/announcements/AnnouncementsFeed";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";
import { ThemeProvider } from "../../src/design-system";

const mockWindowDimensions = jest.fn(() => ({
  fontScale: 2,
  height: 640,
  scale: 2,
  width: 320,
}));

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindowDimensions(),
}));

jest.mock("@react-navigation/native", () => ({ useScrollToTop: jest.fn() }));

const callbacks = {
  onLoadMore: jest.fn(),
  onOpenItem: jest.fn(),
  onOpenNotificationSettings: jest.fn(),
  onOpenSummerSchool: jest.fn(),
  onOpenYok: jest.fn(),
  onRefresh: jest.fn(),
  onRetry: jest.fn(),
  onRetryPagination: jest.fn(),
};

let fakeTimersActive = false;

function record(
  id: string,
  overrides: Partial<TrustedMobileContentRecord> = {},
): TrustedMobileContentRecord {
  const canonicalUrl = `https://example.edu.tr/duyurular/${id}`;
  const candidate = {
    id,
    sourceId: `source-${id}`,
    sourceName: "Örnek Üniversitesi Öğrenci İşleri",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: `Güvenilir duyuru ${id}`,
    summary: `Güvenilir özet ${id}`,
    link: canonicalUrl,
    canonicalUrl,
    officialSourceUrl: "https://example.edu.tr/duyurular",
    publishedAt: "2026-08-01T07:00:00.000Z",
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
    ...overrides,
  };
  return {
    ...candidate,
    sourceRelationships: candidate.sourceRelationships ?? [{
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      officialSourceUrl: candidate.officialSourceUrl ?? "",
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      canonicalUrl: candidate.canonicalUrl ?? candidate.link,
    }],
  } as TrustedMobileContentRecord;
}

const academicItems = [
  record("registration", {
    title: "Ders kayıt takvimi açıklandı",
    publishedAt: "2026-08-02T08:00:00.000Z",
  }),
  record("scholarship", {
    sourceName: "Örnek Üniversitesi Mühendislik Fakültesi",
    contentType: "news",
    scopeType: "faculty",
    scopeId: "faculty-1",
    title: "Burs başvurusu belge listesi",
    publishedAt: undefined,
    sourceUpdatedAt: "2026-08-01T08:00:00.000Z",
  }),
  record("research-event", {
    sourceName: "Bilgisayar Mühendisliği Bölümü",
    contentType: "event",
    scopeType: "department",
    scopeId: "department-1",
    title: "Araştırma etkinliği",
    publishedAt: "2026-07-31T08:00:00.000Z",
  }),
];

const yokItems = [
  record("yok-guidance", {
    sourceId: "yok-source",
    sourceName: "Yükseköğretim Kurulu",
    title: "YÖK öğrenci bilgilendirmesi",
    canonicalUrl: "https://www.yok.gov.tr/duyurular/yok-guidance",
    link: "https://www.yok.gov.tr/duyurular/yok-guidance",
    officialSourceUrl: "https://www.yok.gov.tr/duyurular",
    publishedAt: "2026-07-30T08:00:00.000Z",
  }),
];

const summerItems = [
  record("summer-registration", {
    sourceId: "summer-source",
    sourceName: "Örnek Üniversitesi Yaz Okulu",
    title: "Yaz okulu kayıt tarihleri",
    publishedAt: "2026-07-29T08:00:00.000Z",
  }),
];

function feedProps(
  overrides: Partial<AnnouncementsFeedProps> = {},
): AnnouncementsFeedProps {
  return {
    academicItems,
    yokItems,
    summerItems,
    universityName: "Örnek Üniversitesi",
    facultyName: "Mühendislik Fakültesi",
    departmentName: "Bilgisayar Mühendisliği",
    attempted: true,
    loading: false,
    refreshing: false,
    offline: false,
    serverLimit: 20,
    hasMore: false,
    paginationLoading: false,
    ...callbacks,
    ...overrides,
  };
}

async function renderFeed(
  props: AnnouncementsFeedProps,
  platform: "android" | "ios" = "android",
) {
  return renderAsync(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <ThemeProvider
        liquidGlassAvailable={platform === "ios"}
        platform={platform}
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={320}
      >
        <AnnouncementsFeed {...props} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

function renderedTitles(): string[] {
  return screen
    .getByTestId(/^announcements-feed-/u)
    .props.data.map((item: { record: TrustedMobileContentRecord }) => item.record.title);
}

describe("Phase 8 Announcements feed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    fakeTimersActive = true;
    mockWindowDimensions.mockReturnValue({
      fontScale: 2,
      height: 640,
      scale: 2,
      width: 320,
    });
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
      type: "WIFI",
    });
  });

  afterEach(() => {
    if (fakeTimersActive) {
      act(() => jest.runOnlyPendingTimers());
      jest.useRealTimers();
      fakeTimersActive = false;
    }
  });

  it("uses one virtualized list, registers scroll-to-top, and orders trusted records chronologically", async () => {
    const rejected = record("rejected", {
      title: "Reddedilen içerik görünmemeli",
      trustStatus: "rejected" as "trusted",
    });
    const sourceLess = record("source-less", {
      sourceId: "",
      title: "Kaynaksız içerik görünmemeli",
    });
    const unsafe = record("unsafe", {
      title: "Güvensiz bağlantı görünmemeli",
      canonicalUrl: "javascript:alert(1)",
      link: "javascript:alert(1)",
    });
    const genericSource = record("generic-source", {
      sourceName: "Resmî akademik kaynak",
      title: "Genel kaynak görünmemeli",
    });
    const inactiveSource = record("inactive-source", {
      sourceStatus: "inactive" as "active",
      title: "Etkin olmayan kaynak görünmemeli",
    });
    const rejectedSource = record("rejected-source", {
      sourceTrustStatus: "rejected" as "trusted",
      title: "Reddedilmiş kaynak görünmemeli",
    });
    const view = await renderFeed(feedProps({
      academicItems: [
        ...academicItems,
        rejected,
        sourceLess,
        unsafe,
        genericSource,
        inactiveSource,
        rejectedSource,
      ],
    }));

    expect(view.UNSAFE_getAllByType(FlatList)).toHaveLength(1);
    expect(useScrollToTop).toHaveBeenCalledWith(
      expect.objectContaining({ current: expect.anything() }),
    );
    expect(renderedTitles()).toEqual([
      "Ders kayıt takvimi açıklandı",
      "Burs başvurusu belge listesi",
      "Araştırma etkinliği",
      "YÖK öğrenci bilgilendirmesi",
      "Yaz okulu kayıt tarihleri",
    ]);
    expect(screen.queryByText("Reddedilen içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Kaynaksız içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Güvensiz bağlantı görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Genel kaynak görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Etkin olmayan kaynak görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Reddedilmiş kaynak görünmemeli")).not.toBeOnTheScreen();
    expect(screen.getAllByText(/Yayınlandı/iu).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Güncellendi/iu)).toBeOnTheScreen();
  });

  it("renders the reference top bar, compact search/filter rails, and actionable reminder artwork", async () => {
    await renderFeed(feedProps());

    expect(screen.getByTestId("announcements-top-bar")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Duyurular" })).toBeOnTheScreen();
    expect(screen.getByTestId("announcements-search-frame")).toBeOnTheScreen();
    expect(screen.getByTestId("announcements-reminder-banner")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Bildirim tercihlerini aç" }));
    expect(callbacks.onOpenNotificationSettings).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", {
      name: "Hiçbir duyuruyu kaçırma. Bildirimleri aç.",
    }));
    expect(callbacks.onOpenNotificationSettings).toHaveBeenCalledTimes(2);
  });

  it("debounces raw search for 300 ms and exposes a recoverable no-result state", async () => {
    await renderFeed(feedProps());

    fireEvent.changeText(screen.getByRole("search", { name: "Duyurularda ara" }), "burs");
    expect(renderedTitles()).toContain("Ders kayıt takvimi açıklandı");
    act(() => jest.advanceTimersByTime(299));
    expect(renderedTitles()).toContain("Ders kayıt takvimi açıklandı");
    act(() => jest.advanceTimersByTime(1));
    expect(renderedTitles()).toEqual(["Burs başvurusu belge listesi"]);

    fireEvent.changeText(
      screen.getByRole("search", { name: "Duyurularda ara" }),
      "eşleşmeyen arama",
    );
    act(() => jest.advanceTimersByTime(300));
    expect(screen.getByRole("header", { name: "Bu filtrelerde sonuç yok" })).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Filtreleri temizle" }));
    expect(renderedTitles()).toHaveLength(5);
  });

  it("uses one content rail and one compact source menu with selected semantics", async () => {
    await renderFeed(feedProps());

    expect(screen.getByRole("header", { name: "İçerik türü" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Kaynak" })).toBeOnTheScreen();
    const newsFilter = screen.getByRole("button", {
      name: "Haberler içerik türü filtresi",
    });
    fireEvent.press(newsFilter);
    expect(newsFilter.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(renderedTitles()).toEqual(["Burs başvurusu belge listesi"]);

    fireEvent.press(screen.getByTestId("announcements-source-filter"));
    const facultyFilter = within(screen.getByTestId("bottom-sheet")).getByRole("radio", {
      name: "Fakültem kaynak filtresi",
    });
    fireEvent.press(facultyFilter);
    fireEvent.press(screen.getByTestId("announcements-source-filter"));
    const selectedFacultyFilter = within(screen.getByTestId("bottom-sheet")).getByRole("radio", {
      name: "Fakültem kaynak filtresi",
    });
    expect(selectedFacultyFilter.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId("announcements-filter-summary").props.accessibilityLabel)
      .toContain("Haberler, Fakültem");
    expect(screen.getByTestId("announcements-filter-summary").props.accessibilityLiveRegion)
      .toBe("polite");
  });

  it("announces committed iOS filter and debounced search results without an initial announcement", async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);

    try {
      await renderFeed(feedProps(), "ios");
      expect(announceSpy).not.toHaveBeenCalled();

      fireEvent.press(screen.getByRole("button", {
        name: "Haberler içerik türü filtresi",
      }));
      expect(announceSpy).toHaveBeenLastCalledWith(
        screen.getByTestId("announcements-filter-summary").props.accessibilityLabel,
      );
      expect(announceSpy).toHaveBeenLastCalledWith(
        "Seçili filtreler: Haberler, Tüm kaynaklar. 1 sonuç.",
      );

      announceSpy.mockClear();
      fireEvent.changeText(
        screen.getByRole("search", { name: "Duyurularda ara" }),
        "burs",
      );
      act(() => jest.advanceTimersByTime(299));
      expect(announceSpy).not.toHaveBeenCalled();
      act(() => jest.advanceTimersByTime(1));
      expect(announceSpy).toHaveBeenLastCalledWith(
        "Seçili filtreler: Haberler, Tüm kaynaklar, arama etkin. 1 sonuç.",
      );
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("keeps YÖK and Summer School reachable and uses full-row in-app navigation", async () => {
    await renderFeed(feedProps());

    fireEvent.press(screen.getByTestId("announcements-source-filter"));
    fireEvent.press(within(screen.getByTestId("bottom-sheet")).getByRole("button", { name: "YÖK sayfasını aç" }));
    fireEvent.press(screen.getByTestId("announcements-source-filter"));
    fireEvent.press(within(screen.getByTestId("bottom-sheet")).getByRole("button", { name: "Yaz Okulu sayfasını aç" }));
    expect(callbacks.onOpenYok).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenSummerSchool).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", {
      name: /Ders kayıt takvimi açıklandı.*Ayrıntıyı aç/iu,
    }));
    expect(callbacks.onOpenItem).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "announcement",
        record: expect.objectContaining({ id: "registration" }),
      }),
    );

    fireEvent.press(screen.getByTestId("announcements-source-filter"));
    fireEvent.press(within(screen.getByTestId("bottom-sheet")).getByRole("radio", { name: "YÖK kaynak filtresi" }));
    expect(renderedTitles()).toEqual(["YÖK öğrenci bilgilendirmesi"]);
  });

  it.each([
    {
      name: "initial loading",
      props: { loading: true, attempted: false },
      heading: null,
      progress: "Duyurular yükleniyor",
    },
    {
      name: "genuine empty",
      props: { attempted: true },
      heading: "Henüz güvenilir içerik yok",
      progress: null,
    },
    {
      name: "recoverable error",
      props: { attempted: true, error: "Bağlantı kurulamadı" },
      heading: "Duyurular yüklenemedi",
      progress: null,
    },
    {
      name: "offline",
      props: { attempted: true, offline: true },
      heading: "Çevrimdışısın",
      progress: null,
    },
    {
      name: "zero-item partial source failure",
      props: { attempted: true, partial: true },
      heading: "Bazı kaynaklara ulaşılamadı",
      progress: null,
    },
  ])("renders an exclusive $name state without empty/error overlap", async ({ props, heading, progress }) => {
    await renderFeed(feedProps({
      academicItems: [],
      yokItems: [],
      summerItems: [],
      ...props,
    }));

    if (heading) expect(screen.getByRole("header", { name: heading })).toBeOnTheScreen();
    if (progress) {
      expect(screen.getByLabelText(progress).props.accessibilityState).toEqual({ busy: true });
      expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    } else {
      expect(screen.queryByRole("progressbar")).not.toBeOnTheScreen();
    }
    expect(screen.queryByRole("header", { name: "Bu filtrelerde sonuç yok" })).not.toBeOnTheScreen();
    if (heading !== "Henüz güvenilir içerik yok") {
      expect(screen.queryByRole("header", { name: "Henüz güvenilir içerik yok" })).not.toBeOnTheScreen();
    }
  });

  it("derives offline state from the native network hook when no override is supplied", async () => {
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: false,
      isInternetReachable: false,
      type: "NONE",
    });
    await renderFeed(feedProps({
      academicItems: [],
      yokItems: [],
      summerItems: [],
      offline: undefined,
    }));
    expect(screen.getByRole("header", { name: "Çevrimdışısın" })).toBeOnTheScreen();
  });

  it.each([
    { state: "stale", props: { stale: true, error: "Kaynak yenilenemedi" }, banner: "Son doğrulanan içerikler gösteriliyor" },
    { state: "partial", props: { partial: true }, banner: "Bazı kaynaklara ulaşılamadı" },
    { state: "offline", props: { offline: true }, banner: "Çevrimdışısın" },
    { state: "refresh", props: { loading: true }, banner: "İçerikler yenileniyor" },
  ])("retains trusted rows during $state availability", async ({ props, banner }) => {
    await renderFeed(feedProps(props));
    expect(screen.getByText(banner)).toBeOnTheScreen();
    expect(screen.getByText("Ders kayıt takvimi açıklandı")).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "Duyurular yüklenemedi" })).not.toBeOnTheScreen();
  });

  it("supports pull refresh, controlled pagination, and pagination retry without hiding rows", async () => {
    await renderFeed(feedProps({ hasMore: true, paginationLoading: true }));
    const list = screen.getByTestId(/^announcements-feed-/u);
    expect(list.props.refreshing).toBe(false);
    expect(list.props.onRefresh).toBe(callbacks.onRefresh);
    expect(screen.getByLabelText("Daha fazla içerik yükleniyor")).toBeOnTheScreen();
    act(() => list.props.onEndReached());
    expect(callbacks.onLoadMore).not.toHaveBeenCalled();

  });

  it("loads the next page at the end and offers a controlled retry after failure", async () => {
    const view = await renderFeed(feedProps({ hasMore: true }));
    act(() => screen.getByTestId(/^announcements-feed-/u).props.onEndReached());
    expect(callbacks.onLoadMore).toHaveBeenCalledTimes(1);
    await view.rerenderAsync(
      <SafeAreaProvider>
        <ThemeProvider platform="android" preference="light" reducedMotion windowWidth={320}>
          <AnnouncementsFeed {...feedProps({
            hasMore: true,
            paginationError: "Daha fazla içerik yüklenemedi",
          })} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByText("Daha fazla içerik yüklenemedi")).toBeOnTheScreen();
    expect(screen.getByText("Ders kayıt takvimi açıklandı")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(callbacks.onRetryPagination).toHaveBeenCalledTimes(1);
  });

  it("selects Android/iOS markers at 320 dp and 200% text without glass feed rows", async () => {
    const android = await renderFeed(feedProps(), "android");
    expect(screen.getByTestId(/announcements-feed-android-stacked-large-text/u)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Duyurular" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Güvenilir akademik içerik akışı").props.accessibilityState)
      .toEqual({ busy: false });
    await android.unmountAsync();

    await renderFeed(feedProps(), "ios");
    expect(screen.getByTestId(/announcements-feed-ios-stacked-large-text/u)).toBeOnTheScreen();
    expect(screen.queryByTestId("mock-liquid-glass")).not.toBeOnTheScreen();
    for (const label of ["Beğen", "Yorum yap", "Yeniden paylaş", "Bağlantı sayısı"]) {
      expect(screen.queryByText(label)).not.toBeOnTheScreen();
    }
  });

  it("does not log or persist raw search text", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(
        __dirname,
        "../../src/announcements/AnnouncementsFeed.tsx",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/console\.|AsyncStorage|SecureStore|localStorage/iu);
  });
});
