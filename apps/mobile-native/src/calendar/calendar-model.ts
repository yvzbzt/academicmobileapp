import {
  academicCalendarDayNumber,
  addCalendarDays,
  compareAcademicTemporalStart,
  isDateOnlyValue,
  type AcademicTemporalKind,
} from "../temporal/academic-temporal";

export type CalendarViewMode = "day" | "agenda" | "week" | "month";

export type CalendarClassification =
  | "personal_exam"
  | "exam"
  | "registration"
  | "holiday"
  | "academic";

export interface CalendarAcademicEvent {
  id: string;
  title: string;
  category: string;
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  description?: string;
  location?: string;
}

export interface CalendarPersonalExam {
  id: string;
  title: string;
  examDate: string;
  locationNote?: string;
}

export interface CalendarItem {
  key: string;
  routeId: string;
  id: string;
  title: string;
  category: string;
  classification: CalendarClassification;
  classificationLabel: string;
  icon:
    | "school-outline"
    | "document-text-outline"
    | "flag-outline"
    | "sunny-outline"
    | "calendar-outline";
  source: "academic" | "personal";
  sourceLabel: string;
  startDate: string;
  endDate?: string;
  temporalKind: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  description?: string;
  location?: string;
}

export type CalendarPresentationState =
  | "loading"
  | "refreshing"
  | "populated"
  | "empty"
  | "stale"
  | "partial"
  | "offline"
  | "error";

export interface CalendarPeriod {
  start: string;
  end: string;
  label: string;
}

export interface CalendarDaySummary {
  date: string;
  dayNumber: number;
  inPeriod: boolean;
  itemCount: number;
  classifications: CalendarClassification[];
}

export interface PersonalExamDraft {
  title: string;
  date: string | null;
  time: string | null;
  locationNote?: string;
}

export interface PersonalExamDraftErrors {
  title?: string;
  date?: string;
  time?: string;
}

const EXAM_CATEGORIES = new Set([
  "midterm_exam",
  "final_exam",
  "makeup_exam",
  "single_course_exam",
  "department_exam_schedule",
]);

const REGISTRATION_CATEGORIES = new Set([
  "course_registration",
  "course_renewal",
  "course_add_drop",
  "graduation_application",
  "tuition_payment",
  "horizontal_transfer",
  "summer_school_registration",
]);

export const CALENDAR_VIEW_OPTIONS = [
  { value: "agenda", label: "Ajanda" },
  { value: "week", label: "Hafta" },
  { value: "month", label: "Ay" },
] as const;

export const ACADEMIC_CALENDAR_VIEW_OPTIONS = [
  { value: "day", label: "Gün" },
  { value: "week", label: "Hafta" },
  { value: "month", label: "Ay" },
  { value: "agenda", label: "Ajanda" },
] as const;

export function selectUniversityAcademicCalendarEvents(
  events: readonly CalendarAcademicEvent[],
): CalendarAcademicEvent[] {
  return events.filter((event) => (
    !event.facultyId
    && !event.departmentId
    && event.category !== "course_schedule"
    && event.category !== "department_exam_schedule"
  ));
}

