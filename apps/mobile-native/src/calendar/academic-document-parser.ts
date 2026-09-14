import { isNavigationContentTitle, normalizeDisplayText } from "../content/content-trust";
import type { DeviceAcademicPdfSource, EventRecord } from "../app/app-types";

type ScheduleKind = "course_schedule" | "exam_schedule";

interface ScheduleCandidate {
  rowNumber: number;
  rawText: string;
  title: string;
  date?: string;
  dayOfWeek?: number;
  startTime: string;
  endTime?: string;
}

interface ParsedDate {
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}

export interface DeviceAcademicPdfEventContext {
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  sourceLabel: string;
}

const MAX_TEXT_LINES = 20_000;
const MAX_EVENTS = 2_500;
const DATE_TEXT = /\b(?:[0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2}|[0-3]?\d\s*(?:[-–—]\s*[0-3]?\d)?\s+\p{L}+\s+(?:19|20)\d{2})\b/iu;
const DATE_TEXT_GLOBAL = /\b(?:[0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2}|[0-3]?\d\s*(?:[-–—]\s*[0-3]?\d)?\s+\p{L}+\s+(?:19|20)\d{2})\b/giu;
const TIME_GLOBAL = /\b(?:saat\s*)?(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s*[-–—]\s*(?:[01]?\d|2[0-3])[:.][0-5]\d)?\b/giu;

export function parseDeviceAcademicPdfText(
  text: string,
  source: DeviceAcademicPdfSource,
  context: DeviceAcademicPdfEventContext,
): EventRecord[] {
  const boundedText = text.replace(/\0/gu, " ").slice(0, 2_000_000);
  return source.document.kind === "academic_calendar"
    ? parseCalendarEvents(boundedText, source, context)
    : parseScheduleEvents(boundedText, source, context);
}

export function mergeServerAndDeviceAcademicEvents(
  serverEvents: readonly EventRecord[],
  deviceEvents: readonly EventRecord[],
  allowReviewedDeviceOnlyEvents: boolean,
): EventRecord[] {
  const merged = new Map(serverEvents.map((event) => [eventSemanticKey(event), event]));
  if (allowReviewedDeviceOnlyEvents) {
    for (const event of deviceEvents) {
      const key = eventSemanticKey(event);
      if (!merged.has(key)) merged.set(key, event);
    }
  }
  return [...merged.values()];
}

function parseCalendarEvents(
  text: string,
  source: DeviceAcademicPdfSource,
  context: DeviceAcademicPdfEventContext,
): EventRecord[] {
  if (source.document.kind !== "academic_calendar") return [];
  const approvedEventKeys = new Set(source.document.approvedEvents.map(academicEventDescriptorKey));
  const events: EventRecord[] = [];
  let pendingTitle = "";
  const lines = text.split(/\r?\n/gu).slice(0, MAX_TEXT_LINES);
  for (const [index, rawLine] of lines.entries()) {
    const line = cleanLine(rawLine);
    if (!line || isMetadataLine(line)) continue;
    const date = parseAcademicDate(line);
    if (!date) {
      if (!isDocumentChrome(line)) pendingTitle = cleanLine(`${pendingTitle} ${line}`).slice(-240);
      continue;
    }
    const inlineTitle = cleanLine(line.replace(DATE_TEXT_GLOBAL, " ").replace(TIME_GLOBAL, " "));
    const title = normalizeTitle(inlineTitle || pendingTitle);
    pendingTitle = "";
    if (!title) continue;
    const temporal = temporalFields(date);
    if (!temporal) continue;
    const event: EventRecord = {
      id: deviceEventId(source.expectedSha256, index + 1, temporal.startDate),
      title,
      category: academicCategory(title),
      ...temporal,
      timezone: "Europe/Istanbul",
      universityId: context.universityId,
      ...(context.facultyId ? { facultyId: context.facultyId } : {}),
      ...(context.departmentId ? { departmentId: context.departmentId } : {}),
      sourceUrl: source.sourceUrl,
      sourceLabel: context.sourceLabel,
    };
    if (!approvedEventKeys.has(academicEventDescriptorKey(event))) continue;
    events.push(event);
    if (events.length >= 250) break;
  }
  return events;
}

function academicEventDescriptorKey(event: {
  normalizedTitle?: string;
  title?: string;
  category: string;
  startDate: string;
  endDate?: string;
  temporalKind?: "date" | "timestamp";
  endTemporalKind?: "date" | "timestamp";
}): string {
  const temporalKind = event.temporalKind ?? "timestamp";
  const endTemporalKind = event.endTemporalKind ?? (event.endDate ? "timestamp" : undefined);
  return JSON.stringify([
    fold(event.normalizedTitle ?? event.title ?? ""),
    event.category,
    temporalKind,
    temporalFingerprint(event.startDate, temporalKind),
    endTemporalKind ?? "",
    event.endDate && endTemporalKind ? temporalFingerprint(event.endDate, endTemporalKind) : "",
  ]);
}

