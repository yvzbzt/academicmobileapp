import { useNetworkState } from "expo-network";
import { useScrollToTop } from "@react-navigation/native";
import {
  act,
  fireEvent,
  renderAsync,
  screen,
  within,
} from "@testing-library/react-native";
import { AccessibilityInfo, FlatList, Keyboard } from "react-native";
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
  onOpenOfficialSource: jest.fn(),
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
    universityId: "university-1",
    universityName: "Örnek Üniversitesi",
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
    facultyId: "faculty-1",
    facultyName: "Mühendislik Fakültesi",
    title: "Burs başvurusu belge listesi",
    publishedAt: undefined,
    sourceUpdatedAt: "2026-08-01T08:00:00.000Z",
  }),
  record("research-event", {
    sourceName: "Bilgisayar Mühendisliği Bölümü",
    contentType: "event",
    scopeType: "department",
    scopeId: "department-1",
    facultyId: "faculty-1",
    facultyName: "Mühendislik Fakültesi",
    departmentId: "department-1",
    departmentName: "Bilgisayar Mühendisliği Bölümü",
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
    notificationPreferenceEnabled: false,
    notificationActive: false,
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

  it("reserves the measured bottom-tab height without inventing empty-state content", async () => {
    await renderFeed(feedProps({ academicItems: [], yokItems: [], summerItems: [] }));

    const list = screen.getByTestId(/^announcements-feed-/u);
    expect(list.props.contentContainerStyle).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 84 })]),
    );
    expect(screen.getByRole("header", { name: "Henüz güvenilir içerik yok" })).toBeOnTheScreen();
    expect(screen.queryByTestId(/^announcement-feed-item-/u)).not.toBeOnTheScreen();
  });

  it("renders the reference top bar, compact search/filter rails, and actionable reminder artwork", async () => {
    await renderFeed(feedProps());

    expect(screen.getByTestId(/^announcements-feed-/u)).toHaveProp(
      "keyboardShouldPersistTaps",
      "handled",
    );
    expect(screen.getByTestId(/^announcements-feed-/u)).toHaveProp(
      "keyboardDismissMode",
      "on-drag",
    );
    expect(screen.getByTestId("announcements-top-bar")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Duyurular" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Duyurular" }).props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByRole("header", { name: "Duyurular" }).props.numberOfLines).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Hesap menüsünü aç" })).not.toBeOnTheScreen();
    expect(screen.getByTestId("announcements-search-frame")).toBeOnTheScreen();
    expect(screen.getByRole("search", { name: "Duyurularda ara" }).props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByText("Ders kayıt takvimi açıklandı").props.numberOfLines).toBeUndefined();
    expect(screen.getByText("Güvenilir özet registration").props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId("announcements-reminder-banner")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Bildirim tercihlerini aç" }));
    expect(callbacks.onOpenNotificationSettings).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("button", {
      name: "Hiçbir duyuruyu kaçırma. Bildirimleri aç.",
    }));
    expect(callbacks.onOpenNotificationSettings).toHaveBeenCalledTimes(2);
  });

  it("dismisses search before opening filters or submitting the query", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
    try {
      await renderFeed(feedProps());

      fireEvent.press(screen.getByTestId("announcements-content-filter"));
      expect(dismiss).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByLabelText("Alt sayfayı kapat"));
      fireEvent(screen.getByRole("search", { name: "Duyurularda ara" }), "submitEditing");
      expect(dismiss).toHaveBeenCalledTimes(2);
    } finally {
      dismiss.mockRestore();
    }
  });

  it("uses the compact reference card hierarchy at standard phone width without hiding source context from accessibility", async () => {
    mockWindowDimensions.mockReturnValue({
      fontScale: 1,
      height: 891,
      scale: 2.625,
      width: 411,
    });
    await renderFeed(feedProps());

    expect(screen.getByTestId(/announcements-feed-android-wrapped-standard-text/u))
      .toBeOnTheScreen();
    expect(screen.getByTestId("announcements-search-frame")).toHaveStyle({ minHeight: 52 });

    const expectedCards = [
      {
        title: "Ders kayıt takvimi açıklandı",
        provenance: "Duyuru · Örnek Üniversitesi · Üniversite geneli",
        openAction: "Duyuru ayrıntısını aç",
      },
      {
        title: "Burs başvurusu belge listesi",
        provenance: "Haber · Örnek Üniversitesi · Fakülte · Mühendislik Fakültesi",
        openAction: "Haber ayrıntısını aç",
      },
      {
        title: "Araştırma etkinliği",
        provenance: "Etkinlik · Örnek Üniversitesi · Bölüm · Bilgisayar Mühendisliği Bölümü",
        openAction: "Etkinlik ayrıntısını aç",
      },
    ] as const;
    for (const { title, provenance, openAction } of expectedCards) {
      const contentRow = screen.getByRole("link", {
        name: new RegExp(`${title}.*${openAction}`, "u"),
      });
      expect(within(contentRow).getByText(provenance, { includeHiddenElements: true }))
        .toBeOnTheScreen();
      expect(contentRow.props.accessibilityLabel).toContain(provenance);
      expect(contentRow.props.accessibilityLabel).toContain(openAction);
    }

    const row = screen.getAllByRole("link", {
      name: /Örnek Üniversitesi Öğrenci İşleri.*Ders kayıt takvimi açıklandı.*example\.edu\.tr.*Duyuru ayrıntısını aç/iu,
    })[0]!;
    expect(row).toHaveStyle({ minHeight: 148 });
    expect(within(row).getByText("Ders kayıt takvimi açıklandı"))
      .toHaveProp("numberOfLines", 3);
    expect(within(row).getByText("Güvenilir özet registration"))
      .toHaveProp("numberOfLines", 3);
    expect(within(row).getByText("Örnek Üniversitesi Öğrenci İşleri"))
      .toBeOnTheScreen();
    expect(row.props.accessibilityLabel).toContain("Örnek Üniversitesi Öğrenci İşleri");
  });

  it("shows only genuinely short source text and omits long or missing copy", async () => {
    const shortSummary = "K".repeat(280);
    const longSummary = "U".repeat(281);
    await renderFeed(feedProps({
      academicItems: [
        record("short-copy", { summary: shortSummary }),
        record("long-copy", { summary: longSummary }),
        record("missing-copy", { summary: undefined }),
      ],
      yokItems: [],
      summerItems: [],
    }));

    expect(screen.getByText(shortSummary)).toBeOnTheScreen();
    expect(screen.queryByText(longSummary)).not.toBeOnTheScreen();
    expect(screen.getAllByText("Ayrıntıyı gör")).toHaveLength(2);
    expect(screen.getAllByText("Resmî kaynağa git")).toHaveLength(1);
  });

  it("classifies card dates without inventing an end date or a deadline", async () => {
    await renderFeed(feedProps({
      academicItems: [
        record("date-range", {
          keyDates: [{ label: "Final Sınavları", startDate: "2026-06-23", endDate: "2026-07-04" }],
        }),
        record("single-deadline", {
          keyDates: [{ label: "Başvuru son tarihi", startDate: "2026-05-24" }],
        }),
        record("single-date", {
          keyDates: [{ label: "Tanıtım toplantısı", startDate: "2026-08-11" }],
        }),
      ],
      yokItems: [],
      summerItems: [],
    }));

    expect(screen.getByText("Final Sınavları · 23 Haziran 2026 – 04 Temmuz 2026"))
      .toBeOnTheScreen();
    expect(screen.getByText("Başvuru son tarihi · 24 Mayıs 2026")).toBeOnTheScreen();
    expect(screen.getByText("Tanıtım toplantısı · 11 Ağustos 2026")).toBeOnTheScreen();
    expect(screen.queryByText(/Son gün:/iu)).not.toBeOnTheScreen();
    expect(screen.getAllByText(/Yayınlandı/iu)).toHaveLength(3);
  });

  it("shows the reminder only for an actionable notification state that needs attention", async () => {
    const active = await renderFeed(feedProps({
      notificationPreferenceEnabled: true,
      notificationActive: true,
    }));
    expect(screen.queryByTestId("announcements-reminder-banner")).not.toBeOnTheScreen();
    await active.unmountAsync();

    const incomplete = await renderFeed(feedProps({
      notificationPreferenceEnabled: true,
      notificationActive: false,
    }));
    expect(screen.getByTestId("announcements-reminder-banner")).toBeOnTheScreen();
    expect(screen.getByRole("button", {
      name: "Bildirim tercihin açık ancak bu cihazda etkin değil. Bildirim ayarlarını aç.",
    })).toBeOnTheScreen();
    await incomplete.unmountAsync();

    await renderFeed(feedProps({
      notificationPreferenceEnabled: false,
      notificationActive: false,
      onOpenNotificationSettings: undefined,
    }));
    expect(screen.queryByTestId("announcements-reminder-banner")).not.toBeOnTheScreen();
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

  it("uses one visible source rail and a compact content filter sheet with selected semantics", async () => {
    await renderFeed(feedProps());

    expect(screen.getByRole("header", { name: "Kaynak" })).toBeOnTheScreen();
    expect(screen.getByTestId("announcements-source-filter-rail")).toBeOnTheScreen();
    expect(screen.queryByTestId("announcements-content-filter-rail")).not.toBeOnTheScreen();
    expect(screen.queryByRole("radio", {
      name: "Haberler içerik türü filtresi",
    })).not.toBeOnTheScreen();
    const filterTrigger = screen.getByTestId("announcements-content-filter");
    expect(filterTrigger.props.accessibilityState).toEqual({ expanded: false });
    expect(filterTrigger).toHaveStyle({ height: 48, width: 48 });

    fireEvent.press(filterTrigger);
    expect(screen.getByRole("header", { name: "İçerik türü" })).toBeOnTheScreen();
    const newsFilter = within(screen.getByTestId("bottom-sheet")).getByRole("radio", {
      name: "Haberler içerik türü filtresi",
    });
    fireEvent.press(newsFilter);
    expect(renderedTitles()).toEqual(["Burs başvurusu belge listesi"]);

    fireEvent.press(screen.getByTestId("announcements-content-filter"));
    const selectedNewsFilter = within(screen.getByTestId("bottom-sheet")).getByRole("radio", {
      name: "Haberler içerik türü filtresi",
    });
    expect(selectedNewsFilter.props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByLabelText("Alt sayfayı kapat"));

    const facultyFilter = screen.getByRole("button", {
      name: "Fakültem kaynak filtresi",
    });
    fireEvent.press(facultyFilter);
    expect(facultyFilter.props.accessibilityState).toEqual({ selected: true });
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
      expect(screen.getByTestId(/^announcements-feed-/u)).toHaveProp(
        "keyboardDismissMode",
        "interactive",
      );

      fireEvent.press(screen.getByTestId("announcements-content-filter"));
      fireEvent.press(within(screen.getByTestId("bottom-sheet")).getByRole("radio", {
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

  it("keeps YÖK and Summer School reachable and opens rich content in its in-app detail", async () => {
    await renderFeed(feedProps());

    fireEvent.press(screen.getByTestId("announcements-content-filter"));
    const yokDestination = within(screen.getByTestId("bottom-sheet")).getByRole("button", { name: "YÖK sayfasını aç" });
    expect(yokDestination).toHaveStyle({ height: 48, width: 48 });
    fireEvent.press(yokDestination);
    fireEvent.press(screen.getByTestId("announcements-content-filter"));
    fireEvent.press(within(screen.getByTestId("bottom-sheet")).getByRole("button", { name: "Yaz Okulu sayfasını aç" }));
    expect(callbacks.onOpenYok).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenSummerSchool).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole("link", {
      name: /Ders kayıt takvimi açıklandı.*Duyuru ayrıntısını aç/iu,
    }));
    expect(callbacks.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({
      record: expect.objectContaining({ id: "registration" }),
    }));
    expect(callbacks.onOpenOfficialSource).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole("button", { name: "YÖK kaynak filtresi" }));
    expect(renderedTitles()).toEqual(["YÖK öğrenci bilgilendirmesi"]);
  });

  it("opens the exact official URL when a trusted item has no in-app detail fields", async () => {
    await renderFeed(feedProps({
      academicItems: [record("source-only", {
        summary: undefined,
        body: undefined,
        keyDates: undefined,
      })],
      yokItems: [],
      summerItems: [],
    }));

    fireEvent.press(screen.getByRole("link", {
      name: /Güvenilir duyuru source-only.*Resmî duyuruyu aç/iu,
    }));
    expect(callbacks.onOpenOfficialSource).toHaveBeenCalledWith(
      "https://example.edu.tr/duyurular/source-only",
    );
    expect(callbacks.onOpenItem).not.toHaveBeenCalled();
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
