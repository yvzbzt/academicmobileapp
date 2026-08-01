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

const now = new Date(2026, 7, 1, 10, 0, 0);
const callbacks = {
  onCompleteProfile: jest.fn(),
  onOpenAnnouncement: jest.fn(),
  onOpenAnnouncements: jest.fn(),
  onOpenCalendar: jest.fn(),
  onOpenGoogleCalendarSettings: jest.fn(),
  onOpenNotificationSettings: jest.fn(),
  onRefresh: jest.fn(),
};

function content(overrides: Partial<TrustedMobileContentRecord> = {}): TrustedMobileContentRecord {
  return {
    id: "announcement-1",
    sourceId: "source-1",
    sourceName: "Öğrenci İşleri Daire Başkanlığı",
    scopeType: "university",
    scopeId: "university-1",
    title: "2026-2027 eğitim öğretim yılı kayıt takvimi açıklandı",
    summary: "Kayıt tarihleri ve öğrenci işlemleri için kısa bilgilendirme.",
    link: "https://example.edu.tr/duyuru/kayit",
    canonicalUrl: "https://example.edu.tr/duyuru/kayit",
    publishedAt: "2026-08-01T07:00:00.000Z",
    trustStatus: "trusted",
    ...overrides,
  };
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

  it("keeps initial loading, empty, and recoverable error mutually exclusive", async () => {
    const view = await renderHome(props({ events: [], announcements: [], calendarLoading: true, calendarAttempted: false, announcementLoading: true, announcementAttempted: false }));
    expect(screen.getByLabelText("Günlük özet yükleniyor").props.accessibilityState).toEqual({ busy: true });
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
    await renderHome(props({ announcements: [...props().announcements, rejected, sourceLess] }));
    expect(screen.queryByText("Bu reddedilmiş içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.queryByText("Kaynağı olmayan içerik görünmemeli")).not.toBeOnTheScreen();
    expect(screen.getByText(/Yayınlandı/)).toBeOnTheScreen();
    expect(screen.getByText(/Güncellendi/)).toBeOnTheScreen();
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
    expect(screen.getByRole("header", { name: "Bugün" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Sıradaki önemli tarih" })).toBeOnTheScreen();
    expect(screen.getByText(longTitle).props.numberOfLines).toBeUndefined();
    expect(screen.queryByText("Yaz Okulu")).not.toBeOnTheScreen();
    expect(screen.queryByText("YÖK")).not.toBeOnTheScreen();
    expect(screen.queryByText(/^Duyurular$/u)).not.toBeOnTheScreen();
  });

  it("selects Android and iOS adaptations while content remains opaque", async () => {
    const android = await renderHome(props(), "android");
    expect(screen.getByTestId(/home-android-/)).toBeOnTheScreen();
    await android.unmountAsync();
    await renderHome(props(), "ios");
    expect(screen.getByTestId(/home-ios-/)).toBeOnTheScreen();
    expect(screen.queryByTestId("glass-view")).not.toBeOnTheScreen();
  });

  it("shows only a compact actionable integration state", async () => {
    await renderHome(props({ googleCalendarState: "disconnected" }));
    expect(screen.getByText("Google Takvim bağlantısı hazır değil")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Ayarları aç" }));
    expect(callbacks.onOpenGoogleCalendarSettings).toHaveBeenCalledTimes(1);
  });
});
