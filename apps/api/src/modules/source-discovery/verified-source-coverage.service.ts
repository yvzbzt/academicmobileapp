import { BadRequestException, Injectable } from "@nestjs/common";
import {
  listVerifiedAcademicUnitSources,
  listVerifiedUniversitySources,
  type QuarantinedVerifiedSource,
  type VerifiedAcademicUnitSource,
  type VerifiedAcademicUnitSourceUrlField,
  type VerifiedRegistrySourceEvidence,
  type VerifiedUniversitySource,
  type VerifiedUniversitySourceUrlField
} from "../../bootstrap/verified-source-registry.js";
import { normalizeStrictVerifiedSourceEvidence } from "../../bootstrap/verified-source-evidence.js";
import {
  loadBundledTurkiyeCatalogSeed,
  type TurkiyeCatalogSeed
} from "../../bootstrap/yok-atlas-catalog-importer.js";
import {
  VERIFIED_SOURCE_COVERAGE_RESOLUTIONS,
  VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES,
  type VerifiedSourceCoverageItem,
  type VerifiedSourceCoverageQuery,
  type VerifiedSourceCoverageResolution,
  type VerifiedSourceCoverageResolutionCounts,
  type VerifiedSourceCoverageResponse,
  type VerifiedSourceCoverageScopeType,
  type VerifiedSourceCoverageSourceSummary,
  type VerifiedSourceCoverageSourceType,
  type VerifiedSourceCoverageSummary
} from "./verified-source-coverage.types.js";

export const BUNDLED_SOURCE_COVERAGE_EXPECTATIONS = {
  universities: 208,
  academicUnits: 17_360,
  departments: 14_428,
  sourceSlots: 115_656
} as const;
export const VERIFIED_SOURCE_COVERAGE_DEFAULT_LIMIT = 50;
export const VERIFIED_SOURCE_COVERAGE_MAX_LIMIT = 100;
export const VERIFIED_SOURCE_COVERAGE_MAX_OFFSET = 1_000_000;
export const VERIFIED_SOURCE_COVERAGE_MAX_SEARCH_LENGTH = 200;

type VerifiedAcademicUnitCoverageSourceType = Exclude<VerifiedSourceCoverageSourceType, "academic_calendar">;

const facultySourceTypes = ["homepage", "announcement", "news", "event", "academic_calendar"] as const satisfies readonly VerifiedSourceCoverageSourceType[];
const departmentSourceTypes = [...facultySourceTypes, "course_schedule", "exam_schedule"] as const satisfies readonly VerifiedSourceCoverageSourceType[];
const inheritableSourceTypes = new Set<VerifiedAcademicUnitCoverageSourceType>(["announcement", "news", "event"]);
const sourceTypeOrder = new Map(VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES.map((value, index) => [value, index]));
const resolutionSet = new Set<string>(VERIFIED_SOURCE_COVERAGE_RESOLUTIONS);
const sourceTypeSet = new Set<string>(VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES);

interface CatalogCoverageUnit {
  universityId: string;
  universityName: string;
  scopeType: VerifiedSourceCoverageScopeType;
  scopeId: string;
  scopeName: string;
  facultyId: string;
  facultyName: string;
  departmentId?: string;
  departmentName?: string;
}

export interface VerifiedSourceCoverageReadModel {
  items: readonly VerifiedSourceCoverageItem[];
  catalog: VerifiedSourceCoverageSummary["catalog"];
}

export interface BuildVerifiedSourceCoverageInput {
  catalog: TurkiyeCatalogSeed;
  universitySources: readonly VerifiedUniversitySource[];
  academicUnitSources: readonly VerifiedAcademicUnitSource[];
  expectedCatalog?: {
    universities: number;
    academicUnits: number;
    departments: number;
    sourceSlots?: number;
  };
}

let bundledReadModelPromise: Promise<VerifiedSourceCoverageReadModel> | null = null;

