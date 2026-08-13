import type { ContentCollectionState, TrustedMobileContentRecord } from "../content/content-trust";
import {
  compareAcademicTemporalStart,
  formatAcademicRemainingTime,
  isAcademicTemporalActiveOnDay,
  isAcademicTemporalCurrentOrFuture,
  type AcademicTemporalKind,
  type AcademicTemporalValue,
} from "../temporal/academic-temporal";

export const HOME_RECENT_ANNOUNCEMENT_LIMIT = 3;

export interface HomeAcademicEvent extends AcademicTemporalValue {
  id: string;
  title: string;
  category: string;
  courseName?: string;
  location?: string;
  timezone?: string;
}

export interface HomeManualExam {
  id: string;
  title: string;
  examDate: string;
  locationNote?: string;
  kind?: "exam" | "class" | "study" | "event" | "task" | "other";
}

export interface HomeExamCountdownItem extends AcademicTemporalValue {
  id: string;
  title: string;
  source: "calendar" | "manual";
}

export interface HomeImportantItem {
  id: string;
  title: string;
  category: string;
  courseName?: string;
  location?: string;
  date: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
  kind: "exam" | "deadline" | "registration" | "event";
}

export type HomePrimaryState =
  | "incomplete_profile"
  | "initial_loading"
  | "populated"
  | "offline_no_data"
  | "partial_no_data"
  | "empty"
  | "recoverable_error";

const IMPORTANT_ANNOUNCEMENT_TITLE_PATTERNS = [
  /(?:^|\s)(?:acil|zorunlu)(?:\s|$)/u,
  /(?:iptal|ertelen)/u,
  /(?:son başvuru|başvuru son tarihi|başvuru süresi)/u,
  /(?:ders kayıt(?:ları)?|kayıt takvimi|kayıt tarihleri|kayıt yenileme|ekle bırak)/u,
  /(?:sınav takvimi|sınav tarihi|vize sınav|final sınav|bütünleme sınav|tek ders sınav)/u,
  /(?:(?:ödeme|harç) son tarihi)/u,
];

const IMPORTANT_CATEGORY_ORDER = new Map<string, number>([
  ["midterm_exam", 0],
  ["final_exam", 0],
  ["makeup_exam", 0],
  ["single_course_exam", 0],
  ["course_registration", 1],
  ["course_renewal", 1],
  ["course_add_drop", 1],
  ["application_deadline", 2],
  ["registration_deadline", 2],
]);

export function isSameLocalCalendarDay(value: string, now: Date): boolean {
  const dateOnly = parseDateOnly(value);
  if (dateOnly) {
    return dateOnly.year === now.getFullYear()
      && dateOnly.month === now.getMonth() + 1
      && dateOnly.day === now.getDate();
  }
  const candidate = new Date(value);
  return !Number.isNaN(candidate.getTime())
    && candidate.getFullYear() === now.getFullYear()
    && candidate.getMonth() === now.getMonth()
    && candidate.getDate() === now.getDate();
}

export function isActiveOnLocalCalendarDay(
  startDate: string,
  endDate: string | undefined,
  now: Date
): boolean {
  const today = localCalendarDayNumber(now);
  const start = calendarDayNumber(startDate);
  const end = calendarDayNumber(endDate ?? startDate);
  return start !== null && end !== null && start <= today && today <= end;
}

export function selectTodayItems(
  events: readonly HomeAcademicEvent[],
  manualExams: readonly HomeManualExam[],
  now: Date
): HomeImportantItem[] {
  const academic = events
    .filter((event) => isAcademicTemporalActiveOnDay(event, now))
    .map(toImportantItem);
  const personal = manualExams
    .filter((exam) => isSameLocalCalendarDay(exam.examDate, now))
    .map((exam) => ({
      id: exam.id,
      title: exam.title,
      category: `personal_${exam.kind ?? "exam"}`,
      date: exam.examDate,
      ...(exam.locationNote ? { location: exam.locationNote } : {}),
      kind: exam.kind === undefined || exam.kind === "exam" ? "exam" as const : "event" as const,
    }));
  return [...academic, ...personal].sort(compareImportantItems);
}

