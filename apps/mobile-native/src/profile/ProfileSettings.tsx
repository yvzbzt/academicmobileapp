import { Ionicons } from "@expo/vector-icons";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
  type GestureResponderEvent,
  type Text as NativeText,
  type View as NativeView,
} from "react-native";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AcademicProfileFields as AcademicProfileFieldGroup,
  type AcademicProfileFieldsProps,
} from "../academic/AcademicProfileFields";
import {
  Banner,
  BottomSheet,
  Button,
  Card,
  ListItem,
  SegmentedControl,
  Skeleton,
  useTheme,
} from "../design-system";
import type { SemanticTheme } from "../design-system";
import type { AcademicProfileSummary } from "./profile-model";
import {
  resolveProfileSettingsLayout,
  type GoogleCalendarPresentation,
  type NotificationPreferenceMode,
  type NotificationPreferenceSaveState,
  type NotificationTruth,
} from "./profile-model";

export type ProfileMutationState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface ProfileOverviewScreenProps {
  fullName: string;
  email: string;
  academicSummary: AcademicProfileSummary;
  notificationTruth: NotificationTruth;
  googleCalendar: GoogleCalendarPresentation;
  googleAccountEmail?: string;
  appVersion: string;
  buildNumber: string | number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onOpenAcademicProfile: () => void;
  onOpenNotifications: () => void;
  onOpenGoogleCalendar: () => void;
  onOpenAccountManagement: () => void;
}

/** The profile root is an ordered settings index, not a second dashboard. */
export function ProfileOverviewScreen({
  fullName,
  email,
  academicSummary,
  notificationTruth,
  googleCalendar,
  googleAccountEmail,
  appVersion,
  buildNumber,
  loading = false,
  error,
  onRetry,
  onOpenAcademicProfile,
  onOpenNotifications,
  onOpenGoogleCalendar,
  onOpenAccountManagement,
}: ProfileOverviewScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const normalizedName = fullName.trim() || "Ad bilgisi yok";
  const normalizedEmail = email.trim() || "E-posta bilgisi yok";

  return (
    <SettingsBody gap={theme.spacing.lg}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Profil ve ayarlar</Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Hesabını, akademik bağlamını ve uygulama bağlantılarını tek yerden yönet.</Text>
      </View>

      {error ? (
        <Banner
          actionLabel={onRetry ? "Tekrar dene" : undefined}
          message="Son doğrulanmış profil bilgileri gösteriliyor."
          onAction={onRetry}
          title="Profil yenilenemedi"
          tone="error"
        />
      ) : null}

      {loading ? <ProfileSummarySkeleton /> : (
        <Card
          accessibilityLabel={`${normalizedName}. ${academicSummary.universityLabel}. ${academicSummary.complete ? "Akademik profil tamamlandı" : "Akademik profil eksik"}. ${normalizedEmail}.`}
          style={{ gap: theme.spacing.md }}
          variant="elevated"
        >
          <View style={{ gap: theme.spacing.xxs }}>
            <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>Profil özeti</Text>
            <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>{normalizedName}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{normalizedEmail}</Text>
          </View>
          <View style={{ gap: theme.spacing.xs }}>
            <LabeledValue label="Üniversite" value={academicSummary.universityLabel} />
            {academicSummary.facultyLabel ? <LabeledValue label="Fakülte" value={academicSummary.facultyLabel} /> : null}
            {academicSummary.departmentLabel ? <LabeledValue label="Bölüm" value={academicSummary.departmentLabel} /> : null}
            {academicSummary.classLevelLabel ? <LabeledValue label="Sınıf" value={academicSummary.classLevelLabel} /> : null}
          </View>
          <StatusLine
            icon={academicSummary.complete ? "checkmark-circle-outline" : "alert-circle-outline"}
            label={academicSummary.complete ? "Akademik profil tamamlandı" : "Akademik profil eksik"}
            tone={academicSummary.complete ? "success" : "warning"}
          />
        </Card>
      )}

      <SettingsSection title="Kişisel bilgiler">
        <ListItem title="Ad soyad" supportingText={normalizedName} />
        <ListItem title="E-posta" supportingText={`${normalizedEmail} · Hesap e-postası`} />
      </SettingsSection>

      <SettingsSection title="Akademik profil">
        <ListItem
          accessibilityHint="Akademik profil düzenleme ekranını açar."
          leading={<SettingsIcon name="school-outline" />}
          onPress={onOpenAcademicProfile}
          supportingText={`${academicSummary.universityLabel} · ${academicSummary.supportingText}`}
          title={academicSummary.actionLabel}
          trailing={<Chevron />}
        />
      </SettingsSection>

      <SettingsSection title="Bildirimler">
        <ListItem
          accessibilityHint="Bildirim tercihi ve cihaz teslimat durumunu açar."
          leading={<SettingsIcon name="notifications-outline" />}
          onPress={onOpenNotifications}
          supportingText={`${notificationTruth.title}. ${notificationTruth.detail}`}
          title="Bildirim tercihleri"
          trailing={<Chevron />}
        />
      </SettingsSection>

      <SettingsSection title="Takvim bağlantıları">
        <ListItem
          accessibilityHint="Google Takvim bağlantı yönetimini açar."
          leading={<SettingsIcon name="logo-google" />}
          onPress={onOpenGoogleCalendar}
          supportingText={`${googleCalendar.label}${googleAccountEmail ? ` · ${googleAccountEmail}` : ""}`}
          title="Google Takvim"
          trailing={<Chevron />}
        />
      </SettingsSection>

      <SettingsSection title="Uygulama bilgisi">
        <ListItem title="Sürüm" supportingText={appVersion} />
        <ListItem title="Derleme" supportingText={String(buildNumber)} />
      </SettingsSection>

      <SettingsSection title="Hesap yönetimi">
        <ListItem
          accessibilityHint="Çıkış ve veri yönetimi seçeneklerini açar."
          leading={<SettingsIcon name="person-circle-outline" />}
          onPress={onOpenAccountManagement}
          supportingText="Çıkış, veri silme ve hesap silme"
          title="Hesap ve veri"
          trailing={<Chevron />}
        />
      </SettingsSection>

      {layout.largeText ? (
        <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Tüm eylemler büyük metinde dikey ve erişilebilir sırada sunulur.</Text>
      ) : null}
    </SettingsBody>
  );
}