/**
 * Loads only files copied into the API deployment image. Discovery-run artifacts
 * are intentionally not consulted, so a missing artifact cannot be mistaken for
 * verified coverage.
 */
export function loadBundledVerifiedSourceCoverageReadModel(): Promise<VerifiedSourceCoverageReadModel> {
  bundledReadModelPromise ??= Promise.all([
    loadBundledTurkiyeCatalogSeed(),
    listVerifiedUniversitySources(),
    listVerifiedAcademicUnitSources()
  ]).then(([catalog, universitySources, academicUnitSources]) => buildVerifiedSourceCoverageReadModel({
    catalog,
    universitySources,
    academicUnitSources,
    expectedCatalog: BUNDLED_SOURCE_COVERAGE_EXPECTATIONS
  }));
  return bundledReadModelPromise;
}

@Injectable()
export class VerifiedSourceCoverageService {
  async listCoverage(query: VerifiedSourceCoverageQuery = {}): Promise<VerifiedSourceCoverageResponse> {
    return queryVerifiedSourceCoverage(await loadBundledVerifiedSourceCoverageReadModel(), query);
  }
}

export function buildVerifiedSourceCoverageReadModel(input: BuildVerifiedSourceCoverageInput): VerifiedSourceCoverageReadModel {
  const catalogUnits = buildCatalogCoverageUnits(input.catalog);
  const facultyCount = catalogUnits.filter((unit) => unit.scopeType === "faculty").length;
  const departmentCount = catalogUnits.length - facultyCount;
  assertExpectedCatalogCounts(input.catalog.universities.length, catalogUnits.length, departmentCount, input.expectedCatalog);

  const unitsById = new Map(catalogUnits.map((unit) => [unit.scopeId, unit]));
  const universityIds = new Set(input.catalog.universities.map((university) => university.slug));
  const universitySources = indexUniversitySources(input.universitySources, universityIds);
  const academicUnitSources = indexAcademicUnitSources(input.academicUnitSources, unitsById);
  const items = catalogUnits.flatMap((unit) => {
    const source = academicUnitSources.get(unit.scopeId);
    const sourceTypes = unit.scopeType === "faculty" ? facultySourceTypes : departmentSourceTypes;
    return sourceTypes.map((sourceType) => {
      if (sourceType === "academic_calendar") {
        return buildUniversityCalendarCoverageItem(unit, universitySources);
      }
      const direct = buildDirectCoverageItem(unit, sourceType, source);
      return direct.resolution === "missing" && inheritableSourceTypes.has(sourceType)
        ? buildInheritedCoverageItem(unit, sourceType, direct, academicUnitSources, universitySources)
        : direct;
    });
  }).sort(compareCoverageItems);
  if (input.expectedCatalog?.sourceSlots !== undefined && items.length !== input.expectedCatalog.sourceSlots) {
    throw new Error(`SOURCE_COVERAGE_SOURCE_SLOT_COUNT_MISMATCH:${items.length}/${input.expectedCatalog.sourceSlots}`);
  }

  return {
    items,
    catalog: {
      universities: input.catalog.universities.length,
      academicUnits: catalogUnits.length,
      faculties: facultyCount,
      departments: departmentCount
    }
  };
}

export function queryVerifiedSourceCoverage(
  model: VerifiedSourceCoverageReadModel,
  query: VerifiedSourceCoverageQuery = {}
): VerifiedSourceCoverageResponse {
  const normalized = normalizeCoverageQuery(query);
  const search = normalized.search ? foldSearchText(normalized.search) : undefined;
  const filtered = model.items.filter((item) => {
    if (normalized.universityId && item.universityId !== normalized.universityId) return false;
    if (normalized.scopeType && item.scopeType !== normalized.scopeType) return false;
    if (normalized.sourceType && item.sourceType !== normalized.sourceType) return false;
    if (normalized.resolution && item.resolution !== normalized.resolution) return false;
    return !search || coverageSearchText(item).includes(search);
  });
  return {
    total: filtered.length,
    items: filtered.slice(normalized.offset, normalized.offset + normalized.limit),
    summary: buildCoverageSummary(model.catalog, filtered)
  };
}

