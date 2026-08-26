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

  const deadline = detail.keyDates.find((keyDate) => Boolean(keyDate.endDate));

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
            <Pressable
              accessibilityLabel="Duyurulara geri dön"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressedAction]}
            >
              <Ionicons color={REFERENCE_COLORS.blue} name="arrow-back" size={30} />
            </Pressable>
            <Text
              accessibilityRole="header"
              style={[theme.typography.screenTitle, styles.previewHeaderTitle, { color: REFERENCE_COLORS.navy }]}
            >
              Duyuru Detayı
            </Text>
          </View>
        ) : null}

        <View
          style={[styles.sourcePill, layout.supportsLargeText && styles.sourcePillLargeText]}
          testID="announcement-detail-source-pill"
        >
          <View style={styles.sourceSeal}>
            <Ionicons color={REFERENCE_COLORS.blue} name="business" size={25} />
          </View>
          <View style={[styles.sourcePillCopy, layout.supportsLargeText && styles.sourcePillCopyLargeText]}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.35}
              numberOfLines={layout.supportsLargeText ? undefined : 2}
              style={[theme.typography.bodyStrong, styles.sourcePillName, { color: REFERENCE_COLORS.navy }]}
            >
              {detail.sourceName}
            </Text>
            <View style={styles.sourceMetaRow}>
              <Text
                maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.35}
                style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.secondary }]}
              >
                {detail.typeAndScopeLabel}
              </Text>
              <Text
                maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.35}
                style={[theme.typography.meta, { color: REFERENCE_COLORS.secondary }]}
              >
                · doğrulanmış resmî kaynak
              </Text>
            </View>
          </View>
          <View style={[styles.sourceStatus, layout.supportsLargeText && styles.sourceStatusLargeText]}>
            <Ionicons color={REFERENCE_COLORS.green} name="checkmark-circle" size={19} />
          </View>
        </View>

        <Card
          style={styles.articleCard}
          testID="announcement-detail-article-card"
          variant="elevated"
        >
          <View style={[styles.articleHeadingRow, layout.supportsLargeText && styles.articleHeadingRowStacked]}>
            <View style={styles.articleHeadingIcon}>
              <Ionicons color={REFERENCE_COLORS.blue} name="megaphone" size={31} />
            </View>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.45}
              style={[
                theme.typography.screenTitle,
                styles.articleTitle,
                layout.supportsLargeText && styles.articleTitleStacked,
                { color: REFERENCE_COLORS.navy },
              ]}
            >
              {detail.title}
            </Text>
          </View>

          <View style={styles.articleDateRow}>
            <View style={styles.articleDates}>
              <View style={styles.dateLine}>
                <Ionicons color={REFERENCE_COLORS.blue} name="calendar-outline" size={20} />
                <Text
                  maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.35}
                  style={[theme.typography.body, styles.dateText, { color: REFERENCE_COLORS.secondary }]}
                >
                  {detail.publishedLabel ?? "Yayın tarihi belirtilmemiş"}
                </Text>
              </View>
              {detail.updatedLabel ? (
                <View style={styles.dateLine}>
                  <Ionicons color={REFERENCE_COLORS.blue} name="time-outline" size={20} />
                  <Text
                    maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.35}
                    style={[theme.typography.body, styles.dateText, { color: REFERENCE_COLORS.secondary }]}
                  >
                    {detail.updatedLabel}
                  </Text>
                </View>
              ) : null}
            </View>
            {deadline?.endDate ? (
              <View style={styles.deadlineChip}>
                <Ionicons color={REFERENCE_COLORS.green} name="calendar" size={17} />
                <Text
                  maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.25}
                  style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.green }]}
                >
                  Son gün: {formatKeyDate(deadline.endDate)}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.articleDivider} />

          {detail.summary ? (
            <Text
              maxFontSizeMultiplier={layout.supportsLargeText ? undefined : 1.5}
              style={[theme.typography.body, styles.articleSummary, { color: referencePalette.academicTextBody }]}
            >
              {detail.summary}
            </Text>
          ) : null}

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
                numberOfLines={layout.supportsLargeText ? undefined : 2}
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
                  <Text style={[theme.typography.metaStrong, { color: REFERENCE_COLORS.green }]}>Kaynağa git</Text>
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
        style={[
          styles.stickyActions,
          layout.supportsLargeText && styles.stickyActionsStacked,
        ]}
        testID="announcement-detail-sticky-actions"
      >
        <Button
          fullWidth
          label="Paylaş"
          leadingIcon={<Ionicons color={REFERENCE_COLORS.blue} name="share-outline" size={21} />}
          loading={sharing}
          onPress={() => void handleShare()}
          style={[styles.stickyAction, layout.supportsLargeText && styles.stickyActionStacked]}
          variant="secondary"
        />
        <Button
          fullWidth
          label={saved ? "Kaydedildi" : "Kaydet"}
          leadingIcon={<Ionicons color={REFERENCE_COLORS.blue} name={saved ? "bookmark" : "bookmark-outline"} size={21} />}
          loading={saveLoading || togglingSaved}
          onPress={() => void handleToggleSaved()}
          style={[styles.stickyAction, layout.supportsLargeText && styles.stickyActionStacked]}
          variant="secondary"
        />
      </View>
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

