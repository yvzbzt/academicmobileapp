import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Button, ThemeProvider, useTheme, type ThemePreference } from "../design-system";
import type { TrustedMobileContentRecord } from "../content/content-trust";
import { HomeDailyBrief, type HomeDailyBriefProps } from "./HomeDailyBrief";

export type HomeDailyBriefPreviewScenario =
  | "incomplete"
  | "loading"
  | "populated"
  | "empty"
  | "stale"
  | "error"
  | "long-title"
  | "reference";

const PreviewStack = createNativeStackNavigator<{ Home: undefined; Detail: undefined }>();
const previewNow = new Date(2026, 7, 1, 10, 0, 0);
const referenceNow = new Date(2026, 7, 20, 10, 0, 0);
const referenceWeekAnchor = new Date(2026, 7, 27, 10, 0, 0);

const referenceEvents: HomeDailyBriefProps["events"] = [{
  id: "reference-horizontal-transfer",
  title: "Lisansüstü Programlara Yatay Geçiş Başvuruları",
  category: "horizontal_transfer",
  startDate: "2026-08-27",
  temporalKind: "date",
}, {
  id: "reference-course-registration",
  title: "Ders Kayıtları",
  category: "course_registration",
  startDate: "2026-08-31",
  endDate: "2026-09-04",
  temporalKind: "date",
  endTemporalKind: "date",
}, {
  id: "reference-scholarship-applications",
  title: "Burs Başvuruları",
  category: "scholarship_application",
  startDate: "2026-09-01",
  endDate: "2026-09-15",
  temporalKind: "date",
  endTemporalKind: "date",
}, {
  id: "reference-spring-term-start",
  title: "Bahar Dönemi Ders Başlangıcı",
  category: "semester_start",
  startDate: "2027-02-08",
  temporalKind: "date",
}];

export function HomeDailyBriefPreview({
  scenario = "populated",
  preference = "light",
}: {
  scenario?: HomeDailyBriefPreviewScenario;
  preference?: ThemePreference;
}) {
  if (!__DEV__) return null;
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<TrustedMobileContentRecord | null>(null);
  return (
    <SafeAreaProvider>
      <ThemeProvider preference={preference} reducedMotion>
        <NavigationContainer>
          <PreviewStack.Navigator screenOptions={{ headerShown: false }}>
            <PreviewStack.Screen name="Home">
              {({ navigation }) => (
                <HomeDailyBrief
                  {...createHomeDailyBriefPreviewProps(scenario)}
                  onOpenAnnouncement={(item) => {
                    setSelectedAnnouncement(item);
                    navigation.navigate("Detail");
                  }}
                />
              )}
            </PreviewStack.Screen>
            <PreviewStack.Screen name="Detail">
              {({ navigation }) => (
                <PreviewDetail
                  title={selectedAnnouncement?.title ?? "Güvenilir duyuru"}
                  onBack={() => navigation.goBack()}
                />
              )}
            </PreviewStack.Screen>
          </PreviewStack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function PreviewDetail({ title, onBack }: { title: string; onBack: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: theme.spacing.md, padding: theme.spacing.lg, backgroundColor: theme.colors.background.canvas }}>
      <Text accessibilityRole="header" style={[theme.typography.screenTitle, { color: theme.colors.text.primary }]}>Duyuru ayrıntısı</Text>
      <Text style={[theme.typography.cardTitle, { color: theme.colors.text.primary }]}>{title}</Text>
      <Text style={[theme.typography.body, { color: theme.colors.text.secondary }]}>Sentetik güvenilir içerik ayrıntısı. Bu önizleme ağ veya kalıcı depolama kullanmaz.</Text>
      <Button label="Günlük özete dön" onPress={onBack} variant="secondary" />
    </View>
  );
}

export function createHomeDailyBriefPreviewProps(
  scenario: HomeDailyBriefPreviewScenario,
): HomeDailyBriefProps {
  if (scenario === "reference") {
    return {
      ...basePreviewProps(scenario),
      fullName: "Fuat Başar",
      universityName: "Ankara Üniversitesi",
      facultyName: "Mühendislik Fakültesi",
      departmentName: "Bilgisayar Mühendisliği",
      events: referenceEvents,
      announcements: [
        previewAnnouncement(
          "reference-academic-calendar",
          "2026–2027 Güz Dönemi Akademik Takvimi Yayımlandı",
          "2026-08-20T07:30:00.000Z",
        ),
        previewAnnouncement(
          "reference-engineering-advising",
          "Mühendislik Fakültesi Danışmanlık Toplantısı",
          "2026-08-19T07:30:00.000Z",
        ),
        previewAnnouncement(
          "reference-capstone-deadline",
          "Bilgisayar Mühendisliği Bitirme Projesi Teslim Tarihleri",
          "2026-08-18T07:30:00.000Z",
        ),
      ],
      announcementNewCount: 3,
      now: referenceNow,
      weekAnchorDate: referenceWeekAnchor,
      weeklySummaryOverride: {
        applications: 1,
        exams: 1,
        registrations: 2,
        total: 4,
      },
    };
  }

  return basePreviewProps(scenario);
}