export function selectNearestImportantItem(
  events: readonly HomeAcademicEvent[],
  manualExams: readonly HomeManualExam[],
  now: Date
): HomeImportantItem | null {
  const candidates = [
    ...events.filter((event) => isAcademicTemporalCurrentOrFuture(event, now)).map(toImportantItem),
    ...manualExams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      category: `personal_${exam.kind ?? "exam"}`,
      date: exam.examDate,
      ...(exam.locationNote ? { location: exam.locationNote } : {}),
      kind: exam.kind === undefined || exam.kind === "exam" ? "exam" as const : "event" as const,
    })),
  ].filter((item) => {
    if (!item.category.startsWith("personal_")) return true;
    const time = Date.parse(item.date);
    return !Number.isNaN(time) && time >= now.getTime();
  });
  return candidates.sort(compareImportantItems)[0] ?? null;
}

export function selectExamCountdownItems(
  events: HomeAcademicEvent[],
  manualExams: HomeManualExam[],
  now: Date
): HomeExamCountdownItem[] {
  const examCategories = new Set(["midterm_exam", "final_exam", "makeup_exam", "single_course_exam"]);
  const calendarExams: HomeExamCountdownItem[] = events
    .filter((event) => examCategories.has(event.category))
    .map((event) => ({
      id: event.id,
      title: event.title,
      startDate: event.startDate,
      ...(event.endDate ? { endDate: event.endDate } : {}),
      ...(event.temporalKind ? { temporalKind: event.temporalKind } : {}),
      ...(event.endTemporalKind ? { endTemporalKind: event.endTemporalKind } : {}),
      source: "calendar"
    }));
  const personalExams: HomeExamCountdownItem[] = manualExams
    .filter((exam) => exam.kind === undefined || exam.kind === "exam")
    .map((exam) => ({
    id: exam.id,
    title: exam.title,
    startDate: exam.examDate,
    temporalKind: "timestamp",
    source: "manual"
    }));
  return [...calendarExams, ...personalExams]
    .filter((exam) => isAcademicTemporalCurrentOrFuture(exam, now))
    .sort(compareAcademicTemporalStart);
}

export function orderHomeAnnouncements(
  items: readonly TrustedMobileContentRecord[]
): TrustedMobileContentRecord[] {
  return [...items].sort((left, right) => {
    const timestampDifference = announcementTimestamp(right) - announcementTimestamp(left);
    return timestampDifference || left.id.localeCompare(right.id, "tr-TR");
  });
}

export function selectImportantAnnouncement(
  items: readonly TrustedMobileContentRecord[]
): TrustedMobileContentRecord | null {
  return orderHomeAnnouncements(items.filter(isImportantAnnouncement))[0] ?? null;
}

export function isImportantAnnouncement(item: TrustedMobileContentRecord): boolean {
  const title = item.title.normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/\s+/gu, " ").trim();
  return IMPORTANT_ANNOUNCEMENT_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

export function selectRecentAnnouncements(
  items: readonly TrustedMobileContentRecord[],
  importantId?: string
): TrustedMobileContentRecord[] {
  const qualifiedImportantId = importantId && items.some(
    (item) => item.id === importantId && isImportantAnnouncement(item)
  ) ? importantId : undefined;
  return orderHomeAnnouncements(items)
    .filter((item) => item.id !== qualifiedImportantId)
    .slice(0, HOME_RECENT_ANNOUNCEMENT_LIMIT);
}

export function resolveHomePrimaryState(input: {
  profileComplete: boolean;
  loading: boolean;
  attempted: boolean;
  hasData: boolean;
  error?: string;
  contentState?: ContentCollectionState;
  offline?: boolean;
}): HomePrimaryState {
  if (!input.profileComplete) return "incomplete_profile";
  if (input.loading && !input.hasData) return "initial_loading";
  if (input.hasData) return "populated";
  if (input.offline) return "offline_no_data";
  if (input.contentState === "partial") return "partial_no_data";
  if (input.error) return "recoverable_error";
  if (input.attempted) return "empty";
  return "initial_loading";
}

