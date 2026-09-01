import {
  act,
  fireEvent,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CONTENT_FEED_PREVIEW_LONG_FEED_SIZE,
  CONTENT_FEED_PREVIEW_SCENARIOS,
  ContentFeedPreview,
  createContentFeedPreviewFixture,
  resolveContentFeedPreviewSafeAreaMetrics,
  type ContentFeedPreviewScenario,
} from "../../src/announcements/ContentFeedPreview";
import {
  CONTENT_FEED_PERFORMANCE_MARKER,
  CONTENT_FEED_PERFORMANCE_RECORD_COUNT,
} from "../../src/announcements/ContentFeedPerformanceHarness";

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return { ...actual, useScrollToTop: jest.fn() };
});

async function settleVirtualizedList(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  });
}

describe("Phase 8 synthetic content-feed preview", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses native capture insets and a conservative deterministic fallback", () => {
    const threeButtonAndroidMetrics = {
      frame: { x: 0, y: 0, width: 360, height: 800 },
      insets: { top: 24, right: 0, bottom: 48, left: 0 },
    };

    expect(resolveContentFeedPreviewSafeAreaMetrics(threeButtonAndroidMetrics))
      .toBe(threeButtonAndroidMetrics);
    expect(resolveContentFeedPreviewSafeAreaMetrics(null)).toEqual({
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, right: 0, bottom: 34, left: 0 },
    });
  });

  it("publishes the complete stable scenario inventory", () => {
    expect(CONTENT_FEED_PREVIEW_SCENARIOS).toEqual([
      "populated",
      "reference-list",
      "reference-detail",
      "search-results",
      "no-results",
      "active-filters",
      "partial",
      "stale",
      "offline",
      "error",
      "pagination-error",
      "detail",
      "yok",
      "summer-school",
      "official-source-handoff",
      "long-title",
      "long-feed",
    ]);
  });

  it("keeps every fixture trusted, synthetic, URL-safe, and outside production access", () => {
    const previewSource = require("fs").readFileSync(
      require("path").resolve(
        __dirname,
        "../../src/announcements/ContentFeedPreview.tsx",
      ),
      "utf8",
    );

    expect(previewSource).not.toMatch(
      /apiRequest|SecureStore|AsyncStorage|GoogleSignin|expo-network|fetch\s*\(|Linking|PRODUCTION_API|anssoft\.com/iu,
    );
    expect(previewSource).toContain("preview.edu.tr");
    expect(previewSource).toContain("yok.gov.tr");
    expect(previewSource).toContain("if (!__DEV__) return null");

    for (const scenario of CONTENT_FEED_PREVIEW_SCENARIOS) {
      const fixture = createContentFeedPreviewFixture(scenario);
      const items = [
        ...fixture.academicItems,
        ...fixture.yokItems,
        ...fixture.summerItems,
      ];
      for (const item of items) {
        expect(item.trustStatus).toBe("trusted");
        expect(item.sourceId).toBeTruthy();
        expect(new URL(item.canonicalUrl).protocol).toBe("https:");
        expect(["preview.edu.tr", "www.yok.gov.tr"]).toContain(
          new URL(item.canonicalUrl).hostname,
        );
      }
    }
  });

  it("creates exactly one hundred deterministic records for the long-feed scenario", () => {
    const first = createContentFeedPreviewFixture("long-feed");
    const second = createContentFeedPreviewFixture("long-feed");

    expect([
      ...first.academicItems,
      ...first.yokItems,
      ...first.summerItems,
    ]).toHaveLength(CONTENT_FEED_PREVIEW_LONG_FEED_SIZE);
    expect(first.yokItems).toEqual([]);
    expect(first.summerItems).toEqual([]);
    expect(new Set(first.academicItems.map((item) => item.id)).size).toBe(
      CONTENT_FEED_PREVIEW_LONG_FEED_SIZE,
    );
    expect(first.academicItems).toEqual(second.academicItems);
  });

  it("keeps the reference feed and detail fixtures deterministic and model-backed", () => {
    const list = createContentFeedPreviewFixture("reference-list");
    const records = [
      ...list.academicItems,
      ...list.yokItems,
      ...list.summerItems,
    ];

    expect(records.map((record) => [record.title, record.publishedDate])).toEqual([
      ["2026–2027 Güz Dönemi Akademik Takvimi Yayımlandı", "2026-05-23"],
      ["Mühendislik Fakültesi Danışmanlık Toplantısı", "2026-05-21"],
      ["Bilgisayar Mühendisliği Bitirme Projesi Teslim Tarihleri", "2026-05-20"],
      ["YÖK: Ulusal Staj Programı Duyurusu", "2026-05-19"],
      ["Yaz Okulu Ders Kayıtları Başladı", "2026-05-18"],
    ]);
    expect(list.universityName).toBe("Ankara Üniversitesi");

    const detail = createContentFeedPreviewFixture("reference-detail");
    expect(detail.initialRoute).toBe("Detail");
    expect(detail.initialDetail).toMatchObject({
      body: expect.arrayContaining([
        expect.objectContaining({ type: "heading", text: "Önemli Bilgiler" }),
      ]),
      keyDates: [{
        label: "Ders kayıtları",
        startDate: "2026-08-27",
        endDate: "2026-09-04",
      }],
      publishedDate: "2026-08-27",
      scopeType: "university",
      sourceName: "Üniversite Duyurusu",
      title: "2026–2027 Güz Yarıyılı Ders Kayıtları Başladı",
    });
  });

  it("renders the reference detail without inventing unsupported attachments", async () => {
    const view = await renderAsync(
      <ContentFeedPreview
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 800 },
          insets: { top: 24, right: 0, bottom: 48, left: 0 },
        }}
        preference="light"
        scenario="reference-detail"
      />,
    );
    await settleVirtualizedList();

    expect(await screen.findByRole("header", {
      name: "2026–2027 Güz Yarıyılı Ders Kayıtları Başladı",
    })).toBeVisible();
    expect(screen.getByText("Üniversite Duyurusu")).toBeVisible();
    expect(screen.getByLabelText(
      "Ders kayıtları: 27 Ağustos 2026 – 04 Eylül 2026",
    )).toBeVisible();
    expect(screen.queryByText(/Son gün:/iu)).not.toBeOnTheScreen();
    expect(screen.getByText("Önemli Bilgiler")).toBeVisible();
    expect(screen.queryByText(/Ekler\s*\(/iu)).not.toBeOnTheScreen();
    expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual([
      "left",
      "right",
      "bottom",
    ]);
    expect(screen.getByTestId("phase8-announcement-detail-safe-area"))
      .toHaveStyle({ flex: 1 });
    await view.unmountAsync();
  });

  it("keeps the release performance entry isolated, ungated, and fixed at one hundred records", () => {
    const fs = require("fs");
    const path = require("path");
    const entrySource = fs.readFileSync(
      path.resolve(__dirname, "../../index.feed-performance.ts"),
      "utf8",
    );
    const harnessSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../src/announcements/ContentFeedPerformanceHarness.tsx",
      ),
      "utf8",
    );

    expect(CONTENT_FEED_PERFORMANCE_RECORD_COUNT).toBe(100);
    expect(CONTENT_FEED_PERFORMANCE_MARKER).toContain("100 records");
    expect(entrySource).toContain("ContentFeedPerformanceHarness");
    expect(entrySource).not.toMatch(/from ["']\.\/App["']/u);
    expect(harnessSource).not.toContain("if (!__DEV__) return null");
    expect(harnessSource).not.toMatch(
      /apiRequest|SecureStore|AsyncStorage|GoogleSignin|fetch\s*\(|PRODUCTION_API/iu,
    );
  });

  it("selects the matching source filter in YÖK and Summer School evidence scenarios", () => {
    expect(createContentFeedPreviewFixture("yok").initialSourceFilter).toBe("yok");
    expect(createContentFeedPreviewFixture("summer-school").initialSourceFilter)
      .toBe("summer-school");
  });

  it.each(CONTENT_FEED_PREVIEW_SCENARIOS.filter((scenario) => scenario !== "long-feed"))(
    "renders the %s scenario through the isolated native boundary",
    async (scenario) => {
      const view = await renderAsync(
        <ContentFeedPreview
          preference={scenario === "long-title" ? "dark" : "light"}
          scenario={scenario as ContentFeedPreviewScenario}
        />,
      );
      await settleVirtualizedList();
      expect(
        screen.getByTestId("phase8-content-feed-preview").props.accessibilityLabel,
      ).toBe(`Phase 8 sentetik içerik önizlemesi: ${scenario}`);
      await view.unmountAsync();
    },
  );

  it("keeps the feed mounted while explaining the production direct handoff", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await renderAsync(
      <ContentFeedPreview preference="light" scenario="search-results" />,
    );

    expect(screen.getByDisplayValue("burs")).toBeOnTheScreen();
    await settleVirtualizedList();
    await act(async () => {
      fireEvent.press(
        screen.getByRole("link", {
          name: /Burs başvuruları için güncel belge listesi yayımlandı/iu,
        }),
      );
      await Promise.resolve();
    });
    expect(alert).toHaveBeenCalledWith(
      "Resmî kaynak",
      expect.stringMatching(/gerçek uygulamada.*doğrudan resmî bağlantıyı açar/iu),
    );
    expect(screen.getByDisplayValue("burs")).toBeOnTheScreen();
    await view.unmountAsync();
  });

  it("contains the official-source handoff without opening an external URL", async () => {
    const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const view = await renderAsync(
      <ContentFeedPreview
        preference="light"
        scenario="official-source-handoff"
      />,
    );
    await settleVirtualizedList();

    expect(screen.getAllByText(/preview\.edu\.tr/iu).length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: /Resmî bağlantıyı aç/iu }),
      );
      await Promise.resolve();
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/açılamadı|önizlemede dış uygulamaya gönderilmedi/iu),
    ).toBeOnTheScreen();
    await view.unmountAsync();
  });
});
