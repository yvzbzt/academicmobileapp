import { Platform } from "react-native";
import { Banner, BottomSheet } from "../../design-system";
import { findDuplicateGoogleCalendarMappings } from "../../google-calendar/google-calendar-lifecycle";
import { openNotificationSettings } from "../../notifications";
import { RecentAuthenticationPanel } from "../../auth/RecentAuthenticationPanel";
import {
  selectAcademicClassLevel,
  selectAcademicDepartment,
  selectAcademicFaculty,
  selectAcademicUniversity,
} from "../../auth/auth-ui";
import {
  ProfileOverviewScreen,
  AcademicProfileSettingsScreen,
  NotificationSettingsScreen,
  AppleCalendarSettingsScreen,
  GoogleCalendarSettingsScreen,
  AccountDataSettingsScreen,
} from "../../profile/ProfileSettings";
import { FollowedUniversitiesSettingsScreen } from "../../profile/FollowedUniversitiesSettings";
import { cleanupTargetLabel } from "../app-errors";
import { NATIVE_APP_VERSION, UNIVERSITY_TYPE_LABELS } from "../app-config";
import { toCategoryLabel, formatDateTimeShort } from "../app-content";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "cleanupIssue" | "session" | "busy" | "googleBusy" | "message" | "academicProfileSaveState"
  | "recentAuthAction" | "recentAuthBusy" | "recentAuthError" | "setRecentAuthPassword"
  | "setRecentAuthError" | "recentAuthPassword" | "email" | "universities" | "fullName"
  | "googleCalendarIntegration" | "setAccountDrawerVisible" | "requestAppRoute" | "setMessage"
  | "departments" | "faculties" | "registerFacultyId" | "registerUniversityId"
  | "academicProfileSaveError" | "followedUniversityBusyId" | "followedUniversities"
  | "selectedUniversityId" | "categoryDraft" | "notificationPreferenceError" | "preferences"
  | "alarmMode" | "alarmEnabled" | "appleCalendarStoredState" | "appleCalendarError"
  | "nativeCalendarService" | "appleCalendarState" | "appleCalendarPermission"
  | "appleCalendarWarnings" | "googleCalendarError" | "googleCalendarLastResult"
  | "googleCalendarBusy" | "googleCalendarWarnings" | "recentAuthReturnFocus"
> & Pick<ApplicationActions,
  "retryFailedCleanup" | "dismissRecentAuthentication" | "submitRecentAuthentication"
  | "loadUniversities" | "handleLogout" | "updateOnboardingDraft" | "loadDepartmentsForRegistration"
  | "loadFacultiesForRegistration" | "saveAcademicProfileSettings" | "loadFollowedUniversities"
  | "toggleFollowedUniversity" | "updateCategory" | "updateAlarmMode" | "updateAlarmEnabled"
  | "retryNotificationSettings" | "saveAlarmSettings" | "disconnectAppleCalendar"
  | "syncAppleCalendar" | "openFirstManagedAppleCalendarEvent" | "syncGoogleCalendar"
  | "disconnectGoogleCalendar" | "promptGoogleCalendarAccountSwitch" | "beginRecentAuthentication"
> & Pick<ApplicationDerivedState,
  "controlledActiveRoute" | "academicProfileDirty" | "availableRecentAuthMethods"
  | "academicProfileSummary" | "additionalFollowedUniversities" | "googleCalendarPresentation"
  | "appleCalendarPresentation" | "notificationTruth" | "academicClassLevelOptions"
  | "academicOnboardingDraft" | "availableCategories" | "notificationPreferenceDirty"
  | "notificationPreferenceSaveState"
>;