export function buildCalendarItems(input: {
  academicEvents: readonly CalendarAcademicEvent[];
  personalExams: readonly CalendarPersonalExam[];
  academicSourceLabel: string;
}): CalendarItem[] {
  const academic = input.academicEvents.flatMap((event): CalendarItem[] => {
    const id = cleanText(event.id);
    const title = cleanText(event.title);
    const category = cleanText(event.category);
    if (!id || !title || !category || academicCalendarDayNumber(event.startDate) === null) return [];
    if (event.endDate && academicCalendarDayNumber(event.endDate) === null) return [];
    const classification = classifyCalendarCategory(category);
    const temporalKind = event.temporalKind
      ?? (isDateOnlyValue(event.startDate) ? "date" : "timestamp");
    const endTemporalKind = event.endDate
      ? event.endTemporalKind ?? (isDateOnlyValue(event.endDate) ? "date" : temporalKind)
      : undefined;
    const description = event.description ? cleanText(event.description) : null;
    const location = event.location ? cleanText(event.location) : null;
    return [{
      key: `academic:${id}`,
      routeId: id,
      id,
      title,
      category,
      classification,
      classificationLabel: classificationLabel(classification),
      icon: classificationIcon(classification),
      source: "academic",
      sourceLabel: cleanText(input.academicSourceLabel) ?? "Resmî akademik takvim",
      startDate: event.startDate,
      ...(event.endDate ? { endDate: event.endDate } : {}),
      temporalKind,
      ...(endTemporalKind ? { endTemporalKind } : {}),
      ...(event.timezone ? { timezone: event.timezone } : {}),
      ...(event.universityId ? { universityId: event.universityId } : {}),
      ...(event.facultyId ? { facultyId: event.facultyId } : {}),
      ...(event.departmentId ? { departmentId: event.departmentId } : {}),
      ...(description ? { description } : {}),
      ...(location ? { location } : {}),
    }];
  });

  const personal = input.personalExams.flatMap((exam): CalendarItem[] => {
    const id = cleanText(exam.id);
    const title = cleanText(exam.title);
    const location = exam.locationNote ? cleanText(exam.locationNote) : null;
    if (!id || !title || !Number.isFinite(Date.parse(exam.examDate))) return [];
    return [{
      key: `personal:${id}`,
      routeId: `personal:${id}`,
      id,
      title,
      category: "personal_exam",
      classification: "personal_exam",
      classificationLabel: classificationLabel("personal_exam"),
      icon: classificationIcon("personal_exam"),
      source: "personal",
      sourceLabel: "Kişisel planın",
      startDate: exam.examDate,
      temporalKind: "timestamp",
      ...(location ? { location } : {}),
    }];
  });

  return [...academic, ...personal].sort((left, right) => {
    const temporalDifference = compareAcademicTemporalStart(left, right);
    return temporalDifference || left.key.localeCompare(right.key, "tr-TR");
  });
}

export function classifyCalendarCategory(category: string): CalendarClassification {
  if (category === "personal_exam") return "personal_exam";
  if (EXAM_CATEGORIES.has(category) || category.includes("exam")) return "exam";
  if (REGISTRATION_CATEGORIES.has(category)
    || category.includes("registration")
    || category.includes("application")) return "registration";
  if (category === "holiday") return "holiday";
  return "academic";
}

export function classificationLabel(classification: CalendarClassification): string {
  switch (classification) {
    case "personal_exam": return "Kişisel sınav";
    case "exam": return "Sınav";
    case "registration": return "Son Başvuru";
    case "holiday": return "Tatil";
    case "academic": return "Etkinlik";
  }
}

export function classificationIcon(classification: CalendarClassification): CalendarItem["icon"] {
  switch (classification) {
    case "personal_exam": return "school-outline";
    case "exam": return "document-text-outline";
    case "registration": return "flag-outline";
    case "holiday": return "sunny-outline";
    case "academic": return "calendar-outline";
  }
}

export function resolveCalendarPresentationState(input: {
  loading: boolean;
  attempted: boolean;
  hasItems: boolean;
  error?: string;
  stale?: boolean;
  partial?: boolean;
  offline?: boolean;
}): CalendarPresentationState {
  if (input.hasItems) {
    if (input.offline) return "offline";
    if (input.loading) return "refreshing";
    if (input.partial) return "partial";
    if (input.stale || input.error) return "stale";
    return "populated";
  }
  if (input.loading || !input.attempted) return "loading";
  if (input.offline) return "offline";
  if (input.partial) return "partial";
  if (input.error) return "error";
  return "empty";
}

export function todayDateOnly(now = new Date()): string {
  return formatDateParts(now, "Europe/Istanbul");
}

