import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  PROFILE_SECTION_ORDER,
  commitAcademicProfileDraft,
  hasNotificationPreferenceChanges,
  profileDraftFromServer,
  resolveAcademicProfileSummary,
  resolveGoogleCalendarPresentation,
  resolveNotificationTruth,
  resolveProfileSettingsLayout,
  visibleProfileSectionOrder,
  type NotificationPreferenceComparable,
} from "../../apps/mobile-native/src/profile/profile-model";

describe("Phase 10 Profile and Settings contracts", () => {
  it("keeps the required Profile hierarchy exact and only filters optional real sections", () => {
    expect(PROFILE_SECTION_ORDER).toEqual([
      "profile_summary",
      "personal_information",
      "academic_profile",
      "notifications",
      "calendar_connections",
      "appearance_and_preferences",
      "help_privacy_and_app_info",
      "account_management",
      "dangerous_area",
    ]);
    expect(visibleProfileSectionOrder({
      appearancePreferences: false,
      helpPrivacyOrAppInfo: false,
    })).toEqual([
      "profile_summary",
      "personal_information",
      "academic_profile",
      "notifications",
      "calendar_connections",
      "account_management",
      "dangerous_area",
    ]);
    expect(visibleProfileSectionOrder({
      appearancePreferences: true,
      helpPrivacyOrAppInfo: true,
    })).toEqual(PROFILE_SECTION_ORDER);
  });

  it("summarizes complete academic data without making optional fields required", () => {
    expect(resolveAcademicProfileSummary({
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      classLevel: 3,
    }, {
      universityName: "Ankara Üniversitesi",
      facultyName: "Mühendislik Fakültesi",
      departmentName: "Bilgisayar Mühendisliği",
    })).toEqual({
      complete: true,
      status: "complete",
      universityLabel: "Ankara Üniversitesi",
      facultyLabel: "Mühendislik Fakültesi",
      departmentLabel: "Bilgisayar Mühendisliği",
      classLevelLabel: "3. sınıf",
      supportingText: "Mühendislik Fakültesi · Bilgisayar Mühendisliği",
      actionLabel: "Akademik bilgileri düzenle",
      nameResolutionPending: false,
    });

    const universityOnly = resolveAcademicProfileSummary({ universityId: "university-1" }, {
      universityName: "Ankara Üniversitesi",
    });
    expect(universityOnly).toMatchObject({
      complete: true,
      nameResolutionPending: false,
    });
    expect(universityOnly).not.toHaveProperty("facultyLabel");
    expect(universityOnly).not.toHaveProperty("departmentLabel");
  });

  it("makes missing university explicit and exposes the completion action", () => {
    expect(resolveAcademicProfileSummary({
      universityId: null,
      facultyId: "stale-faculty",
      departmentId: "stale-department",
      classLevel: 2,
    })).toEqual({
      complete: false,
      status: "incomplete",
      universityLabel: "Üniversite seçilmedi",
      supportingText: "Akademik içerikleri kişiselleştirmek için üniversiteni ekle.",
      actionLabel: "Akademik profili tamamla",
      nameResolutionPending: false,
    });
  });

  it("builds a hierarchy-safe editor draft from the server profile", () => {
    expect(profileDraftFromServer({
      universityId: " university-1 ",
      facultyId: " faculty-1 ",
      departmentId: " department-1 ",
      classLevel: 6,
    })).toEqual({
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      classLevel: 6,
    });
    expect(profileDraftFromServer({
      universityId: "university-1",
      facultyId: null,
      departmentId: "stale-department",
      classLevel: 7,
    })).toEqual({
      universityId: "university-1",
      facultyId: "",
      departmentId: "",
      classLevel: null,
    });
  });

  it("commits once and treats returned profile IDs as authoritative", async () => {
    const save = vi.fn().mockResolvedValue({
      id: "owner-1",
      universityId: "server-university",
      facultyId: "server-faculty",
      departmentId: "server-department",
      classLevel: 4,
    });
    const result = await commitAcademicProfileDraft({
      universityId: "draft-university",
      facultyId: "draft-faculty",
      departmentId: "draft-department",
      classLevel: 2,
    }, save);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      universityId: "draft-university",
      facultyId: "draft-faculty",
      departmentId: "draft-department",
      classLevel: 2,
    });
    expect(result).toEqual({
      ok: true,
      profile: expect.objectContaining({ universityId: "server-university", classLevel: 4 }),
      draft: {
        universityId: "server-university",
        facultyId: "server-faculty",
        departmentId: "server-department",
        classLevel: 4,
      },
    });
  });

  it("does not call the mutation when the required university is missing", async () => {
    const save = vi.fn();
    await expect(commitAcademicProfileDraft({
      universityId: "",
      facultyId: "",
      departmentId: "",
      classLevel: null,
    }, save)).resolves.toEqual({ ok: false, reason: "university_required" });
    expect(save).not.toHaveBeenCalled();
  });

  it("detects notification changes across master, mode, and category drafts", () => {
    const initial: NotificationPreferenceComparable = {
      enabled: true,
      mode: "all_calendar",
      categories: { exams: true, registration: true },
    };
    expect(hasNotificationPreferenceChanges(initial, { ...initial })).toBe(false);
    expect(hasNotificationPreferenceChanges(initial, { ...initial, enabled: false })).toBe(true);
    expect(hasNotificationPreferenceChanges(initial, { ...initial, mode: "selected_fields" })).toBe(true);
    expect(hasNotificationPreferenceChanges(initial, {
      ...initial,
      categories: { exams: false, registration: true },
    })).toBe(true);
    expect(hasNotificationPreferenceChanges({
      ...initial,
      categories: {},
    }, initial)).toBe(false);
  });

  it("marks delivery active only when preference, OS permission, and registration all agree", () => {
    const active = resolveNotificationTruth({
      preferenceEnabled: true,
      permission: "granted",
      registration: "registered",
      saveState: "saved",
    });
    expect(active).toMatchObject({ active: true, kind: "active", tone: "success", mismatch: false });

    for (const input of [
      { preferenceEnabled: false, permission: "granted" as const, registration: "registered" as const },
      { preferenceEnabled: true, permission: "denied" as const, registration: "unregistered" as const },
      { preferenceEnabled: true, permission: "granted" as const, registration: "unregistered" as const },
    ]) {
      expect(resolveNotificationTruth({ ...input, saveState: "saved" }).active).toBe(false);
    }
  });

  it("distinguishes permission, registration, busy, and controlled error states", () => {
    expect(resolveNotificationTruth({
      preferenceEnabled: true,
      permission: "permanently_denied",
      registration: "unregistered",
      saveState: "dirty",
    })).toMatchObject({
      kind: "permission_mismatch",
      mismatch: true,
      openSettingsRequired: true,
      preferenceLabel: "Açık",
    });
    expect(resolveNotificationTruth({
      preferenceEnabled: false,
      permission: "granted",
      registration: "unregistered",
      saveState: "dirty",
    }).preferenceLabel).toBe("Kapalı");
    expect(resolveNotificationTruth({
      preferenceEnabled: true,
      permission: "granted",
      registration: "unregistered",
      saveState: "saved",
    })).toMatchObject({ kind: "registration_mismatch", mismatch: true });
    expect(resolveNotificationTruth({
      preferenceEnabled: true,
      permission: "checking",
      registration: "registering",
      saveState: "saving",
    })).toMatchObject({ kind: "busy", busy: true, active: false });
    expect(resolveNotificationTruth({
      preferenceEnabled: true,
      permission: "unavailable",
      registration: "unregistered",
      saveState: "loading",
    })).toMatchObject({
      kind: "busy",
      busy: true,
      active: false,
      permissionLabel: "Bu cihazda kullanılamıyor",
    });
    expect(resolveNotificationTruth({
      preferenceEnabled: true,
      permission: "error",
      registration: "error",
      saveState: "error",
      errorMessage: "Kontrollü hata",
    })).toMatchObject({ kind: "error", detail: "Kontrollü hata", active: false });
  });

  it("provides stable human-readable Google lifecycle presentations", () => {
    expect(resolveGoogleCalendarPresentation("disconnected")).toMatchObject({
      label: "Bağlı değil",
      connected: false,
      busy: false,
    });
    expect(resolveGoogleCalendarPresentation("checking")).toMatchObject({ busy: true, connected: false });
    expect(resolveGoogleCalendarPresentation("connected")).toMatchObject({ tone: "success", connected: true });
    expect(resolveGoogleCalendarPresentation("expired")).toMatchObject({ requiresReconnect: true, connected: false });
    expect(resolveGoogleCalendarPresentation("syncing")).toMatchObject({ busy: true, connected: true });
    expect(resolveGoogleCalendarPresentation("partial")).toMatchObject({ tone: "warning", connected: true });
    expect(resolveGoogleCalendarPresentation("error")).toMatchObject({ tone: "error", connected: false });
  });

  it("uses one readable column and reachable controls at 320 dp and 200% font scale", () => {
    expect(resolveProfileSettingsLayout(320, 2)).toEqual({
      compact: true,
      largeText: true,
      gutter: 16,
      maxWidth: 720,
      columns: 1,
      notificationModeOrientation: "vertical",
      minimumTouchTarget: 48,
      horizontalScrollingAllowed: false,
    });
    expect(resolveProfileSettingsLayout(390, 1)).toMatchObject({
      compact: false,
      largeText: false,
      gutter: 20,
      notificationModeOrientation: "horizontal",
    });
    expect(resolveProfileSettingsLayout(900, 1)).toMatchObject({ gutter: 24, columns: 1 });
  });

  it("keeps fake-social and Phase 11 implementation markers out of the production surface", () => {
    const profileSource = readFileSync(
      new URL("../../apps/mobile-native/src/profile/ProfileSettings.tsx", import.meta.url),
      "utf8",
    );
    const modelSource = readFileSync(
      new URL("../../apps/mobile-native/src/profile/profile-model.ts", import.meta.url),
      "utf8",
    );
    for (const forbiddenFeature of [
      "profile_photo",
      "student_id",
      "connections",
      "followers",
      "endorsements",
      "posts",
      "engagement_statistics",
    ]) {
      expect(profileSource).not.toContain(forbiddenFeature);
      expect(modelSource).not.toContain(`\"${forbiddenFeature}\"`);
    }
    expect(profileSource).not.toContain("EXPO_PUBLIC_PHASE11");
    expect(modelSource).not.toContain("phase11Started");
  });

  it("wires the routed production screens, one academic commit, truthful delivery, and dual preview gate", () => {
    const appSource = readFileSync(
      new URL("../../apps/mobile-native/App.tsx", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    const academicSave = appSource.slice(
      appSource.indexOf("async function saveAcademicProfileSettings"),
      appSource.indexOf("function renderAuthOnboardingScreen"),
    );
    const profileRoutes = appSource.slice(
      appSource.indexOf("const profileOverviewScreen"),
      appSource.indexOf("const routeLeaveGuard"),
    );

    expect(appSource).toContain("Profile: profileOverviewScreen");
    expect(appSource).toContain("AcademicProfileSettings: academicProfileSettingsScreen");
    expect(appSource).toContain("NotificationSettings: notificationSettingsScreen");
    expect(appSource).toContain("GoogleCalendarSettings: googleCalendarSettingsScreen");
    expect(appSource).toContain("AccountDataSettings: accountDataSettingsScreen");
    expect(academicSave).toContain("commitAcademicProfileDraft(");
    expect(academicSave).toContain('method: "PATCH"');
    expect(academicSave.match(/method: "PATCH"/gu)).toHaveLength(1);
    expect(academicSave).toContain("const authoritativeDraft = result.draft");
    expect(appSource).toContain("preferenceEnabled: notificationLifecycle.preferenceEnabled");
    expect(appSource).toContain("dirty={notificationPreferenceDirty}");
    expect(profileRoutes).toContain('onBack={() => requestAppRoute("Profile")}');
    expect(appSource).toContain("connectionExists={Boolean(googleCalendarIntegration)}");
    expect(profileRoutes).toContain("email={email}");
    expect(profileRoutes).toContain("fullName={fullName}");
    expect(profileRoutes).not.toContain("email={session.user.email}");
    expect(profileRoutes).not.toContain("fullName={session.user.fullName}");
    expect(profileRoutes).toContain("operationBusy={googleCalendarBusy}");
    expect(profileRoutes).toContain(
      "managedEventCount={googleCalendarIntegration?.mappings.length ?? googleCalendarLastResult?.verified}",
    );
    expect(profileRoutes).toContain("setMessage(null);\n          requestAppRoute(\"AccountDataSettings\");");
    expect(appSource).toContain(
      "const routeLeaveGuard: AppRouteLeaveGuard | null =\n    academicProfileDirty",
    );
    expect(appSource).not.toContain(
      'controlledActiveRoute === "AcademicProfileSettings" && academicProfileDirty',
    );
    expect(appSource).toContain("__DEV__\n    && process.env.EXPO_PUBLIC_PHASE10_PROFILE_PREVIEW === \"1\"");
    expect(appSource.indexOf("if (showPhase10ProfilePreview)")).toBeLessThan(
      appSource.indexOf("if (showPhase9CalendarPreview)"),
    );
    expect(appSource).not.toContain("EXPO_PUBLIC_PHASE11");
  });

  it("reports package metadata from the real native app configuration", () => {
    const appConfig = JSON.parse(readFileSync(
      new URL("../../apps/mobile-native/app.json", import.meta.url),
      "utf8",
    )) as {
      expo: {
        name: string;
        version: string;
        userInterfaceStyle: string;
        splash: { backgroundColor: string; dark: { backgroundColor: string } };
        android: { versionCode: number };
      };
    };
    expect(appConfig.expo.name).toBe("Akademik Takvim");
    expect(appConfig.expo.version).toBe("0.1.0");
    expect(appConfig.expo.android.versionCode).toBe(17);
    expect(appConfig.expo.userInterfaceStyle).toBe("light");
    expect(appConfig.expo.splash.backgroundColor).toBe("#ffffff");
    expect(appConfig.expo.splash.dark.backgroundColor).toBe("#ffffff");

    const androidBuild = readFileSync(
      new URL("../../apps/mobile-native/android/app/build.gradle", import.meta.url),
      "utf8",
    );
    expect(androidBuild).toContain("versionCode 17");
    expect(androidBuild).toContain('versionName "0.1.0"');

    const androidStrings = readFileSync(
      new URL("../../apps/mobile-native/android/app/src/main/res/values/strings.xml", import.meta.url),
      "utf8",
    );
    const androidNightColors = readFileSync(
      new URL("../../apps/mobile-native/android/app/src/main/res/values-night/colors.xml", import.meta.url),
      "utf8",
    );
    expect(androidStrings).toContain(
      '<string name="app_name">Akademik Takvim</string>',
    );
    expect(androidStrings).toContain(
      '<string name="expo_system_ui_user_interface_style" translatable="false">light</string>',
    );
    expect(androidNightColors).toContain(
      '<color name="splashscreen_background">#ffffff</color>',
    );
  });
});
