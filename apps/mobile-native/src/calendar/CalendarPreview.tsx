import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, type ThemePreference } from "../design-system";
import { CalendarEventDetail } from "./CalendarEventDetail";
import { CalendarExperience } from "./CalendarExperience";
import { buildCalendarItems, type CalendarItem, type CalendarPersonalExam } from "./calendar-model";
import type {
  PersonalExamMutationInput,
  PersonalExamMutationResult,
} from "./PersonalExamEditor";

export const CALENDAR_PREVIEW_SCENARIOS = [
  "populated",
  "week",
  "month",
  "loading",
  "refreshing",
  "empty",
  "stale",
  "partial",
  "offline",
  "error",
  "google-partial",
  "detail-academic",
  "detail-personal",
  "long-title",
] as const;

export type CalendarPreviewScenario = (typeof CALENDAR_PREVIEW_SCENARIOS)[number];

type PreviewStackParamList = {
  Calendar: undefined;
  Detail: undefined;
};

const PreviewStack = createNativeStackNavigator<PreviewStackParamList>();
const fixedNow = new Date("2026-08-05T09:00:00.000+03:00");

const academicEvents = [
  {
    id: "preview-registration",
    title: "Güz dönemi ders kayıt ve danışman onayı tarihleri",
    category: "course_registration",
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    temporalKind: "date" as const,
    endTemporalKind: "date" as const,
  },
  {
    id: "preview-final",
    title: "Mühendislik Fakültesi final sınavları",
    category: "final_exam",
    startDate: "2026-08-10",
    temporalKind: "date" as const,
  },
  {
    id: "preview-orientation",
    title: "Yeni öğrenci çevrim içi oryantasyonu",
    category: "orientation",
    startDate: "2026-08-12T16:00:00.000Z",
    temporalKind: "timestamp" as const,
  },
  {
    id: "preview-holiday",
    title: "Akademik tatil günü",
    category: "holiday",
    startDate: "2026-08-30",
    temporalKind: "date" as const,
  },
];

const longTitleEvent = {
  id: "preview-long-title",
  title: "Bilgisayar Mühendisliği Bölümü öğrencileri için çok uzun açıklamalı bütünleme sınavları ve ders kayıt danışmanlığı tarih aralığı",
  category: "makeup_exam",
  startDate: "2026-08-14",
  endDate: "2026-08-16",
  temporalKind: "date" as const,
  endTemporalKind: "date" as const,
};

const initialPersonalExams: CalendarPersonalExam[] = [{
  id: "preview-personal",
  title: "Lineer Cebir kişisel sınavı",
  examDate: "2026-08-11T06:30:00.000Z",
}];

export interface CalendarPreviewProps {
  preference?: ThemePreference;
  scenario?: CalendarPreviewScenario;
}

export function CalendarPreview({
  preference = "light",
  scenario = "populated",
}: CalendarPreviewProps) {
  const [activePreference, setActivePreference] = useState(preference);
  const [activeScenario, setActiveScenario] = useState(scenario);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const selection = parseCalendarPreviewUrl(url);
      if (!selection) return;
      setActiveScenario(selection.scenario);
      setActivePreference(selection.preference);
    });
    return () => subscription.remove();
  }, []);

  return (
    <CalendarPreviewExperience
      preference={activePreference}
      scenario={activeScenario}
    />
  );
}

export function parseCalendarPreviewUrl(url: string): {
  scenario: CalendarPreviewScenario;
  preference: ThemePreference;
} | null {
  const match = /^academicpulse:\/\/phase9-calendar\/([a-z-]+)(?:\?theme=(light|dark))?$/u.exec(url);
  if (!match || !CALENDAR_PREVIEW_SCENARIOS.includes(match[1] as CalendarPreviewScenario)) return null;
  return {
    scenario: match[1] as CalendarPreviewScenario,
    preference: match[2] === "dark" ? "dark" : "light",
  };
}

