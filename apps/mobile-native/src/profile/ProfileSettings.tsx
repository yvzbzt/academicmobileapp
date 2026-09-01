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
  IconButton,
  ListItem,
  Skeleton,
  referencePalette,
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

export interface AppleCalendarPresentation {
  state: "unavailable" | "disconnected" | "checking" | "connected" | "syncing" | "partial" | "denied" | "error";
  label: string;
  title: string;
  detail: string;
  tone: GoogleCalendarPresentation["tone"];
  busy: boolean;
  connected: boolean;
}

export interface ProfileOverviewScreenProps {
  fullName: string;
  email: string;
  academicSummary: AcademicProfileSummary;
  notificationTruth: NotificationTruth;
  googleCalendar: GoogleCalendarPresentation;
  appleCalendar?: AppleCalendarPresentation;
  googleAccountEmail?: string;
  appVersion: string;
  avatarUri?: string;
  loading?: boolean;
  error?: string;
  followedUniversityCount?: number;
  onRetry?: () => void;
  onOpenAcademicProfile: () => void;
  onOpenFollowedUniversities: () => void;
  onOpenNotifications: () => void;
  onOpenAppleCalendar?: () => void;
  onOpenGoogleCalendar: () => void;
  onOpenAccountManagement: () => void;
  onLogout: () => void | Promise<void>;
  onOpenAccountMenu?: () => void;
}

/** The profile root is an ordered settings index, not a second dashboard. */
export function ProfileOverviewScreen({
  fullName,
  email,
  academicSummary,
  notificationTruth,
  googleCalendar,
  appleCalendar,
  appVersion,
  error,
  followedUniversityCount = 0,
  onRetry,
  onOpenAccountMenu,
  onOpenAcademicProfile,
  onOpenFollowedUniversities,
  onOpenNotifications,
  onOpenAppleCalendar,
  onOpenGoogleCalendar,
  onOpenAccountManagement,
}: ProfileOverviewScreenProps) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const layout = useProfileLayout();
  const completionPercent = academicSummary.complete ? 100 : 0;
  const stackedIdentity = layout.compact || fontScale >= 1.55;
  const stackedProgress = width < 448 || fontScale >= 1.35;
  const showNotificationAttention = notificationTruth.mismatch
    && notificationTruth.tone === "warning";

  return (
    <SettingsBody gap={theme.spacing.md}>
      <View style={styles.profileTopBar}>
        <Text
          accessibilityRole="header"
          style={[
            theme.typography.screenTitle,
            styles.profileOverviewTitle,
            { color: theme.colors.text.primary },
          ]}
        >
          Profil
        </Text>
        <Pressable
          accessibilityLabel="Bildirim tercihlerini aç"
          accessibilityRole="button"
          hitSlop={theme.spacing.xs}
          onPress={onOpenNotifications}
          style={({ pressed }) => [styles.profileBellButton, pressed && { backgroundColor: theme.colors.action.ghostPressed }]}
        >
          <Ionicons color={theme.colors.text.primary} name="notifications-outline" size={27} />
          {showNotificationAttention ? (
            <View style={[styles.profileBellDot, { backgroundColor: referencePalette.academicOrange, borderColor: theme.colors.background.canvas }]} />
          ) : null}
        </Pressable>
      </View>

      {error ? (
        <Banner
          actionLabel={onRetry ? "Tekrar dene" : undefined}
          message="Son doğrulanmış profil bilgileri gösteriliyor."
          onAction={onRetry}
          title="Ayarlar yenilenemedi"
          tone="error"
        />
      ) : null}

      <Card
        style={[
          styles.profileOverviewIdentityCard,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: referencePalette.academicBlueBorderMuted,
            borderRadius: 24,
            gap: theme.spacing.md,
            padding: layout.compact ? theme.spacing.md : theme.spacing.lg,
          },
        ]}
        testID="profile-identity-summary"
        variant="elevated"
      >
        <View style={[
          styles.profileHeroMain,
          stackedIdentity && styles.profileHeroMainStacked,
          { gap: theme.spacing.md },
        ]}>
          <View
            accessibilityLabel={`${profileInitials(fullName)} baş harfli profil avatarı`}
            style={[
              styles.profileAvatarFrame,
              styles.profileInitials,
              {
                backgroundColor: referencePalette.academicBlue,
                borderRadius: 40,
              },
            ]}
          >
            <Text
              maxFontSizeMultiplier={1.25}
              style={[styles.profileInitialsText, { color: referencePalette.white }]}
            >
              {profileInitials(fullName)}
            </Text>
          </View>
          <View style={[styles.profileHeroCopy, { gap: theme.spacing.xxs }]}>
            <Text
              style={[theme.typography.screenTitle, { color: referencePalette.navy }]}
            >
              {fullName.trim() || "Öğrenci"}
            </Text>
            <Text
              style={[theme.typography.meta, { color: referencePalette.academicTextSecondary }]}
            >
              {email.trim() || "E-posta bilgisi yok"}
            </Text>
            <ProfileIdentityLine icon="business-outline" text={academicSummary.universityLabel} />
            {academicSummary.facultyLabel ? (
              <ProfileIdentityLine icon="shield-checkmark-outline" text={academicSummary.facultyLabel} />
            ) : null}
          </View>
        </View>

        <View style={[styles.profileIdentityDivider, { backgroundColor: theme.colors.border.subtle }]} />
        <View
          style={[styles.profileProgressHeader, stackedProgress && styles.profileProgressHeaderStacked]}
          testID="profile-completion-header"
        >
          <Text
            style={[theme.typography.body, styles.profileProgressCopy, { color: theme.colors.text.secondary }]}
          >
            Akademik profil <Text style={[theme.typography.bodyStrong, { color: referencePalette.academicBlueDeep }]}>%{completionPercent}</Text> tamamlandı
          </Text>
          <View style={[styles.profileProgressBadge, { backgroundColor: referencePalette.academicBlueTint }]}>
            <Ionicons color={referencePalette.academicBlue} name="stats-chart" size={16} />
            <Text
              style={[theme.typography.metaStrong, styles.profileProgressBadgeText, { color: referencePalette.academicBlueDeep }]}
            >
              {academicSummary.complete ? "Harika gidiyorsun!" : "Profilini tamamla"}
            </Text>
          </View>
        </View>
        <View
          accessibilityLabel={`Akademik profil yüzde ${completionPercent} tamamlandı`}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: completionPercent }}
          style={[styles.profileProgressTrack, { backgroundColor: referencePalette.academicBlueBorderMuted }]}
          testID="profile-completion-progress"
        >
          <View
            style={[
              styles.profileProgressFill,
              {
                backgroundColor: referencePalette.academicBlue,
                width: `${completionPercent}%` as `${number}%`,
              },
            ]}
          />
        </View>
      </Card>

      {showNotificationAttention ? (
        <Pressable
          accessibilityHint="Bildirim tercihi ve cihaz teslimat durumunu açar."
          accessibilityLabel={`${notificationTruth.title}. Tercihleri gözden geçir`}
          accessibilityRole="button"
          onPress={onOpenNotifications}
          style={({ pressed }) => [
            styles.notificationAttentionCard,
            {
              backgroundColor: referencePalette.academicOrangeSoft,
              borderColor: referencePalette.academicOrange,
              borderRadius: 22,
              gap: theme.spacing.md,
              opacity: pressed ? 0.86 : 1,
              padding: theme.spacing.md,
            },
            stackedIdentity && styles.notificationAttentionCardStacked,
          ]}
        >
          <View style={[styles.notificationAttentionIcon, { backgroundColor: referencePalette.white }]}>
            <Ionicons color={referencePalette.academicOrange} name="notifications-outline" size={28} />
          </View>
          <View style={[styles.profileOverviewItemCopy, { gap: theme.spacing.xxs }]}>
            <Text style={[theme.typography.bodyStrong, { color: referencePalette.amberStrong }]}>
              {notificationTruth.title}
            </Text>
            <Text style={[theme.typography.meta, { color: referencePalette.academicTextBody }]}>
              {notificationTruth.detail}
            </Text>
          </View>
          <View style={styles.notificationAttentionAction}>
            <Text maxFontSizeMultiplier={1.3} style={[theme.typography.metaStrong, { color: referencePalette.amberStrong }]}>Gözden geçir</Text>
            <Ionicons color={referencePalette.amberStrong} name="arrow-forward" size={19} />
          </View>
        </Pressable>
      ) : null}

      <View testID="profile-settings-group">
        <Card
          style={[
            styles.sectionCard,
            {
              backgroundColor: theme.colors.background.surface,
              borderColor: theme.colors.border.subtle,
              borderRadius: 22,
            },
          ]}
          variant="elevated"
        >
        <ProfileOverviewItem
          accessibilityHint="Hesap ve güvenlik yönetimi ekranını açar."
          leading={<SettingsIcon name="person-outline" tone="primary" />}
          onPress={onOpenAccountManagement}
          supportingText="Hesap, oturum ve veri tercihlerini yönet"
          title="Hesap ve güvenlik"
          trailing={<Chevron />}
        />
        <ProfileOverviewItem
          accessibilityHint="Akademik profil düzenleme ekranını açar."
          leading={<SettingsIcon name="school-outline" tone="primary" />}
          onPress={onOpenAcademicProfile}
          supportingText={academicSummary.supportingText}
          title="Akademik profil"
          trailing={<Chevron />}
        />
        <ProfileOverviewItem
          accessibilityHint="Duyurularını takip ettiğin ek üniversiteleri açar."
          leading={<SettingsIcon name="business-outline" tone="success" />}
          onPress={onOpenFollowedUniversities}
          supportingText={`${followedUniversityCount} ek üniversite`}
          title="Takip edilen üniversiteler"
          trailing={<Chevron />}
        />
        <ProfileOverviewItem
          accessibilityHint="Bildirim tercihi ve cihaz teslimat durumunu açar."
          leading={<SettingsIcon name="notifications-outline" tone="warning" />}
          onPress={onOpenNotifications}
          supportingText={`${notificationTruth.title} · Etkinlik, ders ve sınav hatırlatmalarını yönet`}
          title="Bildirim tercihleri"
          trailing={<Chevron />}
        />
        {appleCalendar && onOpenAppleCalendar ? (
          <ProfileOverviewItem
            accessibilityLabel={`Apple Takvim bağlantısı. ${appleCalendar.label}. ${appleCalendar.detail}`}
            accessibilityHint="Apple Takvim bağlantı yönetimini açar."
            leading={<SettingsIcon name="calendar" tone="primary" />}
            onPress={onOpenAppleCalendar}
            stackTrailingAtLargeText
            supportingText="Akademik kayıtlarını cihazındaki Apple Takvim ile eşitle"
            title="Apple Takvim bağlantısı"
            trailing={(
              <View style={[styles.profileTrailingStatus, { gap: theme.spacing.sm }]}>
                <Text
                  style={[
                    theme.typography.metaStrong,
                    styles.profileTrailingStatusText,
                    { color: theme.colors.text.link },
                  ]}
                >
                  {appleCalendar.label}
                </Text>
                <Chevron />
              </View>
            )}
          />
        ) : null}
        <ProfileOverviewItem
          accessibilityLabel={`Google Takvim bağlantısı. ${googleCalendar.label}. ${googleCalendar.detail}`}
          accessibilityHint="Google Takvim bağlantı yönetimini açar."
          leading={<SettingsIcon name="calendar-outline" tone="success" />}
          onPress={onOpenGoogleCalendar}
          stackTrailingAtLargeText
          supportingText="Takvimini senkronize et, hiçbir etkinliği kaçırma"
          title="Google Takvim bağlantısı"
          trailing={(
            <View style={[styles.profileTrailingStatus, { gap: theme.spacing.sm }]}>
              <Text
                style={[
                  theme.typography.metaStrong,
                  styles.profileTrailingStatusText,
                  { color: theme.colors.text.link },
                ]}
              >
                {googleCalendar.label === "Bağlı" ? "Bağlı" : googleCalendar.label}
              </Text>
              <Chevron />
            </View>
          )}
          last
        />
        </Card>
      </View>

      <Text
        style={[
          theme.typography.navLabel,
          styles.profileVersion,
          { color: theme.colors.text.secondary },
        ]}
      >
        Sürüm {appVersion}
      </Text>
    </SettingsBody>
  );
}

