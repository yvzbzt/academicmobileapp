import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  Skeleton,
  referencePalette,
  usePlatformAdaptation,
  useTheme,
} from "../design-system";
import {
  admitTrustedContentRecord,
  canonicalizeOfficialAcademicUrl,
  contentTimestampLabel,
  normalizeDisplayText,
  type TrustedMobileContentRecord,
} from "../content/content-trust";
import {
  resolveContentFeedLayout,
  type ContentFeedItem,
  type FeedContentTypeFilter,
} from "./feed-model";

const CONTENT_TYPE_LABELS: Record<Exclude<FeedContentTypeFilter, "all">, string> = {
  announcement: "Duyuru",
  news: "Haber",
  event: "Etkinlik",
};

const SCOPE_LABELS: Record<TrustedMobileContentRecord["scopeType"], string> = {
  university: "Üniversite",
  faculty: "Fakülte",
  department: "Bölüm",
};

const REFERENCE_COLORS = {
  background: referencePalette.white,
  blue: referencePalette.academicBlue,
  blueSoft: referencePalette.academicBlueTint,
  border: referencePalette.academicBorder,
  green: referencePalette.academicGreen,
  greenSoft: referencePalette.academicGreenTint,
  navy: referencePalette.navy,
  secondary: referencePalette.academicTextSecondary,
} as const;

export type AnnouncementShareResult = "shared" | "dismissed";

export interface AnnouncementDetailProps {
  item: ContentFeedItem | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenOfficialSource: (url: string) => boolean | Promise<boolean>;
  onOpenNotificationSettings: () => void;
  onToggleSaved: () => void | Promise<void>;
  onShareResult?: (result: AnnouncementShareResult) => void;
  saved?: boolean;
  saveError?: string;
  saveLoading?: boolean;
}

