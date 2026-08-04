import { Inject, Injectable } from "@nestjs/common";
import { findVerifiedAcademicUnitSource, findVerifiedUniversitySource } from "../../bootstrap/verified-source-registry.js";
import { safeOutboundRequest } from "../../common/network/safe-outbound-request.js";
import { isFreshAcademicContent } from "../../domain/temporal-freshness.js";
import { cleanText, fetchText } from "../announcements/announcement-parser.js";
import type { CatalogRepository, DepartmentRecord, FacultyRecord, UniversityRecord } from "../catalog/catalog.types.js";

export type SourceCandidateScopeType = "university" | "faculty" | "department";
export type AcademicSourceType =
  | "homepage"
  | "announcement"
  | "academic_calendar"
  | "faculty_announcement"
  | "department_announcement"
  | "course_schedule"
  | "department_exam_schedule"
  | "summer_school";
export type SourceExtractionMethod = "html" | "pdf_auto" | "office_document" | "image_ocr" | "rss_or_html" | "manual_review";
export type SourceDiscoveryMethod = "catalog" | "verified_registry" | "official_directory" | "web_search";

export interface SourceDiscoveryQueryPlanItem {
  scopeType: SourceCandidateScopeType;
  universityId: string;
  universityName: string;
  facultyId?: string;
  facultyName?: string;
  departmentId?: string;
  departmentName?: string;
  query: string;
}

export interface AcademicSourceCandidate {
  scopeType: SourceCandidateScopeType;
  scopeId: string;
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  sourceType: AcademicSourceType;
  url: string;
  title: string;
  reliabilityScore: number;
  extractionMethod: SourceExtractionMethod;
  discoveryMethod: SourceDiscoveryMethod;
  searchQuery: string;
  evidence: string;
}

interface WebSearchResult {
  url: string;
  title?: string;
  snippet?: string;
}

interface SourceAnchorLink {
  url: string;
  title: string;
  sourcePageUrl: string;
}

interface ScheduleLinkMatch {
  url: string;
  score: number;
  sourcePageUrl: string;
}

@Injectable()
export class AcademicSourceDiscoveryService {
  constructor(@Inject("CatalogRepository") private readonly catalogRepository: CatalogRepository) {}

  async discoverSources(input: { universityId?: string; limit?: number; offset?: number; concurrency?: number } = {}) {
    const universities = input.universityId
      ? [await this.catalogRepository.findUniversityById(input.universityId)].filter((university): university is UniversityRecord => Boolean(university))
      : await this.catalogRepository.listUniversities({ status: "active", limit: input.limit ?? readPositiveInteger(process.env.SOURCE_DISCOVERY_BATCH_SIZE, 25), offset: input.offset ?? 0 });

    const groups = await runWithConcurrency(universities, input.concurrency ?? 2, (university) => this.discoverUniversitySources(university));
    const queryPlan = groups.flatMap((group) => group.queryPlan);
    const candidates = dedupeCandidates(groups.flatMap((group) => group.candidates));

    return {
      summary: {
        checkedUniversities: universities.length,
        queryCount: queryPlan.length,
        candidateCount: candidates.length,
        reliableCandidateCount: candidates.filter((candidate) => candidate.reliabilityScore >= 75).length,
        pdfCandidateCount: candidates.filter((candidate) => candidate.extractionMethod === "pdf_auto").length,
        byType: summarizeCandidateTypes(candidates)
      },
      queryPlan,
      candidates
    };
  }

