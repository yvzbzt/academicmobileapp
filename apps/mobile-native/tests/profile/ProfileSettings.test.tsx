import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccessibilityInfo, Switch } from "react-native";
import {
  act,
  fireEvent,
  renderAsync,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { ThemeProvider } from "../../src/design-system";
import {
  AccountDataSettingsScreen,
  AcademicProfileSettingsScreen,
  GoogleCalendarSettingsScreen,
  NotificationSettingsScreen,
  ProfileOverviewScreen,
  resolveNotificationHeroLayout,
} from "../../src/profile/ProfileSettings";
import {
  resolveAcademicProfileSummary,
  resolveGoogleCalendarPresentation,
  resolveNotificationTruth,
} from "../../src/profile/profile-model";

const mockWindowDimensions = jest.fn(() => ({
  fontScale: 2,
  height: 640,
  scale: 2,
  width: 320,
}));

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindowDimensions(),
}));

function tree(child: React.ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <ThemeProvider
        liquidGlassAvailable={false}
        platform="android"
        preference="light"
        reducedMotion
        reducedTransparency={false}
        windowWidth={320}
      >
        {child}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe("Phase 10 profile and settings presentation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindowDimensions.mockReturnValue({
      fontScale: 2,
      height: 640,
      scale: 2,
      width: 320,
    });
  });

  it("stacks the notification hero for narrow or large-text layouts only", () => {
    expect(resolveNotificationHeroLayout(360, 1)).toBe("stacked");
    expect(resolveNotificationHeroLayout(393, 1)).toBe("stacked");
    expect(resolveNotificationHeroLayout(430, 1.3)).toBe("stacked");
    expect(resolveNotificationHeroLayout(410, 1)).toBe("side-by-side");
    expect(resolveNotificationHeroLayout(430, 1)).toBe("side-by-side");
  });

  it("renders the reference profile identity and one capability-backed settings group", async () => {
    const academicSummary = resolveAcademicProfileSummary(
      { universityId: "uni", facultyId: "faculty", departmentId: "department", classLevel: 3 },
      { universityName: "Örnek Üniversitesi", facultyName: "Mühendislik Fakültesi", departmentName: "Bilgisayar Mühendisliği" },
    );
    const notificationTruth = resolveNotificationTruth({
      permission: "granted",
      preferenceEnabled: true,
      registration: "registered",
      saveState: "saved",
    });

    const onOpenAccountMenu = jest.fn();
    await renderAsync(tree(
      <ProfileOverviewScreen
        academicSummary={academicSummary}
        appVersion="0.1.2"
        email="ada@example.invalid"
        fullName="Ada Lovelace"
        googleAccountEmail="ada.google@example.invalid"
        googleCalendar={resolveGoogleCalendarPresentation("connected")}
        notificationTruth={notificationTruth}
        followedUniversityCount={2}
        onOpenAccountMenu={onOpenAccountMenu}
        onOpenAcademicProfile={jest.fn()}
        onOpenFollowedUniversities={jest.fn()}
        onOpenAccountManagement={jest.fn()}
        onOpenGoogleCalendar={jest.fn()}
        onOpenNotifications={jest.fn()}
        onLogout={jest.fn()}
      />,
    ));

    expect(screen.getByRole("header", { name: "Profil" })).toBeVisible();
    expect(screen.getByRole("header", { name: "Profil" })).not.toHaveProp("maxFontSizeMultiplier");
    expect(screen.getByRole("header", { name: "Profil" })).not.toHaveProp("numberOfLines");
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("ada@example.invalid")).toBeVisible();
    expect(screen.getByLabelText("AL baş harfli profil avatarı")).toBeVisible();
    expect(screen.getByLabelText("Akademik profil yüzde 100 tamamlandı")).toHaveProp("accessibilityValue", {
      max: 100,
      min: 0,
      now: 100,
    });
    expect(screen.getByTestId("profile-completion-header")).toHaveStyle({
      alignItems: "flex-start",
      flexDirection: "column",
    });
    expect(screen.getByRole("button", { name: "Akademik profil" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Bildirim tercihleri" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Takip edilen üniversiteler" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hesap ve güvenlik" })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Google Takvim bağlantısı. Bağlı. Yalnızca uygulamanın yönettiği akademik kayıtlar eşitlenir.",
    })).toHaveStyle({ alignItems: "flex-start", flexWrap: "wrap" });
    expect(screen.getByTestId("profile-settings-group")).toBeVisible();
    expect(screen.queryByText("Gözden geçir")).toBeNull();
    expect(screen.queryByRole("button", { name: "Çıkış yap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hesap menüsünü aç" })).not.toBeOnTheScreen();
    expect(onOpenAccountMenu).not.toHaveBeenCalled();
    expect(screen.getByText("Sürüm 0.1.2")).toBeVisible();
    expect(screen.queryByText(/Derleme/u)).toBeNull();
    expect(screen.queryByText(/tema|görünüm|takipçi|öğrenci kimliği/iu)).toBeNull();
  });

  it("stacks profile completion at phone widths and keeps the reference-width row", async () => {
    const props = {
      academicSummary: resolveAcademicProfileSummary(
        { universityId: "uni", facultyId: "faculty", departmentId: "department", classLevel: 3 },
        { universityName: "Ankara Üniversitesi", facultyName: "Mühendislik Fakültesi", departmentName: "Bilgisayar Mühendisliği" },
      ),
      appVersion: "0.1.1",
      email: "fuat.basar@ogrenci.ankara.edu.tr",
      fullName: "Fuat Başar",
      googleCalendar: resolveGoogleCalendarPresentation("connected"),
      notificationTruth: resolveNotificationTruth({
        permission: "denied" as const,
        preferenceEnabled: true,
        registration: "unregistered" as const,
        saveState: "saved" as const,
      }),
      onOpenAcademicProfile: jest.fn(),
      onOpenFollowedUniversities: jest.fn(),
      onOpenAccountManagement: jest.fn(),
      onOpenGoogleCalendar: jest.fn(),
      onOpenNotifications: jest.fn(),
      onLogout: jest.fn(),
    };

    mockWindowDimensions.mockReturnValue({ fontScale: 1, height: 891, scale: 2.625, width: 411 });
    const view = await renderAsync(tree(<ProfileOverviewScreen {...props} />));
    expect(screen.getByTestId("profile-completion-header")).toHaveStyle({
      alignItems: "flex-start",
      flexDirection: "column",
    });
    expect(screen.getByText("Harika gidiyorsun!")).toHaveStyle({ flexShrink: 1, minWidth: 0 });

    mockWindowDimensions.mockReturnValue({ fontScale: 1, height: 836, scale: 2, width: 471 });
    await view.rerenderAsync(tree(<ProfileOverviewScreen {...props} />));
    expect(screen.getByTestId("profile-completion-header")).toHaveStyle({
      alignItems: "center",
      flexDirection: "row",
    });
  });

  it("shows the yellow notification callout only for a real delivery mismatch", async () => {
    const onOpenNotifications = jest.fn();
    await renderAsync(tree(
      <ProfileOverviewScreen
        academicSummary={resolveAcademicProfileSummary(
          { universityId: "uni" },
          { universityName: "Örnek Üniversitesi" },
        )}
        appVersion="0.1.1"
        email="ada@example.invalid"
        fullName="Ada Lovelace"
        googleCalendar={resolveGoogleCalendarPresentation("disconnected")}
        notificationTruth={resolveNotificationTruth({
          permission: "denied",
          preferenceEnabled: true,
          registration: "unregistered",
          saveState: "saved",
        })}
        onOpenAcademicProfile={jest.fn()}
        onOpenFollowedUniversities={jest.fn()}
        onOpenAccountManagement={jest.fn()}
        onOpenGoogleCalendar={jest.fn()}
        onOpenNotifications={onOpenNotifications}
        onLogout={jest.fn()}
      />,
    ));

    const callout = screen.getByRole("button", {
      name: "Bildirim izni gerekiyor. Tercihleri gözden geçir",
    });
    expect(callout).toBeVisible();
    expect(screen.getByLabelText("Akademik profil yüzde 100 tamamlandı")).toHaveProp("accessibilityValue", {
      max: 100,
      min: 0,
      now: 100,
    });
    fireEvent.press(callout);
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });

  it("uses one explicit academic commit and exposes cancel at compact large text", async () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    await renderAsync(tree(
      <AcademicProfileSettingsScreen
        busy={false}
        classLevels={[{ value: 1, label: "1. sınıf" }]}
        departments={[]}
        departmentsLoading={false}
        dirty
        draft={{ universityId: "uni", facultyId: "", departmentId: "", classLevel: null }}
        faculties={[]}
        facultiesLoading={false}
        onCancel={onCancel}
        onClassLevelChange={jest.fn()}
        onDepartmentChange={jest.fn()}
        onFacultyChange={jest.fn()}
        onRetryDepartments={jest.fn()}
        onRetryFaculties={jest.fn()}
        onRetryUniversities={jest.fn()}
        onSave={onSave}
        onUniversityChange={jest.fn()}
        saveState="dirty"
        universities={[{ value: "uni", label: "Örnek Üniversitesi" }]}
        universitiesLoading={false}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));
    fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Kaydedilmemiş değişiklikler")).toBeVisible();
  });

  it("separates permission, registration, preference, and actual notification delivery", async () => {
    const onSave = jest.fn();
    const onOpenSettings = jest.fn();
    const onCategoryChange = jest.fn();
    const truth = resolveNotificationTruth({
      permission: "permanently_denied",
      preferenceEnabled: true,
      registration: "unregistered",
      saveState: "dirty",
    });
    const view = await renderAsync(tree(
      <NotificationSettingsScreen
        categories={[{ key: "exam", label: "Sınavlar", enabled: true }]}
        dirty
        mode="selected_fields"
        onCategoryChange={onCategoryChange}
        onModeChange={jest.fn()}
        onOpenSettings={onOpenSettings}
        onPreferenceEnabledChange={jest.fn()}
        onSave={onSave}
        preferenceEnabled
        saveState="dirty"
        truth={truth}
      />,
    ));

    expect(screen.getByRole("header", { name: "Bildirim tercihleri" })).toBeVisible();
    expect(screen.getByText("Önemli tarihleri zamanında hatırla")).toBeVisible();
    expect(screen.getByLabelText(/^Bildirim izni gerekiyor\./u)).toBeVisible();
    expect(screen.getByRole("switch", { name: "Duyurular bildirimi" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Son başvuru tarihleri bildirimi" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "Etkinlikler bildirimi" })).toBeVisible();
    const openSettingsButton = screen.getByRole("button", { name: "Cihaz ayarlarını aç" });
    fireEvent.press(openSettingsButton);
    await waitFor(() => expect(openSettingsButton).toBeEnabled());
    const categorySwitch = screen.getByRole("switch", { name: "Sınav tarihleri bildirimi" });
    expect(categorySwitch).toHaveStyle({ minHeight: 48, minWidth: 48 });
    for (const nativeSwitch of screen.UNSAFE_getAllByType(Switch)) {
      expect(nativeSwitch.props.disabled).toBe(false);
    }
    fireEvent.press(categorySwitch);
    fireEvent.press(screen.getByRole("button", { name: "Tercihleri kaydet" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith("exam", false);
    expect(onSave).toHaveBeenCalledTimes(1);

    const failedTruth = resolveNotificationTruth({
      permission: "granted",
      preferenceEnabled: true,
      registration: "registered",
      saveState: "error",
      errorMessage: "Tercih kaydedilemedi.",
    });
    await view.rerenderAsync(tree(
      <NotificationSettingsScreen
        categories={[{ key: "exam", label: "Sınavlar", enabled: false }]}
        dirty
        error="Tercih kaydedilemedi."
        mode="selected_fields"
        onCategoryChange={onCategoryChange}
        onModeChange={jest.fn()}
        onOpenSettings={onOpenSettings}
        onPreferenceEnabledChange={jest.fn()}
        onSave={onSave}
        preferenceEnabled
        saveState="error"
        truth={failedTruth}
      />,
    ));
    const retrySave = screen.getByRole("button", { name: "Tercihleri kaydet" });
    expect(retrySave).toBeEnabled();
    fireEvent.press(retrySave);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(/^Bildirim izni açık\./u)).toBeVisible();

    const rejectOpenSettings = jest.fn(() => Promise.reject(new Error("RAW_SETTINGS_FAILURE")));
    await view.rerenderAsync(tree(
      <NotificationSettingsScreen
        categories={[{ key: "exam", label: "Sınavlar", enabled: true }]}
        dirty={false}
        mode="all_calendar"
        onCategoryChange={jest.fn()}
        onModeChange={jest.fn()}
        onOpenSettings={rejectOpenSettings}
        onPreferenceEnabledChange={jest.fn()}
        onSave={jest.fn()}
        preferenceEnabled
        saveState="saved"
        truth={truth}
      />,
    ));
    fireEvent.press(screen.getByRole("button", { name: "Cihaz ayarlarını aç" }));
    await waitFor(() => expect(screen.getByText("Cihaz ayarları açılamadı")).toBeVisible());
    expect(rejectOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/RAW_SETTINGS_FAILURE/u)).toBeNull();
  });

  it("keeps native switch disabled semantics aligned with the owning control", async () => {
    const truth = resolveNotificationTruth({
      permission: "granted",
      preferenceEnabled: true,
      registration: "registered",
      saveState: "saving",
    });
    await renderAsync(tree(
      <NotificationSettingsScreen
        categories={[{ key: "exam", label: "Sınavlar", enabled: true }]}
        dirty
        mode="selected_fields"
        onCategoryChange={jest.fn()}
        onModeChange={jest.fn()}
        onOpenSettings={jest.fn()}
        onPreferenceEnabledChange={jest.fn()}
        onSave={jest.fn()}
        preferenceEnabled
        saveState="saving"
        truth={truth}
      />,
    ));

    for (const control of screen.getAllByRole("switch")) {
      expect(control).toBeDisabled();
    }
    for (const nativeSwitch of screen.UNSAFE_getAllByType(Switch)) {
      expect(nativeSwitch.props.disabled).toBe(true);
    }
  });

  it("keeps granted permission actionable and the clean save control visually active without resaving", async () => {
    const onOpenSettings = jest.fn();
    const onPreferenceEnabledChange = jest.fn();
    const onSave = jest.fn();
    const truth = resolveNotificationTruth({
      permission: "granted",
      preferenceEnabled: true,
      registration: "registered",
      saveState: "saved",
    });
    await renderAsync(tree(
      <NotificationSettingsScreen
        categories={[{ key: "exam", label: "Sınavlar", enabled: true }]}
        dirty={false}
        mode="selected_fields"
        onCategoryChange={jest.fn()}
        onModeChange={jest.fn()}
        onOpenSettings={onOpenSettings}
        onPreferenceEnabledChange={onPreferenceEnabledChange}
        onSave={onSave}
        preferenceEnabled
        saveState="saved"
        truth={truth}
      />,
    ));

    const permission = screen.getByRole("button", { name: /^Bildirim izni açık\./u });
    expect(permission).toBeEnabled();
    fireEvent.press(permission);
    await waitFor(() => expect(onOpenSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(permission).toBeEnabled());

    expect(screen.getByTestId("notification-settings-hero")).toHaveStyle({ flexDirection: "column" });
    const preview = screen.getByTestId("notification-hero-preview", { includeHiddenElements: true });
    expect(preview).toHaveStyle({ width: "100%" });
    expect(preview).toHaveTextContent(/Sınavlar/u);
    expect(preview).toHaveTextContent(/Duyurular/u);

    const masterPreference = screen.getByRole("switch", { name: "Akademik hatırlatmalar bildirimi" });
    expect(masterPreference).toBeEnabled();
    fireEvent.press(masterPreference);
    expect(onPreferenceEnabledChange).toHaveBeenCalledWith(false);

    const save = screen.getByRole("button", { name: "Tercihleri kaydet" });
    expect(save).toBeEnabled();
    fireEvent.press(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps Google lifecycle controls compact and protects personal events in removal copy", async () => {
    const focusSpy = jest.spyOn(AccessibilityInfo, "setAccessibilityFocus").mockImplementation(jest.fn());
    const onRemoveManagedEvents = jest.fn();
    await renderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="google@example.invalid"
        lastSyncedLabel="5 Ağustos 2026 10:00"
        managedEventCount={4}
        onConnect={jest.fn()}
        onDisconnect={jest.fn()}
        onRemoveManagedEvents={onRemoveManagedEvents}
        onRevokeAccess={jest.fn()}
        onSwitchAccount={jest.fn()}
        onSync={jest.fn()}
        presentation={resolveGoogleCalendarPresentation("partial")}
        warnings={["Bir kayıt doğrulanamadı."]}
      />,
    ));

    expect(screen.getByText("Google Takvim kısmen eşitlendi")).toBeVisible();
    expect(screen.getByText(/Kişisel etkinliklerin korunur/u)).toBeVisible();
    expect(screen.getByText(/koruma veya kaldırma seçimi önce ayrıca sorulur/u)).toBeVisible();
    fireEvent.press(screen.getByRole("button", { name: "Yönetilen kayıtları kaldır" }));
    const googleSheet = screen.getByTestId("bottom-sheet");
    expect(googleSheet).toHaveProp("accessibilityLabel", "Yönetilen kayıtlar kaldırılsın mı?");
    expect(within(googleSheet).getByText(/Kişisel etkinliklerin korunur/u)).toBeVisible();
    fireEvent(screen.getByRole("header", { name: "Google Takvim" }), "layout", {
      target: 731,
      nativeEvent: { layout: { height: 48, width: 320, x: 0, y: 0 } },
    });
    focusSpy.mockClear();
    fireEvent.press(within(googleSheet).getByRole("button", { name: "Yönetilen kayıtları kaldır" }));
    await waitFor(() => expect(onRemoveManagedEvents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(focusSpy).toHaveBeenCalledWith(731));
  });

  it("distinguishes a fresh disconnect from a retained Google ledger", async () => {
    const onConnect = jest.fn();
    const view = await renderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="retained-ledger@example.invalid"
        connectionExists={false}
        onConnect={onConnect}
        onDisconnect={jest.fn()}
        onRemoveManagedEvents={jest.fn()}
        onRevokeAccess={jest.fn()}
        onSwitchAccount={jest.fn()}
        onSync={jest.fn()}
        presentation={resolveGoogleCalendarPresentation("disconnected")}
      />,
    ));

    expect(screen.getByRole("button", { name: "Google hesabı bağla" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Şimdi eşitle" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Google hesabı bağla" }));
    expect(onConnect).toHaveBeenCalledTimes(1);

    await view.rerenderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="retained-ledger@example.invalid"
        connectionExists
        onConnect={onConnect}
        onDisconnect={jest.fn()}
        onRemoveManagedEvents={jest.fn()}
        onRevokeAccess={jest.fn()}
        onSwitchAccount={jest.fn()}
        onSync={jest.fn()}
        presentation={resolveGoogleCalendarPresentation("disconnected")}
      />,
    ));
    expect(screen.getByRole("button", { name: "Google hesabını yeniden bağla" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Şimdi eşitle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Google hesabını değiştir" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Bağlantıyı kes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Yönetilen kayıtları kaldır" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Google erişimini iptal et" })).toBeVisible();
  });

  it("routes Google sync, account switch, disconnect, and revoke through distinct actions", async () => {
    const onSync = jest.fn();
    const onSwitchAccount = jest.fn();
    const onDisconnect = jest.fn();
    const onRevokeAccess = jest.fn();
    const view = await renderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="google@example.invalid"
        onConnect={jest.fn()}
        onDisconnect={onDisconnect}
        onRemoveManagedEvents={jest.fn()}
        onRevokeAccess={onRevokeAccess}
        onSwitchAccount={onSwitchAccount}
        onSync={onSync}
        presentation={resolveGoogleCalendarPresentation("connected")}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Şimdi eşitle" }));
    fireEvent.press(screen.getByRole("button", { name: "Google hesabını değiştir" }));
    fireEvent.press(screen.getByRole("button", { name: "Bağlantıyı kes" }));
    let sheet = screen.getByTestId("bottom-sheet");
    fireEvent.press(within(sheet).getByRole("button", { name: "Bağlantıyı kes" }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("bottom-sheet")).toBeNull());

    fireEvent.press(screen.getByRole("button", { name: "Google erişimini iptal et" }));
    sheet = screen.getByTestId("bottom-sheet");
    expect(within(sheet).getByText(/mevcut takvim kayıtları korunur/iu)).toBeVisible();
    fireEvent.press(within(sheet).getByRole("button", { name: "Erişimi iptal et" }));
    await waitFor(() => expect(onRevokeAccess).toHaveBeenCalledTimes(1));

    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);

    await view.rerenderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="google@example.invalid"
        onConnect={jest.fn()}
        onDisconnect={onDisconnect}
        onRemoveManagedEvents={jest.fn()}
        onRevokeAccess={onRevokeAccess}
        onSwitchAccount={onSwitchAccount}
        onSync={onSync}
        operationBusy
        presentation={resolveGoogleCalendarPresentation("connected")}
      />,
    ));
    expect(screen.getByRole("button", { name: "Şimdi eşitle" })).toBeDisabled();
    expect(screen.getByLabelText(/^Google Takvim bağlı\./u)).toBeBusy();
  });

  it("keeps retained-connection management available when Google permission is expired", async () => {
    await renderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="google@example.invalid"
        connectionExists
        onConnect={jest.fn()}
        onDisconnect={jest.fn()}
        onRemoveManagedEvents={jest.fn()}
        onRevokeAccess={jest.fn()}
        onSwitchAccount={jest.fn()}
        onSync={jest.fn()}
        presentation={resolveGoogleCalendarPresentation("expired")}
      />,
    ));

    expect(screen.getByRole("button", { name: /yeniden/u })).toBeVisible();
    expect(screen.queryByRole("button", { name: /e\u015fitle$/u })).toBeNull();
    expect(screen.getByRole("button", { name: /de\u011fi\u015ftir$/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /kes$/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /kald\u0131r$/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /iptal et$/u })).toBeVisible();
  });

  it("blocks duplicate Google confirmation submits and presents a controlled rejection", async () => {
    let rejectOperation: ((error: Error) => void) | undefined;
    const onDisconnect = jest.fn(() => new Promise<void>((_resolve, reject) => {
      rejectOperation = reject;
    }));
    await renderAsync(tree(
      <GoogleCalendarSettingsScreen
        accountEmail="google@example.invalid"
        onConnect={jest.fn()}
        onDisconnect={onDisconnect}
        onRemoveManagedEvents={jest.fn()}
        onRevokeAccess={jest.fn()}
        onSwitchAccount={jest.fn()}
        onSync={jest.fn()}
        presentation={resolveGoogleCalendarPresentation("connected")}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Bağlantıyı kes" }));
    const sheet = screen.getByTestId("bottom-sheet");
    const confirm = within(sheet).getByRole("button", { name: "Bağlantıyı kes" });
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    rejectOperation?.(new Error("RAW_PROVIDER_SECRET"));
    await waitFor(() => expect(screen.getByText("İşlem tamamlanamadı")).toBeVisible());
    expect(screen.queryByText(/RAW_PROVIDER_SECRET/u)).toBeNull();
  });

  it("keeps deletion in a collapsed danger area with explicit, cancellable confirmation", async () => {
    const onDeleteData = jest.fn();
    const view = await renderAsync(tree(
      <AccountDataSettingsScreen
        email="ada@example.invalid"
        onDeleteAccount={jest.fn()}
        onDeleteData={onDeleteData}
        onLogout={jest.fn()}
      />,
    ));

    expect(screen.queryByRole("button", { name: "Uygulama verilerimi sil" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Silme seçeneklerini göster" }));
    expect(screen.getByRole("button", { name: "Uygulama verilerimi sil" })).toBeVisible();
    fireEvent.press(screen.getByRole("button", { name: "Uygulama verilerimi sil" }));
    let accountSheet = screen.getByTestId("bottom-sheet");
    expect(within(accountSheet).getByTestId("bottom-sheet-scroll")).toBeVisible();
    expect(accountSheet).toHaveProp("accessibilityLabel", "Uygulama verileri silinsin mi?");
    expect(within(accountSheet).getByText(/tek kullanımlık yakın zamanda kimlik doğrulaması/iu)).toBeVisible();
    fireEvent.press(within(accountSheet).getByRole("button", { name: "Vazgeç" }));
    expect(onDeleteData).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole("button", { name: "Uygulama verilerimi sil" }));
    accountSheet = screen.getByTestId("bottom-sheet");
    fireEvent.press(within(accountSheet).getByRole("button", { name: "Verileri silmeye devam et" }));
    await waitFor(() => expect(onDeleteData).toHaveBeenCalledTimes(1));

    await view.rerenderAsync(tree(
      <AccountDataSettingsScreen
        email="ada@example.invalid"
        feedback={{ text: "Uygulama verileri silindi.", tone: "success" }}
        onDeleteAccount={jest.fn()}
        onDeleteData={onDeleteData}
        onLogout={jest.fn()}
      />,
    ));
    expect(screen.getByText("Hesap işlemi tamamlandı")).toBeVisible();
    expect(screen.getByText("Uygulama verileri silindi.")).toBeVisible();
  });

  it("uses the account-delete path only after its own confirmation", async () => {
    const onDeleteAccount = jest.fn();
    await renderAsync(tree(
      <AccountDataSettingsScreen
        email="ada@example.invalid"
        onDeleteAccount={onDeleteAccount}
        onDeleteData={jest.fn()}
        onLogout={jest.fn()}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Silme seçeneklerini göster" }));
    fireEvent.press(screen.getByRole("button", { name: "Hesabımı kalıcı olarak sil" }));
    let sheet = screen.getByTestId("bottom-sheet");
    fireEvent.press(within(sheet).getByRole("button", { name: /Vazge/u }));
    expect(onDeleteAccount).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: /kal\u0131c\u0131 olarak sil$/u }));
    sheet = screen.getByTestId("bottom-sheet");
    expect(within(sheet).getByText(/bu hesapla yeniden giriş yapılamaz/iu)).toBeVisible();
    expect(
      within(sheet).getByText(/Kişisel etkinliklerin korunur/u),
    ).toBeVisible();
    fireEvent.press(within(sheet).getByRole("button", { name: "Hesabı silmeye devam et" }));
    await waitFor(() => expect(onDeleteAccount).toHaveBeenCalledTimes(1));
  });

  it("blocks duplicate data-deletion submits and keeps controlled callback errors in the sheet", async () => {
    let rejectOperation: ((error: Error) => void) | undefined;
    const onDeleteData = jest.fn(() => new Promise<void>((_resolve, reject) => {
      rejectOperation = reject;
    }));
    await renderAsync(tree(
      <AccountDataSettingsScreen
        email="ada@example.invalid"
        onDeleteAccount={jest.fn()}
        onDeleteData={onDeleteData}
        onLogout={jest.fn()}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: /ster$/u }));
    fireEvent.press(screen.getByRole("button", { name: /verilerimi sil$/u }));
    const sheet = screen.getByTestId("bottom-sheet");
    const confirm = within(sheet).getByRole("button", { name: /Verileri silmeye devam et$/u });
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    expect(onDeleteData).toHaveBeenCalledTimes(1);
    rejectOperation?.(new Error("RAW_DATA_SECRET"));
    await waitFor(() => expect(within(sheet).getByText(/Hesap durumunu/u)).toBeVisible());
    expect(screen.queryByText(/RAW_DATA_SECRET/u)).toBeNull();
  });

  it("blocks deletion controls and keeps logout outside the account-data page", async () => {
    await renderAsync(tree(
      <AccountDataSettingsScreen
        busy
        email="ada@example.invalid"
        onDeleteAccount={jest.fn()}
        onDeleteData={jest.fn()}
        onLogout={jest.fn()}
        recentAuthentication={<></>}
      />,
    ));

    const deletionToggle = screen.getByRole("button", { name: "Silme seçeneklerini göster" });
    expect(deletionToggle).toBeDisabled();
    expect(deletionToggle).not.toBeBusy();
    expect(screen.queryByRole("button", { name: "Çıkış yap" })).toBeNull();
  });

  it("returns accessibility focus to the originating destructive action after recent-auth cancellation", async () => {
    const focusSpy = jest.spyOn(AccessibilityInfo, "setAccessibilityFocus").mockImplementation(jest.fn());
    const props = {
      email: "ada@example.invalid",
      onDeleteAccount: jest.fn(),
      onDeleteData: jest.fn(),
      onLogout: jest.fn(),
    };
    const view = await renderAsync(tree(<AccountDataSettingsScreen {...props} />));
    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByRole("button", { name: /ster$/u }));
      fireEvent.press(
        screen.getByRole("button", { name: /verilerimi sil$/u }),
        { nativeEvent: { target: 83 } },
      );
      fireEvent.press(screen.getByRole("button", { name: /Verileri silmeye devam et$/u }));

      await view.rerenderAsync(tree(
        <AccountDataSettingsScreen
          {...props}
          recentAuthenticationReturnFocus={{ action: "data", requestId: 1 }}
        />,
      ));
      await act(async () => {
        jest.runOnlyPendingTimers();
      });

      expect(focusSpy).toHaveBeenCalledWith(83);
    } finally {
      jest.useRealTimers();
      focusSpy.mockRestore();
    }
  });

  it("blocks duplicate account deletion submits and hides callback rejection details", async () => {
    let rejectOperation: ((error: Error) => void) | undefined;
    const onDeleteAccount = jest.fn(() => new Promise<void>((_resolve, reject) => {
      rejectOperation = reject;
    }));
    await renderAsync(tree(
      <AccountDataSettingsScreen
        email="ada@example.invalid"
        onDeleteAccount={onDeleteAccount}
        onDeleteData={jest.fn()}
        onLogout={jest.fn()}
      />,
    ));

    fireEvent.press(screen.getByRole("button", { name: "Silme seçeneklerini göster" }));
    fireEvent.press(screen.getByRole("button", { name: "Hesabımı kalıcı olarak sil" }));
    const sheet = screen.getByTestId("bottom-sheet");
    const confirm = within(sheet).getByRole("button", { name: "Hesabı silmeye devam et" });
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    rejectOperation?.(new Error("RAW_ACCOUNT_SECRET"));
    await waitFor(() => expect(screen.getByText("İşlem başlatılamadı")).toBeVisible());
    expect(screen.queryByText(/RAW_ACCOUNT_SECRET/u)).toBeNull();
  });
});