function buildCatalogCoverageUnits(catalog: TurkiyeCatalogSeed): CatalogCoverageUnit[] {
  const universityIds = new Set<string>();
  const scopeIds = new Set<string>();
  const units: CatalogCoverageUnit[] = [];
  for (const university of catalog.universities) {
    if (universityIds.has(university.slug)) throw new Error(`SOURCE_COVERAGE_DUPLICATE_CATALOG_UNIVERSITY:${university.slug}`);
    universityIds.add(university.slug);
    for (const faculty of university.faculties) {
      const facultyId = `${university.slug}__${faculty.slug}`;
      registerCatalogScopeId(scopeIds, facultyId);
      units.push({
        universityId: university.slug,
        universityName: university.name,
        scopeType: "faculty",
        scopeId: facultyId,
        scopeName: faculty.name,
        facultyId,
        facultyName: faculty.name
      });
      for (const department of faculty.departments) {
        const departmentId = `${facultyId}__${department.slug}`;
        registerCatalogScopeId(scopeIds, departmentId);
        units.push({
          universityId: university.slug,
          universityName: university.name,
          scopeType: "department",
          scopeId: departmentId,
          scopeName: department.name,
          facultyId,
          facultyName: faculty.name,
          departmentId,
          departmentName: department.name
        });
      }
    }
  }
  return units.sort(compareCatalogUnits);
}

function registerCatalogScopeId(scopeIds: Set<string>, scopeId: string): void {
  if (scopeIds.has(scopeId)) throw new Error(`SOURCE_COVERAGE_DUPLICATE_CATALOG_SCOPE:${scopeId}`);
  scopeIds.add(scopeId);
}

function assertExpectedCatalogCounts(
  universities: number,
  academicUnits: number,
  departments: number,
  expected: BuildVerifiedSourceCoverageInput["expectedCatalog"]
): void {
  if (!expected) return;
  if (universities !== expected.universities
    || academicUnits !== expected.academicUnits
    || departments !== expected.departments) {
    throw new Error(
      `SOURCE_COVERAGE_CATALOG_COUNT_MISMATCH:universities=${universities}/${expected.universities},academicUnits=${academicUnits}/${expected.academicUnits},departments=${departments}/${expected.departments}`
    );
  }
}

function indexUniversitySources(
  sources: readonly VerifiedUniversitySource[],
  catalogUniversityIds: ReadonlySet<string>
): Map<string, VerifiedUniversitySource> {
  const indexed = new Map<string, VerifiedUniversitySource>();
  for (const source of sources) {
    if (!catalogUniversityIds.has(source.universityId)) continue;
    if (indexed.has(source.universityId)) throw new Error(`SOURCE_COVERAGE_DUPLICATE_UNIVERSITY_REGISTRY:${source.universityId}`);
    indexed.set(source.universityId, source);
  }
  return indexed;
}

function indexAcademicUnitSources(
  sources: readonly VerifiedAcademicUnitSource[],
  catalogUnits: ReadonlyMap<string, CatalogCoverageUnit>
): Map<string, VerifiedAcademicUnitSource> {
  const indexed = new Map<string, VerifiedAcademicUnitSource>();
  for (const source of sources) {
    const scopeId = source.scopeType === "faculty" ? source.facultyId : source.departmentId;
    if (!scopeId) continue;
    const catalogUnit = catalogUnits.get(scopeId);
    if (!catalogUnit) continue;
    const ownershipMatches = source.scopeType === catalogUnit.scopeType
      && source.universityId === catalogUnit.universityId
      && (source.facultyId === undefined || source.facultyId === catalogUnit.facultyId)
      && (source.scopeType !== "department" || source.departmentId === catalogUnit.departmentId);
    if (!ownershipMatches) throw new Error(`SOURCE_COVERAGE_REGISTRY_OWNERSHIP_MISMATCH:${scopeId}`);
    if (indexed.has(scopeId)) throw new Error(`SOURCE_COVERAGE_DUPLICATE_ACADEMIC_UNIT_REGISTRY:${scopeId}`);
    indexed.set(scopeId, source);
  }
  return indexed;
}