export interface AcademicProfileSettingsScreenProps extends AcademicProfileFieldsProps {
  dirty: boolean;
  saveState: ProfileMutationState;
  saveError?: string;
  onSave: () => void;
  onCancel: () => void;
}

export function AcademicProfileSettingsScreen({
  dirty,
  saveState,
  saveError,
  onSave,
  onCancel,
  ...fieldProps
}: AcademicProfileSettingsScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const [validationAttempt, setValidationAttempt] = useState(0);
  const saving = saveState === "saving";
  const disabled = fieldProps.busy || saving;

  return (
    <SettingsBody gap={theme.spacing.lg}>
      <ScreenHeading
        description="Üniversite zorunludur. Fakülte, bölüm ve sınıf isteğe bağlıdır; üst seçim değiştiğinde alt seçimler temizlenir."
        title="Akademik profili düzenle"
      />

      {saveState === "saved" ? <Banner title="Akademik profil kaydedildi" tone="success" /> : null}
      {saveState === "error" ? (
        <Banner
          message={saveError || "Değişikliklerin kaydedilemedi. Seçimlerin ekranda korunuyor."}
          title="Akademik profil kaydedilemedi"
          tone="error"
        />
      ) : null}
      {dirty && saveState !== "saving" && saveState !== "error" ? (
        <Banner message="Kaydetmeden ayrılırsan bu seçimler uygulanmaz." title="Kaydedilmemiş değişiklikler" tone="warning" />
      ) : null}

      <View
        accessibilityLabel="Akademik profil formu"
        accessibilityState={{ busy: disabled }}
        style={{ gap: theme.spacing.md }}
      >
        <AcademicProfileFieldGroup
          {...fieldProps}
          busy={disabled}
          validationAttempt={validationAttempt}
        />
      </View>

      <View style={[styles.actionRow, layout.stackActions && styles.actionColumn, { gap: theme.spacing.sm }]}>
        <Button
          disabled={saving}
          fullWidth={layout.stackActions}
          label="Vazgeç"
          onPress={onCancel}
          variant="secondary"
        />
        <Button
          disabled={!dirty || disabled}
          fullWidth={layout.stackActions}
          label={saveState === "saved" ? "Kaydedildi" : "Değişiklikleri kaydet"}
          loading={saving}
          onPress={() => {
            setValidationAttempt((current) => current + 1);
            onSave();
          }}
          status={saveState === "saved" ? "success" : saveState === "error" ? "error" : "idle"}
        />
      </View>
    </SettingsBody>
  );
}

export interface NotificationCategoryOption {
  key: string;
  label: string;
  enabled: boolean;
}

export interface NotificationSettingsScreenProps {
  truth: NotificationTruth;
  preferenceEnabled: boolean;
  mode: NotificationPreferenceMode;
  categories: readonly NotificationCategoryOption[];
  saveState: NotificationPreferenceSaveState;
  dirty: boolean;
  error?: string;
  reminderSummary?: string;
  quietHoursSummary?: string;
  onPreferenceEnabledChange: (enabled: boolean) => void;
  onModeChange: (mode: NotificationPreferenceMode) => void;
  onCategoryChange: (key: string, enabled: boolean) => void;
  onSave: () => void;
  onOpenSettings: () => void | Promise<void>;
  onRetry?: () => void;
}