export function AnnouncementDetail({
  item,
  loading = false,
  error,
  onRetry,
  onBack,
  onOpenOfficialSource,
  onOpenNotificationSettings,
  onToggleSaved,
  onShareResult,
  saved = false,
  saveError,
  saveLoading = false,
}: AnnouncementDetailProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = resolveContentFeedLayout(width, fontScale);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [openingOfficialSource, setOpeningOfficialSource] = useState(false);
  const [togglingSaved, setTogglingSaved] = useState(false);
  const detail = useMemo(() => normalizeDetail(item), [item]);

  useEffect(() => {
    setActionFailure(null);
    setSharing(false);
    setOpeningOfficialSource(false);
    setTogglingSaved(false);
  }, [item?.key]);

  if (loading) {
    return (
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            gap: theme.spacing.md,
            maxWidth: layout.maxWidth,
            padding: layout.gutter,
          },
        ]}
        style={{ backgroundColor: REFERENCE_COLORS.background }}
        testID={`announcement-detail-${adaptation.platform}-loading`}
      >
        <View
          accessible
          accessibilityLabel="Duyuru ayrıntısı yükleniyor"
          accessibilityRole="progressbar"
          accessibilityState={{ busy: true }}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ gap: theme.spacing.sm }}
          >
            <Skeleton decorative height={24} width="42%" />
            <Skeleton decorative height={44} />
            <Skeleton decorative height={20} width="68%" />
            <Skeleton decorative height={160} />
          </View>
        </View>
      </ScrollView>
    );
  }

  if (!detail) {
    return (
      <View
        style={[
          styles.stateContainer,
          {
            backgroundColor: REFERENCE_COLORS.background,
            padding: layout.gutter,
          },
        ]}
        testID={`announcement-detail-${adaptation.platform}-error`}
      >
        <ErrorState
          title="İçerik açılamadı"
          description={error
            ? "Bu güvenilir içerik şu anda gösterilemiyor."
            : "İçerik doğrulanamadığı için güvenli biçimde gösterilemiyor."}
          actionLabel={onRetry ? "Tekrar dene" : undefined}
          onAction={onRetry}
        />
      </View>
    );
  }

  const handleShare = async () => {
    setActionFailure(null);
    setSharing(true);
    try {
      const result = await Share.share({
        title: detail.title,
        message: `${detail.title}\n${detail.officialUrl}`,
        url: detail.officialUrl,
      });
      onShareResult?.(
        result.action === Share.dismissedAction ? "dismissed" : "shared",
      );
    } catch {
      setActionFailure("Paylaşım başlatılamadı. Lütfen tekrar dene.");
    } finally {
      setSharing(false);
    }
  };

  const handleOpenOfficialSource = async () => {
    setActionFailure(null);
    setOpeningOfficialSource(true);
    try {
      const handled = await onOpenOfficialSource(detail.officialUrl);
      if (!handled) {
        setActionFailure("Resmî kaynak açılamadı. Lütfen tekrar dene.");
      }
    } catch {
      setActionFailure("Resmî kaynak açılamadı. Lütfen tekrar dene.");
    } finally {
      setOpeningOfficialSource(false);
    }
  };

  const handleToggleSaved = async () => {
    setActionFailure(null);
    setTogglingSaved(true);
    try {
      await onToggleSaved();
    } catch {
      setActionFailure("Duyuru kaydetme işlemi tamamlanamadı. Lütfen tekrar dene.");
    } finally {
      setTogglingSaved(false);
    }
  };

  return (
    <View
      style={styles.detailScreen}
      testID={`announcement-detail-${adaptation.platform}-${layout.supportsLargeText ? "large-text" : "standard-text"}`}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            gap: theme.spacing.md,
            maxWidth: layout.maxWidth,
            paddingBottom: theme.spacing.xl,
            paddingHorizontal: layout.gutter,
            paddingTop: theme.spacing.md,
          },
        ]}
        showsVerticalScrollIndicator={false}
        style={styles.detailScroll}
      >
        {onBack ? (
          <View style={styles.previewHeader}>
            <Button
              accessibilityLabel="Duyurulara geri dön"
              compact
              label="Geri"
              onPress={onBack}
              style={styles.backButton}
              variant="ghost"
            />
            <Text
              style={[theme.typography.cardTitle, styles.previewHeaderTitle, { color: REFERENCE_COLORS.navy }]}
            >
              Duyuru Detayı
            </Text>
            <View style={styles.previewHeaderSpacer} />
          </View>
        ) : null}

        <View style={styles.sourcePill} testID="announcement-detail-source-pill">
          <View style={styles.sourceSeal}>
            <Text
              style={[theme.typography.label, { color: REFERENCE_COLORS.blue }]}
            >
              {sourceInitial(detail.sourceName)}
            </Text>
          </View>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={[theme.typography.metaStrong, styles.sourcePillName, { color: REFERENCE_COLORS.navy }]}
          >
            {detail.sourceName}
          </Text>
          <Text style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}>·</Text>
          <Text
            style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.secondary }]}
          >
            {detail.typeAndScopeLabel}
          </Text>
          <Ionicons color={REFERENCE_COLORS.blue} name="checkmark-circle" size={17} />
        </View>

        <Card
          style={styles.articleCard}
          testID="announcement-detail-article-card"
          variant="elevated"
        >
          <Text
            accessibilityRole="header"
            style={[theme.typography.screenTitle, styles.articleTitle, { color: REFERENCE_COLORS.navy }]}
          >
            {detail.title}
          </Text>

          <View style={styles.articleDateRow}>
            <Ionicons color={REFERENCE_COLORS.blue} name="calendar-outline" size={20} />
            <View style={styles.articleDates}>
              {detail.publishedLabel ? (
                <MetadataRow label="Yayın" value={detail.publishedLabel} />
              ) : null}
              {detail.updatedLabel ? (
                <MetadataRow label="Güncelleme" value={detail.updatedLabel} />
              ) : null}
              {!detail.publishedLabel && !detail.updatedLabel ? (
                <MetadataRow label="Tarih" value="Yayın tarihi belirtilmemiş" />
              ) : null}
            </View>
          </View>

          <View style={styles.infoCallout}>
            <View style={styles.infoIcon}>
              <Ionicons color={REFERENCE_COLORS.blue} name="information-circle" size={25} />
            </View>
            <Text
              style={[theme.typography.metaStrong, styles.infoCopy, { color: referencePalette.academicTextInfo }]}
            >
              {detail.summary || "Bu duyuru doğrulanmış resmî kaynaktan alınmıştır. Ayrıntılar için resmî bağlantıyı kullanabilirsin."}
            </Text>
          </View>

          {detail.body.length ? (
            <View style={styles.articleBodyBlocks} testID="announcement-detail-rich-body">
              {detail.body.map((block, index) => (
                <View key={`${block.type}:${index}:${block.text.slice(0, 24)}`}>
                  {block.type === "bullet" ? (
                    <View style={styles.articleBulletRow}>
                      <Text style={[theme.typography.body, { color: REFERENCE_COLORS.blue }]}>•</Text>
                      <Text style={[theme.typography.body, styles.articleBody, styles.articleBulletText, { color: referencePalette.academicTextBody }]}>{block.text}</Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        block.type === "heading" ? theme.typography.bodyStrong : theme.typography.body,
                        styles.articleBody,
                        { color: block.type === "heading" ? REFERENCE_COLORS.navy : referencePalette.academicTextBody },
                      ]}
                    >
                      {block.text}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ) : !detail.summary ? (
            <Text style={[theme.typography.body, styles.articleBody, { color: referencePalette.academicTextBody }]}>Bu içerik için güvenli bir özet sağlanmadı.</Text>
          ) : null}

          {detail.keyDates.length ? (
            <View style={styles.keyDateList} testID="announcement-detail-key-dates">
              {detail.keyDates.map((keyDate) => (
                <View
                  accessible
                  accessibilityLabel={`${keyDate.label}: ${formatKeyDateRange(keyDate.startDate, keyDate.endDate)}`}
                  key={`${keyDate.label}:${keyDate.startDate}:${keyDate.endDate ?? ""}`}
                  style={styles.keyDateRow}
                >
                  <Ionicons color={REFERENCE_COLORS.blue} name="calendar-outline" size={21} />
                  <View style={styles.keyDateCopy}>
                    <Text style={[theme.typography.bodyStrong, { color: REFERENCE_COLORS.navy }]}>{keyDate.label}</Text>
                    <Text style={[theme.typography.body, { color: referencePalette.academicTextDate }]}>{formatKeyDateRange(keyDate.startDate, keyDate.endDate)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.officialSourceCard}>
            <View style={styles.officialSourceIcon}>
              <Ionicons color={REFERENCE_COLORS.green} name="shield-checkmark" size={25} />
            </View>
            <View style={styles.officialSourceCopy}>
              <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.navy }]}>Resmî kaynak</Text>
              <Text
                numberOfLines={2}
                style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
              >
                {detail.sourceName} · {detail.domain}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`Resmî bağlantıyı aç: ${detail.domain}`}
              accessibilityRole="button"
              accessibilityState={{ busy: openingOfficialSource, disabled: openingOfficialSource }}
              disabled={openingOfficialSource}
              onPress={() => void handleOpenOfficialSource()}
              style={({ pressed }) => [styles.officialSourceAction, pressed && styles.pressedAction]}
            >
              {openingOfficialSource ? (
                <ActivityIndicator color={REFERENCE_COLORS.green} size="small" />
              ) : (
                <>
                  <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.green }]}>Resmî bağlantıyı aç</Text>
                  <Ionicons color={REFERENCE_COLORS.green} name="open-outline" size={17} />
                </>
              )}
            </Pressable>
          </View>
        </Card>

        <Pressable
          accessibilityLabel="Bildirim tercihlerini yönet"
          accessibilityRole="button"
          onPress={onOpenNotificationSettings}
          style={({ pressed }) => [styles.notificationCallout, pressed && styles.pressedAction]}
        >
          <View style={styles.notificationIcon}>
            <Ionicons color={referencePalette.white} name="notifications" size={22} />
          </View>
          <View style={styles.notificationCopy}>
            <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.navy }]}>Bildirim tercihlerini yönet</Text>
            <Text style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}>Bu tür duyurulardan haberdar olmak için tercihlerini düzenleyebilirsin.</Text>
          </View>
          <Ionicons color={REFERENCE_COLORS.blue} name="chevron-forward" size={21} />
        </Pressable>

        {actionFailure || saveError ? (
          <Banner
            dismissAccessibilityLabel={actionFailure ? "İşlem uyarısını kapat" : undefined}
            message={actionFailure ?? saveError ?? "Duyuru kaydedilemedi."}
            onDismiss={actionFailure ? () => setActionFailure(null) : undefined}
            title="İşlem tamamlanamadı"
            tone="error"
          />
        ) : null}
      </ScrollView>

      <View
        style={[styles.stickyActions, { paddingBottom: Math.max(12, insets.bottom) }]}
        testID="announcement-detail-sticky-actions"
      >
        <Button
          fullWidth
          label="Paylaş"
          leadingIcon={<Ionicons color={REFERENCE_COLORS.blue} name="share-outline" size={21} />}
          loading={sharing}
          onPress={() => void handleShare()}
          style={styles.stickyAction}
          variant="secondary"
        />
        <Button
          fullWidth
          label={saved ? "Kaydedildi" : "Kaydet"}
          leadingIcon={<Ionicons color={REFERENCE_COLORS.blue} name={saved ? "bookmark" : "bookmark-outline"} size={21} />}
          loading={saveLoading || togglingSaved}
          onPress={() => void handleToggleSaved()}
          style={styles.stickyAction}
          variant="secondary"
        />
      </View>
    </View>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.metadataRow}>
      <Text style={[theme.typography.metaStrong, { color: theme.colors.text.secondary }]}>
        {label}
      </Text>
      <Text
        style={[
          theme.typography.body,
          styles.metadataValue,
          { color: theme.colors.text.primary },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

interface NormalizedDetail {
  title: string;
  sourceName: string;
  summary: string;
  body: NonNullable<TrustedMobileContentRecord["body"]>;
  keyDates: NonNullable<TrustedMobileContentRecord["keyDates"]>;
  typeAndScopeLabel: string;
  publishedLabel: string | null;
  updatedLabel: string | null;
  officialUrl: string;
  domain: string;
}

function normalizeDetail(item: ContentFeedItem | null): NormalizedDetail | null {
  if (!item) return null;
  const record = admitTrustedContentRecord(item.record);
  if (!record) return null;
  const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim() : "";
  const sourceName = normalizeDetailText(record.sourceName);
  const title = normalizeDetailText(record.title);
  const summary = normalizeDetailText(record.summary);
  const body = (record.body ?? []).filter((block) => normalizeDetailText(block.text) !== summary);
  const keyDates = record.keyDates ?? [];
  const officialUrl = canonicalizeOfficialAcademicUrl(record.canonicalUrl)
    ?? canonicalizeOfficialAcademicUrl(record.link);
  const officialSourceUrl = canonicalizeOfficialAcademicUrl(record.officialSourceUrl);
  if (
    !sourceId
    || !sourceName
    || !title
    || !officialUrl
    || !officialSourceUrl
    || officialAuthority(officialUrl) !== officialAuthority(officialSourceUrl)
  ) return null;

  const domain = new URL(officialUrl).hostname.replace(/^www\./u, "");
  const publishedLabel = timestampLabel(record, "published");
  const updatedLabel = timestampLabel(record, "updated");
  const familyLabels = [
    item.sourceFamilies.includes("yok") ? "YÖK" : null,
    item.sourceFamilies.includes("summer-school") ? "Yaz Okulu" : null,
  ].filter((value): value is string => Boolean(value));
  const typeAndScopeLabel = [
    CONTENT_TYPE_LABELS[item.contentType],
    ...familyLabels,
    SCOPE_LABELS[record.scopeType],
  ].join(" · ");

  return {
    title,
    sourceName,
    summary,
    body,
    keyDates,
    typeAndScopeLabel,
    publishedLabel,
    updatedLabel,
    officialUrl,
    domain,
  };
}

function formatKeyDateRange(startDate: string, endDate?: string): string {
  const start = formatKeyDate(startDate);
  const end = endDate ? formatKeyDate(endDate) : null;
  return end ? `${start} – ${end}` : start;
}

function formatKeyDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}

function timestampLabel(
  record: TrustedMobileContentRecord,
  kind: "published" | "updated",
): string | null {
  const label = kind === "published"
    ? contentTimestampLabel({
      publicationKind: record.publicationKind,
      publishedDate: record.publishedDate,
      publishedAt: record.publishedAt
    })
    : contentTimestampLabel({ sourceUpdatedAt: record.sourceUpdatedAt });
  return label === "Yayın tarihi belirtilmemiş" ? null : label;
}

function sourceInitial(sourceName: string): string {
  return Array.from(sourceName.trim())[0]?.toLocaleUpperCase("tr-TR") ?? "R";
}

function normalizeDetailText(value: string | undefined): string {
  return normalizeDisplayText(value).replace(/\s+([,.;:!?])/gu, "$1");
}

function officialAuthority(value: string): string {
  const labels = new URL(value).hostname.replace(/^www\./u, "").split(".");
  return labels.slice(-3).join(".");
}

const styles = StyleSheet.create({
  articleBody: {
    lineHeight: 25,
  },
  articleBodyBlocks: {
    gap: 14,
  },
  articleBulletRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 9,
  },
  articleBulletText: {
    flex: 1,
    minWidth: 0,
  },
  articleCard: {
    borderColor: REFERENCE_COLORS.border,
    borderRadius: 18,
    gap: 18,
    marginHorizontal: 1,
    padding: 18,
  },
  articleDateRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  articleDates: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  articleTitle: {
    fontSize: 25,
    lineHeight: 32,
  },
  backButton: {
    alignSelf: "flex-start",
  },
  content: {
    alignSelf: "center",
    width: "100%",
  },
  detailScreen: {
    backgroundColor: REFERENCE_COLORS.background,
    flex: 1,
  },
  detailScroll: {
    backgroundColor: REFERENCE_COLORS.background,
    flex: 1,
  },
  infoCallout: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueSurface,
    borderColor: referencePalette.academicBlueBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 13,
  },
  infoCopy: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  infoIcon: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueSurfaceStrong,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  keyDateCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  keyDateList: {
    gap: 14,
  },
  keyDateRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  metadataRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minWidth: 0,
  },
  metadataValue: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  officialSourceCard: {
    alignItems: "center",
    backgroundColor: referencePalette.academicGreenSurface,
    borderColor: referencePalette.academicGreenBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 12,
  },
  officialSourceCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  officialSourceIcon: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.greenSoft,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  officialSourceAction: {
    alignItems: "center",
    borderColor: referencePalette.academicGreenBorderStrong,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginLeft: "auto",
    maxWidth: "100%",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
  },
  previewHeaderSpacer: {
    height: 44,
    width: 64,
  },
  previewHeaderTitle: {
    flex: 1,
    textAlign: "center",
  },
  notificationCallout: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueTint,
    borderColor: referencePalette.academicBlueBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    padding: 14,
  },
  notificationCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  notificationIcon: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blue,
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  pressedAction: {
    opacity: 0.78,
  },
  sourcePill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: referencePalette.academicBlueSurface,
    borderColor: referencePalette.academicBlueBorderMuted,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    maxWidth: "100%",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  sourcePillName: {
    flexShrink: 1,
    minWidth: 0,
  },
  sourceSeal: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderColor: referencePalette.academicBlueBorderStrong,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  stateContainer: {
    backgroundColor: REFERENCE_COLORS.background,
    flex: 1,
    justifyContent: "center",
  },
  stickyAction: {
    flex: 1,
    minWidth: 0,
  },
  stickyActions: {
    backgroundColor: REFERENCE_COLORS.background,
    borderTopColor: REFERENCE_COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
});