function buildDirectCoverageItem(
  unit: CatalogCoverageUnit,
  sourceType: VerifiedAcademicUnitCoverageSourceType,
  source: VerifiedAcademicUnitSource | undefined
): VerifiedSourceCoverageItem {
  const base = baseCoverageItem(unit, sourceType);
  const field = academicUnitFieldForSourceType(sourceType);
  const operationalUrl = source?.[field];
  const evidence = strictCoverageEvidence(
    operationalUrl,
    source?.verificationByField?.[field],
    registrySourceTypeForCoverage(sourceType),
    { universityId: unit.universityId, unitType: unit.scopeType, scopeId: unit.scopeId }
  );
  if (operationalUrl && evidence) return verifiedCoverageItem(base, operationalUrl, evidence);
  if (operationalUrl) {
    return {
      ...base,
      resolution: "legacy_unverified",
      url: operationalUrl,
      evidencePresent: false,
      evidenceArtifactReferencePresent: false,
      legacyReason: "final_revalidation_evidence_missing"
    };
  }
  const quarantine = selectQuarantine(source?.quarantinedSources, field);
  if (quarantine) {
    return {
      ...base,
      resolution: "quarantined",
      url: quarantine.url,
      evidencePresent: false,
      evidenceArtifactReferencePresent: false,
      quarantineReason: quarantine.reasonCode
    };
  }
  return missingCoverageItem(base);
}

function buildUniversityCalendarCoverageItem(
  unit: CatalogCoverageUnit,
  universitySources: ReadonlyMap<string, VerifiedUniversitySource>
): VerifiedSourceCoverageItem {
  const sourceType = "academic_calendar" as const;
  const base = baseCoverageItem(unit, sourceType);
  const source = universitySources.get(unit.universityId);
  const operationalUrl = source?.calendarUrl;
  const evidence = strictCoverageEvidence(
    operationalUrl,
    source?.verificationByField?.calendarUrl,
    "academic_calendar",
    { universityId: unit.universityId, unitType: "university", scopeId: unit.universityId }
  );

  if (operationalUrl && evidence?.publicationScope === "university_system") {
    return verifiedCoverageItem(base, operationalUrl, evidence, "university", unit.universityId);
  }
  if (operationalUrl && evidence) {
    return {
      ...base,
      resolution: "quarantined",
      url: evidence.finalUrl || operationalUrl,
      evidencePresent: true,
      evidenceArtifactReferencePresent: Boolean(evidence.sha256 && evidence.evidencePath),
      finalRevalidatedAt: evidence.finalRevalidatedAt,
      publicationScope: evidence.publicationScope,
      quarantineReason: "academic_calendar_publication_scope_not_university_system"
    };
  }
  if (operationalUrl) {
    return {
      ...base,
      resolution: "legacy_unverified",
      url: operationalUrl,
      evidencePresent: false,
      evidenceArtifactReferencePresent: false,
      legacyReason: "final_revalidation_evidence_missing"
    };
  }
  const quarantine = selectQuarantine(source?.quarantinedSources, "calendarUrl");
  if (quarantine) {
    return {
      ...base,
      resolution: "quarantined",
      url: quarantine.url,
      evidencePresent: false,
      evidenceArtifactReferencePresent: false,
      quarantineReason: quarantine.reasonCode
    };
  }
  return {
    ...missingCoverageItem(base),
    missingReason: "no_registered_university_academic_calendar_source"
  };
}

