import { resolveSourceAuthorityContext } from "../../bootstrap/source-authority-context.js";
import {
  evaluateSourceAuthority,
  type SourceAuthorityContext
} from "../../domain/source-authority-enforcement.js";
import type { SourceAuthorityResource } from "../../domain/source-authority-policy.js";
import { cleanText, fetchText } from "../announcements/announcement-parser.js";

const akuUniversityId = "afyon-kocatepe-universitesi-afyonkarahisar";

export type AcademicScheduleType = "course_schedule" | "exam_schedule";
export type AcademicScheduleTerm = "fall" | "spring" | "summer" | "unknown";

export interface AcademicScheduleLink {
  sourceUrl: string;
  title: string;
  type: AcademicScheduleType;
  academicYear?: string;
  term: AcademicScheduleTerm;
  discoveryArea: "page" | "modal_popup" | "department_menu";
}

export interface AkuSbfScheduleDiscoveryResult {
  sourcePageUrl: string;
  examSchedules: AcademicScheduleLink[];
  departmentPages: Array<{ sourceUrl: string; title: string }>;
  courseSchedules: AcademicScheduleLink[];
}

export function extractAcademicScheduleLinks(
  html: string,
  baseUrl: string,
  discoveryArea: AcademicScheduleLink["discoveryArea"] = "page"
): AcademicScheduleLink[] {
  return extractAnchors(html, baseUrl)
    .map((anchor) => toScheduleLink(anchor, discoveryArea))
    .filter((link): link is AcademicScheduleLink => Boolean(link));
}