  private async discoverUniversitySources(university: UniversityRecord): Promise<{ queryPlan: SourceDiscoveryQueryPlanItem[]; candidates: AcademicSourceCandidate[] }> {
    const queryPlan: SourceDiscoveryQueryPlanItem[] = [];
    const candidates: AcademicSourceCandidate[] = [];
    const universityQuery = university.name;
    queryPlan.push({ scopeType: "university", universityId: university.id, universityName: university.name, query: universityQuery });

    addCandidate(candidates, baseCandidate(university, {
      sourceType: "homepage",
      url: university.websiteUrl,
      title: `${university.name} official website`,
      score: 82,
      discoveryMethod: "catalog",
      searchQuery: universityQuery,
      evidence: "catalog.websiteUrl"
    }));
    addCandidate(candidates, baseCandidate(university, {
      sourceType: "announcement",
      url: university.announcementUrl,
      title: `${university.name} announcements`,
      score: 92,
      discoveryMethod: "catalog",
      searchQuery: universityQuery,
      evidence: "catalog.announcementUrl"
    }));
    addCandidate(candidates, baseCandidate(university, {
      sourceType: "academic_calendar",
      url: university.academicCalendarUrl,
      title: `${university.name} academic calendar`,
      score: 92,
      discoveryMethod: "catalog",
      searchQuery: universityQuery,
      evidence: "catalog.academicCalendarUrl"
    }));

    const verified = await findVerifiedUniversitySource(university.id);
    addCandidate(candidates, baseCandidate(university, {
      sourceType: "announcement",
      url: verified?.announcementUrl,
      title: `${university.name} verified announcements`,
      score: 98,
      discoveryMethod: "verified_registry",
      searchQuery: universityQuery,
      evidence: "verified_registry.announcementUrl"
    }));
    addCandidate(candidates, baseCandidate(university, {
      sourceType: "academic_calendar",
      url: verified?.calendarUrl,
      title: `${university.name} verified academic calendar`,
      score: 98,
      discoveryMethod: "verified_registry",
      searchQuery: universityQuery,
      evidence: "verified_registry.calendarUrl"
    }));
    addCandidate(candidates, baseCandidate(university, {
      sourceType: "summer_school",
      url: verified?.summerSchoolUrl,
      title: `${university.name} verified summer school source`,
      score: 88,
      discoveryMethod: "verified_registry",
      searchQuery: universityQuery,
      evidence: "verified_registry.summerSchoolUrl"
    }));

    candidates.push(...await this.webSearchCandidates(university, universityQuery, {
      scopeType: "university",
      scopeId: university.id,
      universityId: university.id
    }));

    const facultyLimit = readPositiveInteger(process.env.SOURCE_DISCOVERY_FACULTY_LIMIT, 20);
    const departmentLimit = readPositiveInteger(process.env.SOURCE_DISCOVERY_DEPARTMENT_LIMIT, 30);
    const faculties = (await this.catalogRepository.listFaculties(university.id, "active")).slice(0, facultyLimit);
    const departmentsByFaculty = new Map<string, DepartmentRecord[]>();
    for (const faculty of faculties) {
      const facultyQuery = `${university.name} ${faculty.name}`;
      queryPlan.push({
        scopeType: "faculty",
        universityId: university.id,
        universityName: university.name,
        facultyId: faculty.id,
        facultyName: faculty.name,
        query: facultyQuery
      });
      await this.addFacultySources(candidates, university, faculty, facultyQuery);

      const departments = (await this.catalogRepository.listDepartments(faculty.id, "active")).slice(0, departmentLimit);
      departmentsByFaculty.set(faculty.id, departments);
      for (const department of departments) {
        const departmentQuery = `${university.name} ${faculty.name} ${department.name}`;
        queryPlan.push({
          scopeType: "department",
          universityId: university.id,
          universityName: university.name,
          facultyId: faculty.id,
          facultyName: faculty.name,
          departmentId: department.id,
          departmentName: department.name,
          query: departmentQuery
        });
        await this.addDepartmentSources(candidates, university, faculty, department, departmentQuery);
      }
    }

    candidates.push(...await this.discoverOfficialDirectoryCandidates(university, faculties, departmentsByFaculty));

    return { queryPlan, candidates };
  }