function buildInheritedCoverageItem(
  unit: CatalogCoverageUnit,
  sourceType: VerifiedAcademicUnitCoverageSourceType,
  missing: VerifiedSourceCoverageItem,
  academicUnitSources: ReadonlyMap<string, VerifiedAcademicUnitSource>,
  universitySources: ReadonlyMap<string, VerifiedUniversitySource>
): VerifiedSourceCoverageItem {
  const field = academicUnitFieldForSourceType(sourceType);
  const inheritedBase = baseCoverageItem(unit, sourceType);
  if (unit.scopeType === "department") {
    const facultySource = academicUnitSources.get(unit.facultyId);
    const facultyUrl = facultySource?.[field];
    const facultyEvidence = strictCoverageEvidence(
      facultyUrl,
      facultySource?.verificationByField?.[field],
      registrySourceTypeForCoverage(sourceType),
      { universityId: unit.universityId, unitType: "faculty", scopeId: unit.facultyId }
    );
    if (facultyUrl && facultyEvidence
      && (facultyEvidence.publicationScope === "faculty_shared" || facultyEvidence.publicationScope === "university_system")) {
      return verifiedCoverageItem(inheritedBase, facultyUrl, facultyEvidence, "faculty", unit.facultyId);
    }
  }

  const universityField = universityFieldForSourceType(sourceType);
  const universitySource = universityField ? universitySources.get(unit.universityId) : undefined;
  const universityUrl = universityField ? universitySource?.[universityField] : undefined;
  const universityEvidence = universityField
    ? strictCoverageEvidence(
        universityUrl,
        universitySource?.verificationByField?.[universityField],
        registrySourceTypeForCoverage(sourceType),
        { universityId: unit.universityId, unitType: "university", scopeId: unit.universityId }
      )
    : undefined;
  if (universityUrl && universityEvidence?.publicationScope === "university_system") {
    return verifiedCoverageItem(inheritedBase, universityUrl, universityEvidence, "university", unit.universityId);
  }
  return missing;
}

function baseCoverageItem(
  unit: CatalogCoverageUnit,
  sourceType: VerifiedSourceCoverageSourceType
): Omit<VerifiedSourceCoverageItem, "resolution" | "evidencePresent" | "evidenceArtifactReferencePresent"> {
  return {
    id: `${unit.scopeId}:${sourceType}`,
    universityId: unit.universityId,
    universityName: unit.universityName,
    scopeType: unit.scopeType,
    scopeId: unit.scopeId,
    scopeName: unit.scopeName,
    facultyId: unit.facultyId,
    facultyName: unit.facultyName,
    ...(unit.departmentId ? { departmentId: unit.departmentId } : {}),
    ...(unit.departmentName ? { departmentName: unit.departmentName } : {}),
    sourceType
  };
}

function missingCoverageItem(
  base: Omit<VerifiedSourceCoverageItem, "resolution" | "evidencePresent" | "evidenceArtifactReferencePresent">
): VerifiedSourceCoverageItem {
  return {
    ...base,
    resolution: "missing",
    evidencePresent: false,
    evidenceArtifactReferencePresent: false,
    missingReason: `no_registered_${base.scopeType}_${base.sourceType}_source`
  };
}

function verifiedCoverageItem(
  base: Omit<VerifiedSourceCoverageItem, "resolution" | "evidencePresent" | "evidenceArtifactReferencePresent">,
  operationalUrl: string,
  evidence: VerifiedRegistrySourceEvidence,
  inheritedFromScopeType?: "faculty" | "university",
  inheritedFromScopeId?: string
): VerifiedSourceCoverageItem {
  return {
    ...base,
    resolution: "verified",
    url: evidence.finalUrl || operationalUrl,
    evidencePresent: true,
    evidenceArtifactReferencePresent: Boolean(evidence.sha256 && evidence.evidencePath),
    finalRevalidatedAt: evidence.finalRevalidatedAt,
    publicationScope: evidence.publicationScope,
    ...(inheritedFromScopeType && inheritedFromScopeId ? { inheritedFromScopeType, inheritedFromScopeId } : {})
  };
}