export function extractModalPopupExamScheduleLinks(html: string, baseUrl: string): AcademicScheduleLink[] {
  const popupHtml = extractContainerSlice(html, /<div\b[^>]*class=["'][^"']*modalpopup-content[^"']*["'][^>]*>/iu);
  if (!popupHtml) return [];
  return extractAcademicScheduleLinks(popupHtml, baseUrl, "modal_popup").filter((link) => link.type === "exam_schedule");
}

export function extractDepartmentMenuLinks(html: string, baseUrl: string): Array<{ sourceUrl: string; title: string }> {
  const menuStart = [...html.matchAll(/<li\b[^>]*class=["'][^"']*drop-down[^"']*["'][^>]*>/giu)]
    .map((match) => {
      const index = match.index ?? 0;
      const elementHtml = extractBalancedElement(html, index, "li");
      const directAnchor = elementHtml?.match(/^<li\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/iu);
      return {
        index,
        html: elementHtml,
        directTitle: foldText((directAnchor?.[1] ?? "").replace(/<[^>]+>/gu, " "))
      };
    })
    .find((match) => match.directTitle === "bolumler" || match.directTitle === "bolum");
  if (!menuStart) return [];
  const menuHtml = menuStart.html;
  if (!menuHtml) return [];
  return uniqueBy(
    extractAnchors(menuHtml, baseUrl)
      .filter((anchor) => !anchor.sourceUrl.endsWith("#"))
      .filter((anchor) => foldText(anchor.title) !== "bolumler")
      .filter((anchor) => isLikelyDepartmentPage(anchor.sourceUrl)),
    (link) => link.sourceUrl
  );
}

export function selectCurrentAcademicScheduleLinks(
  links: AcademicScheduleLink[],
  academicYear: string,
  preferredTerm?: Exclude<AcademicScheduleTerm, "unknown">
): AcademicScheduleLink[] {
  const exactYear = links.filter((link) => link.academicYear === academicYear);
  const yearCandidates = exactYear.length > 0 ? exactYear : links.filter((link) => !link.academicYear);
  const termCandidates = preferredTerm ? yearCandidates.filter((link) => link.term === preferredTerm) : yearCandidates;
  return uniqueBy((termCandidates.length > 0 ? termCandidates : yearCandidates).sort((left, right) => scoreScheduleLink(right, academicYear, preferredTerm) - scoreScheduleLink(left, academicYear, preferredTerm)), (link) => link.sourceUrl);
}

export async function discoverAkuGsfCourseSchedules(input: {
  departmentPageUrls: string[];
  academicYear: string;
  preferredTerm?: Exclude<AcademicScheduleTerm, "unknown">;
  timeoutMs?: number;
  authority?: SourceAuthorityContext;
}): Promise<AcademicScheduleLink[]> {
  const authority = await resolveAkuAuthority(input.authority);
  const results: AcademicScheduleLink[] = [];
  for (const departmentPageUrl of input.departmentPageUrls) {
    const registeredPageUrl = registerAuthorityUrl(departmentPageUrl, authority, "website");
    if (!registeredPageUrl) continue;
    const page = await fetchText(registeredPageUrl, input.timeoutMs ?? 12000, {
      authority,
      resource: "website"
    });
    const links = authorizeScheduleLinks(
      extractAcademicScheduleLinks(page.text, page.finalUrl).filter((link) => link.type === "course_schedule"),
      authority
    );
    results.push(...selectCurrentAcademicScheduleLinks(links, input.academicYear, input.preferredTerm));
  }
  return uniqueBy(results, (link) => link.sourceUrl);
}

export async function discoverAkuSbfSchedules(input: {
  sourcePageUrl?: string;
  academicYear: string;
  preferredTerm?: Exclude<AcademicScheduleTerm, "unknown">;
  timeoutMs?: number;
  authority?: SourceAuthorityContext;
}): Promise<AkuSbfScheduleDiscoveryResult> {
  const authority = await resolveAkuAuthority(input.authority);
  const requestedSourcePageUrl = input.sourcePageUrl ?? "https://sbf.aku.edu.tr/";
  const sourcePageUrl = registerAuthorityUrl(requestedSourcePageUrl, authority, "website");
  if (!sourcePageUrl) throw new Error("SOURCE_AUTHORITY_SOURCE_DOMAIN_MISMATCH");
  const page = await fetchText(sourcePageUrl, input.timeoutMs ?? 12000, {
    authority,
    resource: "website"
  });
  const examSchedules = selectCurrentAcademicScheduleLinks(
    authorizeScheduleLinks(extractModalPopupExamScheduleLinks(page.text, page.finalUrl), authority),
    input.academicYear,
    input.preferredTerm
  );
  const departmentPages = extractDepartmentMenuLinks(page.text, page.finalUrl)
    .map((departmentPage) => {
      const registeredUrl = registerAuthorityUrl(departmentPage.sourceUrl, authority, "website");
      return registeredUrl ? { ...departmentPage, sourceUrl: registeredUrl } : null;
    })
    .filter((departmentPage): departmentPage is { sourceUrl: string; title: string } => Boolean(departmentPage));
  const courseSchedules: AcademicScheduleLink[] = [];
  for (const departmentPage of departmentPages) {
    try {
      const department = await fetchText(departmentPage.sourceUrl, input.timeoutMs ?? 12000, {
        authority,
        resource: "website"
      });
      const links = authorizeScheduleLinks(
        extractAcademicScheduleLinks(department.text, department.finalUrl).filter((link) => link.type === "course_schedule"),
        authority
      );
      courseSchedules.push(...selectCurrentAcademicScheduleLinks(links, input.academicYear, input.preferredTerm));
    } catch {
      continue;
    }
  }
  return {
    sourcePageUrl: page.finalUrl,
    examSchedules,
    departmentPages,
    courseSchedules: uniqueBy(courseSchedules, (link) => link.sourceUrl)
  };
}

async function resolveAkuAuthority(override?: SourceAuthorityContext): Promise<SourceAuthorityContext> {
  if (override) return override;
  return (await resolveSourceAuthorityContext({
    universityId: akuUniversityId,
    ownerAcademicEntityId: akuUniversityId,
    scopeType: "university",
    scopeId: akuUniversityId
  })).context;
}

function authorizeScheduleLinks(
  links: AcademicScheduleLink[],
  authority: SourceAuthorityContext
): AcademicScheduleLink[] {
  return links.flatMap((link) => {
    const sourceUrl = registerAuthorityUrl(link.sourceUrl, authority, resourceForScheduleUrl(link.sourceUrl));
    return sourceUrl ? [{ ...link, sourceUrl }] : [];
  });
}

function registerAuthorityUrl(
  url: string,
  authority: SourceAuthorityContext,
  resource: SourceAuthorityResource
): string | null {
  const decision = evaluateSourceAuthority(authority, {
    boundary: "registration",
    resource,
    url
  });
  return decision.allowed && decision.canonicalUrl
    ? preserveTrailingSlash(decision.canonicalUrl, url)
    : null;
}

function preserveTrailingSlash(canonicalUrl: string, requestedUrl: string): string {
  try {
    const requested = new URL(requestedUrl);
    if (requested.pathname.length <= 1 || !requested.pathname.endsWith("/")) return canonicalUrl;
    const canonical = new URL(canonicalUrl);
    if (!canonical.pathname.endsWith("/")) canonical.pathname += "/";
    return canonical.toString();
  } catch {
    return canonicalUrl;
  }
}

function resourceForScheduleUrl(url: string): SourceAuthorityResource {
  return /\.pdf(?:$|[?#])/iu.test(url) ? "pdf" : "academic_calendar";
}

function extractAnchors(html: string, baseUrl: string): Array<{ sourceUrl: string; title: string }> {
  const anchors: Array<{ sourceUrl: string; title: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const href = cleanText(match[1]);
    if (!href) continue;
    try {
      anchors.push({
        sourceUrl: new URL(href, baseUrl).toString(),
        title: cleanText((match[2] ?? "").replace(/<[^>]+>/gu, " ")) || href
      });
    } catch {
      continue;
    }
  }
  return uniqueBy(anchors, (anchor) => anchor.sourceUrl);
}

function toScheduleLink(
  anchor: { sourceUrl: string; title: string },
  discoveryArea: AcademicScheduleLink["discoveryArea"]
): AcademicScheduleLink | null {
  const rawText = `${anchor.title} ${decodeUrlSafe(anchor.sourceUrl)}`;
  const text = foldText(rawText);
  const isCourseSchedule = /ders\s*program|course\s*schedule/u.test(text);
  const isExamSchedule = /sinav\s*program|exam\s*schedule/u.test(text);
  if (!isCourseSchedule && !isExamSchedule) return null;
  const academicYear = inferAcademicYear(rawText) ?? inferAcademicYear(text);
  return {
    sourceUrl: anchor.sourceUrl,
    title: anchor.title,
    type: isExamSchedule ? "exam_schedule" : "course_schedule",
    ...(academicYear ? { academicYear } : {}),
    term: inferTerm(text),
    discoveryArea
  };
}

function extractContainerSlice(html: string, startPattern: RegExp, closingTag = "</div>"): string | null {
  const start = html.match(startPattern);
  if (!start || start.index === undefined) return null;
  const end = html.indexOf(closingTag, start.index + start[0].length);
  return end >= 0 ? html.slice(start.index, end + closingTag.length) : html.slice(start.index);
}

function inferAcademicYear(value: string): string | undefined {
  const match = value.match(/(20\d{2})\s*(?:[-_/]|\s)\s*(20\d{2})/u);
  if (!match?.[1] || !match[2]) return undefined;
  const left = Number(match[1]);
  const right = Number(match[2]);
  return Number.isInteger(left) && right === left + 1 ? `${left}-${right}` : undefined;
}

function isLikelyDepartmentPage(input: string): boolean {
  try {
    const path = foldText(new URL(input).pathname).replace(/\s+/gu, "-");
    return /\/(?:beden-egitimi-ve-spor-ogretmenligi|[a-z0-9-]+-bolumu)\/?$/u.test(`/${path}`);
  } catch {
    return false;
  }
}

function extractBalancedElement(html: string, startIndex: number, tagName: string): string | null {
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "giu");
  tagPattern.lastIndex = startIndex;
  let depth = 0;
  for (;;) {
    const match = tagPattern.exec(html);
    if (!match) return html.slice(startIndex);
    if (!match[0].startsWith("</")) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(startIndex, tagPattern.lastIndex);
  }
}

function inferTerm(value: string): AcademicScheduleTerm {
  if (/\bguz\b|\bfall\b/u.test(value)) return "fall";
  if (/\bbahar\b|\bspring\b/u.test(value)) return "spring";
  if (/\byaz\b|\bsummer\b/u.test(value)) return "summer";
  return "unknown";
}

function scoreScheduleLink(link: AcademicScheduleLink, academicYear: string, preferredTerm?: Exclude<AcademicScheduleTerm, "unknown">): number {
  let score = link.sourceUrl.toLocaleLowerCase("en-US").includes(".pdf") ? 100 : 20;
  if (link.academicYear === academicYear) score += 100;
  if (preferredTerm && link.term === preferredTerm) score += 40;
  if (link.discoveryArea === "modal_popup") score += 10;
  return score;
}

function decodeUrlSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/\u0130/gu, "I")
    .replace(/[^\p{L}\d]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}