function ProfileIdentityLine({
  icon,
  text,
}: {
  icon: "business-outline" | "shield-checkmark-outline";
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.profileIdentityLine}>
      <Ionicons color={referencePalette.academicTextSecondary} name={icon} size={18} />
      <Text
        style={[theme.typography.meta, styles.profileOverviewItemCopy, { color: referencePalette.academicTextSecondary }]}
      >
        {text}
      </Text>
    </View>
  );
}

function ProfileOverviewItem({
  accessibilityHint,
  accessibilityLabel,
  leading,
  onPress,
  stackTrailingAtLargeText = false,
  supportingText,
  title,
  trailing,
  last = false,
}: {
  accessibilityHint: string;
  accessibilityLabel?: string;
  leading: ReactNode;
  onPress: (event: GestureResponderEvent) => void;
  stackTrailingAtLargeText?: boolean;
  supportingText: string;
  title: string;
  trailing: ReactNode;
  last?: boolean;
}) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const stackTrailing = stackTrailingAtLargeText && fontScale >= 1.8;
  const reflowForCompactLargeText = width < 375 && fontScale >= 1.8;
  const reflowTrailingBelowCopy = reflowForCompactLargeText && stackTrailingAtLargeText;

  const leadingControl = (
    <View importantForAccessibility="no">{leading}</View>
  );
  const trailingControl = (
    <View
      importantForAccessibility="no"
      style={reflowTrailingBelowCopy
        ? styles.profileOverviewTrailingReflowed
        : !reflowForCompactLargeText && stackTrailing
          ? styles.profileOverviewTrailingStacked
          : undefined}
      testID={reflowTrailingBelowCopy ? "profile-overview-item-trailing-reflow" : undefined}
    >
      {trailing}
    </View>
  );
  const copy = (
    <View
      style={[
        styles.profileOverviewItemCopy,
        reflowForCompactLargeText && styles.profileOverviewItemCopyReflowed,
        { gap: theme.spacing.xxs },
      ]}
    >
      <Text
        android_hyphenationFrequency={reflowForCompactLargeText ? "none" : undefined}
        style={[
          theme.typography.bodyStrong,
          reflowForCompactLargeText && styles.profileOverviewItemTextReflowed,
          { color: theme.colors.text.primary },
        ]}
        textBreakStrategy={reflowForCompactLargeText ? "balanced" : undefined}
      >
        {title}
      </Text>
      <Text
        android_hyphenationFrequency={reflowForCompactLargeText ? "none" : undefined}
        style={[
          theme.typography.meta,
          reflowForCompactLargeText && styles.profileOverviewItemTextReflowed,
          { color: theme.colors.text.secondary },
        ]}
        textBreakStrategy={reflowForCompactLargeText ? "balanced" : undefined}
      >
        {supportingText}
      </Text>
    </View>
  );

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileMenuRow,
        styles.profileOverviewItem,
        !reflowForCompactLargeText && stackTrailing && styles.profileOverviewItemStacked,
        reflowForCompactLargeText && styles.profileOverviewItemReflowed,
        last && styles.profileOverviewItemLast,
        {
          backgroundColor: pressed ? theme.colors.action.ghostPressed : theme.colors.background.surface,
          borderColor: theme.colors.border.subtle,
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        },
      ]}
    >
      {reflowForCompactLargeText ? (
        <>
          <View
            style={styles.profileOverviewItemControls}
            testID="profile-overview-item-controls"
          >
            {leadingControl}{reflowTrailingBelowCopy ? null : trailingControl}
          </View>
          {copy}
          {reflowTrailingBelowCopy ? trailingControl : null}
        </>
      ) : (
        <>{leadingControl}{copy}{trailingControl}</>
      )}
    </Pressable>
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
      <View style={[styles.academicProfileIntro, { gap: theme.spacing.xs }]}>
        <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Seçimlerini güncelle</Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Üniversite zorunludur. Fakülte, bölüm ve sınıf isteğe bağlıdır.</Text>
      </View>

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

