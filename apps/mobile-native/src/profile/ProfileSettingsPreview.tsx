import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
} from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Screen,
  ThemeProvider,
  usePlatformAdaptation,
  useReducedMotion,
  useTheme,
  type ThemePreference,
} from "../design-system";
import {
  EMPTY_ACADEMIC_ONBOARDING_DRAFT,
  selectAcademicClassLevel,
  selectAcademicDepartment,
  selectAcademicFaculty,
  selectAcademicUniversity,
  type AcademicClassLevel,
  type AcademicOnboardingDraft,
} from "../auth/auth-ui";
import { AdaptiveTopBar } from "../navigation/AdaptiveTopBar";
import {
  AccountDataSettingsScreen,
  AcademicProfileSettingsScreen,
  GoogleCalendarSettingsScreen,
  NotificationSettingsScreen,
  ProfileOverviewScreen,
  type NotificationCategoryOption,
  type ProfileMutationState,
} from "./ProfileSettings";
import {
  resolveAcademicProfileSummary,
  resolveGoogleCalendarPresentation,
  resolveNotificationTruth,
  type NotificationPreferenceMode,
  type NotificationPreferenceSaveState,
} from "./profile-model";
import type {
  NotificationPermissionState,
  NotificationRegistrationState,
} from "../notifications/notification-lifecycle";

export const PROFILE_SETTINGS_PREVIEW_SCENARIOS = [
  "profile-summary",
  "reference-profile",
  "profile-incomplete",
  "academic-editor",
  "notifications-active",
  "notifications-denied",
  "notifications-settings-required",
  "notifications-registering",
  "notifications-error",
  "google-disconnected",
  "google-connected",
  "google-partial",
  "google-expired",
  "account-management",
  "danger-expanded",
  "data-confirm",
  "data-error",
  "account-confirm",
  "account-error",
] as const;

export type ProfileSettingsPreviewScenario = (
  typeof PROFILE_SETTINGS_PREVIEW_SCENARIOS
)[number];

/**
 * The host must additionally require __DEV__ and the explicit Phase 10 preview
 * environment flag. This module supplies only synthetic, non-live fixtures.
 */
export const PHASE_10_PROFILE_PREVIEW_BOUNDARY = {
  requiresDevAndExplicitEnvironmentGate: true,
  syntheticFixturesOnly: true,
  permitsProductionAccounts: false,
  permitsLiveProviders: false,
} as const;

export interface ProfileSettingsPreviewProps {
  preference?: ThemePreference;
  scenario?: ProfileSettingsPreviewScenario;
}

const COMPLETE_DRAFT: AcademicOnboardingDraft = {
  universityId: "preview-university",
  facultyId: "preview-faculty",
  departmentId: "preview-department",
  classLevel: 3,
};

const REFERENCE_PROFILE_DRAFT: AcademicOnboardingDraft = {
  universityId: "reference-ankara-university",
  facultyId: "reference-ankara-engineering",
  departmentId: "reference-ankara-computer-engineering",
  classLevel: 3,
};

const UNIVERSITIES = [
  { value: "preview-university", label: "Kampüs Üniversitesi", supportingText: "Akademik katalog" },
  { value: "preview-technical-university", label: "Kampüs Teknik Üniversitesi", supportingText: "Akademik katalog" },
  { value: "reference-ankara-university", label: "Ankara Üniversitesi", supportingText: "Akademik katalog" },
] as const;

const FACULTIES = [
  { value: "preview-faculty", label: "Mühendislik Fakültesi" },
  { value: "preview-science-faculty", label: "Fen Fakültesi" },
  { value: "reference-ankara-engineering", label: "Mühendislik Fakültesi" },
] as const;

const DEPARTMENTS = [
  { value: "preview-department", label: "Bilgisayar Mühendisliği" },
  { value: "preview-mathematics", label: "Matematik" },
  { value: "reference-ankara-computer-engineering", label: "Bilgisayar Mühendisliği" },
] as const;

const CLASS_LEVELS: readonly { value: AcademicClassLevel; label: string }[] = [
  { value: 1, label: "1. sınıf" },
  { value: 2, label: "2. sınıf" },
  { value: 3, label: "3. sınıf" },
  { value: 4, label: "4. sınıf" },
  { value: 5, label: "5. sınıf" },
  { value: 6, label: "6. sınıf" },
];

