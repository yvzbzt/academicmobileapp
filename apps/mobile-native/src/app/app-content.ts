import {
  normalizeDisplayText,
  isNavigationContentTitle,
  canonicalizeOfficialAcademicUrl,
  normalizeTrustedApiContentCollection,
  type ContentCollectionState,
  type TrustedContentCollection,
  type TrustedMobileContentRecord,
  normalizeTrustedContentCollection,
} from "../content/content-trust";
import { normalizeLegacyAllDayCalendarEvent } from "../calendar/calendar-display-normalization";
import {
  resolveContentFeedHasMore,
  type ContentFeedItem,
  buildContentFeed,
} from "../announcements/feed-model";
import {
  type EventRecord,
  type CalendarPayload,
  type SummerSchoolApiPayload,
  type SummerSchoolPayload,
  type AnnouncementRecord,
} from "./app-types";
import { CATEGORY_LABELS } from "./app-config";

export function formatRemainingDuration(targetIsoDate: string): string {
  const target = Date.parse(targetIsoDate);
  if (Number.isNaN(target)) return "tarih hatalı";

  const deltaMs = target - Date.now();
  if (deltaMs <= 0) return "bugün";

  const totalHours = Math.floor(deltaMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days === 0) return `${hours} sa kaldı`;
  return `${days} gün ${hours} sa kaldı`;
}

export function toCategoryLabel(category: string): string {
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  return category.split("_").join(" ");
}

