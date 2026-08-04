import {
  act,
  fireEvent,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import { Linking } from "react-native";
import {
  CONTENT_FEED_PREVIEW_LONG_FEED_SIZE,
  CONTENT_FEED_PREVIEW_SCENARIOS,
  ContentFeedPreview,
  createContentFeedPreviewFixture,
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

  it("publishes the complete stable scenario inventory", () => {
    expect(CONTENT_FEED_PREVIEW_SCENARIOS).toEqual([
      "populated",
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
      expect(
        screen.getByTestId("phase8-content-feed-preview").props.accessibilityLabel,
      ).toBe(`Phase 8 sentetik içerik önizlemesi: ${scenario}`);
      await view.unmountAsync();
    },
  );

  it("opens detail and returns to the mounted feed with search state retained", async () => {
    const view = await renderAsync(
      <ContentFeedPreview preference="light" scenario="search-results" />,
    );

    expect(screen.getByDisplayValue("burs")).toBeOnTheScreen();
    await settleVirtualizedList();
    fireEvent.press(
      screen.getByRole("button", {
        name: /Burs başvuruları için güncel belge listesi yayımlandı/iu,
      }),
    );
    expect(
      screen.getByRole("header", {
        name: "Burs başvuruları için güncel belge listesi yayımlandı",
      }),
    ).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole("button", { name: "Duyurulara geri dön" }),
    );
    expect(screen.getByDisplayValue("burs")).toBeOnTheScreen();
    await view.unmountAsync();
  });

  it("contains the official-source handoff without opening an external URL", async () => {
    const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await renderAsync(
      <ContentFeedPreview
        preference="light"
        scenario="official-source-handoff"
      />,
    );

    expect(screen.getAllByText(/preview\.edu\.tr/iu).length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: /Resmî kaynağı aç/iu }),
      );
      await Promise.resolve();
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/açılamadı|önizlemede dış uygulamaya gönderilmedi/iu),
    ).toBeOnTheScreen();
  });
});