const DEFAULT_CATEGORIES: readonly NotificationCategoryOption[] = [
  { key: "registration", label: "Ders kayıtları", enabled: true },
  { key: "exam", label: "Sınav tarihleri", enabled: true },
  { key: "holiday", label: "Tatil ve ara günleri", enabled: false },
];

type ProfilePreviewStackParamList = {
  Profile: undefined;
  AcademicProfileSettings: undefined;
  NotificationSettings: undefined;
  GoogleCalendarSettings: undefined;
  AccountDataSettings: undefined;
};

type ProfilePreviewRoute = keyof ProfilePreviewStackParamList;

const ProfilePreviewStack = createNativeStackNavigator<ProfilePreviewStackParamList>();
const profilePreviewNavigationRef = createNavigationContainerRef<ProfilePreviewStackParamList>();

const PROFILE_ROUTE_BY_SCENARIO: Record<ProfileSettingsPreviewScenario, ProfilePreviewRoute> = {
  "profile-summary": "Profile",
  "reference-profile": "Profile",
  "profile-incomplete": "Profile",
  "academic-editor": "AcademicProfileSettings",
  "notifications-active": "NotificationSettings",
  "notifications-denied": "NotificationSettings",
  "notifications-settings-required": "NotificationSettings",
  "notifications-registering": "NotificationSettings",
  "notifications-error": "NotificationSettings",
  "google-disconnected": "GoogleCalendarSettings",
  "google-connected": "GoogleCalendarSettings",
  "google-partial": "GoogleCalendarSettings",
  "google-expired": "GoogleCalendarSettings",
  "account-management": "AccountDataSettings",
  "danger-expanded": "AccountDataSettings",
  "data-confirm": "AccountDataSettings",
  "data-error": "AccountDataSettings",
  "account-confirm": "AccountDataSettings",
  "account-error": "AccountDataSettings",
};