export function formatDateShort(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

export function formatDateTimeShort(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function normalizeEventRecordsForDisplay(events: EventRecord[]): EventRecord[] {
  return events.flatMap((event) => {
    const title = normalizeDisplayText(event.title);
    if (!title || isNavigationContentTitle(title)) return [];
    const courseName = normalizeDisplayText(event.courseName).slice(0, 240).trim();
    const description = normalizeDisplayText(event.description).slice(0, 2_000).trim();
    const location = normalizeDisplayText(event.location).slice(0, 240).trim();
    const {
      courseName: _courseName,
      description: _description,
      location: _location,
      ...baseEvent
    } = event;
    return [normalizeLegacyAllDayCalendarEvent({
      ...baseEvent,
      title,
      ...(courseName ? { courseName } : {}),
      ...(description ? { description } : {}),
      ...(location ? { location } : {})
    })];
  });
}

export function normalizeCalendarPayloadForDisplay(payload: CalendarPayload): CalendarPayload {
  const { sourceUrl: rawSourceUrl, ...calendarRecord } = payload.calendar;
  const sourceUrl = canonicalizeOfficialAcademicUrl(rawSourceUrl);
  return {
    ...payload,
    calendar: {
      ...calendarRecord,
      title: normalizeDisplayText(payload.calendar.title) || "Akademik takvim",
      ...(sourceUrl ? { sourceUrl } : {})
    },
    events: normalizeEventRecordsForDisplay(payload.events)
  };
}

export function normalizeSummerSchoolPayloadForDisplay(payload: SummerSchoolApiPayload): SummerSchoolPayload {
  const ownAnnouncements = normalizeTrustedApiContentCollection(payload.ownAnnouncements);
  const sameDepartmentAnnouncements = normalizeTrustedApiContentCollection(payload.sameDepartmentAnnouncements);
  let omittedContentCount = 0;

  const requirements = payload.requirements.flatMap((requirement) => {
    const message = normalizeDisplayText(requirement.message);
    if (!message || isNavigationContentTitle(message)) {
      omittedContentCount += 1;
      return [];
    }
    const { sourceUrl: rawSourceUrl, ...safeRequirement } = requirement;
    const sourceUrl = canonicalizeOfficialAcademicUrl(rawSourceUrl);
    if (rawSourceUrl && !sourceUrl) omittedContentCount += 1;
    return [{
      ...safeRequirement,
      message,
      ...(sourceUrl ? { sourceUrl } : {})
    }];
  });

  const sameDepartmentOptions = payload.sameDepartmentOptions.map((option) => {
    const { sourceUrl: rawSourceUrl, ...safeOption } = option;
    const sourceUrl = canonicalizeOfficialAcademicUrl(rawSourceUrl);
    if (rawSourceUrl && !sourceUrl) omittedContentCount += 1;
    const events = normalizeEventRecordsForDisplay(option.events);
    omittedContentCount += option.events.length - events.length;
    const matchingDepartments = option.matchingDepartments?.map((match) => ({
      ...match,
      facultyName: normalizeDisplayText(match.facultyName) || "Fakülte",
      departmentName: normalizeDisplayText(match.departmentName) || "Bölüm"
    }));
    return {
      ...safeOption,
      universityName: normalizeDisplayText(option.universityName) || "Üniversite",
      events,
      ...(matchingDepartments ? { matchingDepartments } : {}),
      ...(sourceUrl ? { sourceUrl } : {})
    };
  });

  const announcementCollections = [ownAnnouncements, sameDepartmentAnnouncements];
  const announcementItems = announcementCollections.flatMap((collection) => collection.items);
  const hasStale = announcementItems.some((item) => item.freshness === "stale");
  const hasFresh = announcementItems.some((item) => item.freshness !== "stale");
  const contentState: ContentCollectionState = omittedContentCount > 0
    || announcementCollections.some((collection) => collection.state === "partial")
    || payload.announcementStatus?.state === "partial"
    || (payload.announcementStatus?.failedSourceCount ?? 0) > 0
    || (hasFresh && hasStale)
    ? "partial"
    : hasStale || payload.announcementStatus?.state === "stale"
      ? "stale"
      : "fresh";

  const profile = payload.profile;
  return {
    ...payload,
    profile: {
      universityId: profile.universityId,
      ...(profile.universityName ? { universityName: normalizeDisplayText(profile.universityName) } : {}),
      ...(profile.facultyId ? { facultyId: profile.facultyId } : {}),
      ...(profile.facultyName ? { facultyName: normalizeDisplayText(profile.facultyName) } : {}),
      ...(profile.departmentId ? { departmentId: profile.departmentId } : {}),
      ...(profile.departmentName ? { departmentName: normalizeDisplayText(profile.departmentName) } : {})
    },
    requirements,
    ownAnnouncements: ownAnnouncements.items,
    sameDepartmentAnnouncements: sameDepartmentAnnouncements.items,
    sameDepartmentOptions,
    contentState
  };
}

export function contentAvailabilityMessage(state: ContentCollectionState | undefined, retainedAfterError: boolean | undefined): string | null {
  if (retainedAfterError) return "Yenileme tamamlanamadı. Son doğrulanmış içerik gösteriliyor.";
  if (state === "partial") return "Bazı kaynaklar doğrulanamadı. Kullanılabilir resmî içerik gösteriliyor.";
  if (state === "stale") return "Kaynakların son doğrulanmış içeriği gösteriliyor.";
  return null;
}

export function trustedContentCollectionHasMore(
  collection: TrustedContentCollection | undefined,
  requestedLimit: number
): boolean {
  return Boolean(collection && resolveContentFeedHasMore({
    requestedLimit,
    nextCursor: collection.nextCursor,
    hasMore: collection.hasMore,
    explicitRawCount: collection.explicitRawCount,
    rawItemCount: collection.rawItemCount
  }));
}

export function appendTrustedContentItems(
  collection: TrustedContentCollection | undefined,
  items: readonly TrustedMobileContentRecord[]
): TrustedContentCollection {
  const merged = normalizeTrustedContentCollection([...(collection?.items ?? []), ...items]);
  if (!collection) return merged;
  return {
    ...merged,
    state: collection.state,
    rawItemCount: collection.rawItemCount,
    ...(collection.explicitRawCount === undefined ? {} : { explicitRawCount: collection.explicitRawCount }),
    ...(collection.nextCursor ? { nextCursor: collection.nextCursor } : {}),
    ...(typeof collection.hasMore === "boolean" ? { hasMore: collection.hasMore } : {})
  };
}

export function contentFeedDetailItem(
  record: AnnouncementRecord,
  origin: "academic" | "yok" | "summer-school"
): ContentFeedItem | null {
  return buildContentFeed({
    academic: origin === "academic" ? [record] : [],
    yok: origin === "yok" ? [record] : [],
    summerSchool: origin === "summer-school" ? [record] : []
  })[0] ?? null;
}

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
