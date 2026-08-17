import { NavigationContainer } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  ThemeProvider,
  type ThemePreference,
} from "../design-system";
import type { TrustedMobileContentRecord } from "../content/content-trust";
import { AnnouncementDetail } from "./AnnouncementDetail";
import { AnnouncementsFeed } from "./AnnouncementsFeed";
import {
  buildContentFeed,
  type ContentFeedItem,
} from "./feed-model";

export const CONTENT_FEED_PREVIEW_SCENARIOS = [
  "populated",
  "search-results",
  "no-results",
  "active-filters",
  "partial",
  "stale",
  "offline",
  "error",
  "pagination-error",
  "detail",
  "yok",
  "summer-school",
  "official-source-handoff",
  "long-title",
  "long-feed",
] as const;

export const CONTENT_FEED_PREVIEW_LONG_FEED_SIZE = 100;

export type ContentFeedPreviewScenario =
  (typeof CONTENT_FEED_PREVIEW_SCENARIOS)[number];

type PreviewStackParamList = {
  Feed: undefined;
  Detail: undefined;
};

export interface ContentFeedPreviewFixture {
  academicItems: TrustedMobileContentRecord[];
  yokItems: TrustedMobileContentRecord[];
  summerItems: TrustedMobileContentRecord[];
  loading: boolean;
  attempted: boolean;
  refreshing: boolean;
  error?: string;
  stale: boolean;
  partial: boolean;
  offline: boolean;
  serverLimit: number;
  hasMore: boolean;
  paginationLoading: boolean;
  paginationError?: string;
  initialSearchText?: string;
  initialContentTypeFilter?: "all" | "announcement" | "news" | "event";
  initialSourceFilter?: "all" | "university" | "faculty" | "department" | "yok" | "summer-school";
  initialRoute: keyof PreviewStackParamList;
  initialDetail: TrustedMobileContentRecord;
  officialHandoffResult: boolean;
}

const PreviewStack = createNativeStackNavigator<PreviewStackParamList>();

const primaryAnnouncement = previewRecord({
  id: "preview-registration",
  sourceId: "preview-student-affairs",
  sourceName: "Kampüs Üniversitesi Öğrenci İşleri Daire Başkanlığı",
  title: "Güz dönemi ders kayıt takvimi açıklandı",
  summary: "Ders kayıtları ve danışman onayları için yayımlanan bilgilendirme özeti.",
  publishedAt: "2026-08-02T07:00:00.000Z",
});

const scholarshipNews = previewRecord({
  id: "preview-scholarship",
  sourceId: "preview-faculty",
  sourceName: "Kampüs Üniversitesi Mühendislik Fakültesi",
  contentType: "news",
  scopeType: "faculty",
  scopeId: "preview-faculty",
  title: "Burs başvuruları için güncel belge listesi yayımlandı",
  summary: "Burs başvurularında istenen güncel belge ve tarih bilgileri.",
  sourceUpdatedAt: "2026-08-01T11:30:00.000Z",
  path: "haberler/burs-belgeleri",
});

const facultyEvent = previewRecord({
  id: "preview-faculty-event",
  sourceId: "preview-faculty",
  sourceName: "Kampüs Üniversitesi Mühendislik Fakültesi",
  contentType: "event",
  scopeType: "faculty",
  scopeId: "preview-faculty",
  title: "Fakülte araştırma etkinliği",
  summary: "Öğrenciler için hazırlanan araştırma etkinliği duyurusu.",
  publishedAt: "2026-07-31T08:00:00.000Z",
  path: "etkinlikler/arastirma-bulusmasi",
});

const yokAnnouncement = previewRecord({
  id: "preview-yok",
  sourceId: "preview-yok-source",
  sourceName: "Yükseköğretim Kurulu",
  scopeId: "yok-council-of-higher-education",
  title: "YÖK öğrenci bilgilendirme duyurusu",
  summary: "Ulusal yükseköğretim gündeminden güncel bilgilendirme.",
  publishedAt: "2026-08-01T06:00:00.000Z",
  origin: "https://www.yok.gov.tr",
  path: "tr/announcements/preview-yok",
});

const summerAnnouncement = previewRecord({
  id: "preview-summer-school",
  sourceId: "preview-summer-source",
  sourceName: "Kampüs Üniversitesi Yaz Okulu Koordinatörlüğü",
  title: "Yaz okulu başvuru tarihleri",
  summary: "Yaz okulu başvuru aralığı ve kayıt adımları.",
  publishedAt: "2026-07-30T09:00:00.000Z",
  path: "yaz-okulu/basvuru-tarihleri",
});

