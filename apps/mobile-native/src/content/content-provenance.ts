import {
  normalizeDisplayText,
  type TrustedMobileContentRecord,
} from "./content-trust";

const CONTENT_TYPE_LABELS = {
  announcement: "Duyuru",
  news: "Haber",
  event: "Etkinlik",
} as const;

const OPEN_ACTION_LABELS = {
  announcement: "Resmî duyuruyu aç",
  news: "Resmî haberi aç",
  event: "Resmî etkinliği aç",
} as const;

const DETAIL_ACTION_LABELS = {
  announcement: "Duyuru ayrıntısını aç",
  news: "Haber ayrıntısını aç",
  event: "Etkinlik ayrıntısını aç",
} as const;

const SCOPE_LABELS = {
  university: "Üniversite geneli",
  faculty: "Fakülte",
  department: "Bölüm",
} as const;

export function contentTypeLabel(
  record: Pick<TrustedMobileContentRecord, "contentType">,
): string {
  return CONTENT_TYPE_LABELS[record.contentType ?? "announcement"];
}

/** One compact, authoritative origin line suitable for every trusted-content card. */
export function compactContentProvenanceLabel(
  record: Pick<
    TrustedMobileContentRecord,
    "scopeType" | "universityName" | "facultyName" | "departmentName"
  >,
): string {
  const universityName = normalizeDisplayText(record.universityName);
  const unitName = record.scopeType === "faculty"
    ? normalizeDisplayText(record.facultyName)
    : record.scopeType === "department"
      ? normalizeDisplayText(record.departmentName)
      : "";

  return [
    universityName || null,
    SCOPE_LABELS[record.scopeType],
    unitName || null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

export function officialContentOpenActionLabel(
  record: Pick<TrustedMobileContentRecord, "contentType">,
): string {
  return OPEN_ACTION_LABELS[record.contentType ?? "announcement"];
}

export function contentDetailOpenActionLabel(
  record: Pick<TrustedMobileContentRecord, "contentType">,
): string {
  return DETAIL_ACTION_LABELS[record.contentType ?? "announcement"];
}