interface NotificationPreferenceGroup {
  key: "exams" | "announcements" | "deadlines" | "events";
  title: string;
  supportingText: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: SettingsIconTone;
  categoryKeys: readonly string[];
  enabled: boolean;
}

const notificationFallbackKeys = {
  exams: ["midterm_exam", "final_exam", "makeup_exam", "single_course_exam", "department_exam_schedule"],
  announcements: ["announcement", "faculty_announcement", "department_announcement", "yok_event"],
  deadlines: ["course_registration", "course_renewal", "add_drop", "graduation_application", "tuition_payment", "horizontal_transfer", "summer_school_registration"],
  events: ["academic_year_start", "academic_year_end", "fall_start", "fall_end", "spring_start", "spring_end", "summer_school_start", "summer_school_end", "holiday", "orientation", "custom_event"],
} as const;

function notificationPreferenceGroups(
  categories: readonly NotificationCategoryOption[],
  preferenceEnabled: boolean,
): readonly NotificationPreferenceGroup[] {
  const remaining = [...categories];
  const take = (matcher: (searchable: string) => boolean) => {
    const matches = remaining.filter((category) => matcher(`${category.key} ${category.label}`.toLocaleLowerCase("tr-TR")));
    const matchedKeys = new Set(matches.map((category) => category.key));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (matchedKeys.has(remaining[index].key)) remaining.splice(index, 1);
    }
    return matches;
  };
  const exams = take((value) => /exam|sınav|sinav|vize|final|bütünleme/.test(value));
  const announcements = take((value) => /announcement|duyuru|haber|yok_event/.test(value));
  const deadlines = take((value) => /registration|renewal|add_drop|application|payment|transfer|deadline|başvuru|basvuru|kayıt|kayit/.test(value));
  const grouped = {
    exams,
    announcements,
    deadlines,
    events: remaining,
  } as const;
  const presentation: Record<NotificationPreferenceGroup["key"], Omit<NotificationPreferenceGroup, "categoryKeys" | "enabled" | "key">> = {
    exams: {
      title: "Sınav tarihleri",
      supportingText: "Sınav programlarınız ve yaklaşan sınavlar",
      icon: "calendar-outline",
      tone: "primary",
    },
    announcements: {
      title: "Duyurular",
      supportingText: "Fakülte, bölüm ve üniversite duyuruları",
      icon: "megaphone-outline",
      tone: "neutral",
    },
    deadlines: {
      title: "Son başvuru tarihleri",
      supportingText: "Başvuru ve kayıt için son tarih hatırlatmaları",
      icon: "hourglass-outline",
      tone: "success",
    },
    events: {
      title: "Etkinlikler",
      supportingText: "Etkinlik, seminer ve organizasyon hatırlatmaları",
      icon: "calendar-number-outline",
      tone: "warning",
    },
  };
  return (["exams", "announcements", "deadlines", "events"] as const).map((key) => {
    const matchingCategories = grouped[key];
    return {
      key,
      ...presentation[key],
      categoryKeys: matchingCategories.length > 0
        ? matchingCategories.map((category) => category.key)
        : notificationFallbackKeys[key],
      enabled: matchingCategories.length > 0
        ? matchingCategories.every((category) => category.enabled)
        : preferenceEnabled,
    };
  });
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
  onBack?: () => void;
}

export type NotificationHeroLayout = "side-by-side" | "stacked";

