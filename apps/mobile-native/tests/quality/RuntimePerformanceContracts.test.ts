import fs from "node:fs";
import path from "node:path";

describe("mobile runtime performance contracts", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
  const navigatorSource = fs.readFileSync(
    path.resolve(__dirname, "../../src/navigation/AppNavigator.tsx"),
    "utf8",
  );
  const entrySource = fs.readFileSync(path.resolve(__dirname, "../../index.ts"), "utf8");

  it("warms every primary authenticated destination before first use", () => {
    const warmup = appSource.slice(
      appSource.indexOf("function warmAuthenticatedContext"),
      appSource.indexOf("async function bootstrapAuthenticatedContext"),
    );

    expect(warmup).toContain("loadMyCalendar");
    expect(warmup).toContain("loadAnnouncements");
    expect(warmup).toContain("loadYokAnnouncements");
    expect(warmup).toContain("loadSummerSchool");
    expect(navigatorSource).toContain("navigation.preload(route)");
  });

  it("freezes inactive tabs after their staggered preload", () => {
    expect(entrySource).toContain("enableFreeze(true)");
    expect(navigatorSource).toContain("freezeOnBlur: FREEZE_INACTIVE_TABS");
    expect(navigatorSource).toContain("lazy: true");
  });

  it("does not block Google sign-in on a provider sign-out", () => {
    const googleStart = appSource.indexOf("const nativeAuth = await enqueueGoogleSdkOperation");
    const providerSignIn = appSource.indexOf("const result = await GoogleSignin.signIn()", googleStart);
    const providerPreparation = appSource.slice(googleStart, providerSignIn);

    expect(googleStart).toBeGreaterThan(0);
    expect(providerSignIn).toBeGreaterThan(googleStart);
    expect(providerPreparation).toContain("GoogleSignin.hasPlayServices");
    expect(providerPreparation).not.toContain("clearGoogleAccountSelection");
    expect(appSource).toContain("offlineAccess: false");
  });
});
