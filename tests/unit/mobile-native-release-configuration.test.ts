import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile-native release configuration", () => {
  it("applies the installed SecureStore plugin with Android backup exclusions enabled", () => {
    const appConfig = JSON.parse(readFileSync(resolve("apps/mobile-native/app.json"), "utf8")) as {
      expo?: { android?: { googleServicesFile?: string }; plugins?: unknown[] };
    };

    expect(appConfig.expo?.plugins).toContainEqual([
      "expo-secure-store",
      { configureAndroidBackup: true, faceIDPermission: false }
    ]);
    expect(appConfig.expo?.plugins).toContain("./plugins/with-notification-manifest-overrides.cjs");
    const notificationOverride = readFileSync(
      resolve("apps/mobile-native/plugins/with-notification-manifest-overrides.cjs"),
      "utf8"
    );
    expect(notificationOverride).toContain("com.google.firebase.messaging.default_notification_channel_id");
    expect(notificationOverride).toContain("com.google.firebase.messaging.default_notification_color");
    expect(notificationOverride).toContain('metadata.$["tools:replace"]');
    expect(appConfig.expo?.android?.googleServicesFile).toBe("./google-services.json");
    expect(readFileSync(resolve(".gitignore"), "utf8"))
      .toContain("apps/mobile-native/google-services.json");
  });
});