export function resolveNotificationHeroLayout(
  windowWidth: number,
  fontScale: number,
): NotificationHeroLayout {
  const safeWidth = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 320;
  const safeFontScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return safeWidth < 410 || safeFontScale >= 1.3 ? "stacked" : "side-by-side";
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
  onBack,
}: NotificationSettingsScreenProps) {
  const theme = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const heroLayout = resolveNotificationHeroLayout(width, fontScale);
  const stackedHero = heroLayout === "stacked";
  const [openSettingsBusy, setOpenSettingsBusy] = useState(false);
  const [openSettingsError, setOpenSettingsError] = useState<string | undefined>();
  const openSettingsPendingRef = useRef(false);
  const busy = truth.busy || saveState === "saving" || saveState === "loading" || openSettingsBusy;
  const groupedCategories = useMemo(
    () => notificationPreferenceGroups(categories, preferenceEnabled),
    [categories, preferenceEnabled],
  );

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
      <View style={styles.notificationTopBar}>
        {onBack ? (
          <IconButton
            accessibilityLabel="Geri dön"
            icon={<Ionicons color={theme.colors.text.primary} name="arrow-back" size={25} />}
            onPress={onBack}
            style={{ borderRadius: theme.radii.pill }}
          />
        ) : <View style={styles.notificationTopSpacer} />}
        <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Bildirim tercihleri</Text>
        <View style={styles.notificationTopSpacer} />
      </View>

      <View
        style={[
          styles.notificationHero,
          stackedHero ? styles.notificationHeroStacked : styles.notificationHeroSideBySide,
        ]}
        testID="notification-settings-hero"
      >
        <View style={[
          styles.notificationHeroCopy,
          stackedHero ? styles.notificationHeroCopyStacked : styles.notificationHeroCopySideBySide,
          { gap: theme.spacing.sm },
        ]}>
          <Text style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Önemli tarihleri zamanında hatırla</Text>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Sınav, duyuru, başvuru ve etkinlik bildirimlerini ihtiyacına göre seç.</Text>
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.notificationHeroPreview,
            stackedHero ? styles.notificationHeroPreviewStacked : styles.notificationHeroPreviewSideBySide,
            {
              backgroundColor: theme.colors.background.subtle,
              borderColor: theme.colors.border.subtle,
              borderRadius: theme.radii.card,
            },
          ]}
          testID="notification-hero-preview"
        >
          <View style={styles.notificationPreviewHeader}>
            <View style={[styles.notificationPreviewIcon, { backgroundColor: theme.colors.action.secondary, borderRadius: theme.radii.card }]}>
              <Ionicons color={theme.colors.action.primary} name="notifications-outline" size={22} />
            </View>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}>Hatırlatmalar</Text>
          </View>
          <View style={[styles.notificationPreviewRow, { borderTopColor: theme.colors.border.subtle }]}>
            <Text style={[theme.typography.meta, styles.flexOne, { color: theme.colors.text.secondary }]}>Sınavlar</Text>
            <Ionicons color={theme.colors.status.success} name="checkmark-circle" size={18} />
          </View>
          <View style={[styles.notificationPreviewRow, { borderTopColor: theme.colors.border.subtle }]}>
            <Text style={[theme.typography.meta, styles.flexOne, { color: theme.colors.text.secondary }]}>Duyurular</Text>
            <Ionicons color={theme.colors.status.success} name="checkmark-circle" size={18} />
          </View>
        </View>
      </View>

      <Pressable
        accessibilityHint="Cihaz bildirim ayarlarını açar."
        accessibilityLabel={`${truth.active ? "Bildirim izni açık" : truth.title}. ${truth.detail}`}
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void requestOpenSettings()}
        style={({ pressed }) => [
          styles.notificationPermissionCard,
          {
            backgroundColor: truth.active ? theme.colors.status.successContainer : theme.colors.status.warningContainer,
            borderColor: truth.active ? theme.colors.status.success : theme.colors.status.warning,
            borderRadius: theme.radii.card,
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
          },
          pressed && { opacity: 0.82 },
        ]}
      >
        <SettingsIcon name={truth.active ? "shield-checkmark" : "alert-circle"} tone={truth.active ? "success" : "warning"} />
        <View style={styles.flexOne}>
          <Text style={[theme.typography.bodyStrong, { color: truth.active ? theme.colors.status.success : theme.colors.status.warning }]}>{truth.active ? "Bildirim izni açık" : truth.title}</Text>
          <Text style={[theme.typography.meta, { color: truth.active ? theme.colors.status.onSuccessContainer : theme.colors.status.onWarningContainer }]}>{truth.detail}</Text>
        </View>
        <Chevron />
      </Pressable>

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
      {openSettingsError && !truth.openSettingsRequired ? (
        <Banner message={openSettingsError} title="Cihaz ayarları açılamadı" tone="error" />
      ) : null}
      {truth.kind === "error" && onRetry ? (
        <Button fullWidth label="Bildirim durumunu tekrar denetle" onPress={onRetry} variant="secondary" />
      ) : null}
      <ProfileReferenceSection title="BİLDİRİM TÜRLERİ">
        <NotificationPreferenceRow
          disabled={busy}
          icon="notifications-outline"
          label="Akademik hatırlatmalar"
          onValueChange={onPreferenceEnabledChange}
          supportingText={preferenceEnabled
            ? "Bildirim teslimatını devre dışı bırak"
            : "Bildirim tercihlerini etkinleştir"}
          tone="primary"
          value={preferenceEnabled}
        />
        {groupedCategories.map((group) => {
          return (
            <NotificationPreferenceRow
              disabled={busy || !preferenceEnabled}
              icon={group.icon}
              key={group.key}
              label={group.title}
              onValueChange={(enabled) => {
                if (mode !== "selected_fields") onModeChange("selected_fields");
                group.categoryKeys.forEach((categoryKey) => onCategoryChange(categoryKey, enabled));
              }}
              supportingText={group.supportingText}
              tone={group.tone}
              value={group.enabled}
            />
          );
        })}
        {categories.length === 0 ? (
          <Text accessibilityRole="alert" style={[theme.typography.body, { color: theme.colors.text.secondary, padding: theme.spacing.md }]}>Bu hesap için kullanılabilir bildirim kategorisi yok.</Text>
        ) : null}
      </ProfileReferenceSection>

      <ProfileReferenceSection title="EK TERCİHLERİN">
        <ListItem
          leading={<SettingsIcon name="moon-outline" tone="neutral" />}
          style={styles.profileMenuRow}
          supportingText="Belirlediğiniz saat aralığında bildirim almayın."
          title="Sessiz saatler"
          trailing={<Text style={[theme.typography.body, { color: theme.colors.text.link }]}>{quietHoursSummary ?? "22:00 – 07:00"}</Text>}
        />
        <ListItem
          leading={<SettingsIcon name="notifications-outline" tone="primary" />}
          style={styles.profileMenuRow}
          supportingText={reminderSummary ? `Hatırlatma zamanı: ${reminderSummary}` : "Öncelikli bildirimler sessiz saatlerde de gönderilebilir."}
          title="Öncelik seçimi"
          trailing={<Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Yalnızca acil</Text>}
        />
        <View style={[styles.notificationInfoCallout, { backgroundColor: theme.colors.status.infoContainer, borderRadius: theme.radii.control, gap: theme.spacing.sm }]}>
          <Ionicons color={theme.colors.status.info} name="information-circle-outline" size={22} />
          <Text style={[theme.typography.meta, styles.flexOne, { color: theme.colors.status.onInfoContainer }]}>Acil duyurular (sınav saati değişikliği, ders iptali vb.) sessiz saatlerde de gönderilebilir.</Text>
        </View>
      </ProfileReferenceSection>

      {saveState === "error" ? (
        <Banner message={error || "Tercihin kaydedilemedi; cihaz ve teslimat durumu değiştirilmiş kabul edilmedi."} title="Bildirim tercihi kaydedilemedi" tone="error" />
      ) : null}
      {dirty ? <Banner message="Bu seçimler henüz hesabına uygulanmadı." title="Kaydedilmemiş değişiklikler" tone="warning" /> : null}

      <Button
        disabled={busy}
        fullWidth
        label="Tercihleri kaydet"
        leadingIcon={<Ionicons color={theme.colors.action.onPrimary} name="bookmark-outline" size={21} />}
        loading={saveState === "saving"}
        onPress={() => {
          if (dirty) onSave();
        }}
        status={saveState === "error" ? "error" : "idle"}
      />
    </SettingsBody>
  );
}