  private async discoverOfficialDirectoryCandidates(university: UniversityRecord, faculties: FacultyRecord[], departmentsByFaculty: Map<string, DepartmentRecord[]>): Promise<AcademicSourceCandidate[]> {
    if (!isAnkaraUniversity(university)) return [];

    const candidates: AcademicSourceCandidate[] = [];
    const directoryUrl = "https://www.ankara.edu.tr/akademik-ve-idari-birimler/Fakulteler";
    const timeoutMs = readPositiveInteger(process.env.SOURCE_DISCOVERY_DIRECTORY_TIMEOUT_MS, 7000);
    let directoryLinks: SourceAnchorLink[] = [];

    try {
      const directory = await fetchText(directoryUrl, timeoutMs);
      directoryLinks = extractSourceLinks(directory.text, directory.finalUrl);
    } catch {
      return candidates;
    }

    for (const faculty of faculties) {
      const facultyDirectoryLink = bestUnitLink(directoryLinks, faculty.name, "faculty");
      if (!facultyDirectoryLink) continue;

      let facultyWebsiteUrl: string | undefined;
      let facultyPageLinks: SourceAnchorLink[] = [];
      try {
        const detail = await fetchText(facultyDirectoryLink.url, timeoutMs);
        facultyPageLinks = extractSourceLinks(detail.text, detail.finalUrl);
        facultyWebsiteUrl = findWebsiteLink(facultyPageLinks)?.url;
      } catch {
        facultyWebsiteUrl = undefined;
      }

      if (!facultyWebsiteUrl) continue;
      const facultySearchQuery = `${university.name} ${faculty.name}`;
      addCandidate(candidates, scopedCandidate(university, faculty, undefined, {
        sourceType: "homepage",
        url: facultyWebsiteUrl,
        title: `${faculty.name} official website`,
        score: 99,
        discoveryMethod: "official_directory",
        searchQuery: facultySearchQuery,
        evidence: facultyDirectoryLink.url
      }));
      addCandidate(candidates, scopedCandidate(university, faculty, undefined, {
        sourceType: "faculty_announcement",
        url: bestAnnouncementLink(facultyPageLinks)?.url ?? deriveAnnouncementUrl(facultyWebsiteUrl),
        title: `${faculty.name} announcements`,
        score: 91,
        discoveryMethod: "official_directory",
        searchQuery: facultySearchQuery,
        evidence: facultyDirectoryLink.url
      }));

      const siteLinks = await fetchLinksFromPage(facultyWebsiteUrl, timeoutMs);
      const mergedSiteLinks = dedupeLinks([...facultyPageLinks, ...siteLinks]);
      const departments = departmentsByFaculty.get(faculty.id) ?? [];
      for (const department of departments) {
        const departmentSearchQuery = `${university.name} ${faculty.name} ${department.name}`;
        const departmentHomepage = bestDepartmentHomepage(mergedSiteLinks, department, facultyWebsiteUrl);
        if (departmentHomepage) {
          addCandidate(candidates, scopedCandidate(university, faculty, department, {
            sourceType: "homepage",
            url: departmentHomepage,
            title: `${department.name} official website`,
            score: 98,
            discoveryMethod: "official_directory",
            searchQuery: departmentSearchQuery,
            evidence: facultyWebsiteUrl
          }));
          addCandidate(candidates, scopedCandidate(university, faculty, department, {
            sourceType: "department_announcement",
            url: bestAnnouncementLink(mergedSiteLinks)?.url ?? deriveAnnouncementUrl(departmentHomepage),
            title: `${department.name} announcements`,
            score: 90,
            discoveryMethod: "official_directory",
            searchQuery: departmentSearchQuery,
            evidence: facultyWebsiteUrl
          }));
        }

        const courseSchedule = bestScheduleLink(mergedSiteLinks, "course") ?? lawFacultyFallbackSchedule(facultyWebsiteUrl, department, "course");
        const examSchedule = bestScheduleLink(mergedSiteLinks, "exam") ?? lawFacultyFallbackSchedule(facultyWebsiteUrl, department, "exam");
        const courseScheduleAssets = courseSchedule ? await fetchScheduleAssetLinks(courseSchedule.url, timeoutMs, "course") : [];
        addCandidate(candidates, scopedCandidate(university, faculty, department, {
          sourceType: "course_schedule",
          url: courseSchedule?.url,
          title: `${department.name} course schedule`,
          score: Math.max(97, courseSchedule?.score ?? 97),
          discoveryMethod: "official_directory",
          searchQuery: departmentSearchQuery,
          evidence: courseSchedule?.sourcePageUrl ?? facultyWebsiteUrl
        }));
        for (const asset of courseScheduleAssets) {
          addCandidate(candidates, scopedCandidate(university, faculty, department, {
            sourceType: "course_schedule",
            url: asset.url,
            title: `${department.name} course schedule image`,
            score: asset.score,
            discoveryMethod: "official_directory",
            searchQuery: departmentSearchQuery,
            evidence: asset.sourcePageUrl
          }));
        }
        addCandidate(candidates, scopedCandidate(university, faculty, department, {
          sourceType: "department_exam_schedule",
          url: examSchedule?.url,
          title: `${department.name} examination schedule`,
          score: Math.max(97, examSchedule?.score ?? 97),
          discoveryMethod: "official_directory",
          searchQuery: departmentSearchQuery,
          evidence: examSchedule?.sourcePageUrl ?? facultyWebsiteUrl
        }));
      }
    }

    return candidates;
  }

  private async addFacultySources(candidates: AcademicSourceCandidate[], university: UniversityRecord, faculty: FacultyRecord, searchQuery: string): Promise<void> {
    addCandidate(candidates, scopedCandidate(university, faculty, undefined, {
      sourceType: "homepage",
      url: faculty.websiteUrl,
      title: `${faculty.name} official website`,
      score: 82,
      discoveryMethod: "catalog",
      searchQuery,
      evidence: "catalog.faculty.websiteUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, undefined, {
      sourceType: "faculty_announcement",
      url: faculty.announcementUrl,
      title: `${faculty.name} announcements`,
      score: 92,
      discoveryMethod: "catalog",
      searchQuery,
      evidence: "catalog.faculty.announcementUrl"
    }));

    const verified = await findVerifiedAcademicUnitSource({ facultyId: faculty.id });
    addCandidate(candidates, scopedCandidate(university, faculty, undefined, {
      sourceType: "homepage",
      url: verified?.websiteUrl,
      title: `${faculty.name} verified website`,
      score: 96,
      discoveryMethod: "verified_registry",
      searchQuery,
      evidence: "verified_registry.faculty.websiteUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, undefined, {
      sourceType: "faculty_announcement",
      url: verified?.announcementUrl,
      title: `${faculty.name} verified announcements`,
      score: 98,
      discoveryMethod: "verified_registry",
      searchQuery,
      evidence: "verified_registry.faculty.announcementUrl"
    }));

    candidates.push(...await this.webSearchCandidates(university, searchQuery, {
      scopeType: "faculty",
      scopeId: faculty.id,
      universityId: university.id,
      facultyId: faculty.id
    }));
  }