export function NotificationSettingsScreen({
  truth,
  preferenceEnabled,
  mode,
  categories,
  saveState,
  dirty,
  error,
  reminderSummary,
  quietHoursSummary,
  onPreferenceEnabledChange,
  onModeChange,
  onCategoryChange,
  onSave,
  onOpenSettings,
  onRetry,
}: NotificationSettingsScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const [categoriesExpanded, setCategoriesExpanded] = useState(mode === "selected_fields");
  const [openSettingsBusy, setOpenSettingsBusy] = useState(false);
  const [openSettingsError, setOpenSettingsError] = useState<string | undefined>();
  const openSettingsPendingRef = useRef(false);
  const busy = truth.busy || saveState === "saving" || saveState === "loading" || openSettingsBusy;
  const selectedCategoryCount = categories.filter((category) => category.enabled).length;

  const requestOpenSettings = async () => {
    if (openSettingsPendingRef.current) return;
    openSettingsPendingRef.current = true;
    setOpenSettingsBusy(true);
    setOpenSettingsError(undefined);
    try {
      await onOpenSettings();
    } catch {
      setOpenSettingsError("Cihaz ayarları açılamadı. Daha sonra yeniden deneyebilirsin.");
    } finally {
      openSettingsPendingRef.current = false;
      setOpenSettingsBusy(false);
    }
  };

  return (
    <SettingsBody gap={theme.spacing.lg}>
      <ScreenHeading
        description="Bildirim teslimatı; tercihin, işletim sistemi izni ve bu cihazın sunucu kaydı birlikte geçerliyse etkin olur."
        title="Bildirim tercihleri"
      />

      <LifecycleStatusCard
        detail={truth.detail}
        label={truth.title}
        tone={truth.tone}
        busy={truth.busy}
        error={truth.kind === "error"}
      />

      <SettingsSection title="Teslimat doğrulaması">
        <TruthRow icon="phone-portrait-outline" label="İşletim sistemi izni" value={truth.permissionLabel} />
        <TruthRow icon="cloud-done-outline" label="Bu cihazın kaydı" value={truth.registrationLabel} />
        <TruthRow icon="options-outline" label="Uygulama tercihi" value={truth.preferenceLabel} />
        <TruthRow
          icon={truth.active ? "checkmark-circle-outline" : "close-circle-outline"}
          label="Gerçek teslimat"
          value={truth.active ? "Etkin" : "Etkin değil"}
        />
      </SettingsSection>

      {truth.openSettingsRequired ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Banner
            message="İzin yeniden uygulama içinden istenemez. Bildirim iznini işletim sistemi ayarlarından değiştirebilirsin."
            title="Cihaz ayarı gerekiyor"
            tone="warning"
          />
          {openSettingsError ? <Banner message={openSettingsError} title="Cihaz ayarları açılamadı" tone="error" /> : null}
          <Button
            disabled={busy}
            fullWidth
            label="Cihaz ayarlarını aç"
            loading={openSettingsBusy}
            onPress={() => void requestOpenSettings()}
            variant="secondary"
          />
        </View>
      ) : null}
      {truth.kind === "error" && onRetry ? (
        <Button fullWidth label="Bildirim durumunu tekrar denetle" onPress={onRetry} variant="secondary" />
      ) : null}

      <SettingsSection title="Tercih">
        <View
          style={[styles.switchRow, { gap: theme.spacing.sm, minHeight: 48 }]}
        >
          <View style={styles.flexOne}>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Akademik hatırlatmalar</Text>
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Bu seçim tek başına teslimatın etkin olduğu anlamına gelmez.</Text>
          </View>
          <SettingsSwitch
            disabled={busy}
            hint="Bu tercih tek başına işletim sistemi iznini veya cihaz kaydını değiştirmez."
            label={`Akademik hatırlatma tercihi. ${preferenceEnabled ? "Açık" : "Kapalı"}.`}
            onValueChange={onPreferenceEnabledChange}
            value={preferenceEnabled}
          />
        </View>
      </SettingsSection>

      <View style={{ gap: theme.spacing.sm }}>
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Hatırlatma kapsamı</Text>
        <SegmentedControl
          disabled={busy || !preferenceEnabled}
          label="Bildirim kapsamı"
          onValueChange={(nextMode) => {
            onModeChange(nextMode);
            if (nextMode === "selected_fields") setCategoriesExpanded(true);
          }}
          options={[
            { value: "all_calendar", label: "Tüm önemli tarihler" },
            { value: "selected_fields", label: "Seçtiğim kategoriler" },
          ]}
          orientation={layout.notificationModeOrientation}
          value={mode}
        />
      </View>

      {mode === "selected_fields" ? (
        <SettingsSection title="Kategoriler">
          <Button
            aria-expanded={categoriesExpanded}
            accessibilityLabel={`Bildirim kategorileri. ${selectedCategoryCount} kategori seçili. ${categoriesExpanded ? "Açık" : "Kapalı"}.`}
            disabled={busy || !preferenceEnabled}
            fullWidth
            label={categoriesExpanded ? "Kategorileri gizle" : "Kategorileri göster"}
            onPress={() => setCategoriesExpanded((current) => !current)}
            variant="secondary"
          />
          {categoriesExpanded ? (
            <View accessibilityLabel="Bildirim kategorileri" style={{ gap: theme.spacing.xs }}>
              {categories.map((category) => (
                <CategorySwitch
                  key={category.key}
                  disabled={busy || !preferenceEnabled}
                  label={category.label}
                  onValueChange={(enabled) => onCategoryChange(category.key, enabled)}
                  value={category.enabled}
                />
              ))}
              {categories.length === 0 ? (
                <Text accessibilityRole="alert" style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bu hesap için kullanılabilir bildirim kategorisi yok.</Text>
              ) : null}
            </View>
          ) : null}
        </SettingsSection>
      ) : null}

      {reminderSummary || quietHoursSummary ? (
        <SettingsSection title="Teslimat ayrıntıları">
          {reminderSummary ? <ListItem title="Hatırlatma zamanı" supportingText={reminderSummary} /> : null}
          {quietHoursSummary ? <ListItem title="Sessiz saatler" supportingText={quietHoursSummary} /> : null}
        </SettingsSection>
      ) : null}

      {saveState === "saved" ? <Banner title="Bildirim tercihin kaydedildi" tone="success" /> : null}
      {saveState === "error" ? (
        <Banner message={error || "Tercihin kaydedilemedi; cihaz ve teslimat durumu değiştirilmiş kabul edilmedi."} title="Bildirim tercihi kaydedilemedi" tone="error" />
      ) : null}
      {dirty ? <Banner message="Bu seçimler henüz hesabına uygulanmadı." title="Kaydedilmemiş değişiklikler" tone="warning" /> : null}

      <Button
        disabled={!dirty || busy}
        fullWidth
        label={saveState === "saved" ? "Kaydedildi" : "Bildirim tercihlerini kaydet"}
        loading={saveState === "saving"}
        onPress={onSave}
        status={saveState === "saved" ? "success" : saveState === "error" ? "error" : "idle"}
      />
    </SettingsBody>
  );
}