export interface AppleCalendarSettingsScreenProps {
  presentation: AppleCalendarPresentation;
  calendarTitle?: string;
  lastSyncedLabel?: string;
  managedEventCount?: number;
  warnings?: readonly string[];
  error?: string;
  permissionDetail?: string;
  onEnable: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onRemoveManagedEvents: () => void | Promise<void>;
  onOpenCalendar?: () => void | Promise<void>;
}

type AppleCalendarConfirmation = "disconnect" | "remove";

export function AppleCalendarSettingsScreen({
  presentation,
  calendarTitle,
  lastSyncedLabel,
  managedEventCount,
  warnings = [],
  error,
  permissionDetail,
  onEnable,
  onSync,
  onOpenSettings,
  onDisconnect,
  onRemoveManagedEvents,
  onOpenCalendar,
}: AppleCalendarSettingsScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const [confirmation, setConfirmation] = useState<AppleCalendarConfirmation | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string>();
  const confirmationPendingRef = useRef(false);
  const disconnectRef = useRef<NativeView | null>(null);
  const removeRef = useRef<NativeView | null>(null);
  const busy = presentation.busy || confirmationBusy;

  const closeConfirmation = () => {
    const current = confirmation;
    setConfirmation(null);
    setConfirmationError(undefined);
    if (current) restoreFocus(current === "disconnect" ? disconnectRef : removeRef);
  };

  const confirm = async () => {
    if (!confirmation || confirmationPendingRef.current) return;
    confirmationPendingRef.current = true;
    setConfirmationBusy(true);
    setConfirmationError(undefined);
    try {
      if (confirmation === "disconnect") await onDisconnect();
      else await onRemoveManagedEvents();
      closeConfirmation();
    } catch {
      setConfirmationError("İşlem tamamlanamadı. Takvim izinlerini ve bağlantı durumunu kontrol edip tekrar dene.");
    } finally {
      confirmationPendingRef.current = false;
      setConfirmationBusy(false);
    }
  };

  const confirmationCopy = appleCalendarConfirmationCopy(confirmation, managedEventCount);

  return (
    <SettingsBody gap={theme.spacing.lg}>
      <ScreenHeading
        description="Akademik kayıtların cihazındaki Apple Takvim'e eklenir. Uygulama yalnızca kendi oluşturduğu işaretli kayıtları günceller veya kaldırır; kişisel etkinliklerine dokunmaz."
        title="Apple Takvim"
      />

      <LifecycleStatusCard
        busy={presentation.busy}
        detail={error || presentation.detail}
        error={Boolean(error) || presentation.tone === "error"}
        label={presentation.title}
        tone={error ? "error" : presentation.tone}
      />

      <Card
        accessibilityLabel={`Apple Takvim bağlantı özeti. ${presentation.label}.`}
        style={[
          styles.summaryCard,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
            gap: theme.spacing.sm,
          },
        ]}
        variant="elevated"
      >
        <View style={[styles.summaryHeading, { gap: theme.spacing.sm }]}>
          <SettingsIcon name="logo-apple" tone="primary" />
          <View style={[styles.flexOne, { gap: theme.spacing.xxs }]}>
            <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>Bağlantı özeti</Text>
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Bu cihazdaki uygulama yönetimli akademik kayıtlar</Text>
          </View>
        </View>
        <LabeledValue label="Bağlantı" value={presentation.label} />
        {calendarTitle ? <LabeledValue label="Takvim" value={calendarTitle} /> : null}
        {lastSyncedLabel ? <LabeledValue label="Son eşitleme" value={lastSyncedLabel} /> : null}
        {typeof managedEventCount === "number" ? <LabeledValue label="Yönetilen kayıt" value={String(managedEventCount)} /> : null}
      </Card>

      {permissionDetail ? <Banner message={permissionDetail} title="Takvim izni gerekli" tone="warning" /> : null}
      {warnings.map((warning, index) => (
        <Banner key={`${index}-${warning}`} message={warning} title="Eşitleme uyarısı" tone="warning" />
      ))}

      <Card
        style={[
          styles.protectionCard,
          {
            backgroundColor: theme.colors.status.successContainer,
            borderColor: theme.colors.status.success,
            gap: theme.spacing.sm,
          },
        ]}
        variant="tonal"
      >
        <StatusLine icon="shield-checkmark-outline" label="Kişisel etkinliklerin korunur" onContainer tone="success" />
        <Text style={[theme.typography.body, { color: theme.colors.status.onSuccessContainer }]}>Silme ve eşitleme işlemleri yalnızca Akademik Takvim uygulamasının doğrulanmış yönetim işaretini taşıyan kayıtlara uygulanır.</Text>
      </Card>

      {presentation.state === "denied" ? (
        <Button disabled={busy} fullWidth label="Takvim ayarlarını aç" onPress={() => void onOpenSettings()} />
      ) : !presentation.connected ? (
        <Button
          disabled={busy || presentation.state === "unavailable"}
          fullWidth
          label="Apple Takvim'i etkinleştir"
          loading={presentation.state === "checking"}
          onPress={() => void onEnable()}
        />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          <Button
            disabled={busy}
            fullWidth
            label="Şimdi eşitle"
            loading={presentation.state === "syncing"}
            onPress={() => void onSync()}
          />
          {onOpenCalendar ? (
            <Button disabled={busy} fullWidth label="Apple Takvim'de aç" onPress={() => void onOpenCalendar()} variant="secondary" />
          ) : null}
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
              variant="danger"
            />
          </View>
        </View>
      )}

      <BottomSheet
        dismissible={!confirmationBusy}
        loading={confirmationBusy}
        onDismiss={closeConfirmation}
        scrollable
        title={confirmationCopy.title}
        visible={confirmation !== null}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>{confirmationCopy.description}</Text>
          {confirmationError ? <Banner message={confirmationError} title="İşlem tamamlanamadı" tone="error" /> : null}
          <View style={[styles.actionRow, layout.stackActions && styles.actionColumn, { gap: theme.spacing.sm }]}>
            <Button disabled={confirmationBusy} fullWidth={layout.stackActions} label="Vazgeç" onPress={closeConfirmation} variant="secondary" />
            <Button disabled={confirmationBusy} fullWidth={layout.stackActions} label={confirmationCopy.actionLabel} loading={confirmationBusy} onPress={() => void confirm()} variant={confirmation === "remove" ? "danger" : "primary"} />
          </View>
        </View>
      </BottomSheet>
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

      <Card
        accessibilityLabel={`Google Takvim bağlantı özeti. ${presentation.label}.`}
        style={[
          styles.summaryCard,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
            gap: theme.spacing.sm,
          },
        ]}
        variant="elevated"
      >
        <View style={[styles.summaryHeading, { gap: theme.spacing.sm }]}>
          <SettingsIcon name="logo-google" tone="success" />
          <View style={[styles.flexOne, { gap: theme.spacing.xxs }]}>
            <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>Bağlantı özeti</Text>
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>Yalnızca uygulamanın yönettiği akademik kayıtlar</Text>
          </View>
        </View>
        <LabeledValue label="Bağlantı" value={presentation.label} />
        {accountEmail ? <LabeledValue label="Google hesabı" value={accountEmail} /> : null}
        {lastSyncedLabel ? <LabeledValue label="Son eşitleme" value={lastSyncedLabel} /> : null}
        {typeof managedEventCount === "number" ? <LabeledValue label="Yönetilen kayıt" value={String(managedEventCount)} /> : null}
      </Card>

      {mappingWarning ? <Banner message={mappingWarning} title="Takvim eşlemesi doğrulanmalı" tone="warning" /> : null}
      {warnings.map((warning, index) => (
        <Banner key={`${index}-${warning}`} message={warning} title="Eşitleme uyarısı" tone="warning" />
      ))}

      <Card
        style={[
          styles.protectionCard,
          {
            backgroundColor: theme.colors.status.successContainer,
            borderColor: theme.colors.status.success,
            gap: theme.spacing.sm,
          },
        ]}
        variant="tonal"
      >
        <StatusLine icon="shield-checkmark-outline" label="Kişisel etkinliklerin korunur" onContainer tone="success" />
        <Text style={[theme.typography.body, { color: theme.colors.status.onSuccessContainer }]}>Eşitleme, kaldırma ve erişimi iptal etme işlemleri kişisel Google Takvim etkinliklerine dokunmaz. Yalnızca uygulamanın yönetim işareti taşıyan akademik kayıtları hedefler.</Text>
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
  /** Legacy preview input; logout is intentionally owned by the profile root. */
  onLogout?: () => void | Promise<void>;
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
  onDeleteData,
  onDeleteAccount,
}: AccountDataSettingsScreenProps) {
  const theme = useTheme();
  const layout = useProfileLayout();
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState<AccountConfirmation | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const confirmationPendingRef = useRef(false);
  const handledReturnFocusRequestRef = useRef(0);
  const dataRef = useRef<NativeView | null>(null);
  const accountRef = useRef<NativeView | null>(null);
  const dataFocusTargetRef = useRef<number | null>(null);
  const accountFocusTargetRef = useRef<number | null>(null);
  const effectiveBusy = busy || confirmationBusy;
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
        description="Uygulama verilerini veya hesabını silme işlemlerini buradan yönetebilirsin. Devam etmeden önce kimliğin yeniden doğrulanır."
        title="Veri ve hesap silme"
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
      ) : error ? (
        <Banner message={error} title="Hesap işlemi tamamlanamadı" tone="error" />
      ) : null}

      <View
        accessibilityLabel={`Silme seçenekleri. ${dangerExpanded ? "Açık" : "Kapalı"}.`}
        accessibilityState={{ expanded: dangerExpanded, busy: effectiveBusy }}
        style={{ gap: theme.spacing.sm }}
      >
        <Button
          aria-expanded={dangerExpanded}
          disabled={controlsLocked}
          fullWidth
          label={dangerExpanded ? "Silme seçeneklerini gizle" : "Silme seçeneklerini göster"}
          onPress={() => setDangerExpanded((current) => !current)}
          variant="secondary"
        />
        {dangerExpanded ? (
          <Card
            style={[
              styles.dangerCard,
              {
                backgroundColor: theme.colors.background.surface,
                borderColor: theme.colors.border.subtle,
                gap: theme.spacing.md,
              },
            ]}
          >
            <View style={[styles.dangerHeading, { gap: theme.spacing.sm }]}>
              <SettingsIcon name="trash-outline" tone="neutral" />
              <View style={[styles.flexOne, { gap: theme.spacing.xs }]}>
                <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>Silme seçenekleri</Text>
                <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Her işlem kapsamını ayrı ayrı açıklar ve son adımda yeniden onay ister.</Text>
              </View>
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
  const theme = useTheme();
  const layout = useProfileLayout();
  return (
    <View
      style={[
        styles.body,
        {
          gap,
          maxWidth: layout.maxWidth,
          paddingBottom: theme.spacing.xl,
          paddingHorizontal: layout.innerGutter,
        },
      ]}
    >
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
  const presentation = screenHeadingPresentation(title);
  return (
    <Card
      style={[
        styles.headingCard,
        {
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
          gap: theme.spacing.md,
        },
      ]}
      variant="tonal"
    >
      <View style={[styles.headingRow, { gap: theme.spacing.md }]}>
        <SettingsIcon name={presentation.icon} tone={presentation.tone} />
        <View style={[styles.headingCopy, { gap: theme.spacing.xs }]}>
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
      </View>
    </Card>
  );
}

function ProfileReferenceSection({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text
        accessibilityRole="header"
        style={[
          theme.typography.label,
          styles.profileSectionLabel,
          { color: theme.colors.text.secondary },
        ]}
      >
        {title}
      </Text>
      <Card
        style={[
          styles.sectionCard,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
          },
        ]}
        variant="elevated"
      >
        {children}
      </Card>
    </View>
  );
}

function profileInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "Ö";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`
    .toLocaleUpperCase("tr-TR");
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text accessibilityRole="header" style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}>{title}</Text>
      <Card
        style={[
          styles.sectionCard,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
          },
        ]}
        variant="elevated"
      >
        {children}
      </Card>
    </View>
  );
}

function ProfileSummarySkeleton() {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Profil özeti yükleniyor"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={styles.profileIdentityBlock}
    >
      <View
        style={[
          styles.profileHero,
          {
            backgroundColor: theme.colors.action.primary,
            borderRadius: theme.radii.prominent,
            gap: theme.spacing.xs,
            padding: theme.spacing.lg,
          },
        ]}
      >
        <Skeleton decorative height={26} style={{ backgroundColor: theme.colors.action.onPrimary }} width="58%" />
        <Skeleton decorative height={16} style={{ backgroundColor: theme.colors.action.onPrimary }} width="76%" />
      </View>
      <Card
        style={[
          styles.profileIdentityCard,
          styles.profileSkeletonCard,
          {
            backgroundColor: theme.colors.background.surface,
            borderColor: theme.colors.border.subtle,
            borderRadius: theme.radii.prominent,
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
          },
        ]}
        variant="elevated"
      >
        <Skeleton decorative height={84} radius={42} style={styles.profileAvatarSkeleton} width={84} />
        <Skeleton decorative height={24} width="55%" />
        <Skeleton decorative height={16} width="72%" />
        <Skeleton decorative height={32} radius={16} width="64%" />
      </Card>
    </View>
  );
}

function LabeledValue({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.valueRow,
        {
          gap: theme.spacing.sm,
          minHeight: 40,
          paddingVertical: theme.spacing.xs,
        },
      ]}
    >
      <Text style={[theme.typography.metaStrong, styles.valueLabel, { color: theme.colors.text.secondary }]}>{label}</Text>
      <Text style={[theme.typography.bodyStrong, styles.valueText, { color: theme.colors.text.primary }]}>{value}</Text>
    </View>
  );
}

function StatusLine({
  icon,
  label,
  tone,
  onContainer = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: "success" | "warning";
  onContainer?: boolean;
}) {
  const theme = useTheme();
  const color = tone === "success" ? theme.colors.status.success : theme.colors.status.warning;
  const textColor = onContainer
    ? tone === "success"
      ? theme.colors.status.onSuccessContainer
      : theme.colors.status.onWarningContainer
    : color;
  return (
    <View accessible accessibilityLabel={label} style={[styles.statusLine, { gap: theme.spacing.xs }]}>
      <Ionicons accessibilityElementsHidden color={color} importantForAccessibility="no-hide-descendants" name={icon} size={20} />
      <Text style={[theme.typography.metaStrong, styles.flexOne, { color: textColor }]}>{label}</Text>
    </View>
  );
}

type SettingsIconTone = "primary" | "success" | "warning" | "error" | "neutral";

function SettingsIcon({
  name,
  tone = "primary",
}: {
  name: keyof typeof Ionicons.glyphMap;
  tone?: SettingsIconTone;
}) {
  const theme = useTheme();
  const palette = settingsIconPalette(theme, tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.settingsIcon,
        {
          backgroundColor: palette.background,
          borderRadius: theme.radii.control,
        },
      ]}
    >
      <Ionicons color={palette.foreground} name={name} size={21} />
    </View>
  );
}

function Chevron() {
  const theme = useTheme();
  return <Ionicons accessibilityElementsHidden color={theme.colors.text.secondary} importantForAccessibility="no-hide-descendants" name="chevron-forward" size={20} />;
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
      style={[
        styles.lifecycleCard,
        {
          backgroundColor: palette.background,
          borderColor: theme.colors.border.subtle,
          borderLeftColor: palette.accent,
          gap: theme.spacing.sm,
        },
      ]}
      variant="elevated"
    >
      <View style={[styles.statusLine, { gap: theme.spacing.xs }]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.lifecycleIcon,
            {
              backgroundColor: theme.colors.background.surface,
              borderRadius: theme.radii.control,
            },
          ]}
        >
          {busy ? <ActivityIndicator color={palette.accent} size="small" /> : <Ionicons color={palette.accent} name={error ? "alert-circle-outline" : "information-circle-outline"} size={22} />}
        </View>
        <Text accessibilityRole="header" style={[theme.typography.cardTitle, styles.flexOne, { color: palette.foreground }]}>{label}</Text>
      </View>
      <Text style={[theme.typography.body, { color: palette.foreground }]}>{detail}</Text>
    </Card>
  );
}

function NotificationPreferenceRow({
  icon,
  label,
  supportingText,
  tone,
  value,
  disabled,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  supportingText: string;
  tone: SettingsIconTone;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`${label}. ${supportingText}`}
      style={[styles.notificationPreferenceRow, { borderBottomColor: theme.colors.border.subtle, gap: theme.spacing.md }]}
    >
      <SettingsIcon name={icon} tone={tone} />
      <View style={[styles.flexOne, { gap: theme.spacing.xxs }]}>
        <Text style={[theme.typography.bodyStrong, { color: disabled ? theme.colors.text.disabled : theme.colors.text.primary }]}>{label}</Text>
        <Text style={[theme.typography.meta, { color: disabled ? theme.colors.text.disabled : theme.colors.text.secondary }]}>{supportingText}</Text>
      </View>
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

function settingsIconPalette(theme: SemanticTheme, tone: SettingsIconTone) {
  switch (tone) {
    case "success":
      return {
        background: theme.colors.status.successContainer,
        foreground: theme.colors.status.success,
      };
    case "warning":
      return {
        background: theme.colors.status.warningContainer,
        foreground: theme.colors.status.warning,
      };
    case "error":
      return {
        background: theme.colors.status.errorContainer,
        foreground: theme.colors.status.error,
      };
    case "neutral":
      return {
        background: theme.colors.background.subtle,
        foreground: theme.colors.text.secondary,
      };
    case "primary":
    default:
      return {
        background: theme.colors.action.secondary,
        foreground: theme.colors.action.primary,
      };
  }
}

function screenHeadingPresentation(title: string): {
  icon: keyof typeof Ionicons.glyphMap;
  tone: SettingsIconTone;
} {
  if (title === "Akademik profili düzenle") {
    return { icon: "school-outline", tone: "primary" };
  }
  if (title === "Bildirim tercihleri") {
    return { icon: "notifications-outline", tone: "warning" };
  }
  if (title === "Google Takvim") {
    return { icon: "logo-google", tone: "success" };
  }
  if (title === "Apple Takvim") {
    return { icon: "logo-apple", tone: "primary" };
  }
  if (title === "Veri ve hesap silme") {
    return { icon: "shield-outline", tone: "error" };
  }
  return { icon: "settings-outline", tone: "neutral" };
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

function appleCalendarConfirmationCopy(confirmation: AppleCalendarConfirmation | null, managedEventCount?: number) {
  if (confirmation === "remove") {
    return {
      title: "Yönetilen kayıtlar kaldırılsın mı?",
      description: `${typeof managedEventCount === "number" ? `${managedEventCount} yönetilen kayıt hedeflenecek. ` : ""}Yalnızca bu uygulamanın doğrulanmış yönetim işaretini taşıyan akademik kayıtlar Apple Takvim'den kaldırılır. Kişisel etkinliklerin korunur.`,
      actionLabel: "Yönetilen kayıtları kaldır",
    };
  }
  return {
    title: "Apple Takvim bağlantısı kesilsin mi?",
    description: "Bağlantı bilgisi bu cihazdan kaldırılır; daha önce oluşturulan uygulama yönetimli kayıtlar Apple Takvim'de kalır. Kişisel etkinliklerin değiştirilmez.",
    actionLabel: "Bağlantıyı kes",
  };
}

