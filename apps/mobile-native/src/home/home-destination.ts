import {
  canonicalizeOfficialAcademicUrl,
  normalizeDisplayText,
} from "../content/content-trust";
import {
  buildCalendarItems,
  type CalendarItem,
} from "../calendar/calendar-model";
import type {
  HomeAcademicEvent,
  HomeImportantItem,
  HomeManualExam,
} from "./home-model";

export type HomeImportantDestination =
  | { kind: "calendar_detail"; item: CalendarItem }
  | { kind: "official_source"; url: string; fallbackItem?: CalendarItem }
  | { kind: "unavailable"; reason: "missing_item" | "invalid_item" };

export function resolveHomeImportantDestination(input: {
  item: HomeImportantItem;
  events: readonly HomeAcademicEvent[];
  manualExams: readonly HomeManualExam[];
  academicSourceLabel: string;
}): HomeImportantDestination {
  if (input.item.category.startsWith("personal_")) {
    const personalExam = input.manualExams.find((candidate) => candidate.id === input.item.id);
    if (!personalExam) return { kind: "unavailable", reason: "missing_item" };
    const detailItem = buildCalendarItems({
      academicEvents: [],
      personalExams: [personalExam],
      academicSourceLabel: "Kişisel takvim",
    })[0];
    return detailItem
      ? { kind: "calendar_detail", item: detailItem }
      : { kind: "unavailable", reason: "invalid_item" };
  }

  const event = input.events.find((candidate) => candidate.id === input.item.id);
  if (!event) return { kind: "unavailable", reason: "missing_item" };
  const detailItem = buildCalendarItems({
    academicEvents: [event],
    personalExams: [],
    academicSourceLabel: event.sourceLabel ?? input.academicSourceLabel,
  })[0];
  const officialUrl = canonicalizeOfficialAcademicUrl(event.sourceUrl);
  const hasInAppDetail = Boolean(
    normalizeDisplayText(event.description)
    || normalizeDisplayText(event.courseName)
    || normalizeDisplayText(event.location)
  );

  if (!hasInAppDetail && officialUrl) {
    return {
      kind: "official_source",
      url: officialUrl,
      ...(detailItem ? { fallbackItem: detailItem } : {}),
    };
  }
  if (detailItem) return { kind: "calendar_detail", item: detailItem };
  if (officialUrl) return { kind: "official_source", url: officialUrl };
  return { kind: "unavailable", reason: "invalid_item" };
}