function strictCoverageEvidence(
  operationalUrl: string | undefined,
  evidence: VerifiedRegistrySourceEvidence | undefined,
  expectedSourceType: VerifiedRegistrySourceEvidence["sourceType"],
  ownership: Pick<VerifiedRegistrySourceEvidence, "universityId" | "unitType" | "scopeId">
): VerifiedRegistrySourceEvidence | undefined {
  if (!operationalUrl || !evidence) return undefined;
  try {
    return normalizeStrictVerifiedSourceEvidence(evidence, {
      expectedSourceType,
      expectedFinalUrl: operationalUrl,
      expectedUniversityId: ownership.universityId,
      expectedUnitType: ownership.unitType,
      expectedScopeId: ownership.scopeId
    });
  } catch {
    return undefined;
  }
}

function registrySourceTypeForCoverage(sourceType: VerifiedSourceCoverageSourceType): VerifiedRegistrySourceEvidence["sourceType"] {
  return sourceType === "homepage" ? "academic_unit_page"
    : sourceType === "academic_calendar" ? "academic_calendar"
      : sourceType;
}

function academicUnitFieldForSourceType(sourceType: VerifiedAcademicUnitCoverageSourceType): VerifiedAcademicUnitSourceUrlField {
  return sourceType === "homepage" ? "websiteUrl"
    : sourceType === "announcement" ? "announcementUrl"
      : sourceType === "news" ? "newsUrl"
        : sourceType === "event" ? "eventUrl"
          : sourceType === "course_schedule" ? "courseScheduleUrl"
            : "examScheduleUrl";
}

function universityFieldForSourceType(sourceType: VerifiedSourceCoverageSourceType): VerifiedUniversitySourceUrlField | null {
  return sourceType === "announcement" ? "announcementUrl"
    : sourceType === "news" ? "newsUrl"
      : sourceType === "event" ? "eventUrl"
        : null;
}

function selectQuarantine(
  quarantines: readonly QuarantinedVerifiedSource[] | undefined,
  field: VerifiedAcademicUnitSourceUrlField | VerifiedUniversitySourceUrlField
): QuarantinedVerifiedSource | undefined {
  return quarantines
    ?.filter((entry) => entry.field === field)
    .sort((left, right) => left.reasonCode.localeCompare(right.reasonCode, "en-US") || left.url.localeCompare(right.url, "en-US"))[0];
}

function normalizeCoverageQuery(query: VerifiedSourceCoverageQuery): Required<Pick<VerifiedSourceCoverageQuery, "limit" | "offset">> & Omit<VerifiedSourceCoverageQuery, "limit" | "offset"> {
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new BadRequestException("SOURCE_COVERAGE_QUERY_INVALID");
  const raw = query as Record<string, unknown>;
  const limit = readBoundedInteger(raw.limit, VERIFIED_SOURCE_COVERAGE_DEFAULT_LIMIT, 1, VERIFIED_SOURCE_COVERAGE_MAX_LIMIT, "limit");
  const offset = readBoundedInteger(raw.offset, 0, 0, VERIFIED_SOURCE_COVERAGE_MAX_OFFSET, "offset");
  const search = readOptionalBoundedText(raw.search, VERIFIED_SOURCE_COVERAGE_MAX_SEARCH_LENGTH, "search");
  const universityId = readOptionalBoundedText(raw.universityId, 200, "universityId");
  if (universityId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(universityId)) throw new BadRequestException("SOURCE_COVERAGE_UNIVERSITY_ID_INVALID");
  const scopeType = raw.scopeType === undefined ? undefined : raw.scopeType;
  if (scopeType !== undefined && scopeType !== "faculty" && scopeType !== "department") throw new BadRequestException("SOURCE_COVERAGE_SCOPE_TYPE_INVALID");
  const sourceType = raw.sourceType === undefined ? undefined : raw.sourceType;
  if (sourceType !== undefined && (typeof sourceType !== "string" || !sourceTypeSet.has(sourceType))) throw new BadRequestException("SOURCE_COVERAGE_SOURCE_TYPE_INVALID");
  const resolution = raw.resolution === undefined ? undefined : raw.resolution;
  if (resolution !== undefined && (typeof resolution !== "string" || !resolutionSet.has(resolution))) throw new BadRequestException("SOURCE_COVERAGE_RESOLUTION_INVALID");
  return {
    limit,
    offset,
    ...(search ? { search } : {}),
    ...(universityId ? { universityId } : {}),
    ...(scopeType ? { scopeType } : {}),
    ...(sourceType ? { sourceType: sourceType as VerifiedSourceCoverageSourceType } : {}),
    ...(resolution ? { resolution: resolution as VerifiedSourceCoverageResolution } : {})
  };
}

function readBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BadRequestException(`SOURCE_COVERAGE_${field.toLocaleUpperCase("en-US")}_INVALID`);
  }
  return value;
}

function readOptionalBoundedText(value: unknown, maximumLength: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new BadRequestException(`SOURCE_COVERAGE_${field.toLocaleUpperCase("en-US")}_INVALID`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) throw new BadRequestException(`SOURCE_COVERAGE_${field.toLocaleUpperCase("en-US")}_INVALID`);
  return normalized;
}

function buildCoverageSummary(
  catalog: VerifiedSourceCoverageSummary["catalog"],
  items: readonly VerifiedSourceCoverageItem[]
): VerifiedSourceCoverageSummary {
  const byResolution = emptyResolutionCounts();
  const bySourceType = Object.fromEntries(VERIFIED_SOURCE_COVERAGE_SOURCE_TYPES.map((sourceType) => [
    sourceType,
    { total: 0, ...emptyResolutionCounts() }
  ])) as Record<VerifiedSourceCoverageSourceType, VerifiedSourceCoverageSourceSummary>;
  const scopeIds = new Set<string>();
  for (const item of items) {
    scopeIds.add(item.scopeId);
    byResolution[item.resolution] += 1;
    bySourceType[item.sourceType].total += 1;
    bySourceType[item.sourceType][item.resolution] += 1;
  }
  return {
    catalog,
    filteredAcademicUnits: scopeIds.size,
    filteredSourceSlots: items.length,
    byResolution,
    bySourceType
  };
}

function emptyResolutionCounts(): VerifiedSourceCoverageResolutionCounts {
  return { missing: 0, quarantined: 0, verified: 0, legacy_unverified: 0 };
}

function compareCatalogUnits(left: CatalogCoverageUnit, right: CatalogCoverageUnit): number {
  return left.universityId.localeCompare(right.universityId, "en-US")
    || left.facultyId.localeCompare(right.facultyId, "en-US")
    || (left.scopeType === right.scopeType ? 0 : left.scopeType === "faculty" ? -1 : 1)
    || left.scopeId.localeCompare(right.scopeId, "en-US");
}

function compareCoverageItems(left: VerifiedSourceCoverageItem, right: VerifiedSourceCoverageItem): number {
  return left.universityId.localeCompare(right.universityId, "en-US")
    || left.facultyId.localeCompare(right.facultyId, "en-US")
    || (left.scopeType === right.scopeType ? 0 : left.scopeType === "faculty" ? -1 : 1)
    || left.scopeId.localeCompare(right.scopeId, "en-US")
    || (sourceTypeOrder.get(left.sourceType) ?? Number.MAX_SAFE_INTEGER) - (sourceTypeOrder.get(right.sourceType) ?? Number.MAX_SAFE_INTEGER);
}

function coverageSearchText(item: VerifiedSourceCoverageItem): string {
  return foldSearchText([
    item.universityId,
    item.universityName,
    item.scopeId,
    item.scopeName,
    item.facultyId,
    item.facultyName,
    item.departmentId,
    item.departmentName,
    item.sourceType,
    item.url
  ].filter((value): value is string => Boolean(value)).join(" "));
}

function foldSearchText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/gu, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}