function accountConfirmationCopy(confirmation: AccountConfirmation | null, email: string) {
  if (confirmation === "account") {
    return {
      title: "Hesap kalıcı olarak silinsin mi?",
      description: `${email.trim() || "Bu hesap"} için sunucu hesabı ve uygulama verileri kalıcı olarak silinir; bu hesapla yeniden giriş yapılamaz. Yalnızca uygulamanın yönettiği Google ve Apple Takvim kayıtlarının kaldırılması ile Google erişiminin iptali denenir. Kişisel etkinliklerin korunur.`,
      warning: "Hesap silme geri alınamaz. Tamamlanamayan takvim veya cihaz temizliği güvenli hedef adıyla bildirilir; kişisel etkinlik silinmez. Devam etmeden önce yalnızca hesap silme amacı için geçerli, tek kullanımlık yakın zamanda kimlik doğrulaması istenir.",
      actionLabel: "Hesabı silmeye devam et",
    };
  }
  return {
    title: "Uygulama verileri silinsin mi?",
    description: "Hesabın ve giriş bilgilerin açık kalır; uygulamadaki kişisel takvim, tercih ve kişiselleştirme verilerin silinir. Yalnızca uygulamanın yönettiği Google ve Apple Takvim kayıtlarının kaldırılması ile Google erişiminin iptali denenir. Kişisel etkinliklerin korunur.",
    warning: "Veri silme geri alınamaz. Tamamlanamayan takvim veya cihaz temizliği güvenli hedef adıyla bildirilir; hesabın ve kişisel etkinliklerin kalır. Devam etmeden önce yalnızca veri silme amacı için geçerli, tek kullanımlık yakın zamanda kimlik doğrulaması istenir.",
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
  profileTopBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
  },
  profileOverviewTitle: {
    flex: 1,
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 47,
    minWidth: 0,
    textAlign: "left",
  },
  profileOverviewIdentityCard: {
    minWidth: 0,
    overflow: "hidden",
  },
  profileOverviewItem: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minWidth: 0,
  },
  profileOverviewItemReflowed: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  profileOverviewItemControls: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    width: "100%",
  },
  profileOverviewItemLast: {
    borderBottomWidth: 0,
  },
  profileOverviewItemStacked: {
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  profileOverviewItemCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileOverviewItemCopyReflowed: {
    flex: 0,
    width: "100%",
  },
  profileOverviewItemTextReflowed: {
    alignSelf: "stretch",
    width: "100%",
  },
  profileOverviewTrailingStacked: {
    alignItems: "flex-end",
    paddingLeft: 52,
    width: "100%",
  },
  profileOverviewTrailingReflowed: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 0,
    width: "100%",
  },
  profileBellButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "relative",
    width: 48,
  },
  profileBellDot: {
    borderWidth: 2,
    borderRadius: 999,
    height: 10,
    position: "absolute",
    right: 8,
    top: 7,
    width: 10,
  },
  profileReferenceHero: {
    minHeight: 132,
    overflow: "hidden",
    position: "relative",
  },
  profileHeroMain: {
    alignItems: "center",
    flexDirection: "row",
    zIndex: 1,
  },
  profileHeroMainStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  profileAvatarFrame: {
    height: 80,
    position: "relative",
    width: 80,
  },
  profilePortrait: {
    borderWidth: 1,
    height: 80,
    width: 80,
  },
  profileInitials: {
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitialsText: {
    fontSize: 31,
    fontWeight: "700",
    lineHeight: 38,
  },
  profileHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileIdentityLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 3,
    minWidth: 0,
  },
  profileIdentityDivider: {
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
  profileProgressHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  profileProgressHeaderStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  profileProgressCopy: {
    flexShrink: 1,
    minWidth: 0,
  },
  profileProgressBadge: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    flexShrink: 1,
    gap: 7,
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  profileProgressBadgeText: {
    flexShrink: 1,
    minWidth: 0,
  },
  profileProgressTrack: {
    borderRadius: 999,
    height: 10,
    overflow: "hidden",
    width: "100%",
  },
  profileProgressFill: {
    borderRadius: 999,
    height: "100%",
  },
  notificationAttentionCard: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minWidth: 0,
  },
  notificationAttentionCardStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  notificationAttentionIcon: {
    alignItems: "center",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  notificationAttentionAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
  },
  profileStudentBadge: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileSectionLabel: {
    letterSpacing: 0,
    paddingHorizontal: 4,
  },
  profileTrailingStatus: {
    alignItems: "center",
    flexDirection: "row",
    maxWidth: "100%",
    minWidth: 0,
  },
  profileTrailingStatusText: {
    flexShrink: 1,
    minWidth: 0,
  },
  profileSecurityBanner: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  profileVersion: {
    paddingVertical: 4,
    textAlign: "center",
  },
  notificationTopBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
  },
  notificationTopSpacer: {
    width: 48,
  },
  notificationHero: {
    gap: 16,
  },
  notificationHeroSideBySide: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 160,
  },
  notificationHeroStacked: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  notificationHeroCopy: {
    paddingHorizontal: 4,
  },
  notificationHeroCopySideBySide: {
    flex: 1,
    maxWidth: "58%",
  },
  notificationHeroCopyStacked: {
    maxWidth: "100%",
    paddingRight: 8,
    width: "100%",
  },
  notificationHeroPreview: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  notificationHeroPreviewSideBySide: {
    flex: 1,
    maxWidth: "42%",
    minWidth: 150,
  },
  notificationHeroPreviewStacked: {
    width: "100%",
  },
  notificationPreviewHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    minHeight: 40,
  },
  notificationPreviewIcon: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  notificationPreviewRow: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 34,
    paddingVertical: 6,
  },
  notificationPermissionCard: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 76,
  },
  notificationPreferenceRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 96,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  notificationInfoCallout: {
    alignItems: "flex-start",
    flexDirection: "row",
    margin: 12,
    padding: 12,
  },
  profileHero: {
    minHeight: 126,
    overflow: "hidden",
    position: "relative",
  },
  profileHeroOrb: {
    borderWidth: 18,
    height: 118,
    opacity: 0.14,
    position: "absolute",
    right: -24,
    top: -32,
    width: 118,
  },
  profileHeroOrbSmall: {
    borderWidth: 10,
    bottom: -32,
    height: 78,
    left: 22,
    opacity: 0.11,
    position: "absolute",
    width: 78,
  },
  profileHeroDescription: {
    maxWidth: 230,
    opacity: 0.9,
  },
  profileIdentityBlock: {
    width: "100%",
  },
  profileIdentityCard: {
    alignItems: "center",
    marginHorizontal: 12,
    marginTop: -28,
    overflow: "visible",
    paddingTop: 20,
  },
  profileAvatar: {
    alignItems: "center",
    borderWidth: 4,
    height: 84,
    justifyContent: "center",
    marginTop: -62,
    width: 84,
  },
  profileIdentityText: {
    maxWidth: "100%",
    textAlign: "center",
  },
  profileSkeletonCard: {
    minHeight: 160,
  },
  profileAvatarSkeleton: {
    marginTop: -62,
  },
  profileStatusBadge: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  profileStatusText: {
    flexShrink: 1,
  },
  academicFacts: {
    minWidth: 0,
  },
  academicFactsHeading: {
    alignItems: "center",
    flexDirection: "row",
  },
  academicFactsList: {
    paddingTop: 8,
  },
  sectionCard: {
    overflow: "hidden",
    padding: 0,
  },
  profileGroupLabel: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 36,
  },
  profileMenuRow: {
    minHeight: 48,
  },
  headingCard: {
    overflow: "hidden",
  },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  academicProfileIntro: {
    paddingHorizontal: 4,
  },
  summaryCard: {
  },
  summaryHeading: {
    alignItems: "center",
    flexDirection: "row",
  },
  protectionCard: {
    borderWidth: 1,
  },
  dangerCard: {
    borderWidth: 1,
  },
  dangerHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  valueRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
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
  settingsIcon: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  lifecycleCard: {
    borderLeftWidth: 3,
  },
  lifecycleIcon: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
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
