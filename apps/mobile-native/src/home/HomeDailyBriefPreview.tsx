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
  | "long-title";

const PreviewStack = createNativeStackNavigator<{ Home: undefined; Detail: undefined }>();
const previewNow = new Date(2026, 7, 1, 10, 0, 0);

export function HomeDailyBriefPreview({
  scenario = "populated",
  preference = "light",
}: {
  scenario?: HomeDailyBriefPreviewScenario;
  preference?: ThemePreference;
}) {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<TrustedMobileContentRecord | null>(null);
  return (
    <SafeAreaProvider>
      <ThemeProvider preference={preference} reducedMotion>
        <NavigationContainer>
          <PreviewStack.Navigator screenOptions={{ headerShown: false }}>
            <PreviewStack.Screen name="Home">
              {({ navigation }) => (
                <HomeDailyBrief
                  {...previewProps(scenario)}
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

function previewProps(scenario: HomeDailyBriefPreviewScenario): HomeDailyBriefProps {
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
    universityName: scenario === "incomplete" ? undefined : "Örnek Üniversitesi",
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
    sourceName: "Örnek Üniversitesi Öğrenci İşleri",
    scopeType: "university",
    scopeId: "preview-university",
    title,
    summary: "Öğrencilerin işlem tarihlerini kaçırmaması için yayımlanan sentetik bilgilendirme özeti.",
    link: canonicalUrl,
    canonicalUrl,
    officialSourceUrl,
    sourceRelationships: [{
      sourceId: "preview-source",
      sourceName: "Örnek Üniversitesi Öğrenci İşleri",
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
