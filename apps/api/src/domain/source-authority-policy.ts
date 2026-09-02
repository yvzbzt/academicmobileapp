import { isIP } from "node:net";

export const SOURCE_AUTHORITY_BOUNDARIES = ["registration", "fetch", "publication"] as const;
export const SOURCE_AUTHORITY_RESOURCES = [
  "announcement",
  "news",
  "event",
  "academic_calendar",
  "pdf",
  "website"
] as const;
export const SOURCE_AUTHORITY_SCOPE_TYPES = ["university", "faculty", "department"] as const;
export const YOK_NATIONAL_SCOPE_IDS = ["yok-council-of-higher-education", "yok"] as const;

export type SourceAuthorityBoundary = (typeof SOURCE_AUTHORITY_BOUNDARIES)[number];
export type SourceAuthorityResource = (typeof SOURCE_AUTHORITY_RESOURCES)[number];
export type SourceAuthorityScopeType = (typeof SOURCE_AUTHORITY_SCOPE_TYPES)[number];

export type SourceAuthorityReasonCode =
  | "authority_verified"
  | "invalid_boundary"
  | "invalid_resource"
  | "missing_owner_academic_entity_id"
  | "missing_owner_university_id"
  | "missing_resolved_owner_academic_entity_id"
  | "missing_resolved_owner_university_id"
  | "owner_academic_entity_mismatch"
  | "owner_university_mismatch"
  | "missing_scope_type"
  | "invalid_scope_type"
  | "missing_scope_id"
  | "scope_owner_mismatch"
  | "missing_authority_domain"
  | "invalid_authority_domain"
  | "unsafe_source_url"
  | "unsafe_redirect_url"
  | "source_domain_mismatch"
  | "redirect_domain_mismatch"
  | "national_authority_scope_mismatch";

export interface EvaluateSourceAuthorityInput {
  boundary: SourceAuthorityBoundary;
  resource: SourceAuthorityResource;
  ownerAcademicEntityId: string | null;
  ownerUniversityId: string | null;
  resolvedOwnerAcademicEntityId: string | null;
  resolvedOwnerUniversityId: string | null;
  scopeType: SourceAuthorityScopeType | null;
  scopeId: string | null;
  /**
   * Domains proven independently of the candidate URL. Candidate registry
   * URLs must never be copied into this list merely to make them pass.
   */
  authorityDomains: readonly string[] | null;
  url: string;
  finalRedirectUrl?: string | null;
}

export interface SourceAuthorityDecision {
  allowed: boolean;
  status: "trusted" | "quarantined";
  reasonCode: SourceAuthorityReasonCode;
  canonicalUrl: string | null;
  canonicalFinalRedirectUrl: string | null;
  matchedAuthorityDomain: string | null;
}

const boundarySet = new Set<string>(SOURCE_AUTHORITY_BOUNDARIES);
const resourceSet = new Set<string>(SOURCE_AUTHORITY_RESOURCES);
const scopeTypeSet = new Set<string>(SOURCE_AUTHORITY_SCOPE_TYPES);
const yokNationalScopeIdSet = new Set<string>(YOK_NATIONAL_SCOPE_IDS);
const yokAuthorityDomain = "yok.gov.tr";

// These are registry/public suffixes, not institutional authority domains.
const forbiddenAuthorityRoots = new Set([
  "biz.tr",
  "com",
  "com.tr",
  "edu",
  "edu.tr",
  "gen.tr",
  "gov",
  "gov.tr",
  "info.tr",
  "k12.tr",
  "mil.tr",
  "name.tr",
  "net",
  "net.tr",
  "org",
  "org.tr",
  "tel.tr",
  "tr",
  "tv.tr",
  "web.tr"
]);

const unsafeHostnameSuffixes = [
  ".home.arpa",
  ".internal",
  ".invalid",
  ".local",
  ".localhost",
  ".test"
] as const;

function normalizedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function isPrivateOrReservedIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const first = octets[0]!;
  const second = octets[1]!;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function isPrivateOrReservedIpv6(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US");
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(?:fc|fd)/u.test(normalized)) return true;
  if (/^fe[89ab]/u.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  return mappedIpv4 ? isPrivateOrReservedIpv4(mappedIpv4) : false;
}

function isUnsafeHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (unsafeHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))) return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isPrivateOrReservedIpv4(hostname);
  if (ipVersion === 6) return isPrivateOrReservedIpv6(hostname);
  return false;
}

function compareQueryEntries(left: readonly [string, string], right: readonly [string, string]): number {
  if (left[0] < right[0]) return -1;
  if (left[0] > right[0]) return 1;
  if (left[1] < right[1]) return -1;
  if (left[1] > right[1]) return 1;
  return 0;
}

function canonicalizeAuthorityUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2_048) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;

    url.hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
    if (isUnsafeHostname(url.hostname)) return null;
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }

    const queryEntries = [...url.searchParams.entries()]
      .filter(([key]) => !/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu.test(key))
      .sort(compareQueryEntries);
    url.search = "";
    for (const [key, value] of queryEntries) url.searchParams.append(key, value);

    url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hasValidDnsLabels(hostname: string): boolean {
  if (hostname.length > 253) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

function normalizeAuthorityDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.includes("*") || /\s/u.test(raw)) return null;

  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw);
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.port) return null;
    if (!hasScheme && (url.pathname !== "/" || url.search || url.hash)) return null;

    const hostname = url.hostname
      .toLocaleLowerCase("en-US")
      .replace(/\.$/u, "")
      .replace(/^www\./u, "");
    if (isIP(hostname) !== 0 || isUnsafeHostname(hostname)) return null;
    if (!hasValidDnsLabels(hostname) || forbiddenAuthorityRoots.has(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

function normalizeAuthorityDomains(values: readonly string[] | null): {
  domains: string[];
  invalid: boolean;
} {
  if (!Array.isArray(values)) return { domains: [], invalid: values !== null };

  const normalized = new Set<string>();
  for (const value of values) {
    const domain = normalizeAuthorityDomain(value);
    if (!domain) return { domains: [], invalid: true };
    normalized.add(domain);
  }

  return {
    domains: [...normalized].sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0)),
    invalid: false
  };
}

function hostnameMatchesAuthority(hostname: string, authorityDomain: string): boolean {
  const normalizedHostname = hostname.toLocaleLowerCase("en-US").replace(/\.$/u, "");
  return normalizedHostname === authorityDomain || normalizedHostname.endsWith(`.${authorityDomain}`);
}

function matchingAuthorityDomain(canonicalUrl: string, authorityDomains: readonly string[]): string | null {
  const hostname = new URL(canonicalUrl).hostname;
  return authorityDomains.find((domain) => hostnameMatchesAuthority(hostname, domain)) ?? null;
}

function isYokUrl(canonicalUrl: string): boolean {
  return hostnameMatchesAuthority(new URL(canonicalUrl).hostname, yokAuthorityDomain);
}

function decision(
  reasonCode: SourceAuthorityReasonCode,
  canonicalUrl: string | null = null,
  canonicalFinalRedirectUrl: string | null = null,
  matchedAuthorityDomain: string | null = null
): SourceAuthorityDecision {
  const allowed = reasonCode === "authority_verified";
  return {
    allowed,
    status: allowed ? "trusted" : "quarantined",
    reasonCode,
    canonicalUrl,
    canonicalFinalRedirectUrl,
    matchedAuthorityDomain
  };
}

/**
 * Pure fail-closed ownership policy shared by source registration, outbound
 * fetching, and publication. It deliberately does no DNS or network work;
 * callers must pair fetch decisions with the safe outbound-request layer.
 */
