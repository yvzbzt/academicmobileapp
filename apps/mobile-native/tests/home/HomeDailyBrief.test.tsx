import { NavigationContainer, useScrollToTop } from "@react-navigation/native";
import { fireEvent, renderAsync, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HomeDailyBrief, type HomeDailyBriefProps } from "../../src/home/HomeDailyBrief";
import { ThemeProvider } from "../../src/design-system";
import type { TrustedMobileContentRecord } from "../../src/content/content-trust";

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return { ...actual, useScrollToTop: jest.fn() };
});

const mockWindowDimensions = jest.fn(() => ({
  fontScale: 2,
  height: 568,
  scale: 2,
  width: 320,
}));

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindowDimensions(),
}));

const now = new Date(2026, 7, 1, 10, 0, 0);
const callbacks = {
  onCompleteProfile: jest.fn(),
  onOpenAccountMenu: jest.fn(),
  onOpenAnnouncement: jest.fn(),
  onOpenAnnouncements: jest.fn(),
  onOpenCalendar: jest.fn(),
  onCreatePersonalEvent: jest.fn(),
  onOpenGoogleCalendarSettings: jest.fn(),
  onOpenNotificationSettings: jest.fn(),
  onRefresh: jest.fn(),
};

function content(overrides: Partial<TrustedMobileContentRecord> = {}): TrustedMobileContentRecord {
  const candidate = {
    id: "announcement-1",
    sourceId: "source-1",
    sourceName: "Öğrenci İşleri Daire Başkanlığı",
    scopeType: "university",
    scopeId: "university-1",
    title: "2026-2027 eğitim öğretim yılı kayıt takvimi açıklandı",
    summary: "Kayıt tarihleri ve öğrenci işlemleri için kısa bilgilendirme.",
    link: "https://example.edu.tr/duyuru/kayit",
    canonicalUrl: "https://example.edu.tr/duyuru/kayit",
    officialSourceUrl: "https://example.edu.tr/duyurular",
    publishedAt: "2026-08-01T07:00:00.000Z",
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

function props(overrides: Partial<HomeDailyBriefProps> = {}): HomeDailyBriefProps {
  return {
    fullName: "Deniz Yılmaz",
    profileComplete: true,
    universityName: "Örnek Üniversitesi",
    facultyName: "Mühendislik Fakültesi",
    departmentName: "Bilgisayar Mühendisliği",
    events: [{
      id: "event-today",
      title: "Ders kayıtları",
      category: "course_registration",
      startDate: new Date(2026, 7, 1, 13).toISOString(),
    }, {
      id: "event-upcoming-registration",
      title: "Ekle bırak haftası",
      category: "course_add_drop",
      startDate: "2026-08-03",
      temporalKind: "date",
    }, {
      id: "event-upcoming-application",
      title: "Burs Başvuruları",
      category: "scholarship_application",
      startDate: "2026-08-04",
      temporalKind: "date",
    }, {
      id: "event-upcoming-term",
      title: "Güz Dönemi Ders Başlangıcı",
      category: "semester_start",
      startDate: "2026-08-05",
      temporalKind: "date",
    }],
    manualExams: [],
    announcements: [
      content(),
      content({ id: "announcement-2", canonicalUrl: "https://example.edu.tr/duyuru/iki", link: "https://example.edu.tr/duyuru/iki", title: "Burs başvuruları için güncel belge listesi", sourceUpdatedAt: "2026-07-31T07:00:00.000Z", publishedAt: undefined }),
    ],
    calendarLoading: false,
    calendarAttempted: true,
    announcementLoading: false,
    announcementAttempted: true,
    announcementState: "fresh",
    googleCalendarState: "connected",
    notificationPermission: "granted",
    notificationPreferenceEnabled: true,
    notificationActive: true,
    now,
    ...callbacks,
    ...overrides,
  };
}

async function renderHome(input: HomeDailyBriefProps, platform: "ios" | "android" = "android") {
  return renderAsync(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider
        liquidGlassAvailable={platform === "ios"}
        platform={platform}
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={320}
      >
        <NavigationContainer>
          <HomeDailyBrief {...input} />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe("Phase 7 Home daily brief", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders an exclusive incomplete-profile state without misleading dashboards", async () => {
    await renderHome(props({ profileComplete: false, universityName: undefined, events: [], announcements: [], calendarLoading: true, calendarAttempted: false, announcementLoading: true, announcementAttempted: false }));
    expect(screen.getByRole("header", { name: "Akademik profilin eksik" })).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar")).not.toBeOnTheScreen();
    expect(screen.queryByText("Bugün gündemin sakin")).not.toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Akademik profili tamamla" }));
    expect(callbacks.onCompleteProfile).toHaveBeenCalledTimes(1);
  });

  it("registers its virtualized list for Home-tab re-selection scroll-to-top", async () => {
    await renderHome(props());
    expect(useScrollToTop).toHaveBeenCalledWith(expect.objectContaining({ current: expect.anything() }));
  });

  it("renders the branded hierarchy with avatar-owned account access and the weekly dashboard", async () => {
    await renderHome(props());

    expect(screen.getByTestId("home-top-bar")).toBeOnTheScreen();
    expect(screen.queryByTestId("notification-attention-indicator")).toBeNull();
    expect(screen.queryByRole("header", { name: "Ana Sayfa" })).toBeNull();
    expect(screen.getByText("Akademik Takvim")).toBeOnTheScreen();
    expect(screen.getByText("Sıradaki Etkinlik")).toBeOnTheScreen();
    expect(screen.getByTestId("home-focus-card")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Haftalık Takvim" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Bu hafta 1 önemli tarih/u })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Senin için" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Kişisel etkinlik ekle" })).toBeOnTheScreen();
    expect(screen.getAllByText(/Ağustos 2026/u).some((node) => node.props.numberOfLines === 1)).toBe(true);
    expect(screen.getByRole("header", { name: "Önemli duyuru" })).toHaveTextContent("Öne çıkan duyurular");

    fireEvent.press(screen.getByRole("button", { name: "Hesap menüsünü aç" }));
    fireEvent.press(screen.getByRole("button", { name: "Bildirim tercihlerini aç" }));
    expect(callbacks.onOpenAccountMenu).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("anchors the week strip to now by default and accepts an explicit visual anchor", async () => {
    const defaultWeek = await renderHome(props());
    expect(screen.getByRole("button", { name: "CMT, 1 Ağustos. Takvimi aç." })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "PER, 27 Ağustos. Takvimi aç." })).toBeNull();
    await defaultWeek.unmountAsync();

    await renderHome(props({ weekAnchorDate: new Date(2026, 7, 27, 10, 0, 0) }));
    expect(screen.getByRole("button", { name: "PER, 27 Ağustos. Takvimi aç." })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "CMT, 1 Ağustos. Takvimi aç." })).toBeNull();
  });

  it("keeps the highlighted next item out of the agenda and backfills three distinct rows", async () => {
    const highlightedTitle = "Lisansüstü Programlara Yatay Geçiş Başvuruları";
    await renderHome(props({
      events: [{
        id: "highlighted",
        title: highlightedTitle,
        category: "horizontal_transfer",
        startDate: new Date(2026, 7, 1, 11).toISOString(),
      }, {
        id: "today-second",
        title: "Bugünkü ikinci önemli tarih",
        category: "course_registration",
        startDate: new Date(2026, 7, 1, 12).toISOString(),
      }, {
        id: "next-registration",
        title: "Ders Kayıtları",
        category: "course_registration",
        startDate: "2026-08-31",
        temporalKind: "date",
      }, {
        id: "next-scholarship",
        title: "Burs Başvuruları",
        category: "scholarship_application",
        startDate: "2026-09-01",
        temporalKind: "date",
      }, {
        id: "fourth-remaining",
        title: "Dördüncü kalan tarih",
        category: "semester_start",
        startDate: "2027-02-08",
        temporalKind: "date",
      }],
    }));

    expect(screen.getAllByText(highlightedTitle)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Bugünkü ikinci önemli tarih\./u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Ders Kayıtları\./u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Burs Başvuruları\./u })).toBeOnTheScreen();
    expect(screen.queryByText("Dördüncü kalan tarih")).not.toBeOnTheScreen();
  });

  it("keeps past starts out of future Home surfaces and removes page-count copy", async () => {
    await renderHome(props({
      now: new Date("2026-08-25T10:00:00.000Z"),
      announcements: [],
      events: [{
        id: "past-range",
        title: "SINAV TARİHLERİ",
        category: "final_exam",
        startDate: "2026-08-17",
        endDate: "2026-09-04",
        temporalKind: "date",
        endTemporalKind: "date",
      }, {
        id: "past-this-week",
        title: "Dün başlayan ders kayıtları",
        category: "course_registration",
        startDate: "2026-08-24",
        endDate: "2026-09-04",
        temporalKind: "date",
        endTemporalKind: "date",
      }, {
        id: "future-application",
        title: "8 of 10 -- Yabancı Diller Yüksekokulu başvurusu",
        category: "scholarship_application",
        startDate: "2026-08-26",
        temporalKind: "date",
      }, {
        id: "future-registration",
        title: "Ders kayıtları",
        category: "course_registration",
        startDate: "2026-08-27",
        temporalKind: "date",
      }],
    }));

    expect(screen.getByTestId("home-focus-card")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("Yabancı Diller Yüksekokulu başvurusu"),
    );
    expect(screen.queryByText(/8 of 10/iu)).not.toBeOnTheScreen();
    expect(screen.queryByText("SINAV TARİHLERİ")).not.toBeOnTheScreen();
    expect(screen.queryByText("Dün başlayan ders kayıtları")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Bu hafta 2 önemli tarih\./u }))
      .toHaveProp("accessibilityLabel", expect.stringContaining("1 başvuru · 1 kayıt"));
  });

  it("does not render an empty next-event card when only announcements are available", async () => {
    await renderHome(props({ events: [], manualExams: [] }));

    expect(screen.queryByTestId("home-focus-card")).not.toBeOnTheScreen();
    expect(screen.queryByText("Sıradaki Etkinlik")).not.toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Önemli duyuru" })).toBeOnTheScreen();
  });

  it("reserves the measured bottom-tab height below the last Home card", async () => {
    await renderHome(props());

    expect(screen.getByTestId(/^home-(?:android|ios)-/u).props.contentContainerStyle).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 84 })]),
    );
  });

  it("routes the personal-event CTA through its create intent instead of generic Calendar navigation", async () => {
    await renderHome(props());

    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik ekle" }));

    expect(callbacks.onCreatePersonalEvent).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenCalendar).not.toHaveBeenCalled();
  });

  it("shows notification attention only when the enabled preference is not active", async () => {
    await renderHome(props({ notificationActive: false }));

    expect(screen.getByTestId("notification-attention-indicator")).toBeOnTheScreen();
    expect(screen.getByRole("button", {
      name: "Bildirim tercihlerini aç. Bildirimlerin etkinleştirilmesi gerekiyor.",
    })).toBeOnTheScreen();
  });

  it("does not call the trusted announcement total new without an authoritative count", async () => {
    const defaultSummary = await renderHome(props());
    expect(screen.getByText("duyuru")).toBeOnTheScreen();
    expect(screen.queryByText("yeni")).not.toBeOnTheScreen();
    expect(screen.getByLabelText("Duyuru özeti")).toHaveProp(
      "accessibilityHint",
      "2 güncel duyuru bulunuyor.",
    );
    await defaultSummary.unmountAsync();

    await renderHome(props({ announcementNewCount: 1 }));
    expect(screen.getByText("yeni")).toBeOnTheScreen();
    expect(screen.getByLabelText("Duyuru özeti")).toHaveProp(
      "accessibilityHint",
      "1 yeni duyuru bulunuyor; toplam 2 güncel duyuru var.",
    );
  });

  it("bounds fixed focus-card typography at 320 dp and 200% font scale", async () => {
    const longTitle = "Lisansüstü programlara yatay geçiş başvuruları ve belge teslim süreci";
    await renderHome(props({
      events: [{
        category: "horizontal_transfer",
        id: "long-focus-event",
        startDate: new Date(2026, 7, 1, 13).toISOString(),
        title: longTitle,
      }],
    }));

    expect(screen.getByText("gün kaldı")).toHaveProp("maxFontSizeMultiplier", 1.25);
    expect(screen.getByText("gün kaldı")).toHaveProp("numberOfLines", 2);
    expect(screen.getByText("Akademik Takvim")).toHaveProp("adjustsFontSizeToFit", true);
    expect(screen.getByText("Sıradaki Etkinlik")).toHaveProp("maxFontSizeMultiplier", 1.3);
    const boundedHeroTitle = screen.getAllByText(longTitle).find(
      (node) => node.props.maxFontSizeMultiplier === 1.35,
    );
    expect(boundedHeroTitle).toBeDefined();
    expect(boundedHeroTitle).toHaveProp("numberOfLines", 2);
    expect(screen.getAllByText("13:00").some((node) => node.props.maxFontSizeMultiplier === 1.3)).toBe(true);
  });

  it("keeps compact Home controls inside real 48dp press targets", async () => {
    await renderHome(props({ facultyName: undefined, departmentName: undefined }));

    screen.getAllByRole("tab").forEach((filter) => {
      expect(filter).toHaveStyle({ minHeight: 48 });
    });
    expect(screen.getByRole("button", { name: "Takvimi gör" })).toHaveStyle({ minHeight: 48 });
    expect(screen.getByRole("button", { name: "Akademik profili tamamla" })).toHaveStyle({ minHeight: 48 });
  });

  it("announces the highlighted event title, schedule, remaining time, and destination", async () => {
    await renderHome(props({
      events: [{
        id: "accessible-focus",
        title: "Veri Yapıları Final Sınavı",
        category: "final_exam",
        startDate: new Date(2026, 7, 1, 13).toISOString(),
        endDate: new Date(2026, 7, 1, 15).toISOString(),
      }],
    }));

    expect(screen.getByTestId("home-focus-card")).toHaveProp(
      "accessibilityLabel",
      expect.stringMatching(/Veri Yapıları Final Sınavı.*Sınav.*13:00.*15:00.*3 saat kaldı.*Takvimi aç/u),
    );
  });

  it("keeps the incomplete-profile prompt compact and locally dismissible", async () => {
    await renderHome(props({ facultyName: undefined, departmentName: undefined }));

    expect(screen.getByTestId("home-profile-completion-card")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Akademik profili tamamla" })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Akademik profil önerisini kapat" }));

    expect(screen.queryByTestId("home-profile-completion-card")).not.toBeOnTheScreen();
    expect(callbacks.onCompleteProfile).not.toHaveBeenCalled();
  });

  it("renders explicit course and venue metadata without splitting the event title", async () => {
    await renderHome(props({
      events: [{
        id: "final-exam",
        title: "Veri Yapıları Final Sınavı",
        courseName: "Veri Yapıları",
        location: "Mühendislik Fak. – A Blok 201",
        category: "final_exam",
        startDate: new Date(2026, 7, 1, 13).toISOString(),
      }],
    }));

    expect(screen.getByText("Veri Yapıları")).toBeOnTheScreen();
    expect(screen.getByTestId("home-focus-card")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining("Mühendislik Fak. – A Blok 201"),
    );
    expect(screen.getAllByText("Veri Yapıları Final Sınavı").length).toBeGreaterThanOrEqual(1);
  });

  it("renders legacy custom_event records with consistent exam, application, and registration semantics", async () => {
    await renderHome(props({
      events: [
        {
          id: "application",
          title: "Lisansüstü Programlara Yatay Geçiş Başvuruları",
          category: "custom_event",
          startDate: "2026-08-01",
        },
        {
          id: "registration",
          title: "Lisans Programlarına Çift Anadal ve Yan Dal Kayıtları",
          category: "custom_event",
          startDate: "2026-08-01",
        },
        {
          id: "exam",
          title: "Azami Süreyi Dolduran Öğrenciler için Ek Sınavlar",
          category: "custom_event",
          startDate: "2026-08-01",
        },
        {
          id: "second-registration",
          title: "Ders kayıt tarihleri",
          category: "course_registration",
          startDate: "2026-08-02",
        },
        {
          id: "results",
          title: "Final sınavı sonuçları",
          category: "custom_event",
          startDate: "2026-08-02",
        },
      ],
    }));

    expect(screen.getByText("1 başvuru · 2 kayıt · 1 sınav")).toBeOnTheScreen();
    expect(screen.getByTestId("home-focus-card")).toHaveProp(
      "accessibilityLabel",
      expect.stringMatching(/Azami Süreyi Dolduran Öğrenciler için Ek Sınavlar.*Sınav/u),
    );
    expect(screen.getByText("Başvuru")).toBeOnTheScreen();
    expect(screen.getAllByText("Kayıt").length).toBeGreaterThan(0);
    expect(screen.queryByText("4 kayıt")).not.toBeOnTheScreen();
  });

  it("renders academic event clocks in the event timezone instead of the device timezone", async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      await renderHome(props({
        now: new Date("2026-08-11T06:00:00.000Z"),
        events: [{
          id: "istanbul-final",
          title: "Saat dilimi finali",
          category: "final_exam",
          startDate: "2026-08-11T07:00:00.000Z",
          endDate: "2026-08-11T09:00:00.000Z",
          temporalKind: "timestamp",
          endTemporalKind: "timestamp",
          timezone: "Europe/Istanbul",
        }],
      }));

      expect(screen.getAllByText("10:00").length).toBeGreaterThan(0);
      expect(screen.getByTestId("home-focus-card")).toHaveProp(
        "accessibilityLabel",
        expect.stringMatching(/10:00.*12:00/u),
      );
      expect(screen.queryByText("07:00")).not.toBeOnTheScreen();
      expect(screen.queryByText("09:00")).not.toBeOnTheScreen();
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("keeps initial loading, empty, and recoverable error mutually exclusive", async () => {
    const view = await renderHome(props({ events: [], announcements: [], calendarLoading: true, calendarAttempted: false, announcementLoading: true, announcementAttempted: false }));
    expect(screen.getByLabelText("Günlük özet yükleniyor").props.accessibilityState).toEqual({ busy: true });
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.queryByText("Bugün gündemin sakin")).not.toBeOnTheScreen();
    await view.rerenderAsync(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ThemeProvider platform="android" preference="light" reducedMotion reducedTransparency={false} windowWidth={320}>
          <NavigationContainer><HomeDailyBrief {...props({ events: [], announcements: [], calendarAttempted: true, announcementAttempted: true })} /></NavigationContainer>
        </ThemeProvider>
      </SafeAreaProvider>
    );
    expect(screen.getByRole("header", { name: "Bugün gündemin sakin" })).toBeOnTheScreen();
    expect(screen.queryByText("Günlük özet yüklenemedi")).not.toBeOnTheScreen();
  });

  it("retains populated content and explains stale refresh failure", async () => {
    await renderHome(props({ calendarError: "Bağlantı kurulamadı", calendarStale: true }));
    expect(screen.getByText("Son bilgiler gösteriliyor")).toBeOnTheScreen();
    expect(screen.getAllByText("Ders kayıtları").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2026-2027 eğitim öğretim yılı kayıt takvimi açıklandı")).toBeOnTheScreen();
  });

  it("renders trusted content only with publication/update timestamp meaning", async () => {
    const rejected = content({
      id: "rejected",
      title: "Bu reddedilmiş içerik görünmemeli",
      canonicalUrl: "https://example.edu.tr/rejected",
      link: "https://example.edu.tr/rejected",
      trustStatus: "rejected" as "trusted",
    });
    const sourceLess = content({
      id: "source-less",
      sourceId: "",
      title: "Kaynağı olmayan içerik görünmemeli",
      canonicalUrl: "https://example.edu.tr/source-less",
      link: "https://example.edu.tr/source-less",
    });
    const trustMissing = content({
      id: "trust-missing",
      title: "Güven durumu olmayan içerik görünmemeli",
      canonicalUrl: "https://example.edu.tr/trust-missing",
      link: "https://example.edu.tr/trust-missing",
      trustStatus: undefined as unknown as "trusted",
    });
    const genericSource = content({
      id: "generic-source",
      sourceName: "Resmî akademik kaynak",
      title: "Genel kaynak adlı içerik görünmemeli",
      canonicalUrl: "https://example.edu.tr/generic-source",
      link: "https://example.edu.tr/generic-source",
    });
    const inactiveSource = content({
      id: "inactive-source",
      title: "Etkin olmayan kaynak içeriği görünmemeli",
      canonicalUrl: "https://example.edu.tr/inactive-source",
      link: "https://example.edu.tr/inactive-source",
      sourceStatus: "inactive" as "active",
    });
    const rejectedSource = content({
      id: "rejected-source",
      title: "Reddedilmiş kaynak içeriği görünmemeli",
      canonicalUrl: "https://example.edu.tr/rejected-source",
      link: "https://example.edu.tr/rejected-source",
      sourceTrustStatus: "rejected" as "trusted",
    });
    await renderHome(props({ announcements: [
      ...props().announcements,
      rejected,
      sourceLess,
      trustMissing,
      genericSource,
      inactiveSource,
      rejectedSource,
    ] }));
    expect(screen.queryByText("Bu reddedilmiş içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Kaynağı olmayan içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Güven durumu olmayan içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Genel kaynak adlı içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Etkin olmayan kaynak içeriği görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Reddedilmiş kaynak içeriği görünmemeli")).not.toBeOnTheScreen();
    expect(screen.getByText(/Yayınlandı/)).toBeOnTheScreen();
    expect(screen.getByText(/Güncellendi/)).toBeOnTheScreen();
  });

  it("promotes only explicitly important announcements while recent content stays independent", async () => {
    const genericNewest = content({
      id: "generic-newest",
      title: "Kampüs yaşamından haftalık haberler",
      canonicalUrl: "https://example.edu.tr/duyuru/generic",
      link: "https://example.edu.tr/duyuru/generic",
      publishedAt: "2026-08-01T09:00:00.000Z",
    });
    const qualifiedOlder = content({
      id: "qualified-older",
      title: "Ders kayıt tarihleri açıklandı",
      canonicalUrl: "https://example.edu.tr/duyuru/kayit-tarihleri",
      link: "https://example.edu.tr/duyuru/kayit-tarihleri",
      publishedAt: "2026-07-30T09:00:00.000Z",
    });
    await renderHome(props({ events: [], announcements: [genericNewest, qualifiedOlder] }));

    expect(screen.getByRole("header", { name: "Önemli duyuru" })).toBeOnTheScreen();
    expect(screen.getAllByText("Ders kayıt tarihleri açıklandı")).toHaveLength(1);
    expect(screen.getAllByText("Kampüs yaşamından haftalık haberler")).toHaveLength(1);
  });

  it("keeps a generic newest announcement in recent content without inventing importance", async () => {
    await renderHome(props({
      events: [],
      announcements: [content({
        id: "generic-only",
        title: "Kampüs yaşamından haftalık haberler",
        canonicalUrl: "https://example.edu.tr/duyuru/generic-only",
        link: "https://example.edu.tr/duyuru/generic-only",
      })],
    }));

    expect(screen.queryByRole("header", { name: "Önemli duyuru" })).not.toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Son duyurular" })).toBeOnTheScreen();
    expect(screen.getByText("Kampüs yaşamından haftalık haberler")).toBeOnTheScreen();
  });

  it("uses full-row announcement navigation and the existing Announcements destination", async () => {
    await renderHome(props());
    fireEvent.press(screen.getAllByLabelText(/Öğrenci İşleri Daire Başkanlığı.*Ayrıntıyı aç/)[0]);
    expect(callbacks.onOpenAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ id: "announcement-1" }));
    fireEvent.press(screen.getByRole("button", { name: "Tümünü aç" }));
    expect(callbacks.onOpenAnnouncements).toHaveBeenCalledTimes(1);
  });

  it("has headings, logical labels, busy state, long-title wrapping, and no duplicate primary-tab cards", async () => {
    const longTitle = "2026-2027 eğitim öğretim yılı güz dönemi ders kayıtları ve danışman onay süreci hakkında çok uzun Türkçe duyuru başlığı";
    await renderHome(props({ announcements: [content({ title: longTitle })], calendarLoading: true }));
    expect(screen.getByLabelText("Öğrenci günlük özeti").props.accessibilityState).toEqual({ busy: true });
    expect(screen.getByRole("header", { name: "Senin için" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Sıradaki önemli tarih" })).toBeOnTheScreen();
    expect(screen.getByText(longTitle).props.numberOfLines).toBeUndefined();
    expect(screen.queryByText("Yaz Okulu")).not.toBeOnTheScreen();
    expect(screen.queryByText("YÖK")).not.toBeOnTheScreen();
    expect(screen.getAllByText(/^Duyurular$/u)).toHaveLength(1);
  });

  it("selects Android and iOS adaptations while content remains opaque", async () => {
    const android = await renderHome(props(), "android");
    expect(screen.getByTestId(/home-android-/)).toBeOnTheScreen();
    await android.unmountAsync();
    await renderHome(props(), "ios");
    expect(screen.getByTestId(/home-ios-/)).toBeOnTheScreen();
    expect(screen.queryByTestId("glass-view")).not.toBeOnTheScreen();
  });

  it("keeps Google connection prompts out of the home feed", async () => {
    await renderHome(props({ googleCalendarState: "disconnected" }));
    expect(screen.queryByText("Google Takvim bağlantısı hazır değil")).not.toBeOnTheScreen();
    expect(callbacks.onOpenGoogleCalendarSettings).not.toHaveBeenCalled();
  });

  it("keeps the genuine empty state focused on the calendar", async () => {
    await renderHome(props({
      events: [],
      manualExams: [],
      announcements: [],
      googleCalendarState: "disconnected",
    }));

    expect(screen.getByRole("header", { name: "Bugün gündemin sakin" })).toBeOnTheScreen();
    expect(screen.queryByText("Google Takvim bağlantısı hazır değil")).not.toBeOnTheScreen();
  });

  it("renders mutually exclusive no-data offline, partial, error, and genuine empty states", async () => {
    const offline = await renderHome(props({
      events: [],
      announcements: [],
      offline: true,
      calendarError: "network failed",
      announcementState: "partial",
    }));
    expect(screen.getByText("Çevrimdışısın")).toBeOnTheScreen();
    expect(screen.queryByText("Bazı kaynaklara ulaşılamadı")).not.toBeOnTheScreen();
    expect(screen.queryByText("Günlük özet yüklenemedi")).not.toBeOnTheScreen();
    expect(screen.queryByText("Bugün gündemin sakin")).not.toBeOnTheScreen();
    await offline.unmountAsync();

    const partial = await renderHome(props({
      events: [],
      announcements: [],
      offline: false,
      calendarError: "one source failed",
      announcementState: "partial",
    }));
    expect(screen.getByText("Bazı kaynaklara ulaşılamadı")).toBeOnTheScreen();
    expect(screen.queryByText("Çevrimdışısın")).not.toBeOnTheScreen();
    expect(screen.queryByText("Günlük özet yüklenemedi")).not.toBeOnTheScreen();
    expect(screen.queryByText("Bugün gündemin sakin")).not.toBeOnTheScreen();
    await partial.unmountAsync();

    const error = await renderHome(props({
      events: [],
      announcements: [],
      offline: false,
      calendarError: "request failed",
      announcementState: "fresh",
    }));
    expect(screen.getByText("Günlük özet yüklenemedi")).toBeOnTheScreen();
    expect(screen.queryByText("Çevrimdışısın")).not.toBeOnTheScreen();
    expect(screen.queryByText("Bazı kaynaklara ulaşılamadı")).not.toBeOnTheScreen();
    expect(screen.queryByText("Bugün gündemin sakin")).not.toBeOnTheScreen();
    await error.unmountAsync();

    await renderHome(props({
      events: [],
      announcements: [],
      offline: false,
      announcementState: "fresh",
    }));
    expect(screen.getByRole("header", { name: "Bugün gündemin sakin" })).toBeOnTheScreen();
    expect(screen.queryByText("Çevrimdışısın")).not.toBeOnTheScreen();
    expect(screen.queryByText("Bazı kaynaklara ulaşılamadı")).not.toBeOnTheScreen();
    expect(screen.queryByText("Günlük özet yüklenemedi")).not.toBeOnTheScreen();
  });
});
