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
  "reference",
] as const;

export type CalendarPreviewScenario = (typeof CALENDAR_PREVIEW_SCENARIOS)[number];

type PreviewStackParamList = {
  Calendar: undefined;
  Detail: undefined;
};

const PreviewStack = createNativeStackNavigator<PreviewStackParamList>();
const fixedNow = new Date("2026-08-05T09:00:00.000+03:00");
const weekNow = new Date("2026-08-25T09:00:00.000+03:00");
const referenceNow = new Date("2025-05-22T08:00:00.000+03:00");

export const REFERENCE_CALENDAR_EVENTS = [{
  id: "reference-midterm",
  title: "Vize Sınavı",
  category: "midterm_exam",
  startDate: "2025-05-22T09:00:00.000+03:00",
  endDate: "2025-05-22T10:50:00.000+03:00",
  temporalKind: "timestamp" as const,
  endTemporalKind: "timestamp" as const,
  timezone: "Europe/Istanbul",
  description: "Matematik II",
  location: "Mühendislik Fakültesi - A Blok",
}, {
  id: "reference-assignment",
  title: "Ödev Teslimi",
  category: "assignment_deadline",
  startDate: "2025-05-22T14:00:00.000+03:00",
  endDate: "2025-05-22T15:30:00.000+03:00",
  temporalKind: "timestamp" as const,
  endTemporalKind: "timestamp" as const,
  timezone: "Europe/Istanbul",
  description: "Veri Yapıları",
  location: "Online Platform",
}, {
  id: "reference-scholarship",
  title: "Burs Başvurusu",
  category: "scholarship_application",
  startDate: "2025-05-22T17:00:00.000+03:00",
  endDate: "2025-05-22T19:00:00.000+03:00",
  temporalKind: "timestamp" as const,
  endTemporalKind: "timestamp" as const,
  timezone: "Europe/Istanbul",
  description: "Son gün",
  location: "Öğrenci İşleri",
}] as const;

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

export const WEEK_RANGE_REGRESSION_EVENT = {
  id: "preview-continuing-exam-window",
  title: "Devam eden sınav tarihleri",
  category: "department_exam_schedule",
  startDate: "2026-08-17",
  endDate: "2026-08-28",
  temporalKind: "date" as const,
  endTemporalKind: "date" as const,
};

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
  if (!__DEV__) return null;
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
      key={activeScenario}
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
  const referenceScenario = scenario === "reference";
  const fixtureEvents = referenceScenario
    ? REFERENCE_CALENDAR_EVENTS
    : scenario === "week"
      ? [WEEK_RANGE_REGRESSION_EVENT, ...academicEvents]
    : scenario === "long-title"
      ? [...academicEvents, longTitleEvent]
      : academicEvents;
  const fixturePersonalExams = referenceScenario ? [] : personalExams;
  const fixtureNow = referenceScenario ? referenceNow : scenario === "week" ? weekNow : fixedNow;
  const initialItems = buildCalendarItems({
    academicEvents: fixtureEvents,
    personalExams: fixturePersonalExams,
    academicSourceLabel: referenceScenario
      ? "Ankara Üniversitesi Akademik Takvimi"
      : "Kampüs Üniversitesi Akademik Takvimi",
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
    : referenceScenario
      ? {
        state: "disconnected",
        stateLabel: "Bağlı değil",
        verifiedCount: 0,
        lastSyncedLabel: "Henüz eşitlenmedi",
        connected: false,
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
                  academicYear={referenceScenario ? "2025-2026" : "2026-2027"}
                  attempted={scenario !== "loading"}
                  calendarTitle={referenceScenario
                    ? "Ankara Üniversitesi Akademik Takvimi"
                    : "Kampüs Üniversitesi Akademik Takvimi"}
                  error={scenario === "error" || scenario === "stale" ? "Sentetik kaynak yanıt vermedi." : undefined}
                  google={selectedGoogleState}
                  initialAnchorDate={referenceScenario
                    ? "2025-05-22"
                    : scenario === "week"
                      ? "2026-08-25"
                      : "2026-08-05"}
                  initialView={scenario === "week" ? "week" : scenario === "month" ? "month" : "agenda"}
                  loading={scenario === "loading" || scenario === "refreshing"}
                  now={fixtureNow}
                  offline={scenario === "offline"}
                  onCreatePersonalExam={createExam}
                  onManageGoogle={() => undefined}
                  onOpenAccountMenu={() => undefined}
                  onOpenItem={(item) => {
                    setSelectedItem(item);
                    navigation.navigate("Detail");
                  }}
                  onRefresh={() => undefined}
                  onSyncGoogle={() => undefined}
                  onUpdatePersonalExam={updateExam}
                  partial={scenario === "partial"}
                  personalExams={emptyData ? [] : fixturePersonalExams}
                  personalExamsReady
                  stale={scenario === "stale"}
                  universityName={referenceScenario ? "Ankara Üniversitesi" : "Kampüs Üniversitesi"}
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