export function createProfileScreens(dependencies: Dependencies) {
  const {
    cleanupIssue,
    session,
    busy,
    googleBusy,
    retryFailedCleanup,
    controlledActiveRoute,
    message,
    academicProfileSaveState,
    academicProfileDirty,
    recentAuthAction,
    recentAuthBusy,
    dismissRecentAuthentication,
    recentAuthError,
    availableRecentAuthMethods,
    setRecentAuthPassword,
    setRecentAuthError,
    submitRecentAuthentication,
    recentAuthPassword,
    academicProfileSummary,
    email,
    universities,
    fullName,
    additionalFollowedUniversities,
    googleCalendarIntegration,
    googleCalendarPresentation,
    appleCalendarPresentation,
    notificationTruth,
    setAccountDrawerVisible,
    requestAppRoute,
    setMessage,
    loadUniversities,
    handleLogout,
    academicClassLevelOptions,
    departments,
    academicOnboardingDraft,
    faculties,
    updateOnboardingDraft,
    loadDepartmentsForRegistration,
    registerFacultyId,
    loadFacultiesForRegistration,
    registerUniversityId,
    saveAcademicProfileSettings,
    academicProfileSaveError,
    followedUniversityBusyId,
    followedUniversities,
    loadFollowedUniversities,
    toggleFollowedUniversity,
    selectedUniversityId,
    availableCategories,
    categoryDraft,
    notificationPreferenceDirty,
    notificationPreferenceError,
    preferences,
    alarmMode,
    updateCategory,
    updateAlarmMode,
    updateAlarmEnabled,
    retryNotificationSettings,
    saveAlarmSettings,
    alarmEnabled,
    notificationPreferenceSaveState,
    appleCalendarStoredState,
    appleCalendarError,
    disconnectAppleCalendar,
    syncAppleCalendar,
    openFirstManagedAppleCalendarEvent,
    nativeCalendarService,
    appleCalendarState,
    appleCalendarPermission,
    appleCalendarWarnings,
    googleCalendarError,
    googleCalendarLastResult,
    syncGoogleCalendar,
    disconnectGoogleCalendar,
    promptGoogleCalendarAccountSwitch,
    googleCalendarBusy,
    googleCalendarWarnings,
    beginRecentAuthentication,
    recentAuthReturnFocus
  } = dependencies;

  const profileCleanupCanRetry = Boolean(cleanupIssue?.failedTargets.some(
    (target) => target !== "server_session"
      && target !== "server_account"
      && (target !== "device_registration" || Boolean(session))
  ));

  const profileCleanupIssue = cleanupIssue ? (
    <Banner
      actionLabel={profileCleanupCanRetry && !busy && !googleBusy ? "Temizliği tekrar dene" : undefined}
      message={cleanupIssue.failedTargets.map(cleanupTargetLabel).join(", ")}
      onAction={profileCleanupCanRetry && !busy && !googleBusy ? () => void retryFailedCleanup() : undefined}
      title="Tamamlanamayan güvenli temizlik"
      tone="warning"
    />
  ) : null;

  const profileRouteFeedback = (
    <>
      {controlledActiveRoute === "Profile" && message && !cleanupIssue ? (
        <Banner
          message={message.text}
          title={message.tone === "error"
            ? "İşlem tamamlanamadı"
            : message.tone === "success"
              ? "İşlem tamamlandı"
              : "Bilgi"}
          tone={message.tone}
        />
      ) : null}
      {controlledActiveRoute === "Profile" ? profileCleanupIssue : null}
    </>
  );

  const academicScreenSaveState = academicProfileSaveState === "idle" && academicProfileDirty
    ? "dirty" as const
    : academicProfileSaveState;

  const recentAuthenticationPanel = recentAuthAction ? (
    <BottomSheet
      dismissible={!recentAuthBusy}
      onDismiss={dismissRecentAuthentication}
      scrollable
      title="Kimliğini yeniden doğrula"
      visible
    >
      <RecentAuthenticationPanel
        action={recentAuthAction}
        busy={recentAuthBusy}
        error={recentAuthError}
        methods={availableRecentAuthMethods}
        onCancel={dismissRecentAuthentication}
        onPasswordChange={(value) => {
          setRecentAuthPassword(value);
          setRecentAuthError(undefined);
        }}
        onSubmitGoogle={() => void submitRecentAuthentication("google")}
        onSubmitApple={() => void submitRecentAuthentication("apple")}
        onSubmitPassword={() => void submitRecentAuthentication("password")}
        password={recentAuthPassword}
      />
    </BottomSheet>
  ) : undefined;

  const profileOverviewScreen = session ? (
    <>
      {profileRouteFeedback}
      <ProfileOverviewScreen
        academicSummary={academicProfileSummary}
        appVersion={NATIVE_APP_VERSION}
        email={email}
        error={academicProfileSummary.nameResolutionPending ? universities.error : undefined}
        fullName={fullName}
        followedUniversityCount={additionalFollowedUniversities.length}
        googleAccountEmail={googleCalendarIntegration?.accountEmail}
        googleCalendar={googleCalendarPresentation}
        appleCalendar={Platform.OS === "ios" ? appleCalendarPresentation : undefined}
        loading={false}
        notificationTruth={notificationTruth}
        onOpenAccountMenu={() => setAccountDrawerVisible(true)}
        onOpenAcademicProfile={() => requestAppRoute("AcademicProfileSettings")}
        onOpenFollowedUniversities={() => requestAppRoute("FollowedUniversitiesSettings")}
        onOpenAccountManagement={() => {
          setMessage(null);
          requestAppRoute("AccountDataSettings");
        }}
        onOpenAppleCalendar={Platform.OS === "ios" ? () => requestAppRoute("AppleCalendarSettings") : undefined}
        onOpenGoogleCalendar={() => requestAppRoute("GoogleCalendarSettings")}
        onOpenNotifications={() => requestAppRoute("NotificationSettings")}
        onRetry={() => void loadUniversities()}
        onLogout={() => handleLogout()}
      />
    </>
  ) : null;

  const academicProfileSettingsScreen = session ? (
    <>
      <AcademicProfileSettingsScreen
        busy={busy}
        classLevels={academicClassLevelOptions}
        departments={(departments.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
        departmentsError={departments.error}
        departmentsLoading={departments.loading}
        dirty={academicProfileDirty}
        draft={academicOnboardingDraft}
        faculties={(faculties.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
        facultiesError={faculties.error}
        facultiesLoading={faculties.loading}
        onCancel={() => requestAppRoute("Profile")}
        onClassLevelChange={(value) => updateOnboardingDraft(
          selectAcademicClassLevel(academicOnboardingDraft, value)
        )}
        onDepartmentChange={(value) => updateOnboardingDraft(
          selectAcademicDepartment(academicOnboardingDraft, value)
        )}
        onFacultyChange={(value) => updateOnboardingDraft(
          selectAcademicFaculty(academicOnboardingDraft, value)
        )}
        onRetryDepartments={() => void loadDepartmentsForRegistration(registerFacultyId)}
        onRetryFaculties={() => void loadFacultiesForRegistration(registerUniversityId)}
        onRetryUniversities={() => void loadUniversities()}
        onSave={() => void saveAcademicProfileSettings()}
        onUniversityChange={(value) => updateOnboardingDraft(
          selectAcademicUniversity(academicOnboardingDraft, value)
        )}
        saveError={academicProfileSaveError}
        saveState={academicScreenSaveState}
        universities={(universities.data ?? []).map((item) => ({
          value: item.id,
          label: item.name,
          supportingText: [item.city, UNIVERSITY_TYPE_LABELS[item.type] ?? item.type].filter(Boolean).join(" · ")
        }))}
        universitiesError={universities.error}
        universitiesLoading={universities.loading}
        universityRequiredError={!academicOnboardingDraft.universityId && academicProfileSaveState === "error"
          ? "Üniversite seçimi zorunludur."
          : undefined}
      />
    </>
  ) : null;

  const followedUniversitiesSettingsScreen = session ? (
    <FollowedUniversitiesSettingsScreen
      busyUniversityId={followedUniversityBusyId}
      error={followedUniversities.error ?? universities.error}
      followed={additionalFollowedUniversities}
      loading={followedUniversities.loading || universities.loading}
      onRetry={() => {
        void loadUniversities();
        void loadFollowedUniversities();
      }}
      onToggle={toggleFollowedUniversity}
      primaryUniversityId={selectedUniversityId || registerUniversityId}
      universities={universities.data ?? []}
    />
  ) : null;

  const notificationSettingsScreen = session ? (
    <>
      <NotificationSettingsScreen
        categories={availableCategories.map((category) => ({
          key: category,
          label: toCategoryLabel(category),
          enabled: categoryDraft[category] !== false
        }))}
        dirty={notificationPreferenceDirty}
        error={notificationPreferenceError ?? preferences.error}
        mode={alarmMode}
        onCategoryChange={updateCategory}
        onModeChange={updateAlarmMode}
        onBack={() => requestAppRoute("Profile")}
        onOpenSettings={() => openNotificationSettings()}
        onPreferenceEnabledChange={updateAlarmEnabled}
        onRetry={() => void retryNotificationSettings()}
        onSave={() => void saveAlarmSettings()}
        preferenceEnabled={alarmEnabled}
        quietHoursSummary={preferences.data?.quietHours
          ? preferences.data.quietHours.enabled
            ? `${preferences.data.quietHours.start}–${preferences.data.quietHours.end} · ${preferences.data.quietHours.timezone}`
            : "Kapalı"
          : undefined}
        reminderSummary={preferences.data?.reminderOffsets.length
          ? preferences.data.reminderOffsets
            .map((offset) => offset === 0 ? "aynı gün" : `${offset} gün önce`)
            .join(", ")
          : undefined}
        saveState={notificationPreferenceSaveState}
        truth={notificationTruth}
      />
    </>
  ) : null;

  const appleCalendarSettingsScreen = session && Platform.OS === "ios" ? (
    <AppleCalendarSettingsScreen
      calendarTitle={appleCalendarStoredState.integration?.deviceCalendarTitle}
      error={appleCalendarError ?? undefined}
      lastSyncedLabel={appleCalendarStoredState.integration?.lastSuccessfulSyncAt
        ? formatDateTimeShort(appleCalendarStoredState.integration.lastSuccessfulSyncAt)
        : undefined}
      managedEventCount={Object.keys(appleCalendarStoredState.mappings).length}
      onDisconnect={() => disconnectAppleCalendar(false)}
      onEnable={syncAppleCalendar}
      onOpenCalendar={Object.keys(appleCalendarStoredState.mappings).length > 0
        ? openFirstManagedAppleCalendarEvent
        : undefined}
      onOpenSettings={() => nativeCalendarService.openSettings()}
      onRemoveManagedEvents={() => disconnectAppleCalendar(true)}
      onSync={syncAppleCalendar}
      permissionDetail={appleCalendarState === "denied"
        ? appleCalendarPermission.canAskAgain
          ? "Takvim erişim isteğini onaylayıp tam erişim vermelisin."
          : "Ayarlar > Akademik Takvim > Takvimler bölümünden Tam Erişim'i açmalısın."
        : undefined}
      presentation={appleCalendarPresentation}
      warnings={appleCalendarWarnings}
    />
  ) : null;

  const googleCalendarSettingsScreen = session ? (
    <>
      <GoogleCalendarSettingsScreen
        accountEmail={googleCalendarIntegration?.accountEmail}
        connectionExists={Boolean(googleCalendarIntegration)}
        error={googleCalendarError ?? undefined}
        lastSyncedLabel={googleCalendarIntegration?.lastSyncedAt
          ? formatDateTimeShort(googleCalendarIntegration.lastSyncedAt)
          : undefined}
        managedEventCount={googleCalendarIntegration?.mappings.length ?? googleCalendarLastResult?.verified}
        mappingWarning={googleCalendarIntegration
          && findDuplicateGoogleCalendarMappings(googleCalendarIntegration.mappings).hasDuplicates
          ? "Yönetilen kayıt eşlemelerinde yinelenen kimlikler bulundu; silme işlemi doğrulanmadan uygulanmaz."
          : undefined}
        onConnect={() => syncGoogleCalendar(true)}
        onDisconnect={async () => {
          await disconnectGoogleCalendar({ removeManagedEvents: false, revokeAccess: false });
        }}
        onRemoveManagedEvents={async () => {
          await disconnectGoogleCalendar({ removeManagedEvents: true, revokeAccess: false });
        }}
        onRevokeAccess={async () => {
          await disconnectGoogleCalendar({ removeManagedEvents: false, revokeAccess: true });
        }}
        onSwitchAccount={promptGoogleCalendarAccountSwitch}
        onSync={() => syncGoogleCalendar(false)}
        operationBusy={googleCalendarBusy}
        presentation={googleCalendarPresentation}
        warnings={googleCalendarWarnings}
      />
    </>
  ) : null;

  const accountDataSettingsScreen = session ? (
    <>
      {controlledActiveRoute === "AccountDataSettings" ? profileCleanupIssue : null}
      <AccountDataSettingsScreen
        busy={busy || recentAuthBusy}
        email={email}
        feedback={controlledActiveRoute === "AccountDataSettings" ? message ?? undefined : undefined}
        onDeleteAccount={() => beginRecentAuthentication("account")}
        onDeleteData={() => beginRecentAuthentication("data")}
        recentAuthentication={recentAuthenticationPanel}
        recentAuthenticationReturnFocus={recentAuthReturnFocus}
      />
    </>
  ) : null;

  return {
    profileCleanupCanRetry,
    profileCleanupIssue,
    profileRouteFeedback,
    academicScreenSaveState,
    recentAuthenticationPanel,
    profileOverviewScreen,
    academicProfileSettingsScreen,
    followedUniversitiesSettingsScreen,
    notificationSettingsScreen,
    appleCalendarSettingsScreen,
    googleCalendarSettingsScreen,
    accountDataSettingsScreen
  };
}
