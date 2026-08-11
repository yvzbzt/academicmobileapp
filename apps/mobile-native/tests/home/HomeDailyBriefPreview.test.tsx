import { renderAsync, screen } from "@testing-library/react-native";
import {
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
  ] as const)("renders the %s scenario", async (scenario, expected) => {
    await renderAsync(<HomeDailyBriefPreview scenario={scenario as HomeDailyBriefPreviewScenario} preference="light" />);
    const expectedPattern = new RegExp(expected, "u");
    expect(screen.queryByText(expectedPattern) ?? screen.queryByLabelText(expectedPattern)).toBeOnTheScreen();
  });
});