function temporalFingerprint(value: string, kind: "date" | "timestamp"): string {
  return kind === "date" ? value : String(Date.parse(value));
}

function parseScheduleEvents(
  text: string,
  source: DeviceAcademicPdfSource,
  context: DeviceAcademicPdfEventContext,
): EventRecord[] {
  if (source.document.kind === "academic_calendar") return [];
  const document = source.document;
  const approvedRows = new Map(document.approvedRows.map((row) => [row.rowNumber, row]));
  const candidates = parseScheduleCandidates(text, document.kind)
    .filter((candidate) => {
      const approved = approvedRows.get(candidate.rowNumber);
      return approved !== undefined
        && candidate.title === approved.normalizedTitle
        && candidate.date === approved.date
        && candidate.dayOfWeek === approved.dayOfWeek
        && candidate.startTime === approved.startTime
        && candidate.endTime === approved.endTime;
    });
  let dated: Array<{ candidate: ScheduleCandidate; date: string }>;
  if (document.kind === "exam_schedule") {
    dated = candidates.flatMap((candidate) => candidate.date ? [{ candidate, date: candidate.date }] : []);
  } else {
    const rangeStart = document.courseRangeStart;
    const rangeEnd = document.courseRangeEnd;
    dated = !rangeStart || !rangeEnd ? [] : candidates.flatMap((candidate) => datesForWeekday(
      rangeStart,
      rangeEnd,
      candidate.dayOfWeek!,
    ).map((date) => ({ candidate, date })));
  }

  return dated.slice(0, MAX_EVENTS).map(({ candidate, date }) => {
    const startDate = `${date}T${candidate.startTime}:00+03:00`;
    const endDate = candidate.endTime ? `${date}T${candidate.endTime}:00+03:00` : undefined;
    const category = document.kind === "course_schedule" ? "course_schedule" : examCategory(candidate.title);
    return {
      id: deviceEventId(source.expectedSha256, candidate.rowNumber, startDate),
      title: candidate.title,
      ...(document.kind === "course_schedule" ? { courseName: candidate.title } : {}),
      category,
      startDate,
      ...(endDate ? { endDate } : {}),
      temporalKind: "timestamp",
      ...(endDate ? { endTemporalKind: "timestamp" as const } : {}),
      timezone: "Europe/Istanbul",
      universityId: context.universityId,
      ...(context.facultyId ? { facultyId: context.facultyId } : {}),
      ...(context.departmentId ? { departmentId: context.departmentId } : {}),
      sourceUrl: source.sourceUrl,
      sourceLabel: context.sourceLabel,
    };
  });
}

function parseScheduleCandidates(text: string, scheduleType: ScheduleKind): ScheduleCandidate[] {
  const candidates: ScheduleCandidate[] = [];
  const lines = text.split(/\r?\n/gu).slice(0, MAX_TEXT_LINES);
  for (const [index, rawLine] of lines.entries()) {
    const rawText = cleanLine(rawLine).slice(0, 1_000);
    if (rawText.length < 5 || isMetadataLine(rawText)) continue;
    const date = extractDate(rawText);
    const timeSearchText = rawText
      .replace(/\b[0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2}\b/gu, " ")
      .replace(/\b(?:19|20)\d{2}-[01]?\d-[0-3]?\d\b/gu, " ");
    const times = [...timeSearchText.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d))?/gu)];
    const first = times[0];
    if (!first) continue;
    const startTime = `${String(first[1]).padStart(2, "0")}:${first[2]}`;
    const endTime = first[3] && first[4] ? `${String(first[3]).padStart(2, "0")}:${first[4]}` : undefined;
    const dayOfWeek = extractDayOfWeek(rawText);
    if (scheduleType === "exam_schedule" ? !date : dayOfWeek === undefined) continue;
    if (endTime && endTime <= startTime) continue;
    const title = normalizeTitle(rawText
      .replace(/\b(?:[0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2}|(?:19|20)\d{2}-[01]\d-[0-3]\d)\b/gu, " ")
      .replace(/\b(?:pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu, " ")
      .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d))?/gu, " "));
    if (!title) continue;
    candidates.push({
      rowNumber: index + 1,
      rawText,
      title,
      ...(date ? { date } : {}),
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      startTime,
      ...(endTime ? { endTime } : {}),
    });
    if (candidates.length >= 250) break;
  }
  return candidates;
}