const longTitleAnnouncement = previewRecord({
  id: "preview-long-title",
  sourceId: "preview-student-affairs",
  sourceName: "Örnek Üniversitesi Öğrenci İşleri Daire Başkanlığı ve Akademik Birimler Koordinatörlüğü",
  title: "2026-2027 eğitim öğretim yılı güz dönemi ders kayıtları, danışman onayları, mazeretli kayıt başvuruları ve bölüm bazlı değerlendirme takvimi hakkında çok uzun Türkçe duyuru başlığı",
  summary: "Uzun Türkçe kurum adları ile başlıkların 320 dp ve yüzde 200 yazı ölçeğinde sarılmasını sınayan sentetik özet.",
  publishedAt: "2026-08-02T05:00:00.000Z",
  path: "duyurular/uzun-turkce-baslik",
});

export function createContentFeedPreviewFixture(
  scenario: ContentFeedPreviewScenario,
): ContentFeedPreviewFixture {
  const base: ContentFeedPreviewFixture = {
    academicItems: [primaryAnnouncement, scholarshipNews, facultyEvent],
    yokItems: [yokAnnouncement],
    summerItems: [summerAnnouncement],
    loading: false,
    attempted: true,
    refreshing: false,
    stale: false,
    partial: false,
    offline: false,
    serverLimit: 20,
    hasMore: false,
    paginationLoading: false,
    initialRoute: "Feed",
    initialDetail: primaryAnnouncement,
    officialHandoffResult: true,
  };

  switch (scenario) {
    case "search-results":
      return { ...base, initialSearchText: "burs" };
    case "no-results":
      return { ...base, initialSearchText: "eşleşmeyen sentetik arama" };
    case "active-filters":
      return {
        ...base,
        initialContentTypeFilter: "event",
        initialSourceFilter: "faculty",
      };
    case "partial":
      return { ...base, partial: true };
    case "stale":
      return {
        ...base,
        stale: true,
        error: "Kaynaklar yenilenemedi; son güvenilir içerikler gösteriliyor.",
      };
    case "offline":
      return { ...base, offline: true };
    case "error":
      return {
        ...base,
        academicItems: [],
        yokItems: [],
        summerItems: [],
        error: "Sentetik içerik yüklenemedi.",
      };
    case "pagination-error":
      return {
        ...base,
        hasMore: true,
        paginationError: "Daha fazla sentetik içerik yüklenemedi.",
      };
    case "detail":
      return { ...base, initialRoute: "Detail" };
    case "yok":
      return {
        ...base,
        academicItems: [],
        summerItems: [],
        initialDetail: yokAnnouncement,
        initialSourceFilter: "yok",
      };
    case "summer-school":
      return {
        ...base,
        academicItems: [],
        yokItems: [],
        initialDetail: summerAnnouncement,
        initialSourceFilter: "summer-school",
      };
    case "official-source-handoff":
      return {
        ...base,
        initialRoute: "Detail",
        officialHandoffResult: false,
      };
    case "long-title":
      return {
        ...base,
        academicItems: [longTitleAnnouncement],
        yokItems: [],
        summerItems: [],
        initialDetail: longTitleAnnouncement,
      };
    case "long-feed":
      return {
        ...base,
        yokItems: [],
        summerItems: [],
        academicItems: Array.from(
          { length: CONTENT_FEED_PREVIEW_LONG_FEED_SIZE },
          (_, index) => previewRecord({
            id: `preview-long-feed-${index + 1}`,
            sourceId: index % 2 === 0 ? "preview-student-affairs" : "preview-faculty",
            sourceName: index % 2 === 0
              ? "Örnek Üniversitesi Öğrenci İşleri"
              : "Örnek Üniversitesi Mühendislik Fakültesi",
            scopeType: index % 2 === 0 ? "university" : "faculty",
            scopeId: index % 2 === 0 ? "preview-university" : "preview-faculty",
            contentType: index % 5 === 0 ? "event" : index % 3 === 0 ? "news" : "announcement",
            title: `Sentetik uzun akış kaydı ${String(index + 1).padStart(3, "0")}`,
            summary: "Sanal liste performansını gözlemlemek için oluşturulan sentetik güvenilir içerik.",
            publishedAt: new Date(Date.UTC(2026, 7, 2, 7, 0, 0) - index * 60_000).toISOString(),
            path: `uzun-akis/${index + 1}`,
          }),
        ),
        serverLimit: CONTENT_FEED_PREVIEW_LONG_FEED_SIZE,
      };
    case "populated":
      return base;
  }
}