export interface GoogleCalendarSettingsScreenProps {
  presentation: GoogleCalendarPresentation;
  operationBusy?: boolean;
  accountEmail?: string;
  lastSyncedLabel?: string;
  managedEventCount?: number;
  mappingWarning?: string;
  warnings?: readonly string[];
  error?: string;
  connectionExists?: boolean;
  onConnect: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
  onSwitchAccount: () => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onRemoveManagedEvents: () => void | Promise<void>;
  onRevokeAccess: () => void | Promise<void>;
}

type GoogleConfirmation = "disconnect" | "remove" | "revoke";

export function GoogleCalendarSettingsScreen({
  presentation,
  operationBusy = false,
  accountEmail,
  lastSyncedLabel,
  managedEventCount,
  mappingWarning,
  warnings = [],
  error,
  connectionExists,
  onConnect,
  onSync,
  onSwitchAccount,
  onDisconnect,
  onRemoveManagedEvents,
  onRevokeAccess,
}: GoogleCalendarSettingsScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const [confirmation, setConfirmation] = useState<GoogleConfirmation | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const confirmationPendingRef = useRef(false);
  const headingRef = useRef<NativeText | null>(null);
  const headingTargetRef = useRef<number | null>(null);
  const disconnectRef = useRef<NativeView | null>(null);
  const removeRef = useRef<NativeView | null>(null);
  const revokeRef = useRef<NativeView | null>(null);
  const hasConnection = connectionExists ?? (presentation.connected || Boolean(accountEmail));
  const busy = operationBusy || presentation.busy || confirmationBusy;

  const closeConfirmation = (restore = true) => {
    const current = confirmation;
    setConfirmation(null);
    setConfirmationError(undefined);
    if (restore && current) {
      restoreFocus(current === "disconnect" ? disconnectRef : current === "remove" ? removeRef : revokeRef);
    }
  };

  const confirm = async () => {
    if (!confirmation || confirmationPendingRef.current) return;
    const currentConfirmation = confirmation;
    confirmationPendingRef.current = true;
    setConfirmationBusy(true);
    setConfirmationError(undefined);
    try {
      if (currentConfirmation === "disconnect") await onDisconnect();
      if (currentConfirmation === "remove") await onRemoveManagedEvents();
      if (currentConfirmation === "revoke") await onRevokeAccess();
      if (currentConfirmation === "remove") {
        closeConfirmation(false);
        restoreFocus(headingRef, headingTargetRef.current);
      } else {
        closeConfirmation();
      }
    } catch {
      setConfirmationError("İşlem tamamlanamadı. Bağlantı durumunu doğrulayıp tekrar deneyebilirsin.");
    } finally {
      confirmationPendingRef.current = false;
      setConfirmationBusy(false);
    }
  };

  const confirmationCopy = googleConfirmationCopy(confirmation, managedEventCount);

  return (
    <SettingsBody gap={theme.spacing.lg}>
      <ScreenHeading
        description="Bağlantı yalnızca uygulamanın yönettiği akademik kayıtlar için kullanılır. Kişisel Google Takvim etkinliklerin hiçbir işlemde değiştirilmez."
        headingRef={headingRef}
        onHeadingLayoutTarget={(target) => {
          headingTargetRef.current = target;
        }}
        title="Google Takvim"
      />

      <LifecycleStatusCard
        busy={operationBusy || presentation.busy}
        detail={error || presentation.detail}
        error={Boolean(error) || presentation.tone === "error"}
        label={presentation.title}
        tone={error ? "error" : presentation.tone}
      />

      <Card accessibilityLabel={`Google Takvim bağlantı özeti. ${presentation.label}.`} style={{ gap: theme.spacing.sm }}>
        <LabeledValue label="Bağlantı" value={presentation.label} />
        {accountEmail ? <LabeledValue label="Google hesabı" value={accountEmail} /> : null}
        {lastSyncedLabel ? <LabeledValue label="Son eşitleme" value={lastSyncedLabel} /> : null}
        {typeof managedEventCount === "number" ? <LabeledValue label="Yönetilen kayıt" value={String(managedEventCount)} /> : null}
      </Card>

      {mappingWarning ? <Banner message={mappingWarning} title="Takvim eşlemesi doğrulanmalı" tone="warning" /> : null}
      {warnings.map((warning, index) => (
        <Banner key={`${index}-${warning}`} message={warning} title="Eşitleme uyarısı" tone="warning" />
      ))}

      <Card style={{ gap: theme.spacing.sm }} variant="tonal">
        <StatusLine icon="shield-checkmark-outline" label="Kişisel etkinliklerin korunur" tone="success" />
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Eşitleme, kaldırma ve erişimi iptal etme işlemleri kişisel Google Takvim etkinliklerine dokunmaz. Yalnızca uygulamanın yönetim işareti taşıyan akademik kayıtları hedefler.</Text>
      </Card>

      {!hasConnection ? (
        <Button
          disabled={busy}
          fullWidth
          label="Google hesabı bağla"
          loading={presentation.state === "checking"}
          onPress={() => void onConnect()}
        />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <SettingsSection title="Bağlantı işlemlerinin kapsamı">
            <ListItem
              supportingText="Eski hesaptaki uygulama yönetimli kayıtları koruma veya kaldırma seçimi önce ayrıca sorulur."
              title="Hesabı değiştir"
            />
            <ListItem
              supportingText="Bağlantı metadatası kaldırılır; mevcut uygulama yönetimli kayıtlar Google Takvimde kalır."
              title="Bağlantıyı kes"
            />
            <ListItem
              supportingText="Yalnızca uygulamanın yönetim işaretli kayıtları kaldırılır ve bağlantı kesilir."
              title="Yönetilen kayıtları kaldır"
            />
            <ListItem
              supportingText="Google yetkisi iptal edilir; mevcut takvim kayıtları korunur."
              title="Erişimi iptal et"
            />
          </SettingsSection>
          {presentation.requiresReconnect || presentation.state === "disconnected" ? (
            <Button
              disabled={busy}
              fullWidth
              label="Google hesabını yeniden bağla"
              onPress={() => void onConnect()}
            />
          ) : (
            <Button
              disabled={busy}
              fullWidth
              label="Şimdi eşitle"
              loading={presentation.state === "syncing"}
              onPress={() => void onSync()}
            />
          )}
          <Button disabled={busy} fullWidth label="Google hesabını değiştir" onPress={() => void onSwitchAccount()} variant="secondary" />
          <View style={[styles.actionRow, layout.stackActions && styles.actionColumn, { gap: theme.spacing.sm }]}>
            <Button
              ref={disconnectRef}
              disabled={busy}
              fullWidth={layout.stackActions}
              label="Bağlantıyı kes"
              onPress={() => setConfirmation("disconnect")}
              variant="secondary"
            />
            <Button
              ref={removeRef}
              disabled={busy}
              fullWidth={layout.stackActions}
              label="Yönetilen kayıtları kaldır"
              onPress={() => setConfirmation("remove")}
              variant="secondary"
            />
          </View>
          <Button
            ref={revokeRef}
            disabled={busy}
            fullWidth
            label="Google erişimini iptal et"
            onPress={() => setConfirmation("revoke")}
            variant="danger"
          />
        </View>
      )}

      <BottomSheet
        dismissible={!confirmationBusy}
        loading={confirmationBusy}
        onDismiss={() => closeConfirmation()}
        scrollable
        title={confirmationCopy.title}
        visible={confirmation !== null}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{confirmationCopy.description}</Text>
          {confirmationError ? <Banner message={confirmationError} title="İşlem tamamlanamadı" tone="error" /> : null}
          <View style={[styles.actionRow, layout.stackActions && styles.actionColumn, { gap: theme.spacing.sm }]}>
            <Button disabled={confirmationBusy} fullWidth={layout.stackActions} label="Vazgeç" onPress={() => closeConfirmation()} variant="secondary" />
            <Button disabled={confirmationBusy} fullWidth={layout.stackActions} label={confirmationCopy.actionLabel} loading={confirmationBusy} onPress={() => void confirm()} variant={confirmation === "revoke" ? "danger" : "primary"} />
          </View>
        </View>
      </BottomSheet>
    </SettingsBody>
  );
}

