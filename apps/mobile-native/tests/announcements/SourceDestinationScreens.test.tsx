import { readFileSync } from "node:fs";
import { useNetworkState } from "expo-network";
import {
  fireEvent,
  screen,
} from "@testing-library/react-native";
import { FlatList, SectionList, StyleSheet, Text } from "react-native";
import {
  SummerSchoolScreen,
  YokAnnouncementsScreen,
  type SummerSchoolScreenProps,
  type YokAnnouncementsScreenProps,
} from "../../src/announcements/SourceDestinationScreens";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";
import { darkTheme } from "../../src/design-system";
import { renderWithTheme } from "../design-system/test-utils";

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

function record(
  id: string,
  overrides: Partial<TrustedMobileContentRecord> = {},
): TrustedMobileContentRecord {
  const canonicalUrl = `https://example.edu.tr/duyurular/${id}`;
  return {
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
    publicationKind: "date",
    publishedDate: "2026-08-01",
    freshness: "fresh",
    trustStatus: "trusted",
    ...overrides,
  };
}

const yokRecord = record("yok", {
  sourceId: "yok-source",
  sourceName: "Yükseköğretim Kurulu",
  title: "YÖK öğrenci bilgilendirmesi",
  canonicalUrl: "https://www.yok.gov.tr/duyurular/yok",
  link: "https://www.yok.gov.tr/duyurular/yok",
  officialSourceUrl: "https://www.yok.gov.tr/duyurular",
});

const yokCallbacks = {
  onOpenItem: jest.fn(),
  onRefresh: jest.fn(),
};

function yokProps(
  overrides: Partial<YokAnnouncementsScreenProps> = {},
): YokAnnouncementsScreenProps {
  return {
    attempted: true,
    collectionState: "fresh",
    error: undefined,
    items: [yokRecord],
    loading: false,
    offline: false,
    onOpenItem: yokCallbacks.onOpenItem,
    onRefresh: yokCallbacks.onRefresh,
    stale: false,
    ...overrides,
  };
}

const summerCallbacks = {
  onOpenAnnouncement: jest.fn(),
  onOpenOfficialSource: jest.fn(),
  onRefresh: jest.fn(),
};

function summerProps(
  overrides: Partial<SummerSchoolScreenProps> = {},
): SummerSchoolScreenProps {
  return {
    announcements: [record("summer", { title: "Yaz okulu başvuruları" })],
    calendarAttempted: true,
    calendarError: undefined,
    calendarLoading: false,
    calendarStale: false,
    contentAttempted: true,
    contentError: undefined,
    contentLoading: false,
    contentStale: false,
    contentState: "fresh",
    events: [{
      id: "summer-date",
      title: "Yaz okulu kayıt dönemi",
      category: "summer_school_registration",
      startDate: "2026-07-14",
      endDate: "2026-07-18",
      temporalKind: "date",
      endTemporalKind: "date",
    }],
    offline: false,
    onOpenAnnouncement: summerCallbacks.onOpenAnnouncement,
    onOpenOfficialSource: summerCallbacks.onOpenOfficialSource,
    onRefresh: summerCallbacks.onRefresh,
    requirements: [{
      eventId: "requirement-1",
      message: "Not dökümünü resmî başvuru formuna ekle.",
      date: "2026-07-10",
      sourceUrl: "https://example.edu.tr/yaz-okulu/basvuru",
    }],
    sameDepartmentOptions: [{
      universityId: "university-2",
      universityName: "Başka Üniversite",
      academicYear: "2025-2026",
      sourceUrl: "https://other.edu.tr/yaz-okulu",
      events: [],
      matchingDepartments: [{
        facultyId: "faculty-2",
        facultyName: "Mühendislik Fakültesi",
        departmentId: "department-2",
        departmentName: "Bilgisayar Mühendisliği",
        educationLevel: "undergraduate",
      }],
    }],
    universityName: "Örnek Üniversitesi",
    universitySelected: true,
    ...overrides,
  };
}