export function ContentFeedPreview({
  scenario = "populated",
  preference = "light",
}: {
  scenario?: ContentFeedPreviewScenario;
  preference?: ThemePreference;
}) {
  if (!__DEV__) return null;

  const fixture = createContentFeedPreviewFixture(scenario);
  const initialItems = buildContentFeed({
    academic: fixture.academicItems,
    yok: fixture.yokItems,
    summerSchool: fixture.summerItems,
  });
  const initialDetail = initialItems.find(
    (item) => item.record.id === fixture.initialDetail.id,
  ) ?? buildContentFeed({
    academic: [fixture.initialDetail],
    yok: [],
    summerSchool: [],
  })[0]!;
  const [selectedItem, setSelectedItem] = useState<ContentFeedItem>(
    initialDetail,
  );
  const [saved, setSaved] = useState(false);

  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <ThemeProvider preference={preference} reducedMotion>
        <View
          accessibilityLabel={`Phase 8 sentetik içerik önizlemesi: ${scenario}`}
          style={{ flex: 1 }}
          testID="phase8-content-feed-preview"
        >
          <NavigationContainer>
            <PreviewStack.Navigator
              initialRouteName="Feed"
              screenOptions={{ headerShown: false }}
            >
              <PreviewStack.Screen name="Feed">
                {({ navigation }) => (
                  <PreviewFeedRoute
                    fixture={fixture}
                    navigation={navigation}
                    onSelectItem={setSelectedItem}
                  />
                )}
              </PreviewStack.Screen>
              <PreviewStack.Screen name="Detail">
                {({ navigation }) => (
                  <AnnouncementDetail
                    item={selectedItem}
                    onBack={() => navigation.goBack()}
                    onOpenNotificationSettings={() => undefined}
                    onOpenOfficialSource={() => Promise.resolve(fixture.officialHandoffResult)}
                    onToggleSaved={() => setSaved((current) => !current)}
                    saved={saved}
                  />
                )}
              </PreviewStack.Screen>
            </PreviewStack.Navigator>
          </NavigationContainer>
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function PreviewFeedRoute({
  fixture,
  navigation,
  onSelectItem,
}: {
  fixture: ContentFeedPreviewFixture;
  navigation: NativeStackScreenProps<PreviewStackParamList, "Feed">["navigation"];
  onSelectItem: (item: ContentFeedItem) => void;
}) {
  const openedInitialDetail = useRef(false);

  useEffect(() => {
    if (fixture.initialRoute !== "Detail" || openedInitialDetail.current) return;
    openedInitialDetail.current = true;
    navigation.navigate("Detail");
  }, [fixture.initialRoute, navigation]);

  return (
    <AnnouncementsFeed
      academicItems={fixture.academicItems}
      yokItems={fixture.yokItems}
      summerItems={fixture.summerItems}
      universityName="Kampüs Üniversitesi"
      facultyName="Mühendislik Fakültesi"
      departmentName="Bilgisayar Mühendisliği"
      loading={fixture.loading}
      attempted={fixture.attempted}
      refreshing={fixture.refreshing}
      error={fixture.error}
      stale={fixture.stale}
      partial={fixture.partial}
      offline={fixture.offline}
      serverLimit={fixture.serverLimit}
      hasMore={fixture.hasMore}
      paginationLoading={fixture.paginationLoading}
      paginationError={fixture.paginationError}
      onRefresh={() => undefined}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
      onRetryPagination={() => undefined}
      onOpenItem={(item) => {
        onSelectItem(item);
        navigation.navigate("Detail");
      }}
      onOpenYok={() => undefined}
      onOpenSummerSchool={() => undefined}
      initialSearchText={fixture.initialSearchText}
      initialContentTypeFilter={fixture.initialContentTypeFilter}
      initialSourceFilter={fixture.initialSourceFilter}
    />
  );
}

function previewRecord({
  id,
  sourceId,
  sourceName,
  title,
  summary,
  contentType = "announcement",
  scopeType = "university",
  scopeId = "preview-university",
  publishedAt,
  sourceUpdatedAt,
  origin = "https://preview.edu.tr",
  path,
}: {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary: string;
  contentType?: "announcement" | "news" | "event";
  scopeType?: "university" | "faculty" | "department";
  scopeId?: string;
  publishedAt?: string;
  sourceUpdatedAt?: string;
  origin?: "https://preview.edu.tr" | "https://www.yok.gov.tr";
  path?: string;
}): TrustedMobileContentRecord {
  const officialUrl = `${origin}/${path ?? `duyurular/${id}`}`;
  return {
    id,
    sourceId,
    sourceName,
    contentType,
    scopeType,
    scopeId,
    title,
    summary,
    link: officialUrl,
    canonicalUrl: officialUrl,
    officialSourceUrl: officialUrl,
    sourceRelationships: [{
      sourceId,
      sourceName,
      officialSourceUrl: officialUrl,
      scopeType,
      scopeId,
      canonicalUrl: officialUrl,
    }],
    ...(publishedAt ? { publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    freshness: "fresh",
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
