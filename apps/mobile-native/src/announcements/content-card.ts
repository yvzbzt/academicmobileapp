import {
  admitTrustedContentRecord,
  canonicalizeOfficialAcademicUrl,
  normalizeDisplayText,
  type TrustedMobileContentRecord,
} from "../content/content-trust";

/** Long source copy belongs on the university page, not in a compact feed card. */
export const CONTENT_CARD_EXCERPT_MAX_LENGTH = 280;

export type ContentKeyDateKind = "deadline" | "range" | "start" | "single";

type ContentKeyDate = NonNullable<TrustedMobileContentRecord["keyDates"]>[number];

export interface ContentKeyDatePresentation {
  kind: ContentKeyDateKind;
  text: string;
}

export type TrustedContentOpenTarget =
  | { kind: "detail" }
  | { kind: "official_source"; url: string };

export function shortContentCardExcerpt(
  record: Pick<TrustedMobileContentRecord, "summary">,
): string | null {
  const summary = normalizeDisplayText(record.summary);
  return summary.length > 0 && summary.length <= CONTENT_CARD_EXCERPT_MAX_LENGTH
    ? summary
    : null;
}

/** Re-admits the record before returning its exact official content destination. */
export function trustedContentDestinationUrl(
  record: TrustedMobileContentRecord,
): string | null {
  const trusted = admitTrustedContentRecord(record);
  if (!trusted) return null;
  return canonicalizeOfficialAcademicUrl(trusted.canonicalUrl)
    ?? canonicalizeOfficialAcademicUrl(trusted.link);
}

/**
 * Rich source-owned fields justify an in-app detail screen. Title-only records
 * hand off to the exact canonical item URL instead of showing an empty shell.
 */
export function resolveTrustedContentOpenTarget(
  record: TrustedMobileContentRecord,
): TrustedContentOpenTarget | null {
  const trusted = admitTrustedContentRecord(record);
  if (!trusted) return null;
  const hasSummary = normalizeDisplayText(trusted.summary).length > 0;
  const hasBody = (trusted.body ?? []).some((block) => normalizeDisplayText(block.text).length > 0);
  const hasKeyDates = (trusted.keyDates ?? []).length > 0;
  if (hasSummary || hasBody || hasKeyDates) return { kind: "detail" };
  const url = trustedContentDestinationUrl(trusted);
  return url ? { kind: "official_source", url } : null;
}

export function officialContentDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "Resmî kaynak";
  }
}

/**
 * `endDate` describes a real range; it never means "deadline" by itself.
 * Deadline/start roles are admitted only when the source-derived label says so.
 */
export function classifyContentKeyDate(keyDate: ContentKeyDate): ContentKeyDateKind {
  const label = normalizeDisplayText(keyDate.label).toLocaleLowerCase("tr-TR");
  if (/(?:son\s+(?:başvuru|kayıt|teslim|ödeme|gün|tarih)|(?:başvuru|kayıt|teslim|ödeme|onay|tercih)(?:\s+[\p{L}\d]+){0,2}\s+(?:son|bitiş)(?:\s+(?:günü|tarihi))?|deadline)/iu.test(label)) {
    return "deadline";
  }
  if (keyDate.endDate && keyDate.endDate !== keyDate.startDate) return "range";
  if (/(?:başlangıç|başlama|başlayacağı|başlayacaktır)/iu.test(label)) return "start";
  return "single";
}

export function primaryContentKeyDate(
  record: Pick<TrustedMobileContentRecord, "keyDates">,
): ContentKeyDatePresentation | null {
  const dates = record.keyDates ?? [];
  const keyDate = dates.find((candidate) => classifyContentKeyDate(candidate) === "deadline")
    ?? dates[0];
  if (!keyDate) return null;

  const kind = classifyContentKeyDate(keyDate);
  const label = normalizeDisplayText(keyDate.label)
    || (kind === "deadline"
      ? "Son tarih"
      : kind === "range"
        ? "Tarih aralığı"
        : kind === "start"
          ? "Başlangıç"
          : "Tarih");
  return {
    kind,
    text: `${label} · ${formatContentKeyDateRange(keyDate.startDate, keyDate.endDate)}`,
  };
}

export function formatContentKeyDateRange(startDate: string, endDate?: string): string {
  const start = formatContentKeyDate(startDate);
  const end = endDate && endDate !== startDate ? formatContentKeyDate(endDate) : null;
  return end ? `${start} – ${end}` : start;
}

function formatContentKeyDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