export interface AccountDataSettingsScreenProps {
  email: string;
  busy?: boolean;
  error?: string;
  feedback?: {
    text: string;
    tone: "info" | "success" | "error";
  };
  recentAuthentication?: ReactNode;
  recentAuthenticationReturnFocus?: {
    action: "data" | "account";
    requestId: number;
  };
  onLogout: () => void | Promise<void>;
  onDeleteData: () => void | Promise<void>;
  onDeleteAccount: () => void | Promise<void>;
}

type AccountConfirmation = "data" | "account";

export function AccountDataSettingsScreen({
  email,
  busy = false,
  error,
  feedback,
  recentAuthentication,
  recentAuthenticationReturnFocus,
  onLogout,
  onDeleteData,
  onDeleteAccount,
}: AccountDataSettingsScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState<AccountConfirmation | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | undefined>();
  const confirmationPendingRef = useRef(false);
  const logoutPendingRef = useRef(false);
  const handledReturnFocusRequestRef = useRef(0);
  const dataRef = useRef<NativeView | null>(null);
  const accountRef = useRef<NativeView | null>(null);
  const dataFocusTargetRef = useRef<number | null>(null);
  const accountFocusTargetRef = useRef<number | null>(null);
  const effectiveBusy = busy || confirmationBusy || logoutBusy;
  const controlsLocked = effectiveBusy || Boolean(recentAuthentication);
  const copy = accountConfirmationCopy(confirmation, email);

  useEffect(() => {
    if (
      !recentAuthenticationReturnFocus
      || recentAuthenticationReturnFocus.requestId === handledReturnFocusRequestRef.current
    ) return;
    handledReturnFocusRequestRef.current = recentAuthenticationReturnFocus.requestId;
    restoreFocus(
      recentAuthenticationReturnFocus.action === "data" ? dataRef : accountRef,
      recentAuthenticationReturnFocus.action === "data"
        ? dataFocusTargetRef.current
        : accountFocusTargetRef.current,
    );
  }, [recentAuthenticationReturnFocus]);

  const closeConfirmation = (restore = true) => {
    const current = confirmation;
    setConfirmation(null);
    setConfirmationError(undefined);
    if (restore && current) {
      restoreFocus(
        current === "data" ? dataRef : accountRef,
        current === "data" ? dataFocusTargetRef.current : accountFocusTargetRef.current,
      );
    }
  };

  const submitLogout = async () => {
    if (logoutPendingRef.current) return;
    logoutPendingRef.current = true;
    setLogoutBusy(true);
    setLogoutError(undefined);
    try {
      await onLogout();
    } catch {
      setLogoutError("Oturum kapatılamadı. Hesap durumunu doğrulayıp tekrar deneyebilirsin.");
    } finally {
      logoutPendingRef.current = false;
      setLogoutBusy(false);
    }
  };

  const confirm = async () => {
    if (!confirmation || confirmationPendingRef.current) return;
    confirmationPendingRef.current = true;
    setConfirmationBusy(true);
    setConfirmationError(undefined);
    try {
      if (confirmation === "data") await onDeleteData();
      if (confirmation === "account") await onDeleteAccount();
      closeConfirmation(false);
    } catch {
      setConfirmationError("İşlem başlatılamadı. Hesap durumunu doğrulayıp tekrar deneyebilirsin.");
    } finally {
      confirmationPendingRef.current = false;
      setConfirmationBusy(false);
    }
  };

  return (
    <SettingsBody gap={theme.spacing.lg}>
      <ScreenHeading
        description="Oturumunu kapatabilir veya hesabına ait verileri yönetebilirsin. Silme işlemleri için amaca bağlı yakın zamanda kimlik doğrulaması gerekir."
        title="Hesap ve veri"
      />

      {feedback ? (
        <Banner
          message={feedback.text}
          title={feedback.tone === "error"
            ? "Hesap işlemi tamamlanamadı"
            : feedback.tone === "success"
              ? "Hesap işlemi tamamlandı"
              : "Hesap işlemi bilgisi"}
          tone={feedback.tone}
        />
      ) : error || logoutError ? (
        <Banner message={error ?? logoutError} title="Hesap işlemi tamamlanamadı" tone="error" />
      ) : null}

      <SettingsSection title="Oturum">
        <ListItem title="Hesap" supportingText={email.trim() || "E-posta bilgisi yok"} />
        <Button disabled={controlsLocked} fullWidth label="Çıkış yap" loading={logoutBusy} onPress={() => void submitLogout()} variant="secondary" />
      </SettingsSection>

      <View
        accessibilityLabel={`Tehlikeli alan. ${dangerExpanded ? "Açık" : "Kapalı"}.`}
        accessibilityState={{ expanded: dangerExpanded, busy: effectiveBusy }}
        style={{ gap: theme.spacing.sm }}
      >
        <Button
          aria-expanded={dangerExpanded}
          disabled={controlsLocked}
          fullWidth
          label={dangerExpanded ? "Tehlikeli alanı kapat" : "Tehlikeli alanı göster"}
          onPress={() => setDangerExpanded((current) => !current)}
          variant="danger"
        />
        {dangerExpanded ? (
          <Card style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.status.error }]}>Tehlikeli alan</Text>
              <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Bu işlemler geri alınamaz. Önce kapsamı okuyup ayrı bir onay vermen gerekir.</Text>
            </View>
            <Button
              ref={dataRef}
          disabled={controlsLocked}
              fullWidth
              label="Uygulama verilerimi sil"
              onPress={(event: GestureResponderEvent) => {
                const target = Number(event?.nativeEvent?.target);
                dataFocusTargetRef.current = Number.isFinite(target) ? target : null;
                setConfirmation("data");
              }}
              variant="secondary"
            />
            <Button
              ref={accountRef}
          disabled={controlsLocked}
              fullWidth
              label="Hesabımı kalıcı olarak sil"
              onPress={(event: GestureResponderEvent) => {
                const target = Number(event?.nativeEvent?.target);
                accountFocusTargetRef.current = Number.isFinite(target) ? target : null;
                setConfirmation("account");
              }}
              variant="danger"
            />
          </Card>
        ) : null}
        {recentAuthentication}
      </View>

      <BottomSheet
        dismissible={!confirmationBusy}
        loading={confirmationBusy}
        onDismiss={() => closeConfirmation()}
        scrollable
        title={copy.title}
        visible={confirmation !== null}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{copy.description}</Text>
          <Banner message={copy.warning} title="Geri alınamaz" tone="warning" />
          {confirmationError ? <Banner message={confirmationError} title="İşlem başlatılamadı" tone="error" /> : null}
          <View style={[styles.actionRow, layout.stackActions && styles.actionColumn, { gap: theme.spacing.sm }]}>
            <Button disabled={confirmationBusy} fullWidth={layout.stackActions} label="Vazgeç" onPress={() => closeConfirmation()} variant="secondary" />
            <Button disabled={confirmationBusy} fullWidth={layout.stackActions} label={copy.actionLabel} loading={confirmationBusy} onPress={() => void confirm()} variant="danger" />
          </View>
        </View>
      </BottomSheet>
    </SettingsBody>
  );
}