function normalizeDetailText(value: string | undefined): string {
  return normalizeDisplayText(value).replace(/\s+([,.;:!?])/gu, "$1");
}

function officialAuthority(value: string): string {
  const labels = new URL(value).hostname.replace(/^www\./u, "").split(".");
  return labels.slice(-3).join(".");
}

const styles = StyleSheet.create({
  articleBody: {
    lineHeight: 26,
  },
  articleBodyBlocks: {
    gap: 16,
  },
  articleBulletRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  articleBulletText: {
    flex: 1,
    minWidth: 0,
  },
  articleCard: {
    borderColor: REFERENCE_COLORS.border,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    gap: 20,
    marginHorizontal: 1,
    padding: 20,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 7, width: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 18,
  },
  articleDateRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  articleDates: {
    flex: 1,
    gap: 8,
    minWidth: 190,
  },
  articleDivider: {
    backgroundColor: REFERENCE_COLORS.border,
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
  articleHeadingIcon: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderRadius: 29,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  articleHeadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    minWidth: 0,
  },
  articleHeadingRowStacked: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  articleSummary: {
    fontSize: 16,
    lineHeight: 26,
  },
  articleTitle: {
    flex: 1,
    fontSize: 25,
    lineHeight: 32,
    minWidth: 0,
  },
  articleTitleStacked: {
    flex: 0,
    width: "100%",
  },
  backButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  content: {
    alignSelf: "center",
    width: "100%",
  },
  dateLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  dateText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  deadlineChip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: REFERENCE_COLORS.greenSoft,
    borderColor: referencePalette.academicGreenBorder,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  detailScreen: {
    backgroundColor: REFERENCE_COLORS.background,
    flex: 1,
  },
  detailScroll: {
    backgroundColor: REFERENCE_COLORS.background,
    flex: 1,
  },
  keyDateCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  keyDateList: {
    gap: 10,
  },
  keyDateRow: {
    alignItems: "flex-start",
    backgroundColor: referencePalette.academicBlueSurface,
    borderColor: referencePalette.academicBlueBorderMuted,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  officialSourceCard: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.background,
    borderColor: referencePalette.academicGreenBorder,
    borderRadius: 16,
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
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginLeft: "auto",
    maxWidth: "100%",
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    minHeight: 58,
  },
  previewHeaderTitle: {
    flex: 1,
    fontSize: 28,
    lineHeight: 34,
    textAlign: "left",
  },
  notificationCallout: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.background,
    borderColor: referencePalette.academicBlueBorder,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 2,
    flexDirection: "row",
    gap: 11,
    padding: 14,
    shadowColor: REFERENCE_COLORS.navy,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 11,
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
  sourceMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  sourcePill: {
    alignItems: "center",
    backgroundColor: referencePalette.academicBlueSurface,
    borderColor: referencePalette.academicBlueBorderMuted,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    maxWidth: "100%",
    minHeight: 82,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "100%",
  },
  sourcePillLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  sourcePillCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  sourcePillCopyLargeText: {
    flex: 0,
    width: "100%",
  },
  sourcePillName: {
    minWidth: 0,
  },
  sourceSeal: {
    alignItems: "center",
    backgroundColor: REFERENCE_COLORS.blueSoft,
    borderColor: referencePalette.academicBlueBorderStrong,
    borderRadius: 25,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  sourceStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  sourceStatusLargeText: {
    alignSelf: "flex-end",
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
  stickyActionStacked: {
    flex: 0,
    width: "100%",
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
  stickyActionsStacked: {
    flexDirection: "column",
  },
});
