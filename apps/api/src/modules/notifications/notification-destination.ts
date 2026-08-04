import { createHash } from "node:crypto";
import type { AnnouncementItem, AnnouncementSourceRecord } from "../announcements/announcements.types.js";
import { createNormalizedContentFingerprint } from "../announcements/announcement-content-trust.js";
import type { AcademicEventRecord } from "../calendars/calendar.types.js";

const DESTINATION_FINGERPRINT_DOMAIN = "academic-mobile:notification-destination:v1\0";

export function announcementDestinationFingerprint(
  item: AnnouncementItem,
  source: AnnouncementSourceRecord
): string {
  const contentFingerprint = item.contentFingerprint ?? createNormalizedContentFingerprint({
    title: item.title,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.publicationKind ? { publicationKind: item.publicationKind } : {}),
    ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {})
  });
  return hashDestinationMaterial([
    "announcement",
    source.scopeType,
    source.scopeId,
    item.contentType ?? source.contentType ?? "announcement",
    contentFingerprint
  ]);
}

export function calendarDestinationFingerprint(event: AcademicEventRecord): string {
  return hashDestinationMaterial([
    "calendar_event",
    event.universityId,
    event.facultyId ?? null,
    event.departmentId ?? null,
    event.category,
    event.title,
    event.description ?? null,
    event.temporalKind ?? "timestamp",
    event.dateOnlyStart ?? event.startDate.toISOString(),
    event.endTemporalKind ?? null,
    event.dateOnlyEnd ?? event.endDate?.toISOString() ?? null,
    event.timezone
  ]);
}

function hashDestinationMaterial(material: readonly unknown[]): string {
  return createHash("sha256")
    .update(DESTINATION_FINGERPRINT_DOMAIN)
    .update(JSON.stringify(material))
    .digest("hex");
}
