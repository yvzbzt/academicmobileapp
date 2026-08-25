import { renderAsync, screen } from "@testing-library/react-native";
import {
  createHomeDailyBriefPreviewProps,
  HomeDailyBriefPreview,
  type HomeDailyBriefPreviewScenario,
} from "../../src/home/HomeDailyBriefPreview";

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return { ...actual, useScrollToTop: jest.fn() };
});

describe("Phase 7 synthetic Home preview", () => {
  it("keeps fixtures synthetic and outside API, storage, provider, and production modules", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../src/home/HomeDailyBriefPreview.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/apiRequest|SecureStore|GoogleSignin|expo-network|production/iu);
    expect(source).toContain("preview.edu.tr");
  });

  it.each([
    ["incomplete", "Akademik profilin eksik"],
    ["loading", "Günlük özet yükleniyor"],
    ["populated", "Güz dönemi ders kayıt takvimi açıklandı"],
    ["empty", "Bugün gündemin sakin"],
    ["stale", "Son bilgiler gösteriliyor"],
    ["error", "Günlük özet yüklenemedi"],
    ["long-title", "çok uzun Türkçe duyuru başlığı"],
    ["reference", "Lisansüstü Programlara Yatay Geçiş Başvuruları"],
  ] as const)("renders the %s scenario", async (scenario, expected) => {
    const view = await renderAsync(
      <HomeDailyBriefPreview
        preference="light"
        scenario={scenario as HomeDailyBriefPreviewScenario}
      />,
    );
    const expectedPattern = new RegExp(expected, "u");
    expect([
      ...screen.queryAllByText(expectedPattern),
      ...screen.queryAllByLabelText(expectedPattern),
    ].length).toBeGreaterThan(0);
    await view.unmountAsync();
  });

  it("models the supplied Home reference without API or production-state changes", async () => {
    const fixture = createHomeDailyBriefPreviewProps("reference");

    expect(fixture.fullName).toBe("Fuat Başar");
    expect(fixture.now).toEqual(new Date(2026, 7, 20, 10, 0, 0));
    expect(fixture.weekAnchorDate).toEqual(new Date(2026, 7, 27, 10, 0, 0));
    expect(fixture.weeklySummaryOverride).toEqual({
      applications: 1,
      exams: 1,
      registrations: 2,
      total: 4,
    });
    expect(fixture.announcements).toHaveLength(3);
    expect(fixture.announcementNewCount).toBe(3);
    expect(fixture.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Lisansüstü Programlara Yatay Geçiş Başvuruları",
        startDate: "2026-08-27",
      }),
      expect.objectContaining({
        title: "Ders Kayıtları",
        startDate: "2026-08-31",
        endDate: "2026-09-04",
      }),
      expect.objectContaining({
        title: "Burs Başvuruları",
        startDate: "2026-09-01",
        endDate: "2026-09-15",
      }),
      expect.objectContaining({
        title: "Bahar Dönemi Ders Başlangıcı",
        startDate: "2027-02-08",
      }),
    ]));

    const view = await renderAsync(
      <HomeDailyBriefPreview scenario="reference" preference="light" />,
    );
    expect(screen.getByLabelText(/Merhaba, Fuat/u)).toBeOnTheScreen();
    expect(screen.getByText("7")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "PER, 27 Ağustos. Takvimi aç." })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Bu hafta 4 önemli tarih/u })).toBeOnTheScreen();
    expect(screen.getAllByText("Lisansüstü Programlara Yatay Geçiş Başvuruları")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Ders Kayıtları\./u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Burs Başvuruları\./u })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^Bahar Dönemi Ders Başlangıcı\./u })).toBeOnTheScreen();
    expect(screen.getByLabelText("Duyuru özeti")).toHaveProp(
      "accessibilityHint",
      "3 yeni duyuru bulunuyor; toplam 3 güncel duyuru var.",
    );
    await view.unmountAsync();
  });
});
