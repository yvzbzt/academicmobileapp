import type { ContentCollectionState, TrustedMobileContentRecord } from "../content/content-trust";

export const HOME_RECENT_ANNOUNCEMENT_LIMIT = 3;

export interface HomeAcademicEvent {
  id: string;
  title: string;
  category: string;
  startDate: string;
  endDate?: string;
}

export interface HomeManualExam {
  id: string;
  title: string;
  examDate: string;
}

export interface HomeImportantItem {
  id: string;
  title: string;
  category: string;
  date: string;
  kind: "exam" | "deadline" | "registration" | "event";
}

export type HomePrimaryState =
  | "incomplete_profile"
  | "initial_loading"
  | "populated"
  | "empty"
  | "recoverable_error";

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
  const candidate = new Date(value);
  return !Number.isNaN(candidate.getTime())
    && candidate.getFullYear() === now.getFullYear()
    && candidate.getMonth() === now.getMonth()
    && candidate.getDate() === now.getDate();
}

export function selectTodayItems(
  events: readonly HomeAcademicEvent[],
  manualExams: readonly HomeManualExam[],
  now: Date
): HomeImportantItem[] {
  const academic = events
    .filter((event) => isSameLocalCalendarDay(event.startDate, now))
    .map(toImportantItem);
  const personal = manualExams
    .filter((exam) => isSameLocalCalendarDay(exam.examDate, now))
    .map((exam) => ({
      id: exam.id,
      title: exam.title,
      category: "personal_exam",
      date: exam.examDate,
      kind: "exam" as const,
    }));
  return [...academic, ...personal].sort(compareImportantItems);
}

export function selectNearestImportantItem(
  events: readonly HomeAcademicEvent[],
  manualExams: readonly HomeManualExam[],
  now: Date
): HomeImportantItem | null {
  const candidates = [
    ...events.map(toImportantItem),
    ...manualExams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      category: "personal_exam",
      date: exam.examDate,
      kind: "exam" as const,
    })),
  ].filter((item) => {
    const time = Date.parse(item.date);
    return !Number.isNaN(time) && time >= now.getTime();
  });
  return candidates.sort(compareImportantItems)[0] ?? null;
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
  return orderHomeAnnouncements(items)[0] ?? null;
}

export function selectRecentAnnouncements(
  items: readonly TrustedMobileContentRecord[],
  importantId?: string
): TrustedMobileContentRecord[] {
  return orderHomeAnnouncements(items)
    .filter((item) => item.id !== importantId)
    .slice(0, HOME_RECENT_ANNOUNCEMENT_LIMIT);
}

export function resolveHomePrimaryState(input: {
  profileComplete: boolean;
  loading: boolean;
  attempted: boolean;
  hasData: boolean;
  error?: string;
}): HomePrimaryState {
  if (!input.profileComplete) return "incomplete_profile";
  if (input.loading && !input.hasData) return "initial_loading";
  if (input.hasData) return "populated";
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

export function formatRemainingTime(date: string, now: Date): string {
  const difference = Date.parse(date) - now.getTime();
  if (!Number.isFinite(difference) || difference < 0) return "Süresi geçti";
  const minutes = Math.ceil(difference / 60_000);
  if (minutes < 60) return `${minutes} dakika kaldı`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} saat kaldı`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? "Yarın" : `${days} gün kaldı`;
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
  return { id: event.id, title: event.title, category, date: event.startDate, kind };
}

function compareImportantItems(left: HomeImportantItem, right: HomeImportantItem): number {
  const dateDifference = Date.parse(left.date) - Date.parse(right.date);
  if (dateDifference) return dateDifference;
  const priorityDifference = (IMPORTANT_CATEGORY_ORDER.get(left.category) ?? 9)
    - (IMPORTANT_CATEGORY_ORDER.get(right.category) ?? 9);
  return priorityDifference || left.id.localeCompare(right.id, "tr-TR");
}

function announcementTimestamp(item: TrustedMobileContentRecord): number {
  return Date.parse(item.publishedAt ?? item.sourceUpdatedAt ?? "") || 0;
}