  private async addDepartmentSources(candidates: AcademicSourceCandidate[], university: UniversityRecord, faculty: FacultyRecord, department: DepartmentRecord, searchQuery: string): Promise<void> {
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "homepage",
      url: department.websiteUrl,
      title: `${department.name} official website`,
      score: 84,
      discoveryMethod: "catalog",
      searchQuery,
      evidence: "catalog.department.websiteUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "department_announcement",
      url: department.announcementUrl,
      title: `${department.name} announcements`,
      score: 94,
      discoveryMethod: "catalog",
      searchQuery,
      evidence: "catalog.department.announcementUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "course_schedule",
      url: department.courseScheduleUrl,
      title: `${department.name} course schedule`,
      score: 94,
      discoveryMethod: "catalog",
      searchQuery,
      evidence: "catalog.department.courseScheduleUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "department_exam_schedule",
      url: department.examScheduleUrl,
      title: `${department.name} examination schedule`,
      score: 94,
      discoveryMethod: "catalog",
      searchQuery,
      evidence: "catalog.department.examScheduleUrl"
    }));

    const verified = await findVerifiedAcademicUnitSource({ facultyId: faculty.id, departmentId: department.id });
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "homepage",
      url: verified?.websiteUrl,
      title: `${department.name} verified website`,
      score: 96,
      discoveryMethod: "verified_registry",
      searchQuery,
      evidence: "verified_registry.department.websiteUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "department_announcement",
      url: verified?.announcementUrl,
      title: `${department.name} verified announcements`,
      score: 98,
      discoveryMethod: "verified_registry",
      searchQuery,
      evidence: "verified_registry.department.announcementUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "course_schedule",
      url: verified?.courseScheduleUrl,
      title: `${department.name} verified course schedule`,
      score: 96,
      discoveryMethod: "verified_registry",
      searchQuery,
      evidence: "verified_registry.department.courseScheduleUrl"
    }));
    addCandidate(candidates, scopedCandidate(university, faculty, department, {
      sourceType: "department_exam_schedule",
      url: verified?.examScheduleUrl,
      title: `${department.name} verified examination schedule`,
      score: 96,
      discoveryMethod: "verified_registry",
      searchQuery,
      evidence: "verified_registry.department.examScheduleUrl"
    }));

    candidates.push(...await this.webSearchCandidates(university, searchQuery, {
      scopeType: "department",
      scopeId: department.id,
      universityId: university.id,
      facultyId: faculty.id,
      departmentId: department.id
    }));
  }

  private async webSearchCandidates(university: UniversityRecord, searchQuery: string, scope: Pick<AcademicSourceCandidate, "scopeType" | "scopeId" | "universityId" | "facultyId" | "departmentId">): Promise<AcademicSourceCandidate[]> {
    const results = await fetchConfiguredSearchResults(searchQuery);
    const candidates: AcademicSourceCandidate[] = [];
    for (const result of results) {
      const sourceType = inferSourceType(`${result.title ?? ""} ${result.snippet ?? ""} ${result.url}`, scope.scopeType);
      const url = normalizeUrl(result.url);
      if (!url || !isLikelyOfficialUniversitySource(url, university)) continue;
      const candidate: AcademicSourceCandidate = {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        universityId: scope.universityId,
        ...(scope.facultyId ? { facultyId: scope.facultyId } : {}),
        ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
        sourceType,
        url,
        title: result.title ?? sourceTypeLabel(sourceType),
        reliabilityScore: sourceType === "homepage" ? 62 : 76,
        extractionMethod: extractionMethodForUrl(url, sourceType),
        discoveryMethod: "web_search",
        searchQuery,
        evidence: result.snippet ?? "web_search_result"
      };
      if (candidate.sourceType === "academic_calendar" && candidate.scopeType !== "university") continue;
      if ((candidate.sourceType === "course_schedule" || candidate.sourceType === "department_exam_schedule") && candidate.scopeType !== "department") continue;
      addCandidate(candidates, candidate);
    }
    return candidates;
  }
}

