import {
  fireEvent,
  renderAsync,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Share } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  AnnouncementDetail,
  type AnnouncementDetailProps,
} from "../../src/announcements/AnnouncementDetail";
import type { ContentFeedItem } from "../../src/announcements/feed-model";
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

function record(
  overrides: Partial<TrustedMobileContentRecord> = {},
): TrustedMobileContentRecord {
  const candidate = {
    id: "detail-record",
    sourceId: "student-affairs",
    sourceName: "Örnek Üniversitesi Öğrenci İşleri",
    contentType: "announcement",
    scopeType: "university",
    scopeId: "university-1",
    title: "Ders kayıt takvimi açıklandı",
    summary: "Ders kayıtları ve danışman onayları için güvenli özet.",
    canonicalUrl: "https://example.edu.tr/duyurular/detail-record",
    link: "https://example.edu.tr/duyurular/detail-record",
    officialSourceUrl: "https://example.edu.tr/duyurular",
    publishedAt: "2026-08-02T08:00:00.000Z",
    sourceUpdatedAt: "2026-08-02T09:00:00.000Z",
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

function item(
  recordOverrides: Partial<TrustedMobileContentRecord> = {},
  itemOverrides: Partial<ContentFeedItem> = {},
): ContentFeedItem {
  const detailRecord = record(recordOverrides);
  return {
    key: `feed:${detailRecord.id}`,
    record: detailRecord,
    contentType: detailRecord.contentType ?? "announcement",
    sourceFamilies: [detailRecord.scopeType],
    displayTimestamp: detailRecord.publishedAt ?? detailRecord.sourceUpdatedAt ?? null,
    displayTimestampKind: detailRecord.publishedAt
      ? "published"
      : detailRecord.sourceUpdatedAt
        ? "updated"
        : null,
    ...itemOverrides,
  };
}

const callbacks = {
  onBack: jest.fn(),
  onOpenNotificationSettings: jest.fn(),
  onOpenOfficialSource: jest.fn<Promise<boolean>, [string]>(),
  onRetry: jest.fn(),
  onShareResult: jest.fn(),
  onToggleSaved: jest.fn<Promise<void>, []>(),
};

function detailProps(
  overrides: Partial<AnnouncementDetailProps> = {},
): AnnouncementDetailProps {
  return {
    item: item(),
    onOpenNotificationSettings: callbacks.onOpenNotificationSettings,
    onOpenOfficialSource: callbacks.onOpenOfficialSource,
    onToggleSaved: callbacks.onToggleSaved,
    ...overrides,
  };
}

async function renderDetail(
  props: AnnouncementDetailProps,
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
        <AnnouncementDetail {...props} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("Phase 8 announcement detail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindowDimensions.mockReturnValue({
      fontScale: 2,
      height: 640,
      scale: 2,
      width: 320,
    });
    callbacks.onOpenOfficialSource.mockResolvedValue(true);
    callbacks.onToggleSaved.mockResolvedValue();
  });

  it("renders an admitted normalized detail, source identity, both source dates, and domain disclosure", async () => {
    await renderDetail(detailProps({
      item: item({
        sourceName: "Örnek Üniversitesi & Öğrenci İşleri",
        title: "Ders kayıtları & danışman onayı",
        summary: "Güvenli & kısa özet.",
      }),
    }));

    expect(screen.getByRole("header", {
      name: "Ders kayıtları & danışman onayı",
    })).toBeOnTheScreen();
    expect(screen.getByRole("header", {
      name: "Örnek Üniversitesi & Öğrenci İşleri",
    })).toBeOnTheScreen();
    expect(screen.getByText("Güvenli & kısa özet.")).toBeOnTheScreen();
    expect(screen.getByText(/Yayınlandı/iu)).toBeOnTheScreen();
    expect(screen.getByText(/Güncellendi/iu)).toBeOnTheScreen();
    expect(screen.getAllByText(/example\.edu\.tr/iu).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Duyuru · Üniversite")).toBeOnTheScreen();
    expect(screen.queryByText(/<strong>|&amp;|<p>/iu)).not.toBeOnTheScreen();
  });

  it("uses the reference source pill, article card, trust callout, and fixed action treatment", async () => {
    await renderDetail(detailProps());

    expect(screen.getByTestId("announcement-detail-source-pill")).toBeOnTheScreen();
    expect(screen.getByTestId("announcement-detail-article-card")).toBeOnTheScreen();
    expect(screen.getByTestId("announcement-detail-sticky-actions")).toBeOnTheScreen();
    expect(screen.getByText("Ders kayıtları ve danışman onayları için güvenli özet.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Paylaş" })).toBeOnTheScreen();
    expect(screen.getByRole("button", {
      name: "Resmî bağlantıyı aç: example.edu.tr",
    })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Bildirim tercihlerini yönet" })).toBeOnTheScreen();
  });

  it("renders sanitized rich body blocks and explicit key-date ranges", async () => {
    await renderDetail(detailProps({
      item: item({
        body: [
          { type: "paragraph", text: "Üniversitemiz senato kararıyla takvimi güncellemiştir." },
          { type: "bullet", text: "Sınav yerinizi öğrenci portalından kontrol edin." },
        ],
        keyDates: [
          { label: "Kayıt Yenileme", startDate: "2026-05-20", endDate: "2026-05-24" },
          { label: "Final Sınavları", startDate: "2026-06-23", endDate: "2026-07-04" },
        ],
      }),
    }));

    expect(screen.getByTestId("announcement-detail-rich-body")).toBeOnTheScreen();
    expect(screen.getByText("Üniversitemiz senato kararıyla takvimi güncellemiştir.")).toBeOnTheScreen();
    expect(screen.getByText("Sınav yerinizi öğrenci portalından kontrol edin.")).toBeOnTheScreen();
    expect(screen.getByTestId("announcement-detail-key-dates")).toBeOnTheScreen();
    expect(screen.getByText("Kayıt Yenileme")).toBeOnTheScreen();
    expect(screen.getByText("20 Mayıs 2026 – 24 Mayıs 2026")).toBeOnTheScreen();
    expect(screen.getByText("23 Haziran 2026 – 04 Temmuz 2026")).toBeOnTheScreen();
  });

  it("renders an Istanbul source date without inventing midnight or a clock", async () => {
    await renderDetail(detailProps({
      item: item({
        publicationKind: "date",
        publishedDate: "2026-08-04",
        publishedAt: undefined,
        sourceUpdatedAt: undefined,
      }, {
        displayTimestamp: "2026-08-04",
        displayTimestampKind: "published",
      }),
    }));

    expect(screen.getByText("Yayınlandı 04 Ağu 2026")).toBeOnTheScreen();
    expect(screen.queryByText(/(?:00:00|03:00|3 Ağu|5 Ağu)/u)).not.toBeOnTheScreen();
  });

  it("shares only the normalized specific canonical URL and reports the result", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({
      action: Share.sharedAction,
    });
    await renderDetail(detailProps({
      item: item({
        canonicalUrl: "https://example.edu.tr/duyurular/detail-record?a=1",
        link: "https://example.edu.tr/duyurular/detail-record?a=1",
        title: "Ders kayıt takvimi",
      }),
      onShareResult: callbacks.onShareResult,
    }));

    fireEvent.press(screen.getByRole("button", { name: "Paylaş" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({
      title: "Ders kayıt takvimi",
      message: "Ders kayıt takvimi\nhttps://example.edu.tr/duyurular/detail-record?a=1",
      url: "https://example.edu.tr/duyurular/detail-record?a=1",
    }));
    expect(callbacks.onShareResult).toHaveBeenCalledWith("shared");
  });

  it("opens the specific canonical content URL, not the source listing URL", async () => {
    await renderDetail(detailProps());
    fireEvent.press(screen.getByRole("button", {
      name: "Resmî bağlantıyı aç: example.edu.tr",
    }));
    await waitFor(() => expect(callbacks.onOpenOfficialSource).toHaveBeenCalledWith(
      "https://example.edu.tr/duyurular/detail-record",
    ));
    expect(callbacks.onOpenOfficialSource).not.toHaveBeenCalledWith(
      "https://example.edu.tr/duyurular",
    );
  });

  it.each([
    { mode: "unsupported", implementation: () => Promise.resolve(false) },
    { mode: "failed", implementation: () => Promise.reject(new Error("synthetic")) },
  ])("contains $mode official handoff failure in the current route", async ({ implementation }) => {
    callbacks.onOpenOfficialSource.mockImplementation(implementation);
    await renderDetail(detailProps());
    fireEvent.press(screen.getByRole("button", {
      name: "Resmî bağlantıyı aç: example.edu.tr",
    }));
    expect(await screen.findByText("İşlem tamamlanamadı")).toBeOnTheScreen();
    expect(screen.getByText("Resmî kaynak açılamadı. Lütfen tekrar dene.")).toBeOnTheScreen();
    expect(screen.getByRole("header", {
      name: "Ders kayıt takvimi açıklandı",
    })).toBeOnTheScreen();
  });

  it("contains share failure and never exposes raw failure details", async () => {
    jest.spyOn(Share, "share").mockRejectedValue(new Error("secret native details"));
    await renderDetail(detailProps());
    fireEvent.press(screen.getByRole("button", { name: "Paylaş" }));
    expect(await screen.findByText("İşlem tamamlanamadı")).toBeOnTheScreen();
    expect(screen.getByText("Paylaşım başlatılamadı. Lütfen tekrar dene.")).toBeOnTheScreen();
    expect(screen.queryByText(/secret native details/iu)).not.toBeOnTheScreen();
  });

  it.each([
    {
      name: "unsafe canonical URL",
      detailItem: item({ canonicalUrl: "javascript:alert(1)", link: "file:///secret" }),
    },
    {
      name: "mismatched official authority",
      detailItem: item({ officialSourceUrl: "https://other.edu.tr/duyurular" }),
    },
    {
      name: "missing official source URL",
      detailItem: item({ officialSourceUrl: undefined as unknown as string }),
    },
    {
      name: "missing explicit source",
      detailItem: item({ sourceId: "" }),
    },
    {
      name: "untrusted record",
      detailItem: item({ trustStatus: "quarantined" as "trusted" }),
    },
    {
      name: "generic substituted source name",
      detailItem: item({ sourceName: "Resmî akademik kaynak" }),
    },
    {
      name: "inactive source",
      detailItem: item({ sourceStatus: "inactive" as "active" }),
    },
    {
      name: "rejected source",
      detailItem: item({ sourceTrustStatus: "rejected" as "trusted" }),
    },
    {
      name: "cross-scope relationship",
      detailItem: item({
        sourceRelationships: [{
          sourceId: "student-affairs",
          sourceName: "Örnek Üniversitesi Öğrenci İşleri",
          officialSourceUrl: "https://example.edu.tr/duyurular",
          scopeType: "faculty",
          scopeId: "faculty-2",
          canonicalUrl: "https://example.edu.tr/duyurular/detail-record",
        }],
      }),
    },
  ])("fails closed for $name", async ({ detailItem }) => {
    await renderDetail(detailProps({ item: detailItem }));
    expect(screen.getByRole("header", { name: "İçerik açılamadı" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Paylaş" })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Resmî bağlantıyı aç/iu })).not.toBeOnTheScreen();
  });

  it("keeps loading and error states exclusive with one accessible busy indicator", async () => {
    const loading = await renderDetail(detailProps({ item: null, loading: true }));
    expect(screen.getByLabelText("Duyuru ayrıntısı yükleniyor").props.accessibilityState)
      .toEqual({ busy: true });
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.queryByRole("header", { name: "İçerik açılamadı" })).not.toBeOnTheScreen();
    await loading.unmountAsync();

    await renderDetail(detailProps({ item: null, error: "Sentetik hata", onRetry: callbacks.onRetry }));
    expect(screen.getByRole("header", { name: "İçerik açılamadı" })).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar")).not.toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the real share/save actions, notification handoff, and an optional preview back action", async () => {
    await renderDetail(detailProps({ onBack: callbacks.onBack }));
    fireEvent.press(screen.getByRole("button", { name: "Duyurulara geri dön" }));
    expect(callbacks.onBack).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(callbacks.onToggleSaved).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByRole("button", { name: "Bildirim tercihlerini yönet" }));
    expect(callbacks.onOpenNotificationSettings).toHaveBeenCalledTimes(1);
    for (const unsupported of [
      "Okundu olarak işaretle",
      "Takvime ekle",
      "Ekler",
      "Beğen",
      "Yorum yap",
      "Yeniden paylaş",
    ]) {
      expect(screen.queryByRole("button", { name: unsupported })).not.toBeOnTheScreen();
    }
  });

  it("exposes saved, loading, and contained save-error states", async () => {
    const saved = await renderDetail(detailProps({ saved: true }));
    expect(screen.getByRole("button", { name: "Kaydedildi" })).toBeOnTheScreen();
    await saved.unmountAsync();

    const loading = await renderDetail(detailProps({ saveLoading: true }));
    expect(screen.getByRole("button", { name: "Kaydet" }).props.accessibilityState)
      .toEqual(expect.objectContaining({ busy: true, disabled: true }));
    await loading.unmountAsync();

    await renderDetail(detailProps({ saveError: "Duyuru kaydedilemedi. Lütfen tekrar dene." }));
    expect(screen.getByText("Duyuru kaydedilemedi. Lütfen tekrar dene.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Ders kayıt takvimi açıklandı" })).toBeOnTheScreen();
  });

  it("uses opaque Android/iOS detail markers at 320 dp and 200% text", async () => {
    const android = await renderDetail(detailProps(), "android");
    expect(screen.getByTestId("announcement-detail-android-large-text")).toBeOnTheScreen();
    await android.unmountAsync();
    await renderDetail(detailProps(), "ios");
    expect(screen.getByTestId("announcement-detail-ios-large-text")).toBeOnTheScreen();
    expect(screen.queryByTestId("mock-liquid-glass")).not.toBeOnTheScreen();
  });
});