export function ProfileSettingsPreview({
  preference = "light",
  scenario = "profile-summary",
}: ProfileSettingsPreviewProps) {
  const [activePreference, setActivePreference] = useState(preference);
  const [activeScenario, setActiveScenario] = useState(scenario);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const selection = parseProfileSettingsPreviewUrl(url);
      if (!selection) return;
      setActiveScenario(selection.scenario);
      setActivePreference(selection.preference);
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider preference={activePreference}>
        <ProfileSettingsPreviewExperience scenario={activeScenario} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export function parseProfileSettingsPreviewUrl(url: string): {
  scenario: ProfileSettingsPreviewScenario;
  preference: ThemePreference;
} | null {
  const match = /^academicpulse:\/\/phase10-profile\/([a-z-]+)(?:\?theme=(light|dark))?$/u.exec(url);
  if (
    !match
    || !PROFILE_SETTINGS_PREVIEW_SCENARIOS.includes(match[1] as ProfileSettingsPreviewScenario)
  ) {
    return null;
  }
  return {
    scenario: match[1] as ProfileSettingsPreviewScenario,
    preference: match[2] === "dark" ? "dark" : "light",
  };
}

function ProfileSettingsPreviewExperience({
  scenario,
}: {
  scenario: ProfileSettingsPreviewScenario;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const referenceProfile = scenario === "reference-profile";
  const completeDraft = referenceProfile ? REFERENCE_PROFILE_DRAFT : COMPLETE_DRAFT;
  const [navigationReady, setNavigationReady] = useState(false);
  const [academicDraft, setAcademicDraft] = useState<AcademicOnboardingDraft>(completeDraft);
  const [academicSaveState, setAcademicSaveState] = useState<ProfileMutationState>("dirty");
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [notificationMode, setNotificationMode] = useState<NotificationPreferenceMode>("all_calendar");
  const [notificationCategories, setNotificationCategories] = useState(DEFAULT_CATEGORIES);
  const [notificationSaveState, setNotificationSaveState] = useState<NotificationPreferenceSaveState>("saved");

  const openRoute = useCallback((route: ProfilePreviewRoute) => {
    if (!profilePreviewNavigationRef.isReady()) return;
    profilePreviewNavigationRef.navigate(route);
  }, []);

  useEffect(() => {
    setAcademicDraft(completeDraft);
    setAcademicSaveState("dirty");
    setNotificationEnabled(true);
    setNotificationMode("all_calendar");
    setNotificationCategories(DEFAULT_CATEGORIES);
    setNotificationSaveState(scenario === "notifications-error" ? "error" : "saved");
  }, [completeDraft, scenario]);

  useEffect(() => {
    if (!navigationReady || !profilePreviewNavigationRef.isReady()) return;
    const targetRoute = PROFILE_ROUTE_BY_SCENARIO[scenario];
    profilePreviewNavigationRef.resetRoot({
      index: targetRoute === "Profile" ? 0 : 1,
      routes: targetRoute === "Profile"
        ? [{ name: "Profile" }]
        : [{ name: "Profile" }, { name: targetRoute }],
    });
  }, [navigationReady, scenario]);

  const notificationLifecycle = notificationLifecycleFixture(scenario);
  const notificationTruth = resolveNotificationTruth({
    preferenceEnabled: notificationEnabled,
    permission: notificationLifecycle.permission,
    registration: notificationLifecycle.registration,
    saveState: notificationSaveState,
    ...(scenario === "notifications-error"
      ? { errorMessage: "Sentetik cihaz teslimat durumu doğrulanamadı." }
      : {}),
  });
  const googleState = googleStateFixture(scenario);
  const googlePresentation = resolveGoogleCalendarPresentation(googleState);
  const incomplete = scenario === "profile-incomplete";
  const academicSummary = resolveAcademicProfileSummary(
    incomplete ? EMPTY_ACADEMIC_ONBOARDING_DRAFT : completeDraft,
    incomplete
      ? {}
      : {
        universityName: referenceProfile ? "Ankara Üniversitesi" : "Kampüs Üniversitesi",
        facultyName: "Mühendislik Fakültesi",
        departmentName: "Bilgisayar Mühendisliği",
      },
  );
  const profileEmail = referenceProfile
    ? "fuat.basar@ogrenci.ankara.edu.tr"
    : "deniz.yilmaz@kampus.example.invalid";
  const profileFullName = referenceProfile
    ? "Fuat Başar"
    : incomplete
      ? "Örnek Öğrenci"
      : "Deniz Örnek";
  const profileNotificationTruth = referenceProfile
    ? notificationTruth
    : resolveNotificationTruth({
      permission: "granted",
      preferenceEnabled: true,
      registration: "registered",
      saveState: "saved",
    });

  const accountScenarioError = scenario === "data-error"
    ? "Sentetik veri silme isteği tamamlanamadı."
    : scenario === "account-error"
      ? "Sentetik hesap silme isteği tamamlanamadı."
      : undefined;
  const shouldRejectDataDeletion = scenario === "data-error";
  const shouldRejectAccountDeletion = scenario === "account-error";

  const screens = useMemo<Record<ProfilePreviewRoute, React.ReactNode>>(() => {
    return {
      Profile: (
        <ProfileOverviewScreen
          academicSummary={academicSummary}
          appVersion="0.1.2"
          email={profileEmail}
          fullName={profileFullName}
          googleAccountEmail={incomplete ? undefined : profileEmail}
          googleCalendar={resolveGoogleCalendarPresentation(incomplete ? "disconnected" : "connected")}
          notificationTruth={profileNotificationTruth}
          followedUniversityCount={2}
          onOpenAcademicProfile={() => openRoute("AcademicProfileSettings")}
          onOpenFollowedUniversities={() => undefined}
          onOpenNotifications={() => openRoute("NotificationSettings")}
          onOpenGoogleCalendar={() => openRoute("GoogleCalendarSettings")}
          onOpenAccountManagement={() => openRoute("AccountDataSettings")}
          onLogout={() => undefined}
        />
      ),
      AcademicProfileSettings: (
        <AcademicProfileSettingsScreen
          busy={false}
          classLevels={CLASS_LEVELS}
          departments={DEPARTMENTS}
          departmentsLoading={false}
          dirty={academicSaveState === "dirty"}
          draft={academicDraft}
          faculties={FACULTIES}
          facultiesLoading={false}
          onCancel={() => {
            if (profilePreviewNavigationRef.canGoBack()) {
              profilePreviewNavigationRef.goBack();
            } else {
              openRoute("Profile");
            }
          }}
          onClassLevelChange={(classLevel) => {
            setAcademicDraft((current) => selectAcademicClassLevel(current, classLevel));
            setAcademicSaveState("dirty");
          }}
          onDepartmentChange={(departmentId) => {
            setAcademicDraft((current) => selectAcademicDepartment(current, departmentId));
            setAcademicSaveState("dirty");
          }}
          onFacultyChange={(facultyId) => {
            setAcademicDraft((current) => selectAcademicFaculty(current, facultyId));
            setAcademicSaveState("dirty");
          }}
          onRetryDepartments={() => undefined}
          onRetryFaculties={() => undefined}
          onRetryUniversities={() => undefined}
          onSave={() => setAcademicSaveState("saved")}
          onUniversityChange={(universityId) => {
            setAcademicDraft((current) => selectAcademicUniversity(current, universityId));
            setAcademicSaveState("dirty");
          }}
          saveState={academicSaveState}
          universities={UNIVERSITIES}
          universitiesLoading={false}
        />
      ),
      NotificationSettings: (
        <NotificationSettingsScreen
          categories={notificationCategories}
          dirty={notificationSaveState === "dirty"}
          error={scenario === "notifications-error" ? "Sentetik tercih kaydı doğrulanamadı." : undefined}
          mode={notificationMode}
          onBack={() => {
            if (profilePreviewNavigationRef.canGoBack()) {
              profilePreviewNavigationRef.goBack();
            } else {
              openRoute("Profile");
            }
          }}
          onCategoryChange={(key, enabled) => {
            setNotificationCategories((current) => current.map((category) => (
              category.key === key ? { ...category, enabled } : category
            )));
            setNotificationSaveState("dirty");
          }}
          onModeChange={(mode) => {
            setNotificationMode(mode);
            setNotificationSaveState("dirty");
          }}
          onOpenSettings={() => undefined}
          onPreferenceEnabledChange={(enabled) => {
            setNotificationEnabled(enabled);
            setNotificationSaveState("dirty");
          }}
          onRetry={() => setNotificationSaveState("saved")}
          onSave={() => setNotificationSaveState("saved")}
          preferenceEnabled={notificationEnabled}
          quietHoursSummary="Bu sürümde ayarlanabilir sessiz saat bulunmuyor."
          reminderSummary="Takvim kaynağındaki doğrulanmış tarihlere göre"
          saveState={notificationSaveState}
          truth={notificationTruth}
        />
      ),
      GoogleCalendarSettings: (
        <GoogleCalendarSettingsScreen
          accountEmail={googleState === "disconnected" ? undefined : profileEmail}
          connectionExists={googleState !== "disconnected"}
          lastSyncedLabel={googleState === "disconnected" ? undefined : "5 Ağustos 2026 09:30"}
          managedEventCount={googleState === "disconnected" ? undefined : 4}
          mappingWarning={googleState === "partial" ? "Bir sentetik akademik kayıt hedef takvimle eşleşmedi." : undefined}
          onConnect={() => undefined}
          onDisconnect={() => undefined}
          onRemoveManagedEvents={() => undefined}
          onRevokeAccess={() => undefined}
          onSwitchAccount={() => undefined}
          onSync={() => undefined}
          presentation={googlePresentation}
          warnings={googleState === "partial" ? ["Doğrulanan kayıtlar korundu; kalan kayıt yeniden denenebilir."] : []}
        />
      ),
      AccountDataSettings: (
        <AccountDataSettingsScreen
          key={scenario}
          email={profileEmail}
          error={accountScenarioError}
          onDeleteAccount={() => (
            shouldRejectAccountDeletion
              ? Promise.reject(new Error("synthetic account deletion failure"))
              : Promise.resolve()
          )}
          onDeleteData={() => (
            shouldRejectDataDeletion
              ? Promise.reject(new Error("synthetic data deletion failure"))
              : Promise.resolve()
          )}
          onLogout={() => undefined}
        />
      ),
    };
  }, [
    academicDraft,
    academicSaveState,
    academicSummary,
    accountScenarioError,
    googlePresentation,
    googleState,
    incomplete,
    notificationCategories,
    notificationEnabled,
    notificationMode,
    notificationSaveState,
    notificationTruth,
    openRoute,
    profileEmail,
    profileFullName,
    profileNotificationTruth,
    scenario,
    shouldRejectAccountDeletion,
    shouldRejectDataDeletion,
  ]);

  return (
    <NavigationContainer
      ref={profilePreviewNavigationRef}
      onReady={() => setNavigationReady(true)}
    >
      <ProfilePreviewStack.Navigator
        initialRouteName="Profile"
        screenOptions={{
          animation: reducedMotion ? "none" : "default",
          contentStyle: { backgroundColor: theme.colors.background.canvas },
          header: renderProfilePreviewHeader,
          headerBackTitle: "Profil",
        }}
      >
        <ProfilePreviewStack.Screen name="Profile" options={{ headerShown: false, title: "Profil" }}>
          {() => <PreviewScreen headerless>{screens.Profile}</PreviewScreen>}
        </ProfilePreviewStack.Screen>
        <ProfilePreviewStack.Screen name="AcademicProfileSettings" options={{ title: "Akademik Profil" }}>
          {() => <PreviewScreen>{screens.AcademicProfileSettings}</PreviewScreen>}
        </ProfilePreviewStack.Screen>
        <ProfilePreviewStack.Screen name="NotificationSettings" options={{ headerShown: false, title: "Bildirim tercihleri" }}>
          {() => <PreviewScreen headerless>{screens.NotificationSettings}</PreviewScreen>}
        </ProfilePreviewStack.Screen>
        <ProfilePreviewStack.Screen name="GoogleCalendarSettings" options={{ title: "Google Takvim" }}>
          {() => <PreviewScreen>{screens.GoogleCalendarSettings}</PreviewScreen>}
        </ProfilePreviewStack.Screen>
        <ProfilePreviewStack.Screen name="AccountDataSettings" options={{ title: "Hesap ve Veri" }}>
          {() => <PreviewScreen>{screens.AccountDataSettings}</PreviewScreen>}
        </ProfilePreviewStack.Screen>
      </ProfilePreviewStack.Navigator>
    </NavigationContainer>
  );
}

function PreviewScreen({
  children,
  headerless = false,
}: {
  children: React.ReactNode;
  headerless?: boolean;
}) {
  return (
    <Screen
      contentStyle={{ paddingBottom: 32 }}
      edges={headerless ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"]}
      readableWidth="content"
      scroll
      scrollViewProps={{ contentInsetAdjustmentBehavior: "automatic" }}
    >
      {children}
    </Screen>
  );
}

function ProfilePreviewHeader({
  back,
  navigation,
  options,
  route,
}: NativeStackHeaderProps) {
  const adaptation = usePlatformAdaptation();
  const theme = useTheme();
  return (
    <AdaptiveTopBar
      title={options.title ?? route.name}
      leadingAction={back ? {
        accessibilityHint: "Profil ekranına döner.",
        accessibilityLabel: "Geri dön",
        icon: (
          <Ionicons
            color={theme.colors.text.primary}
            name={adaptation.platform === "ios" ? "chevron-back" : "arrow-back"}
            size={22}
          />
        ),
        onPress: () => navigation.goBack(),
      } : undefined}
    />
  );
}

function renderProfilePreviewHeader(props: NativeStackHeaderProps) {
  return <ProfilePreviewHeader {...props} />;
}

function notificationLifecycleFixture(scenario: ProfileSettingsPreviewScenario): {
  permission: NotificationPermissionState;
  registration: NotificationRegistrationState;
} {
  switch (scenario) {
    case "notifications-denied":
      return { permission: "denied", registration: "unregistered" };
    case "reference-profile":
    case "notifications-settings-required":
      return { permission: "permanently_denied", registration: "unregistered" };
    case "notifications-registering":
      return { permission: "granted", registration: "registering" };
    case "notifications-error":
      return { permission: "error", registration: "error" };
    default:
      return { permission: "granted", registration: "registered" };
  }
}

function googleStateFixture(scenario: ProfileSettingsPreviewScenario) {
  switch (scenario) {
    case "google-disconnected":
      return "disconnected" as const;
    case "google-partial":
      return "partial" as const;
    case "google-expired":
      return "expired" as const;
    default:
      return "connected" as const;
  }
}