describe("semantic Summer School and YÖK destinations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindowDimensions.mockReturnValue({ fontScale: 2, height: 640, scale: 2, width: 320 });
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it("renders the YÖK route as one dark-safe virtualized list at 320 dp and 200% text", async () => {
    await renderWithTheme(
      <YokAnnouncementsScreen {...yokProps({ collectionState: "partial" })} />,
      { preference: "dark", windowWidth: 320 },
    );

    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.initialNumToRender).toBe(12);
    expect(list.props.maxToRenderPerBatch).toBe(12);
    expect(list.props.windowSize).toBe(7);
    expect(screen.getByTestId("yok-destination-16-large-text")).toBeVisible();
    expect(StyleSheet.flatten(screen.getByTestId("yok-destination-16-large-text").props.style)).toMatchObject({
      backgroundColor: darkTheme.colors.background.canvas,
    });
    expect(screen.getByText("Bazı YÖK kaynaklarına ulaşılamadı")).toBeVisible();

    fireEvent.press(screen.getByRole("button", { name: /Yükseköğretim Kurulu.*YÖK öğrenci bilgilendirmesi.*Ayrıntıyı aç/u }));
    expect(yokCallbacks.onOpenItem).toHaveBeenCalledWith(yokRecord);
    fireEvent.press(screen.getByRole("button", { name: "YÖK duyurularını yenile" }));
    expect(yokCallbacks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps YÖK loading, retained-error, offline, and empty states mutually exclusive", async () => {
    let view = await renderWithTheme(
      <YokAnnouncementsScreen {...yokProps({ attempted: false, items: [], loading: true })} />,
    );
    expect(screen.getByRole("progressbar", { name: "YÖK duyuruları yükleniyor" })).toBeVisible();
    expect(screen.queryByText("YÖK duyurusu bulunamadı")).toBeNull();

    await view.unmountAsync();
    view = await renderWithTheme(
      <YokAnnouncementsScreen {...yokProps({ error: "Kaynak zaman aşımına uğradı", items: [] })} />,
    );
    expect(screen.getByText("YÖK duyuruları yüklenemedi")).toBeVisible();
    expect(screen.getByText("Kaynak zaman aşımına uğradı")).toBeVisible();

    await view.unmountAsync();
    view = await renderWithTheme(
      <YokAnnouncementsScreen {...yokProps({ items: [], loading: true, offline: true })} />,
    );
    expect(screen.getByText("Çevrimdışısın")).toBeVisible();
    expect(screen.queryByText("YÖK duyuruları yüklenemedi")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();

    await view.unmountAsync();
    await renderWithTheme(
      <YokAnnouncementsScreen {...yokProps({ items: [] })} />,
    );
    expect(screen.getByText("YÖK duyurusu bulunamadı")).toBeVisible();
    expect(screen.queryByText("Çevrimdışısın")).toBeNull();
  });

  it("virtualizes every Summer School section and preserves date-only and trusted-link behavior", async () => {
    await renderWithTheme(
      <SummerSchoolScreen {...summerProps({ contentState: "partial" })} />,
      { preference: "dark", windowWidth: 320 },
    );

    const list = screen.UNSAFE_getByType(SectionList);
    expect(list.props.sections).toHaveLength(3);
    expect(list.props.initialNumToRender).toBe(14);
    expect(list.props.maxToRenderPerBatch).toBe(14);
    expect(list.props.windowSize).toBe(7);
    expect(screen.getByTestId("summer-destination-16-large-text")).toBeVisible();
    expect(screen.getByText("14 Temmuz 2026 – 18 Temmuz 2026")).toBeVisible();
    expect(screen.queryByText(/00:00/u)).toBeNull();
    expect(screen.getByText("Bazı yaz okulu kaynaklarına ulaşılamadı")).toBeVisible();

    fireEvent.press(screen.getByRole("link", { name: /Başvuru koşulu.*Not dökümünü.*Resmî kaynağı aç/u }));
    expect(summerCallbacks.onOpenOfficialSource).toHaveBeenCalledWith("https://example.edu.tr/yaz-okulu/basvuru");
    fireEvent.press(screen.getByRole("button", { name: /Yaz okulu duyurusu.*Yaz okulu başvuruları.*Ayrıntıyı aç/u }));
    expect(summerCallbacks.onOpenAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ id: "summer" }));
    fireEvent.press(screen.getByRole("link", { name: /Başka Üniversite.*Resmî kaynağı aç/u }));
    expect(summerCallbacks.onOpenOfficialSource).toHaveBeenCalledWith("https://other.edu.tr/yaz-okulu");
  });

  it("chooses one retained status per Summer School source when flags overlap", async () => {
    let view = await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          calendarError: "Takvim hatası",
          calendarLoading: true,
          calendarStale: true,
          contentError: "İçerik hatası",
          contentLoading: true,
          contentStale: true,
          contentState: "partial",
        })}
      />,
    );

    expect(screen.getByText("Takvim tarihleri yenileniyor")).toBeVisible();
    expect(screen.getByText("Yaz okulu kaynakları yenileniyor")).toBeVisible();
    expect(screen.queryByText("Takvim tarihleri yenilenemedi")).toBeNull();
    expect(screen.queryByText("Yaz okulu kaynakları yenilenemedi")).toBeNull();
    expect(screen.queryByText("Bazı yaz okulu kaynaklarına ulaşılamadı")).toBeNull();

    await view.unmountAsync();
    view = await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          calendarError: "Takvim hatası",
          calendarStale: true,
          contentError: "İçerik hatası",
          contentStale: true,
          contentState: "partial",
        })}
      />,
    );
    expect(screen.getByText("Takvim tarihleri yenilenemedi")).toBeVisible();
    expect(screen.getByText("Yaz okulu kaynakları yenilenemedi")).toBeVisible();
    expect(screen.queryByText("Bazı yaz okulu kaynaklarına ulaşılamadı")).toBeNull();
    await view.unmountAsync();
  });

  it("prioritizes Summer School offline state over simultaneous loading flags", async () => {
    await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          announcements: [],
          calendarLoading: true,
          contentLoading: true,
          events: [],
          offline: true,
          requirements: [],
          sameDepartmentOptions: [],
        })}
      />,
    );

    expect(screen.getAllByText("Çevrimdışısın").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "Yaz okulunu yenile" })).toBeDisabled();
  });

  it("uses truthful Summer School source-state titles and counts requirements", async () => {
    let view = await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          announcements: [],
          calendarAttempted: false,
          calendarLoading: true,
          contentAttempted: false,
          contentLoading: true,
          events: [],
          requirements: [],
          sameDepartmentOptions: [],
        })}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Yaz okulu tarihleri yükleniyor" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Yaz okulu duyuruları yükleniyor" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Aynı bölüm seçenekleri yükleniyor" })).toBeVisible();
    expect(screen.queryByText(/yok yükleniyor/u)).toBeNull();
    expect(screen.queryByText(/bulunamadı yükleniyor/u)).toBeNull();

    await view.unmountAsync();
    view = await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          announcements: [],
          calendarAttempted: false,
          contentAttempted: false,
          events: [],
          requirements: [],
          sameDepartmentOptions: [],
        })}
      />,
    );
    expect(screen.getByText("Yaz okulu tarihleri henüz yüklenmedi")).toBeVisible();
    expect(screen.getByText("Yaz okulu duyuruları henüz yüklenmedi")).toBeVisible();
    expect(screen.getByText("Aynı bölüm seçenekleri henüz yüklenmedi")).toBeVisible();

    await view.unmountAsync();
    await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          announcements: [],
          events: [],
          requirements: [{ message: "Resmî başvuru belgesini yükle." }],
          sameDepartmentOptions: [],
        })}
      />,
    );
    expect(screen.getByLabelText("1 kayıt")).toBeVisible();
    expect(screen.queryByLabelText("0 kayıt")).toBeNull();
  });

  it("renders route feedback before destination content", async () => {
    await renderWithTheme(
      <YokAnnouncementsScreen
        {...yokProps()}
        feedback={<Text>Bildirim hedefi artık kullanılamıyor</Text>}
      />,
    );
    expect(screen.getByText("Bildirim hedefi artık kullanılamıyor")).toBeVisible();
  });

  it("keeps Summer School refresh disabled until an academic university exists", async () => {
    await renderWithTheme(
      <SummerSchoolScreen
        {...summerProps({
          announcements: [],
          events: [],
          requirements: [],
          sameDepartmentOptions: [],
          universityName: undefined,
          universitySelected: false,
        })}
      />,
    );

    expect(screen.getByText("Üniversite seçildiğinde hazır")).toBeVisible();
    expect(screen.getByRole("button", { name: "Yaz okulunu yenile" })).toBeDisabled();
    expect(screen.UNSAFE_getByType(SectionList).props.sections).toEqual([]);
  });

  it("contains no route-local raw color system or nested ScrollView fallback", () => {
    const source = readFileSync(
      "src/announcements/SourceDestinationScreens.tsx",
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-f]{3,8}/iu);
    expect(source).not.toMatch(/\bScrollView\b/u);
    expect(source).toContain("FlatList");
    expect(source).toContain("SectionList");
  });
});