function SettingsBody({ children, gap }: { children: ReactNode; gap: number }) {
  const layout = useProfileLayout();
  return (
    <View style={[styles.body, { gap, maxWidth: layout.maxWidth, paddingHorizontal: layout.innerGutter }]}>
      {children}
    </View>
  );
}

function ScreenHeading({
  title,
  description,
  headingRef,
  onHeadingLayoutTarget,
}: {
  title: string;
  description: string;
  headingRef?: RefObject<NativeText | null>;
  onHeadingLayoutTarget?: (target: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text
        ref={headingRef}
        accessibilityRole="header"
        onLayout={(event) => {
          const target = Number(event.target);
          if (Number.isFinite(target)) onHeadingLayoutTarget?.(target);
        }}
        style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
      >
        {title}
      </Text>
      <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{description}</Text>
    </View>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>{title}</Text>
      <Card style={styles.sectionCard}>{children}</Card>
    </View>
  );
}

function ProfileSummarySkeleton() {
  const theme = useTheme();
  return (
    <Card accessibilityLabel="Profil özeti yükleniyor" accessibilityState={{ busy: true }} style={{ gap: theme.spacing.sm }}>
      <Skeleton decorative height={24} width="55%" />
      <Skeleton decorative height={18} width="78%" />
      <Skeleton decorative height={18} />
      <Skeleton decorative height={18} width="88%" />
    </Card>
  );
}

function LabeledValue({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.valueRow, { gap: theme.spacing.sm }]}>
      <Text style={[theme.typography.meta, styles.valueLabel, { color: theme.colors.text.secondary }]}>{label}</Text>
      <Text style={[theme.typography.bodyStrong, styles.valueText, { color: theme.colors.text.primary }]}>{value}</Text>
    </View>
  );
}

