import fs from "node:fs";
import path from "node:path";

describe("mobile runtime performance contracts", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
  const navigatorSource = fs.readFileSync(
    path.resolve(__dirname, "../../src/navigation/AppNavigator.tsx"),
    "utf8",
  );
  it("warms only Home data while the initial shell becomes interactive", () => {
    const warmup = appSource.slice(
      appSource.indexOf("function warmAuthenticatedContext"),
      appSource.indexOf("async function bootstrapAuthenticatedContext"),
    );

    expect(warmup).toContain("loadMyCalendar");
    expect(warmup).toContain("loadAnnouncements");
    expect(warmup).toContain("InteractionManager.runAfterInteractions");
    expect(warmup).toContain("}, 1_500)");
    expect(warmup).not.toContain("loadYokAnnouncements");
    expect(warmup).not.toContain("loadSummerSchool");
  });

  it("restores independent authenticated startup state concurrently", () => {
    const hydration = appSource.slice(
      appSource.indexOf("async function hydrateApplication"),
      appSource.indexOf("async function restoreSession"),
    );

    expect(hydration).toContain("restoreSession(storedSessionValue)");
    expect(hydration).toContain("const [contextReady] = await Promise.all([");
    expect(hydration).toContain("bootstrapAuthenticatedContext(restoredSession.accessToken, snapshot)");
    expect(hydration).toContain("restoreManualExams(restoredSession.user.id, snapshot).catch");
    expect(hydration).toContain("restoreGoogleCalendarConnection(restoredSession.user.id, snapshot).catch");
  });

  it("does not pre-mount or freeze inactive tabs during startup", () => {
    expect(navigatorSource).not.toContain("navigation.preload(route)");
    expect(navigatorSource).not.toContain("freezeOnBlur:");
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