export function calendarPeriod(view: Exclude<CalendarViewMode, "agenda">, anchorDate: string): CalendarPeriod {
  const anchor = validDateOnly(anchorDate) ?? todayDateOnly();
  if (view === "day") {
    return { start: anchor, end: anchor, label: formatCalendarDayHeading(anchor) };
  }
  if (view === "week") {
    const weekday = weekdayMondayFirst(anchor);
    const start = addCalendarDays(anchor, -weekday) ?? anchor;
    const end = addCalendarDays(start, 6) ?? start;
    return { start, end, label: formatPeriodLabel(start, end) };
  }
  const { year, month } = dateOnlyParts(anchor)!;
  const start = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  const nextMonth = month === 12
    ? `${year + 1}-01-01`
    : `${year.toString().padStart(4, "0")}-${(month + 1).toString().padStart(2, "0")}-01`;
  const end = addCalendarDays(nextMonth, -1) ?? start;
  return {
    start,
    end,
    label: new Intl.DateTimeFormat("tr-TR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(dateOnlyAtNoonUtc(start)),
  };
}

export function moveCalendarAnchor(
  view: Exclude<CalendarViewMode, "agenda">,
  anchorDate: string,
  direction: -1 | 1,
): string {
  const anchor = validDateOnly(anchorDate) ?? todayDateOnly();
  if (view === "day") return addCalendarDays(anchor, direction) ?? anchor;
  if (view === "week") return addCalendarDays(anchor, direction * 7) ?? anchor;
  const parts = dateOnlyParts(anchor)!;
  const moved = new Date(Date.UTC(parts.year, parts.month - 1 + direction, 1, 12));
  const month = moved.getUTCMonth() + 1;
  const day = Math.min(parts.day, daysInMonth(moved.getUTCFullYear(), month));
  return `${moved.getUTCFullYear().toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function selectCalendarItemsForView(input: {
  items: readonly CalendarItem[];
  view: CalendarViewMode;
  anchorDate: string;
  now?: Date;
}): CalendarItem[] {
  if (input.view === "agenda") {
    const today = academicCalendarDayNumber(todayDateOnly(input.now));
    return input.items.filter((item) => {
      const end = academicCalendarDayNumber(item.endDate ?? item.startDate);
      return today !== null && end !== null && end >= today;
    });
  }
  const period = calendarPeriod(input.view, input.anchorDate);
  return input.items.filter((item) => calendarItemOverlapsPeriod(item, period.start, period.end));
}

export function buildWeekSummary(
  items: readonly CalendarItem[],
  anchorDate: string,
): CalendarDaySummary[] {
  const period = calendarPeriod("week", anchorDate);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addCalendarDays(period.start, index) ?? period.start;
    return daySummary(date, true, items);
  });
}

export function buildMonthSummary(
  items: readonly CalendarItem[],
  anchorDate: string,
): CalendarDaySummary[] {
  const period = calendarPeriod("month", anchorDate);
  const leadingDays = weekdayMondayFirst(period.start);
  const gridStart = addCalendarDays(period.start, -leadingDays) ?? period.start;
  return Array.from({ length: 42 }, (_, index) => {
    const date = addCalendarDays(gridStart, index) ?? gridStart;
    return daySummary(date, date >= period.start && date <= period.end, items);
  });
}

export function calendarItemStartDateOnly(item: CalendarItem): string {
  if (item.temporalKind === "date" || isDateOnlyValue(item.startDate)) {
    return validDateOnly(item.startDate) ?? todayDateOnly();
  }
  const parsed = new Date(item.startDate);
  return Number.isNaN(parsed.getTime()) ? todayDateOnly() : formatDateParts(parsed, "Europe/Istanbul");
}

export function formatCalendarDayHeading(date: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateOnlyAtNoonUtc(date));
}

export function formatCalendarCompactDay(date: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateOnlyAtNoonUtc(date));
}

export function emptyPersonalExamDraft(): PersonalExamDraft {
  return { title: "", date: null, time: null, locationNote: "" };
}

export function personalExamDraftFromRecord(exam: CalendarPersonalExam): PersonalExamDraft {
  const date = new Date(exam.examDate);
  if (Number.isNaN(date.getTime())) {
    return { title: exam.title, date: null, time: null, locationNote: exam.locationNote ?? "" };
  }
  return {
    title: exam.title,
    date: localDateOnly(date),
    time: `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`,
    locationNote: exam.locationNote ?? "",
  };
}

export function validatePersonalExamDraft(draft: PersonalExamDraft): PersonalExamDraftErrors {
  const errors: PersonalExamDraftErrors = {};
  if (!cleanText(draft.title)) errors.title = "Sınav adı zorunludur.";
  if (!draft.date || !validDateOnly(draft.date)) errors.date = "Tarihi sistem seçicisinden seç.";
  if (!draft.time || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(draft.time)) {
    errors.time = "Saati sistem seçicisinden seç.";
  }
  return errors;
}

export function composePersonalExamTimestamp(draft: PersonalExamDraft): string | null {
  if (Object.keys(validatePersonalExamDraft(draft)).length > 0) return null;
  const parts = dateOnlyParts(draft.date!);
  const [hours, minutes] = draft.time!.split(":").map(Number);
  if (!parts) return null;
  const value = new Date(parts.year, parts.month - 1, parts.day, hours, minutes, 0, 0);
  if (value.getFullYear() !== parts.year
    || value.getMonth() !== parts.month - 1
    || value.getDate() !== parts.day
    || value.getHours() !== hours
    || value.getMinutes() !== minutes) return null;
  return value.toISOString();
}

export function selectionDateFromDraft(draft: PersonalExamDraft, fallback = new Date()): Date {
  const date = draft.date ? dateOnlyParts(draft.date) : null;
  const time = draft.time && /^([01]\d|2[0-3]):[0-5]\d$/u.test(draft.time)
    ? draft.time.split(":").map(Number)
    : [fallback.getHours(), fallback.getMinutes()];
  return date
    ? new Date(date.year, date.month - 1, date.day, time[0], time[1], 0, 0)
    : new Date(fallback);
}

export function applyDateSelection(draft: PersonalExamDraft, selected: Date): PersonalExamDraft {
  return { ...draft, date: localDateOnly(selected) };
}

export function applyTimeSelection(draft: PersonalExamDraft, selected: Date): PersonalExamDraft {
  return {
    ...draft,
    time: `${selected.getHours().toString().padStart(2, "0")}:${selected.getMinutes().toString().padStart(2, "0")}`,
  };
}

export function formatSelectedDate(date: string | null): string {
  if (!date || !validDateOnly(date)) return "Tarih seçilmedi";
  const value = dateOnlyAtNoonUtc(date);
  const dateLabel = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
  const weekdayLabel = new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    timeZone: "UTC",
  }).format(value);
  return `${dateLabel}, ${weekdayLabel}`;
}

export function formatSelectedTime(time: string | null): string {
  return time ?? "Saat seçilmedi";
}

function calendarItemOverlapsPeriod(item: CalendarItem, startDate: string, endDate: string): boolean {
  const itemStart = academicCalendarDayNumber(item.startDate);
  const itemEnd = academicCalendarDayNumber(item.endDate ?? item.startDate);
  const rangeStart = academicCalendarDayNumber(startDate);
  const rangeEnd = academicCalendarDayNumber(endDate);
  return itemStart !== null
    && itemEnd !== null
    && rangeStart !== null
    && rangeEnd !== null
    && itemStart <= rangeEnd
    && itemEnd >= rangeStart;
}

function daySummary(
  date: string,
  inPeriod: boolean,
  items: readonly CalendarItem[],
): CalendarDaySummary {
  const matching = items.filter((item) => calendarItemOverlapsPeriod(item, date, date));
  return {
    date,
    dayNumber: dateOnlyParts(date)?.day ?? 0,
    inPeriod,
    itemCount: matching.length,
    classifications: [...new Set(matching.map((item) => item.classification))],
  };
}

function formatPeriodLabel(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(dateOnlyAtNoonUtc(start))} – ${formatter.format(dateOnlyAtNoonUtc(end))}`;
}

function weekdayMondayFirst(date: string): number {
  const weekday = dateOnlyAtNoonUtc(date).getUTCDay();
  return weekday === 0 ? 6 : weekday - 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDateOnly(value: string): string | null {
  return dateOnlyParts(value) ? value : null;
}

function dateOnlyParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day) return null;
  return { year, month, day };
}

function dateOnlyAtNoonUtc(value: string): Date {
  const parts = dateOnlyParts(value) ?? dateOnlyParts(todayDateOnly())!;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
}

function formatDateParts(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localDateOnly(value: Date): string {
  return `${value.getFullYear().toString().padStart(4, "0")}-${(value.getMonth() + 1).toString().padStart(2, "0")}-${value.getDate().toString().padStart(2, "0")}`;
}

function cleanText(value: string): string | null {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized || null;
}
