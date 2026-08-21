import { Text } from "react-native";
import {
  screen,
  userEvent,
} from "@testing-library/react-native";
import {
  Banner,
  EmptyState,
  ErrorState,
  Skeleton,
  Toast,
} from "../../src/design-system/primitives/Feedback";
import { renderWithTheme } from "./test-utils";

describe("accessible feedback and state primitives", () => {
  it("announces error banners and keeps recovery and dismiss actions reachable", async () => {
    const onAction = jest.fn();
    const onDismiss = jest.fn();
    await renderWithTheme(
      <Banner
        actionLabel="Tekrar dene"
        message="Bağlantıyı kontrol edip yeniden deneyin."
        onAction={onAction}
        onDismiss={onDismiss}
        title="Duyurular yüklenemedi"
        tone="error"
      />,
    );

    expect(
      screen.getByRole("alert", {
        name: "Duyurular yüklenemedi. Bağlantıyı kontrol edip yeniden deneyin.",
      }),
    ).toHaveProp("accessibilityLiveRegion", "assertive");
    expect(screen.getByText("Duyurular yüklenemedi")).toHaveProp("maxFontSizeMultiplier", 1.35);
    await userEvent.press(screen.getByRole("button", { name: "Tekrar dene" }));
    await userEvent.press(screen.getByRole("button", { name: "Bildirimi kapat" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders a polite success toast without an automatic unreadable timeout", async () => {
    await renderWithTheme(
      <Toast message="Etkinlik yönetilen takvime eklendi." title="Tamamlandı" tone="success" />,
    );

    expect(
      screen.getByRole("alert", {
        name: "Tamamlandı. Etkinlik yönetilen takvime eklendi.",
      }),
    ).toHaveProp("accessibilityLiveRegion", "polite");
  });

  it("exposes a reduced-motion skeleton as a busy progress indicator", async () => {
    await renderWithTheme(<Skeleton accessibilityLabel="Takvim yükleniyor" />, {
      reducedMotion: true,
    });

    const skeleton = screen.getByRole("progressbar", { name: "Takvim yükleniyor" });
    expect(skeleton).toBeBusy();
    expect(skeleton).toHaveStyle({ opacity: 1 });
  });

  it("separates empty and error semantics and activates their next steps", async () => {
    const onEmptyAction = jest.fn();
    const onRetry = jest.fn();
    await renderWithTheme(
      <>
        <EmptyState
          actionLabel="Filtreleri temizle"
          description="Seçili filtrelerle eşleşen duyuru yok."
          illustration={<Text>∅</Text>}
          onAction={onEmptyAction}
          title="Sonuç bulunamadı"
        />
        <ErrorState
          actionLabel="Yeniden yükle"
          description="Daha önce doğrulanmış içerik korunuyor."
          onAction={onRetry}
          technicalDetails="Hata kodu: CONTENT_REFRESH_FAILED"
          title="Yenileme başarısız"
        />
      </>,
    );

    expect(
      screen.getByRole("summary", {
        name: "Sonuç bulunamadı. Seçili filtrelerle eşleşen duyuru yok.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("alert", {
        name: "Yenileme başarısız. Daha önce doğrulanmış içerik korunuyor.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Hata kodu: CONTENT_REFRESH_FAILED")).toBeVisible();
    expect(screen.getByRole("header", { name: "Sonuç bulunamadı" })).toHaveProp("maxFontSizeMultiplier", 1.4);
    expect(screen.getByRole("header", { name: "Yenileme başarısız" })).toHaveProp("numberOfLines", 3);

    await userEvent.press(screen.getByRole("button", { name: "Filtreleri temizle" }));
    await userEvent.press(screen.getByRole("button", { name: "Yeniden yükle" }));
    expect(onEmptyAction).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