function StatusLine({ icon, label, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; tone: "success" | "warning" }) {
  const theme = useTheme();
  const color = tone === "success" ? theme.colors.status.success : theme.colors.status.warning;
  return (
    <View accessible accessibilityLabel={label} style={[styles.statusLine, { gap: theme.spacing.xs }]}>
      <Ionicons accessibilityElementsHidden color={color} importantForAccessibility="no-hide-descendants" name={icon} size={20} />
      <Text style={[theme.typography.metaStrong, styles.flexOne, { color }]}>{label}</Text>
    </View>
  );
}

function SettingsIcon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return <Ionicons accessibilityElementsHidden color={theme.colors.text.link} importantForAccessibility="no-hide-descendants" name={name} size={22} />;
}

function Chevron() {
  const theme = useTheme();
  return <Ionicons accessibilityElementsHidden color={theme.colors.text.secondary} importantForAccessibility="no-hide-descendants" name="chevron-forward" size={20} />;
}

function TruthRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return <ListItem accessibilityLabel={`${label}. ${value}`} leading={<SettingsIcon name={icon} />} supportingText={value} title={label} />;
}

function LifecycleStatusCard({
  label,
  detail,
  tone,
  busy,
  error,
}: {
  label: string;
  detail: string;
  tone: GoogleCalendarPresentation["tone"] | NotificationTruth["tone"];
  busy: boolean;
  error: boolean;
}) {
  const theme = useTheme();
  const palette = statusPalette(theme, tone);
  return (
    <Card
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityLiveRegion={error ? "assertive" : "polite"}
      accessibilityRole={error ? "alert" : undefined}
      busy={busy}
      style={{ backgroundColor: palette.background, borderColor: palette.accent, gap: theme.spacing.sm }}
    >
      <View style={[styles.statusLine, { gap: theme.spacing.xs }]}>
        {busy ? <ActivityIndicator color={palette.accent} size="small" /> : <Ionicons color={palette.accent} name={error ? "alert-circle-outline" : "information-circle-outline"} size={22} />}
        <Text accessibilityRole="header" style={[theme.typography.cardTitle, styles.flexOne, { color: palette.foreground }]}>{label}</Text>
      </View>
      <Text style={[theme.typography.body, { color: palette.foreground }]}>{detail}</Text>
    </Card>
  );
}

function CategorySwitch({ label, value, disabled, onValueChange }: { label: string; value: boolean; disabled: boolean; onValueChange: (value: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.switchRow, { gap: theme.spacing.sm, minHeight: 48 }]}>
      <Text style={[theme.typography.body, styles.flexOne, { color: disabled ? theme.colors.text.disabled : theme.colors.text.primary }]}>{label}</Text>
      <SettingsSwitch
        disabled={disabled}
        label={`${label} bildirimi`}
        onValueChange={onValueChange}
        value={value}
      />
    </View>
  );
}