export function homeAvailability(input: {
  loading: boolean;
  hasRetainedData: boolean;
  error?: string;
  stale?: boolean;
  contentState?: ContentCollectionState;
  offline?: boolean;
}): "refreshing" | "offline" | "stale" | "partial" | "ready" {
  if (input.offline) return "offline";
  if (input.loading && input.hasRetainedData) return "refreshing";
  if (input.stale || (input.error && input.hasRetainedData) || input.contentState === "stale") return "stale";
  if (input.contentState === "partial") return "partial";
  return "ready";
}

export function resolveActionableIntegration(input: {
  profileComplete: boolean;
  googleCalendarState: string;
  notificationPermission: string;
  notificationPreferenceEnabled: boolean;
  notificationActive: boolean;
}): "google_calendar" | "notifications" | null {
  if (!input.profileComplete) return null;
  if (input.notificationPermission === "permanently_denied"
    || (input.notificationPreferenceEnabled && !input.notificationActive)) return "notifications";
  if (["disconnected", "expired", "error"].includes(input.googleCalendarState)) {
    return "google_calendar";
  }
  return null;
}

export function resolveHomeLayout(width: number, fontScale: number): {
  gutter: number;
  maxWidth: number;
  columns: 1;
  supportsLargeText: boolean;
} {
  return {
    gutter: width < 375 ? 16 : 20,
    maxWidth: 720,
    columns: 1,
    supportsLargeText: fontScale >= 2,
  };
}

export function formatRemainingTime(
  date: string,
  now: Date,
  endDate?: string,
  temporalKind?: AcademicTemporalKind,
  endTemporalKind?: AcademicTemporalKind
): string {
  return formatAcademicRemainingTime({
    startDate: date,
    ...(endDate ? { endDate } : {}),
    ...(temporalKind ? { temporalKind } : {}),
    ...(endTemporalKind ? { endTemporalKind } : {})
  }, now);
}

function toImportantItem(event: HomeAcademicEvent): HomeImportantItem {
  const category = event.category;
  const kind = category.includes("exam")
    ? "exam"
    : category.includes("registration") || category.includes("renewal") || category.includes("add_drop")
      ? "registration"
      : category.includes("deadline") || category.includes("application")
        ? "deadline"
        : "event";
  return {
    id: event.id,
    title: event.title,
    category,
    date: event.startDate,
    ...(event.courseName ? { courseName: event.courseName } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.temporalKind ? { temporalKind: event.temporalKind } : {}),
    ...(event.endTemporalKind ? { endTemporalKind: event.endTemporalKind } : {}),
    ...(event.timezone ? { timezone: event.timezone } : {}),
    kind
  };
}

function compareImportantItems(left: HomeImportantItem, right: HomeImportantItem): number {
  const dateDifference = compareAcademicTemporalStart(
    { startDate: left.date, ...(left.temporalKind ? { temporalKind: left.temporalKind } : {}) },
    { startDate: right.date, ...(right.temporalKind ? { temporalKind: right.temporalKind } : {}) }
  );
  if (dateDifference) return dateDifference;
  const priorityDifference = (IMPORTANT_CATEGORY_ORDER.get(left.category) ?? 9)
    - (IMPORTANT_CATEGORY_ORDER.get(right.category) ?? 9);
  return priorityDifference || left.id.localeCompare(right.id, "tr-TR");
}

function announcementTimestamp(item: TrustedMobileContentRecord): number {
  if (item.publicationKind === "date" && item.publishedDate) {
    const dateOnly = parseDateOnly(item.publishedDate);
    if (dateOnly) return Date.UTC(dateOnly.year, dateOnly.month - 1, dateOnly.day, 12);
  }
  return Date.parse(item.publishedAt ?? item.sourceUpdatedAt ?? "") || 0;
}

function calendarDayNumber(value: string): number | null {
  const dateOnly = parseDateOnly(value);
  if (dateOnly) return Date.UTC(dateOnly.year, dateOnly.month - 1, dateOnly.day);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : localCalendarDayNumber(date);
}

function localCalendarDayNumber(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}
