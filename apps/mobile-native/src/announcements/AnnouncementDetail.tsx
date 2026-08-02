import { useEffect, useMemo, useState } from "react";
import {
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
  usePlatformAdaptation,
  useTheme,
} from "../design-system";
import {
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

export type AnnouncementShareResult = "shared" | "dismissed";

export interface AnnouncementDetailProps {
  item: ContentFeedItem | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenOfficialSource: (url: string) => boolean | Promise<boolean>;
  onShareResult?: (result: AnnouncementShareResult) => void;
}

export function AnnouncementDetail({
  item,
  loading = false,
  error,
  onRetry,
  onBack,
  onOpenOfficialSource,
  onShareResult,
}: AnnouncementDetailProps) {
  const theme = useTheme();
  const adaptation = usePlatformAdaptation();
  const { fontScale, width } = useWindowDimensions();
  const layout = resolveContentFeedLayout(width, fontScale);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [openingOfficialSource, setOpeningOfficialSource] = useState(false);
  const detail = useMemo(() => normalizeDetail(item), [item]);

  useEffect(() => {
    setActionFailure(null);
    setSharing(false);
    setOpeningOfficialSource(false);
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
        style={{ backgroundColor: theme.colors.background.canvas }}
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
            backgroundColor: theme.colors.background.canvas,
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

  return (
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
      style={{ backgroundColor: theme.colors.background.canvas }}
      testID={`announcement-detail-${adaptation.platform}-${layout.supportsLargeText ? "large-text" : "standard-text"}`}
    >
      {onBack ? (
        <Button
          accessibilityLabel="Duyurulara geri dön"
          compact
          label="Geri"
          onPress={onBack}
          style={styles.backButton}
          variant="ghost"
        />
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Text style={[theme.typography.metaStrong, { color: theme.colors.text.link }]}>
          {detail.typeAndScopeLabel}
        </Text>
        <Text
          accessibilityRole="header"
          style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}
        >
          {detail.title}
        </Text>
      </View>

      <Card style={{ gap: theme.spacing.sm }} variant="outlined">
        <View style={[styles.sourceRow, { gap: theme.spacing.sm }]}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.sourceMark,
              {
                backgroundColor: theme.colors.state.selected,
                borderRadius: theme.radii.pill,
              },
            ]}
          >
            <Text style={[theme.typography.label, { color: theme.colors.text.link }]}>
              {sourceInitial(detail.sourceName)}
            </Text>
          </View>
          <View style={styles.flexibleCopy}>
            <Text
              accessibilityRole="header"
              style={[theme.typography.bodyStrong, { color: theme.colors.text.primary }]}
            >
              {detail.sourceName}
            </Text>
            <Text style={[theme.typography.meta, { color: theme.colors.text.secondary }]}>
              Resmî kaynak · {detail.domain}
            </Text>
          </View>
        </View>

        {detail.publishedLabel ? (
          <MetadataRow label="Yayın" value={detail.publishedLabel} />
        ) : null}
        {detail.updatedLabel ? (
          <MetadataRow label="Güncelleme" value={detail.updatedLabel} />
        ) : null}
        {!detail.publishedLabel && !detail.updatedLabel ? (
          <MetadataRow label="Tarih" value="Yayın tarihi belirtilmemiş" />
        ) : null}
      </Card>

      <Card style={{ gap: theme.spacing.sm }} variant="outlined">
        <Text
          accessibilityRole="header"
          style={[theme.typography.sectionTitle, { color: theme.colors.text.primary }]}
        >
          Özet
        </Text>
        <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>
          {detail.summary || "Bu içerik için güvenli bir özet sağlanmadı."}
        </Text>
      </Card>

      {actionFailure ? (
        <Banner
          dismissAccessibilityLabel="İşlem uyarısını kapat"
          message={actionFailure}
          onDismiss={() => setActionFailure(null)}
          title="İşlem tamamlanamadı"
          tone="error"
        />
      ) : null}

      <View style={[styles.actions, { gap: theme.spacing.sm }]}>
        <Button
          fullWidth
          label="Paylaş"
          loading={sharing}
          onPress={() => void handleShare()}
          variant="secondary"
        />
        <Button
          accessibilityLabel={`Resmî kaynağı aç: ${detail.domain}`}
          fullWidth
          label={`Resmî kaynağı aç · ${detail.domain}`}
          loading={openingOfficialSource}
          onPress={() => void handleOpenOfficialSource()}
        />
      </View>
    </ScrollView>
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
  typeAndScopeLabel: string;
  publishedLabel: string | null;
  updatedLabel: string | null;
  officialUrl: string;
  domain: string;
}

function normalizeDetail(item: ContentFeedItem | null): NormalizedDetail | null {
  if (!item || item.record.trustStatus !== "trusted") return null;
  const record = item.record;
  const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim() : "";
  const sourceName = normalizeDetailText(record.sourceName);
  const title = normalizeDetailText(record.title);
  const summary = normalizeDetailText(record.summary);
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
    typeAndScopeLabel,
    publishedLabel,
    updatedLabel,
    officialUrl,
    domain,
  };
}

function timestampLabel(
  record: TrustedMobileContentRecord,
  kind: "published" | "updated",
): string | null {
  const label = kind === "published"
    ? contentTimestampLabel({ publishedAt: record.publishedAt })
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
  actions: {
    alignItems: "stretch",
  },
  backButton: {
    alignSelf: "flex-start",
  },
  content: {
    alignSelf: "center",
    width: "100%",
  },
  flexibleCopy: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    minWidth: 0,
  },
  metadataRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingVertical: 8,
  },
  metadataValue: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    textAlign: "right",
  },
  sourceMark: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  sourceRow: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  stateContainer: {
    flex: 1,
    justifyContent: "center",
  },
});