function SettingsSwitch({
  label,
  hint,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      android_ripple={{ color: theme.colors.state.pressed, borderless: true }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        styles.switchControl,
        pressed ? { backgroundColor: theme.colors.action.ghostPressed } : null,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <Switch
          disabled={disabled}
          ios_backgroundColor={theme.colors.action.disabled}
          thumbColor={value ? theme.colors.action.primary : theme.colors.text.disabled}
          trackColor={{ false: theme.colors.action.disabled, true: theme.colors.state.selected }}
          value={value}
        />
      </View>
    </Pressable>
  );
}

function statusPalette(theme: SemanticTheme, tone: GoogleCalendarPresentation["tone"] | NotificationTruth["tone"]) {
  switch (tone) {
    case "success": return { background: theme.colors.status.successContainer, foreground: theme.colors.status.onSuccessContainer, accent: theme.colors.status.success };
    case "warning": return { background: theme.colors.status.warningContainer, foreground: theme.colors.status.onWarningContainer, accent: theme.colors.status.warning };
    case "error": return { background: theme.colors.status.errorContainer, foreground: theme.colors.status.onErrorContainer, accent: theme.colors.status.error };
    case "neutral": return { background: theme.colors.background.subtle, foreground: theme.colors.text.primary, accent: theme.colors.border.strong };
    case "info":
    default: return { background: theme.colors.status.infoContainer, foreground: theme.colors.status.onInfoContainer, accent: theme.colors.status.info };
  }
}

function googleConfirmationCopy(confirmation: GoogleConfirmation | null, managedEventCount?: number) {
  if (confirmation === "remove") {
    return {
      title: "Yönetilen kayıtlar kaldırılsın mı?",
      description: `${typeof managedEventCount === "number" ? `${managedEventCount} yönetilen kayıt hedeflenecek. ` : ""}Yalnızca bu uygulamanın yönetim işaretini taşıyan akademik kayıtlar kaldırılır. Kişisel etkinliklerin korunur.`,
      actionLabel: "Yönetilen kayıtları kaldır",
    };
  }
  if (confirmation === "revoke") {
    return {
      title: "Google erişimi iptal edilsin mi?",
      description: "Uygulamanın Google yetkisi iptal edilir. Mevcut takvim kayıtları korunur; buna uygulamanın yönettiği kayıtlar da dahildir. Kişisel etkinliklerin değiştirilmez; daha sonra eşitlemek için yeniden izin vermen gerekir.",
      actionLabel: "Erişimi iptal et",
    };
  }
  return {
    title: "Google Takvim bağlantısı kesilsin mi?",
    description: "Hesap bağlantısı kaldırılır; uygulamanın daha önce yönettiği kayıtlar Google Takvimde kalır. Kişisel Google Takvim etkinliklerin değiştirilmez.",
    actionLabel: "Bağlantıyı kes",
  };
}

function accountConfirmationCopy(confirmation: AccountConfirmation | null, email: string) {
  if (confirmation === "account") {
    return {
      title: "Hesap kalıcı olarak silinsin mi?",
      description: `${email.trim() || "Bu hesap"} için sunucu hesabı ve uygulama verileri kalıcı olarak silinir; bu hesapla yeniden giriş yapılamaz. Mevcut bağlantı kaydında bilinen, yalnızca uygulamanın yönettiği Google Takvim kayıtlarının kaldırılması ve Google erişiminin iptali denenir. Kişisel Google Takvim etkinliklerin korunur.`,
      warning: "Hesap silme geri alınamaz. Tamamlanamayan Google veya cihaz temizliği güvenli hedef adıyla bildirilir; kişisel etkinlik silinmez. Devam etmeden önce yalnızca hesap silme amacı için geçerli, tek kullanımlık yakın zamanda kimlik doğrulaması istenir.",
      actionLabel: "Hesabı silmeye devam et",
    };
  }
  return {
    title: "Uygulama verileri silinsin mi?",
    description: "Hesabın ve giriş bilgilerin açık kalır; uygulamadaki kişisel takvim, tercih ve kişiselleştirme verilerin silinir. Mevcut bağlantı kaydında bilinen, yalnızca uygulamanın yönettiği Google Takvim kayıtlarının kaldırılması ve Google erişiminin iptali denenir. Kişisel Google Takvim etkinliklerin korunur.",
    warning: "Veri silme geri alınamaz. Tamamlanamayan Google veya cihaz temizliği güvenli hedef adıyla bildirilir; hesabın ve kişisel Google etkinliklerin kalır. Devam etmeden önce yalnızca veri silme amacı için geçerli, tek kullanımlık yakın zamanda kimlik doğrulaması istenir.",
    actionLabel: "Verileri silmeye devam et",
  };
}

function restoreFocus(
  ref: RefObject<NativeView | NativeText | null>,
  fallbackTarget?: number | null,
) {
  setTimeout(() => {
    const target = findNodeHandle(ref.current) ?? fallbackTarget;
    if (target) AccessibilityInfo.setAccessibilityFocus(target);
  }, 0);
}

function useProfileLayout() {
  const { width, fontScale } = useWindowDimensions();
  return useMemo(() => {
    const resolved = resolveProfileSettingsLayout(width, fontScale);
    return {
      ...resolved,
      stackActions: resolved.compact || resolved.largeText,
      innerGutter: resolved.compact ? 2 : 0,
    };
  }, [fontScale, width]);
}

const styles = StyleSheet.create({
  body: {
    alignSelf: "center",
    width: "100%",
  },
  sectionCard: {
    overflow: "hidden",
    padding: 0,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  valueRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  valueLabel: {
    flexBasis: 92,
    flexShrink: 0,
  },
  valueText: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
  statusLine: {
    alignItems: "center",
    flexDirection: "row",
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  switchControl: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
  },
  actionRow: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  actionColumn: {
    flexDirection: "column",
  },
});
