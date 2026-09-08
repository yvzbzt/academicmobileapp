import { useMemo } from "react";
import { type EventRecord } from "./app-types";
import type { ApplicationState } from "./useApplicationState";
import type { ApplicationDerivedState } from "./useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "calendar" | "courseSchedule" | "upcoming" | "session" | "manualExamOwnerId"
  | "manualExamsHydrated" | "manualExams"
> & Pick<ApplicationDerivedState,
  "selectedUniversity"
>;

export function useHomeContentData(dependencies: Dependencies) {
  const {
    calendar,
    courseSchedule,
    selectedUniversity,
    upcoming,
    session,
    manualExamOwnerId,
    manualExamsHydrated,
    manualExams
  } = dependencies;

  const homeEvents = useMemo(() => {
    const calendarEvents = calendar.data?.events ?? [];
    const calendarEventIds = new Set(calendarEvents.map((event) => event.id));
    const sourceForEvent = (event: EventRecord, fromPublishedCalendar: boolean) => {
      const courseScheduleEvent = event.category === "course_schedule";
      const sourceUrl = event.sourceUrl
        ?? (courseScheduleEvent
          ? courseSchedule.data?.sourceUrl
          : fromPublishedCalendar
            ? calendar.data?.calendar.sourceUrl
            : undefined);
      const sourceLabel = event.sourceLabel
        ?? (courseScheduleEvent
          ? "Bölüm ders programı"
          : fromPublishedCalendar
            ? calendar.data?.calendar.title ?? selectedUniversity?.name ?? "Resmî akademik takvim"
            : selectedUniversity?.name ?? "Resmî akademik kayıt");
      return {
        ...event,
        sourceLabel,
        ...(sourceUrl ? { sourceUrl } : {}),
      };
    };
    return [
      ...calendarEvents.map((event) => sourceForEvent(event, true)),
      ...(upcoming.data ?? [])
        .filter((event) => !calendarEventIds.has(event.id))
        .map((event) => sourceForEvent(event, false)),
    ];
  }, [
    calendar.data?.calendar.sourceUrl,
    calendar.data?.calendar.title,
    calendar.data?.events,
    courseSchedule.data?.sourceUrl,
    selectedUniversity?.name,
    upcoming.data,
  ]);

  const homeManualExams = session?.user.id === manualExamOwnerId && manualExamsHydrated
    ? manualExams
    : [];

  return {
    homeEvents,
    homeManualExams
  };
}

export type HomeContentData = ReturnType<typeof useHomeContentData>;