function baseCandidate(university: UniversityRecord, input: CandidateInput): AcademicSourceCandidate | null {
  const url = normalizeUrl(input.url);
  if (!url) return null;
  return {
    scopeType: "university",
    scopeId: university.id,
    universityId: university.id,
    sourceType: input.sourceType,
    url,
    title: input.title,
    reliabilityScore: input.score,
    extractionMethod: extractionMethodForUrl(url, input.sourceType),
    discoveryMethod: input.discoveryMethod,
    searchQuery: input.searchQuery,
    evidence: input.evidence
  };
}

function scopedCandidate(university: UniversityRecord, faculty: FacultyRecord, department: DepartmentRecord | undefined, input: CandidateInput): AcademicSourceCandidate | null {
  const url = normalizeUrl(input.url);
  if (!url) return null;
  return {
    scopeType: department ? "department" : "faculty",
    scopeId: department?.id ?? faculty.id,
    universityId: university.id,
    facultyId: faculty.id,
    ...(department ? { departmentId: department.id } : {}),
    sourceType: input.sourceType,
    url,
    title: input.title,
    reliabilityScore: input.score,
    extractionMethod: extractionMethodForUrl(url, input.sourceType),
    discoveryMethod: input.discoveryMethod,
    searchQuery: input.searchQuery,
    evidence: input.evidence
  };
}

interface CandidateInput {
  sourceType: AcademicSourceType;
  url?: string | undefined;
  title: string;
  score: number;
  discoveryMethod: SourceDiscoveryMethod;
  searchQuery: string;
  evidence: string;
}

function addCandidate(candidates: AcademicSourceCandidate[], candidate: AcademicSourceCandidate | null): void {
  if (!candidate) return;
  if (candidate.sourceType === "homepage" && looksLikeNonHtmlAssetUrl(candidate.url)) return;
  if (!isFreshAcademicContent({
    title: candidate.title,
    url: candidate.url,
    text: candidate.evidence
  }).accepted) return;
  candidates.push(candidate);
}

function normalizeUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value.trim()).toString();
  } catch {
    return undefined;
  }
}