function CalendarPreviewExperience({
  preference,
  scenario,
}: Required<CalendarPreviewProps>) {
  const [personalExams, setPersonalExams] = useState(initialPersonalExams);
  const fixtureEvents = scenario === "long-title"
    ? [...academicEvents, longTitleEvent]
    : academicEvents;
  const initialItems = buildCalendarItems({
    academicEvents: fixtureEvents,
    personalExams,
    academicSourceLabel: "Kampüs Üniversitesi Akademik Takvimi",
  });
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(() => (
    scenario === "detail-personal"
      ? initialItems.find((item) => item.source === "personal") ?? null
      : initialItems.find((item) => item.source === "academic") ?? null
  ));
  const initialRoute = scenario === "detail-academic" || scenario === "detail-personal"
    ? "Detail"
    : "Calendar";

  const createExam = (input: PersonalExamMutationInput): PersonalExamMutationResult => {
    setPersonalExams((current) => [...current, {
      id: `preview-created-${current.length + 1}`,
      ...input,
    }]);
    return { ok: true };
  };
  const updateExam = (id: string, input: PersonalExamMutationInput): PersonalExamMutationResult => {
    setPersonalExams((current) => current.map((exam) => exam.id === id ? { id, ...input } : exam));
    setSelectedItem((current) => current?.source === "personal" && current.id === id
      ? {
          ...current,
          title: input.title,
          startDate: input.examDate,
          ...(input.locationNote ? { location: input.locationNote } : {}),
        }
      : current);
    return { ok: true };
  };
  const deleteExam = (id: string): PersonalExamMutationResult => {
    setPersonalExams((current) => current.filter((exam) => exam.id !== id));
    setSelectedItem(null);
    return { ok: true };
  };

  const emptyData = ["loading", "empty", "error"].includes(scenario);
  const selectedGoogleState = scenario === "google-partial"
    ? {
      state: "partial",
      stateLabel: "Kısmi",
      accountEmail: "deniz.yilmaz@kampus.example.invalid",
      verifiedCount: 2,
      lastSyncedLabel: "Son eşitleme: 5 Ağustos 2026 09:30",
      warnings: ["Bir sentetik kayıt doğrulanamadı."],
      connected: true,
    }
    : {
      state: "connected",
      stateLabel: "Bağlı",
      accountEmail: "deniz.yilmaz@kampus.example.invalid",
      verifiedCount: 4,
      lastSyncedLabel: "Son eşitleme: 5 Ağustos 2026 09:30",
      connected: true,
    };

  return (
    <SafeAreaProvider>
      <ThemeProvider preference={preference}>
        <NavigationContainer>
          <PreviewStack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
            <PreviewStack.Screen name="Calendar" options={{ title: "Takvim" }}>
              {({ navigation }) => (
                <CalendarExperience
                  academicEvents={emptyData ? [] : fixtureEvents}
                  academicYear="2026-2027"
                  attempted={scenario !== "loading"}
                  calendarTitle="Kampüs Üniversitesi Akademik Takvimi"
                  error={scenario === "error" || scenario === "stale" ? "Sentetik kaynak yanıt vermedi." : undefined}
                  google={selectedGoogleState}
                  initialAnchorDate="2026-08-05"
                  initialView={scenario === "week" ? "week" : scenario === "month" ? "month" : "agenda"}
                  loading={scenario === "loading" || scenario === "refreshing"}
                  now={fixedNow}
                  offline={scenario === "offline"}
                  onCreatePersonalExam={createExam}
                  onManageGoogle={() => undefined}
                  onOpenItem={(item) => {
                    setSelectedItem(item);
                    navigation.navigate("Detail");
                  }}
                  onRefresh={() => undefined}
                  onSyncGoogle={() => undefined}
                  onUpdatePersonalExam={updateExam}
                  partial={scenario === "partial"}
                  personalExams={emptyData ? [] : personalExams}
                  personalExamsReady
                  stale={scenario === "stale"}
                  universityName="Kampüs Üniversitesi"
                />
              )}
            </PreviewStack.Screen>
            <PreviewStack.Screen name="Detail" options={{ title: "Takvim Ayrıntısı" }}>
              {({ navigation }) => (
                <CalendarEventDetail
                  academicYear="2026-2027"
                  departmentName="Bilgisayar Mühendisliği"
                  facultyName="Mühendislik Fakültesi"
                  item={selectedItem}
                  onBack={() => navigation.goBack()}
                  onDeletePersonalExam={(id) => {
                    const result = deleteExam(id);
                    if (result.ok) navigation.goBack();
                    return result;
                  }}
                  onUpdatePersonalExam={updateExam}
                  universityName="Kampüs Üniversitesi"
                />
              )}
            </PreviewStack.Screen>
          </PreviewStack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