export class SourceAuthorityPolicy {
  evaluate(input: EvaluateSourceAuthorityInput): SourceAuthorityDecision {
    if (!boundarySet.has(input.boundary)) return decision("invalid_boundary");
    if (!resourceSet.has(input.resource)) return decision("invalid_resource");

    const ownerAcademicEntityId = normalizedId(input.ownerAcademicEntityId);
    if (!ownerAcademicEntityId) return decision("missing_owner_academic_entity_id");
    const ownerUniversityId = normalizedId(input.ownerUniversityId);
    if (!ownerUniversityId) return decision("missing_owner_university_id");
    const resolvedOwnerAcademicEntityId = normalizedId(input.resolvedOwnerAcademicEntityId);
    if (!resolvedOwnerAcademicEntityId) return decision("missing_resolved_owner_academic_entity_id");
    const resolvedOwnerUniversityId = normalizedId(input.resolvedOwnerUniversityId);
    if (!resolvedOwnerUniversityId) return decision("missing_resolved_owner_university_id");

    if (ownerAcademicEntityId !== resolvedOwnerAcademicEntityId) {
      return decision("owner_academic_entity_mismatch");
    }
    if (ownerUniversityId !== resolvedOwnerUniversityId) return decision("owner_university_mismatch");

    const scopeTypeValue: unknown = input.scopeType;
    if (scopeTypeValue === null || scopeTypeValue === undefined || scopeTypeValue === "") {
      return decision("missing_scope_type");
    }
    if (typeof scopeTypeValue !== "string" || !scopeTypeSet.has(scopeTypeValue)) {
      return decision("invalid_scope_type");
    }
    const scopeType = scopeTypeValue as SourceAuthorityScopeType;
    const scopeId = normalizedId(input.scopeId);
    if (!scopeId) return decision("missing_scope_id");

    const expectedScopeId = scopeType === "university"
      ? resolvedOwnerUniversityId
      : resolvedOwnerAcademicEntityId;
    if (scopeId !== expectedScopeId) return decision("scope_owner_mismatch");
    if (scopeType === "university" && resolvedOwnerAcademicEntityId !== resolvedOwnerUniversityId) {
      return decision("scope_owner_mismatch");
    }

    const canonicalUrl = canonicalizeAuthorityUrl(input.url);
    if (!canonicalUrl) return decision("unsafe_source_url");

    const isYokScope = scopeType === "university" && yokNationalScopeIdSet.has(scopeId);
    if (isYokUrl(canonicalUrl) && !isYokScope) {
      return decision("national_authority_scope_mismatch", canonicalUrl);
    }

    const normalizedAuthorities = normalizeAuthorityDomains(input.authorityDomains);
    if (normalizedAuthorities.invalid) return decision("invalid_authority_domain", canonicalUrl);
    const authorityDomains = isYokScope ? [yokAuthorityDomain] : normalizedAuthorities.domains;
    if (authorityDomains.length === 0) return decision("missing_authority_domain", canonicalUrl);

    const matchedAuthorityDomain = matchingAuthorityDomain(canonicalUrl, authorityDomains);
    if (!matchedAuthorityDomain) return decision("source_domain_mismatch", canonicalUrl);

    if (input.finalRedirectUrl !== undefined && input.finalRedirectUrl !== null) {
      const canonicalFinalRedirectUrl = canonicalizeAuthorityUrl(input.finalRedirectUrl);
      if (!canonicalFinalRedirectUrl) {
        return decision("unsafe_redirect_url", canonicalUrl, null, matchedAuthorityDomain);
      }
      if (isYokUrl(canonicalFinalRedirectUrl) && !isYokScope) {
        return decision(
          "national_authority_scope_mismatch",
          canonicalUrl,
          canonicalFinalRedirectUrl,
          matchedAuthorityDomain
        );
      }
      if (!matchingAuthorityDomain(canonicalFinalRedirectUrl, authorityDomains)) {
        return decision(
          "redirect_domain_mismatch",
          canonicalUrl,
          canonicalFinalRedirectUrl,
          matchedAuthorityDomain
        );
      }
      return decision(
        "authority_verified",
        canonicalUrl,
        canonicalFinalRedirectUrl,
        matchedAuthorityDomain
      );
    }

    return decision("authority_verified", canonicalUrl, null, matchedAuthorityDomain);
  }
}

export const sourceAuthorityPolicy = Object.freeze(new SourceAuthorityPolicy());