function extractionMethodForUrl(url: string, sourceType: AcademicSourceType): SourceExtractionMethod {
  if (/\.pdf(?:$|[?#])/iu.test(url)) return "pdf_auto";
  if (/\.(?:docx|xlsx)(?:$|[?#])/iu.test(url)) return "office_document";
  if (/\.(?:jpg|jpeg|png|webp)(?:$|[?#])/iu.test(url) && (sourceType === "course_schedule" || sourceType === "department_exam_schedule")) return "image_ocr";
  if (sourceType.includes("announcement")) return "rss_or_html";
  return "html";
}

function looksLikeNonHtmlAssetUrl(url: string): boolean {
  return /\.(?:pdf|docx?|xlsx?|pptx?|mp4|mov|avi|jpg|jpeg|png|gif|webp|svg|zip|rar)(?:$|[?#])/iu.test(url);
}

function inferSourceType(value: string, scopeType: SourceCandidateScopeType): AcademicSourceType {
  const text = foldForMatch(value);
  if (text.includes("sinav program") || text.includes("exam schedule") || text.includes("examination schedule")) return "department_exam_schedule";
  if (text.includes("ders program") || text.includes("course schedule") || text.includes("weekly schedule")) return "course_schedule";
  if (text.includes("akademik takvim") || text.includes("academic calendar")) return "academic_calendar";
  if (text.includes("duyuru") || text.includes("announcement") || text.includes("notice")) return scopeType === "department" ? "department_announcement" : scopeType === "faculty" ? "faculty_announcement" : "announcement";
  if (text.includes("yaz okulu") || text.includes("summer school")) return "summer_school";
  return "homepage";
}

function sourceTypeLabel(sourceType: AcademicSourceType): string {
  return sourceType.replace(/_/gu, " ");
}

function isLikelyOfficialUniversitySource(url: string, university: UniversityRecord): boolean {
  const host = hostFromUrl(url);
  if (!host) return false;
  const websiteHost = hostFromUrl(university.websiteUrl);
  if (websiteHost && (host === websiteHost || host.endsWith(`.${websiteHost}`))) return true;
  return host.endsWith(".edu.tr") || host.endsWith(".edu");
}

function hostFromUrl(value?: string): string | undefined {
  const url = normalizeUrl(value);
  if (!url) return undefined;
  return new URL(url).hostname.replace(/^www\./u, "").toLocaleLowerCase("en-US");
}

export async function fetchConfiguredSearchResults(query: string): Promise<WebSearchResult[]> {
  const endpoint = process.env.WEB_SOURCE_SEARCH_ENDPOINT;
  if (!endpoint) return [];
  try {
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    const configuredOrigin = url.origin;
    const response = await safeOutboundRequest(url.toString(), {
      timeoutMs: readBoundedPositiveInteger(process.env.WEB_SOURCE_SEARCH_TIMEOUT_MS, 5_000, 15_000),
      method: "GET",
      headers: { Accept: "application/json" },
      maximumRedirects: 2,
      maximumResponseBytes: 1024 * 1024,
      validateUrl: (candidate) => {
        if (new URL(candidate).origin !== configuredOrigin) {
          throw new Error("WEB_SOURCE_SEARCH_REDIRECT_AUTHORITY_FORBIDDEN");
        }
        return candidate;
      }
    });
    if (response.status < 200 || response.status >= 300) return [];
    return normalizeSearchPayload(JSON.parse(response.body.toString("utf8")) as unknown);
  } catch {
    return [];
  }
}

async function fetchLinksFromPage(pageUrl: string, timeoutMs: number): Promise<SourceAnchorLink[]> {
  try {
    const page = await fetchText(pageUrl, timeoutMs);
    return extractSourceLinks(page.text, page.finalUrl);
  } catch {
    return [];
  }
}

function extractSourceLinks(html: string, baseUrl: string): SourceAnchorLink[] {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)];
  const links: SourceAnchorLink[] = [];
  for (const anchor of anchors) {
    const attrs = anchor[1] ?? "";
    const href = attrs.match(/\bhref=["']([^"']+)["']/iu)?.[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const url = new URL(href, baseUrl).toString().replace(/#.*$/u, "");
      if (!/^https?:\/\//iu.test(url) || looksLikeIgnoredAsset(url)) continue;
      const title = cleanText([
        stripHtml(anchor[2] ?? ""),
        attrs.match(/\btitle=["']([^"']+)["']/iu)?.[1] ?? "",
        attrs.match(/\baria-label=["']([^"']+)["']/iu)?.[1] ?? ""
      ].join(" "));
      links.push({ url, title, sourcePageUrl: baseUrl });
    } catch {
      continue;
    }
  }
  const images = [...html.matchAll(/<img\b([^>]*)>/giu)];
  for (const image of images) {
    const attrs = image[1] ?? "";
    const src = attrs.match(/\bsrc=["']([^"']+)["']/iu)?.[1];
    if (!src) continue;
    try {
      const url = new URL(src, baseUrl).toString().replace(/#.*$/u, "");
      if (!/^https?:\/\//iu.test(url) || looksLikeIgnoredAsset(url)) continue;
      const title = cleanText([
        attrs.match(/\balt=["']([^"']+)["']/iu)?.[1] ?? "",
        attrs.match(/\btitle=["']([^"']+)["']/iu)?.[1] ?? "",
        fileLabelFromUrl(url)
      ].join(" "));
      links.push({ url, title, sourcePageUrl: baseUrl });
    } catch {
      continue;
    }
  }
  return dedupeLinks(links);
}

async function fetchScheduleAssetLinks(pageUrl: string, timeoutMs: number, kind: "course" | "exam"): Promise<ScheduleLinkMatch[]> {
  if (looksLikeImageUrl(pageUrl) || looksLikeOfficeDocumentUrl(pageUrl) || /\.pdf(?:$|[?#])/iu.test(pageUrl)) return [];
  const links = await fetchLinksFromPage(pageUrl, timeoutMs);
  return links
    .map((link) => ({ link, score: scoreScheduleAssetLink(link, kind) }))
    .filter((match) => match.score >= 70)
    .sort((left, right) => right.score - left.score || left.link.url.localeCompare(right.link.url))
    .slice(0, 12)
    .map((match) => ({ url: match.link.url, score: match.score, sourcePageUrl: pageUrl }));
}

function dedupeLinks(links: SourceAnchorLink[]): SourceAnchorLink[] {
  const selected = new Map<string, SourceAnchorLink>();
  for (const link of links) {
    const existing = selected.get(link.url);
    if (!existing || link.title.length > existing.title.length) selected.set(link.url, link);
  }
  return [...selected.values()];
}

function bestUnitLink(links: SourceAnchorLink[], name: string, scope: "faculty" | "department"): SourceAnchorLink | null {
  const matches = links
    .map((link) => ({ link, score: scoreUnitLink(link, name, scope) }))
    .filter((match) => match.score >= (scope === "faculty" ? 80 : 70))
    .sort((left, right) => right.score - left.score || left.link.url.length - right.link.url.length);
  return matches[0]?.link ?? null;
}

function scoreUnitLink(link: SourceAnchorLink, name: string, scope: "faculty" | "department"): number {
  const text = foldForMatch(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  const foldedName = foldForMatch(name);
  const tokens = significantUnitTokens(name);
  if (!text || tokens.length === 0) return 0;
  let score = 0;
  if (foldedName.length > 5 && text.includes(foldedName)) score += 100;
  const matchedTokens = tokens.filter((token) => text.includes(token));
  score += matchedTokens.length * 20;
  if (matchedTokens.length >= Math.min(2, tokens.length)) score += 25;
  if (scope === "faculty" && /\b(fakulte|faculty|yuksekokul|enstitu)\b/u.test(text)) score += 15;
  if (scope === "department" && /\b(bolum|department|program|anabilim)\b/u.test(text)) score += 15;
  if (/\b(duyuru|haber|iletisim|contact|mezun|yemek|ihale)\b/u.test(text)) score -= 70;
  return score;
}

function findWebsiteLink(links: SourceAnchorLink[]): SourceAnchorLink | null {
  const matches = links
    .map((link) => ({ link, score: scoreWebsiteLink(link) }))
    .filter((match) => match.score >= 50)
    .sort((left, right) => right.score - left.score || left.link.url.length - right.link.url.length);
  return matches[0]?.link ?? null;
}

function scoreWebsiteLink(link: SourceAnchorLink): number {
  const text = foldForMatch(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  let score = 0;
  if (/\b(web sitesi|website|site|resmi web|official)\b/u.test(text)) score += 80;
  if (/\.ankara\.edu\.tr\/?$/iu.test(link.url) || /\.ankara\.edu\.tr\/[^/]*\/?$/iu.test(link.url)) score += 35;
  if (/\bankara\.edu\.tr\b/iu.test(link.url)) score += 20;
  if (/oidb\.ankara\.edu\.tr/iu.test(link.url)) score -= 30;
  if (looksLikeIgnoredAsset(link.url)) score -= 100;
  return score;
}

function bestAnnouncementLink(links: SourceAnchorLink[]): SourceAnchorLink | null {
  const matches = links
    .map((link) => ({ link, score: scoreAnnouncementLink(link) }))
    .filter((match) => match.score >= 60)
    .sort((left, right) => right.score - left.score || left.link.url.length - right.link.url.length);
  return matches[0]?.link ?? null;
}

function scoreAnnouncementLink(link: SourceAnchorLink): number {
  const text = foldForMatch(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  let score = 0;
  if (/\b(duyuru|duyurular|announcement|announcements|haber|news)\b/u.test(text)) score += 80;
  if (/\b(ogrenci|student|akademik|academic)\b/u.test(text)) score += 10;
  if (/\b(arsiv|archive|gecmis)\b/u.test(text)) score += 5;
  return score;
}

function bestDepartmentHomepage(links: SourceAnchorLink[], department: DepartmentRecord, facultyWebsiteUrl: string): string | undefined {
  const direct = bestUnitLink(links, department.name, "department")?.url;
  if (direct) return direct;
  if (isLawFacultyWebsite(facultyWebsiteUrl) && foldForMatch(department.name).includes("hukuk")) return facultyWebsiteUrl;
  return undefined;
}

function bestScheduleLink(links: SourceAnchorLink[], kind: "course" | "exam"): ScheduleLinkMatch | null {
  const matches = links
    .map((link) => ({ link, score: kind === "course" ? scoreCourseScheduleLink(link) : scoreExamScheduleLink(link) }))
    .filter((match) => match.score >= 70)
    .sort((left, right) => right.score - left.score || left.link.url.length - right.link.url.length);
  const match = matches[0];
  return match ? { url: match.link.url, score: Math.min(99, match.score), sourcePageUrl: match.link.sourcePageUrl } : null;
}

function scoreCourseScheduleLink(link: SourceAnchorLink): number {
  const text = foldForMatch(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  let score = 0;
  if (/\b(ders program|haftalik ders|course schedule|class schedule)\b/u.test(text)) score += 90;
  if (/\b(program|schedule)\b/u.test(text) && /\b(ders|course)\b/u.test(text)) score += 45;
  if (/\b(sinav|exam)\b/u.test(text)) score -= 80;
  return score;
}

function scoreExamScheduleLink(link: SourceAnchorLink): number {
  const text = foldForMatch(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  let score = 0;
  if (/\b(sinavlar|sinav program|exam schedule|examination schedule|final|butunleme)\b/u.test(text)) score += 90;
  if (/\b(sinav|exam)\b/u.test(text)) score += 50;
  if (/\b(ders program|course schedule)\b/u.test(text)) score -= 80;
  return score;
}

function scoreScheduleAssetLink(link: SourceAnchorLink, kind: "course" | "exam"): number {
  if (!looksLikeImageUrl(link.url) && !looksLikeOfficeDocumentUrl(link.url) && !/\.pdf(?:$|[?#])/iu.test(link.url)) return 0;
  const text = foldForMatch(`${link.title} ${decodeURIComponentSafe(link.url)}`);
  let score = looksLikeImageUrl(link.url) ? 88 : 75;
  if (kind === "course" && /\b(ders|program|sinif|class|haftalik)\b/u.test(text)) score += 15;
  if (kind === "exam" && /\b(sinav|exam|final|butunleme)\b/u.test(text)) score += 15;
  if (kind === "course" && /\b(sinav|exam)\b/u.test(text)) score -= 40;
  if (kind === "exam" && /\b(ders)\b/u.test(text)) score -= 30;
  return Math.min(99, score);
}

function lawFacultyFallbackSchedule(facultyWebsiteUrl: string, department: DepartmentRecord, kind: "course" | "exam"): ScheduleLinkMatch | null {
  if (!isLawFacultyWebsite(facultyWebsiteUrl) || !foldForMatch(department.name).includes("hukuk")) return null;
  const path = kind === "course" ? "/ders-programi/" : "/sinavlar/";
  return { url: new URL(path, facultyWebsiteUrl).toString(), score: 98, sourcePageUrl: facultyWebsiteUrl };
}

function deriveAnnouncementUrl(homepageUrl: string): string | undefined {
  try {
    return new URL("/duyurular/", homepageUrl).toString();
  } catch {
    return undefined;
  }
}

function isAnkaraUniversity(university: UniversityRecord): boolean {
  return university.id === "ankara-universitesi" || foldForMatch(university.name).replace(/\s+/gu, " ") === "ankara universitesi";
}

function isLawFacultyWebsite(url: string): boolean {
  return /^https?:\/\/(?:www\.)?law\.ankara\.edu\.tr\/?/iu.test(url);
}

function significantUnitTokens(value: string): string[] {
  return foldForMatch(value)
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !unitStopWords.has(token));
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/gu, " ");
}

function decodeURIComponentSafe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function fileLabelFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const fileName = pathname.split("/").filter(Boolean).at(-1) ?? pathname;
    return decodeURIComponentSafe(fileName).replace(/\.[a-z0-9]+$/iu, "").replace(/[-_]+/gu, " ");
  } catch {
    return url;
  }
}

function looksLikeIgnoredAsset(url: string): boolean {
  return /\.(?:css|js|ico|zip|rar|mp4|mov|avi)(?:$|[?#])/iu.test(url);
}

function looksLikeImageUrl(url: string): boolean {
  return /\.(?:jpg|jpeg|png|webp)(?:$|[?#])/iu.test(url);
}

function looksLikeOfficeDocumentUrl(url: string): boolean {
  return /\.(?:docx?|xlsx?|pptx?)(?:$|[?#])/iu.test(url);
}

function normalizeSearchPayload(payload: unknown): WebSearchResult[] {
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { results?: unknown[] }).results)
      ? (payload as { results: unknown[] }).results
      : Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items
        : [];
  return rawItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as { url?: unknown; link?: unknown; title?: unknown; name?: unknown; snippet?: unknown };
      const url = typeof record.url === "string" ? record.url : typeof record.link === "string" ? record.link : undefined;
      if (!url) return null;
      return {
        url,
        ...(typeof record.title === "string" ? { title: record.title } : typeof record.name === "string" ? { title: record.name } : {}),
        ...(typeof record.snippet === "string" ? { snippet: record.snippet } : {})
      };
    })
    .filter((item): item is WebSearchResult => Boolean(item))
    .slice(0, readPositiveInteger(process.env.WEB_SOURCE_SEARCH_RESULT_LIMIT, 8));
}

function dedupeCandidates(candidates: AcademicSourceCandidate[]): AcademicSourceCandidate[] {
  const selected = new Map<string, AcademicSourceCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.scopeType}:${candidate.scopeId}:${candidate.sourceType}:${candidate.url}`;
    const existing = selected.get(key);
    if (!existing || candidate.reliabilityScore > existing.reliabilityScore) selected.set(key, candidate);
  }
  return [...selected.values()].sort((left, right) => right.reliabilityScore - left.reliabilityScore || left.url.localeCompare(right.url));
}

function summarizeCandidateTypes(candidates: AcademicSourceCandidate[]): Partial<Record<AcademicSourceType, number>> {
  const summary: Partial<Record<AcademicSourceType, number>> = {};
  for (const candidate of candidates) summary[candidate.sourceType] = (summary[candidate.sourceType] ?? 0) + 1;
  return summary;
}

async function runWithConcurrency<TInput, TOutput>(items: TInput[], concurrency: number, worker: (item: TInput) => Promise<TOutput>): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  }));
  return results;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function foldForMatch(value: string): string {
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

const unitStopWords = new Set([
  "fakultesi",
  "fakulte",
  "faculty",
  "bolumu",
  "bolum",
  "department",
  "programi",
  "program",
  "meslek",
  "yuksekokulu",
  "yuksek",
  "okulu",
  "enstitusu",
  "enstitu",
  "bilimleri",
  "bilimler",
  "universitesi",
  "universite",
  "ve",
  "ile"
]);