function parseAcademicDate(value: string): ParsedDate | null {
  const numericRange = value.match(/\b([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\s*[-–—]\s*([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/iu);
  if (numericRange) return parsedDate(
    Number(numericRange[3]), Number(numericRange[2]), Number(numericRange[1]),
    Number(numericRange[8]), Number(numericRange[7]), Number(numericRange[6]),
    time(numericRange[4], numericRange[5]), time(numericRange[9], numericRange[10]),
  );
  const singleTimeRange = value.match(/\b([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\s*[-–—]\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/iu);
  if (singleTimeRange) return parsedDate(
    Number(singleTimeRange[3]), Number(singleTimeRange[2]), Number(singleTimeRange[1]),
    Number(singleTimeRange[3]), Number(singleTimeRange[2]), Number(singleTimeRange[1]),
    time(singleTimeRange[4], singleTimeRange[5]), time(singleTimeRange[6], singleTimeRange[7]),
  );
  const numeric = value.match(/\b([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/iu);
  if (numeric) return parsedDate(
    Number(numeric[3]), Number(numeric[2]), Number(numeric[1]),
    undefined, undefined, undefined, time(numeric[4], numeric[5]), undefined,
  );
  const sameMonth = value.match(/\b([0-3]?\d)\s*[-–—]\s*([0-3]?\d)\s+([\p{L}]+)\s+((?:19|20)\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/iu);
  if (sameMonth) {
    const month = monthNumber(sameMonth[3]);
    if (month) return parsedDate(
      Number(sameMonth[4]), month, Number(sameMonth[1]),
      Number(sameMonth[4]), month, Number(sameMonth[2]), time(sameMonth[5], sameMonth[6]), undefined,
    );
  }
  const differentMonth = value.match(/\b([0-3]?\d)\s+([\p{L}]+)\s*[-–—]\s*([0-3]?\d)\s+([\p{L}]+)\s+((?:19|20)\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/iu);
  if (differentMonth) {
    const startMonth = monthNumber(differentMonth[2]);
    const endMonth = monthNumber(differentMonth[4]);
    if (startMonth && endMonth) return parsedDate(
      Number(differentMonth[5]), startMonth, Number(differentMonth[1]),
      Number(differentMonth[5]), endMonth, Number(differentMonth[3]), time(differentMonth[6], differentMonth[7]), undefined,
    );
  }
  const textual = value.match(/\b([0-3]?\d)\s+([\p{L}]+)\s+((?:19|20)\d{2})(?:\s*(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d))?\b/iu);
  if (!textual) return null;
  const month = monthNumber(textual[2]);
  return month ? parsedDate(
    Number(textual[3]), month, Number(textual[1]),
    undefined, undefined, undefined, time(textual[4], textual[5]), undefined,
  ) : null;
}

function parsedDate(
  startYear: number,
  startMonth: number,
  startDay: number,
  endYear?: number,
  endMonth?: number,
  endDay?: number,
  startTime?: string,
  endTime?: string,
): ParsedDate | null {
  const startDate = isoDate(startYear, startMonth, startDay);
  const endDate = endYear !== undefined && endMonth !== undefined && endDay !== undefined
    ? isoDate(endYear, endMonth, endDay)
    : undefined;
  if (!startDate || (endYear !== undefined && !endDate) || (endDate && endDate < startDate)) return null;
  return {
    startDate,
    ...(endDate ? { endDate } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
  };
}

function temporalFields(date: ParsedDate): Pick<EventRecord, "startDate" | "endDate" | "temporalKind" | "endTemporalKind"> | null {
  if (date.startTime) {
    const endDateOnly = date.endDate ?? date.startDate;
    const startDate = `${date.startDate}T${date.startTime}:00+03:00`;
    const endDate = date.endTime
      ? `${endDateOnly}T${date.endTime}:00+03:00`
      : date.endDate ? `${date.endDate}T23:59:59+03:00` : undefined;
    if (!Number.isFinite(Date.parse(startDate)) || (endDate && Date.parse(endDate) < Date.parse(startDate))) return null;
    return {
      startDate,
      ...(endDate ? { endDate } : {}),
      temporalKind: "timestamp",
      ...(endDate ? { endTemporalKind: "timestamp" } : {}),
    };
  }
  return {
    startDate: date.startDate,
    ...(date.endDate ? { endDate: date.endDate, endTemporalKind: "date" as const } : {}),
    temporalKind: "date",
  };
}

function normalizeTitle(value: string): string {
  const title = cleanLine(value).replace(/^[\s|;,:–—-]+|[\s|;,:–—-]+$/gu, "").slice(0, 240);
  return title.length >= 3 && /[\p{L}\p{N}]/u.test(title) && !isNavigationContentTitle(title) ? title : "";
}

function cleanLine(value: string): string {
  return normalizeDisplayText(value).replace(/[|]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function isMetadataLine(value: string): boolean {
  return /^(?:eklenme tarihi|son güncelleme(?: tarihi)?|güncellenme tarihi|yayın(?:lanma)? tarihi|added(?: date| on)?|last updated|published(?: date| on)?|modified(?: date| on)?)\b/iu.test(fold(value));
}

function isDocumentChrome(value: string): boolean {
  const normalized = fold(value);
  return !DATE_TEXT.test(value) && (
    /^(?:akademik takvim|tarih|aciklama|etkinlik|faaliyet|baslangic tarihi|bitis tarihi|sayfa \d+)$/u.test(normalized)
    || isNavigationContentTitle(value)
  );
}

function extractDate(value: string): string | undefined {
  const iso = value.match(/\b((?:19|20)\d{2})-([01]?\d)-([0-3]?\d)\b/u);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? undefined;
  const local = value.match(/\b([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})\b/u);
  return local ? isoDate(Number(local[3]), Number(local[2]), Number(local[1])) ?? undefined : undefined;
}

function extractDayOfWeek(value: string): number | undefined {
  const match = fold(value).match(/\b(pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u)?.[1];
  return match ? ({ pazartesi: 1, monday: 1, sali: 2, tuesday: 2, carsamba: 3, wednesday: 3,
    persembe: 4, thursday: 4, cuma: 5, friday: 5, cumartesi: 6, saturday: 6, pazar: 0, sunday: 0 } as Record<string, number>)[match] : undefined;
}

function datesForWeekday(start: string, end: string, dayOfWeek: number): string[] {
  const dates: string[] = [];
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  for (let cursor = startTime; cursor <= endTime && dates.length < MAX_EVENTS; cursor += 86_400_000) {
    const date = new Date(cursor);
    if (date.getUTCDay() === dayOfWeek) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function eventSemanticKey(event: EventRecord): string {
  const temporal = /^\d{4}-\d{2}-\d{2}$/u.test(event.startDate)
    ? event.startDate
    : String(Date.parse(event.startDate));
  const endTemporal = event.endDate
    ? /^\d{4}-\d{2}-\d{2}$/u.test(event.endDate) ? event.endDate : String(Date.parse(event.endDate))
    : "";
  return JSON.stringify([
    fold(event.title), event.category, temporal, endTemporal,
    event.universityId ?? "", event.facultyId ?? "", event.departmentId ?? "",
  ]);
}

function academicCategory(value: string): string {
  const text = fold(value);
  if (/\bekle (?:sil|birak)\b|\bders ekleme\b/u.test(text)) return "course_add_drop";
  if (/\bders programi\b|\bcourse schedule\b/u.test(text)) return "course_schedule";
  if (/\byaz okulu\b.*\b(?:kayit|basvuru|ders secimi|ders alma)\b/u.test(text)) return "summer_school_registration";
  if (/\byatay gecis\b/u.test(text)) return "horizontal_transfer";
  if (/\b(?:ara sinav|vize|midterm)\b/u.test(text)) return "midterm_exam";
  if (/\b(?:final|yariyil sonu sinav)\b/u.test(text)) return "final_exam";
  if (/\b(?:butunleme|mazeret|make up)\b/u.test(text)) return "makeup_exam";
  if (/\btek ders sinav\b/u.test(text)) return "single_course_exam";
  if (/\b(?:ders kayit|kayit yenileme|kayitlanma)\b/u.test(text)) return "course_registration";
  if (/\b(?:harc|katki payi|odeme)\b/u.test(text)) return "tuition_payment";
  if (/\b(?:resmi tatil|bayram|tatil)\b/u.test(text)) return "holiday";
  if (/\boryantasyon\b/u.test(text)) return "orientation";
  return "custom_event";
}

function examCategory(value: string): string {
  const text = fold(value);
  if (/\b(?:butunleme|mazeret|make up)\b/u.test(text)) return "makeup_exam";
  if (/\b(?:ara sinav|vize|midterm)\b/u.test(text)) return "midterm_exam";
  if (/\b(?:tek ders|single course)\b/u.test(text)) return "single_course_exam";
  if (/\b(?:final|yariyil sonu)\b/u.test(text)) return "final_exam";
  return "department_exam_schedule";
}

function deviceEventId(hash: string, row: number, date: string): string {
  return `device-pdf:${hash.slice(0, 20)}:${row}:${date.replace(/[^\d]/gu, "")}`;
}

function isoDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function time(hour?: string, minute?: string): string | undefined {
  return hour && minute ? `${String(Number(hour)).padStart(2, "0")}:${minute}` : undefined;
}

function monthNumber(value?: string): number | undefined {
  return ({ ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
    temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12 } as Record<string, number>)[fold(value ?? "")];
}

function fold(value: string): string {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ı/gu, "i")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