function basePreviewProps(scenario: HomeDailyBriefPreviewScenario): HomeDailyBriefProps {
  const populatedAnnouncements = [previewAnnouncement(
    "announcement-important",
    scenario === "long-title"
      ? "2026-2027 eğitim öğretim yılı güz dönemi ders kayıtları, danışman onayları ve mazeretli kayıt başvuruları hakkında çok uzun Türkçe duyuru başlığı"
      : "Güz dönemi ders kayıt takvimi açıklandı",
    "2026-08-01T07:00:00.000Z"
  ), previewAnnouncement("announcement-recent", "Burs başvuruları için güncel belge listesi", "2026-07-31T07:00:00.000Z")];
  const base: HomeDailyBriefProps = {
    fullName: "Deniz Yılmaz",
    profileComplete: scenario !== "incomplete",
    universityName: scenario === "incomplete" ? undefined : "Kampüs Üniversitesi",
    facultyName: scenario === "incomplete" ? undefined : "Mühendislik Fakültesi",
    departmentName: scenario === "incomplete" ? undefined : "Bilgisayar Mühendisliği",
    events: scenario === "populated" || scenario === "stale" || scenario === "long-title" ? [{
      id: "registration-today",
      title: "Ders kayıtları ve danışman onayı",
      category: "course_registration",
      startDate: new Date(2026, 7, 1, 14, 0).toISOString(),
    }, {
      id: "exam-next",
      title: "Veri Yapıları final sınavı",
      category: "final_exam",
      startDate: new Date(2026, 7, 3, 9, 30).toISOString(),
    }] : [],
    manualExams: [],
    announcements: scenario === "populated" || scenario === "stale" || scenario === "long-title"
      ? populatedAnnouncements
      : [],
    calendarLoading: scenario === "loading",
    calendarAttempted: scenario !== "loading",
    announcementLoading: scenario === "loading",
    announcementAttempted: scenario !== "loading",
    calendarError: scenario === "stale" ? "Takvim kaynağı şu anda yenilenemedi." : scenario === "error" ? "Sunucuya ulaşılamadı." : undefined,
    calendarStale: scenario === "stale",
    announcementState: scenario === "stale" ? "partial" : "fresh",
    googleCalendarState: "connected",
    notificationPermission: "granted",
    notificationPreferenceEnabled: true,
    notificationActive: true,
    now: previewNow,
    onCompleteProfile: () => undefined,
    onOpenAnnouncement: () => undefined,
    onOpenAnnouncements: () => undefined,
    onOpenCalendar: () => undefined,
    onCreatePersonalEvent: () => undefined,
    onOpenGoogleCalendarSettings: () => undefined,
    onOpenNotificationSettings: () => undefined,
    onRefresh: () => undefined,
  };
  return base;
}

function previewAnnouncement(id: string, title: string, publishedAt: string): TrustedMobileContentRecord {
  const canonicalUrl = `https://preview.edu.tr/duyurular/${id}`;
  const officialSourceUrl = "https://preview.edu.tr/duyurular";
  return {
    id,
    sourceId: "preview-source",
    sourceName: "Kampüs Üniversitesi Öğrenci İşleri",
    scopeType: "university",
    scopeId: "preview-university",
    title,
    summary: "Öğrencilerin işlem tarihlerini kaçırmaması için yayımlanan bilgilendirme özeti.",
    link: canonicalUrl,
    canonicalUrl,
    officialSourceUrl,
    sourceRelationships: [{
      sourceId: "preview-source",
      sourceName: "Kampüs Üniversitesi Öğrenci İşleri",
      officialSourceUrl,
      scopeType: "university",
      scopeId: "preview-university",
      canonicalUrl,
    }],
    publishedAt,
    trustStatus: "trusted",
    sourceStatus: "active",
    sourceTrustStatus: "trusted",
  };
}
