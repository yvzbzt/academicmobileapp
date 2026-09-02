import { describe, expect, it } from "vitest";
import {
  sourceAuthorityPolicy,
  type EvaluateSourceAuthorityInput,
  type SourceAuthorityBoundary,
  type SourceAuthorityResource
} from "../src/domain/source-authority-policy.js";

const universityContext: EvaluateSourceAuthorityInput = {
  boundary: "registration",
  resource: "announcement",
  ownerAcademicEntityId: "ankara-university",
  ownerUniversityId: "ankara-university",
  resolvedOwnerAcademicEntityId: "ankara-university",
  resolvedOwnerUniversityId: "ankara-university",
  scopeType: "university",
  scopeId: "ankara-university",
  authorityDomains: ["ankara.edu.tr"],
  url: "https://www.ankara.edu.tr/duyurular"
};

function evaluate(overrides: Partial<EvaluateSourceAuthorityInput> = {}) {
  return sourceAuthorityPolicy.evaluate({ ...universityContext, ...overrides });
}

describe("SourceAuthorityPolicy", () => {
  it("accepts an independently supplied root domain and all of its real subdomains", () => {
    const root = evaluate({ url: "https://ankara.edu.tr/duyurular" });
    const subdomain = evaluate({
      url: "HTTPS://DUYURU.ANKARA.EDU.TR//liste/?utm_source=test&b=2&a=1#footer",
      finalRedirectUrl: "https://arsiv.duyuru.ankara.edu.tr/liste/"
    });

    expect(root).toMatchObject({
      allowed: true,
      status: "trusted",
      reasonCode: "authority_verified",
      matchedAuthorityDomain: "ankara.edu.tr"
    });
    expect(subdomain).toEqual({
      allowed: true,
      status: "trusted",
      reasonCode: "authority_verified",
      canonicalUrl: "https://duyuru.ankara.edu.tr/liste?a=1&b=2",
      canonicalFinalRedirectUrl: "https://arsiv.duyuru.ankara.edu.tr/liste",
      matchedAuthorityDomain: "ankara.edu.tr"
    });
  });

  it("does not confuse a suffix lookalike or another valid edu.tr institution with the owner", () => {
    expect(evaluate({ url: "https://ankara.edu.tr.attacker.edu.tr/duyuru" })).toMatchObject({
      allowed: false,
      status: "quarantined",
      reasonCode: "source_domain_mismatch"
    });
    expect(evaluate({ url: "https://www.gaziantep.edu.tr/duyurular" })).toMatchObject({
      allowed: false,
      status: "quarantined",
      reasonCode: "source_domain_mismatch"
    });
  });

  it("rejects a cross-institution direct academic-calendar PDF", () => {
    const decision = evaluate({
      resource: "pdf",
      ownerAcademicEntityId: "gaziantep-islam-science-and-technology-university",
      ownerUniversityId: "gaziantep-islam-science-and-technology-university",
      resolvedOwnerAcademicEntityId: "gaziantep-islam-science-and-technology-university",
      resolvedOwnerUniversityId: "gaziantep-islam-science-and-technology-university",
      scopeId: "gaziantep-islam-science-and-technology-university",
      authorityDomains: ["gibtu.edu.tr"],
      url: "https://www.gaziantep.edu.tr/upload/akademik-takvim.pdf"
    });

    expect(decision).toMatchObject({
      allowed: false,
      status: "quarantined",
      reasonCode: "source_domain_mismatch",
      canonicalUrl: "https://www.gaziantep.edu.tr/upload/akademik-takvim.pdf"
    });
  });

  it("checks the final redirect with the same owner-domain rule and rejects unsafe redirects", () => {
    expect(evaluate({
      boundary: "fetch",
      finalRedirectUrl: "https://calendar.istanbul.edu.tr/academic-calendar.pdf"
    })).toMatchObject({
      allowed: false,
      reasonCode: "redirect_domain_mismatch",
      canonicalFinalRedirectUrl: "https://calendar.istanbul.edu.tr/academic-calendar.pdf"
    });

    expect(evaluate({
      boundary: "fetch",
      finalRedirectUrl: "http://127.0.0.1/private.pdf"
    })).toEqual({
      allowed: false,
      status: "quarantined",
      reasonCode: "unsafe_redirect_url",
      canonicalUrl: "https://www.ankara.edu.tr/duyurular",
      canonicalFinalRedirectUrl: null,
      matchedAuthorityDomain: "ankara.edu.tr"
    });
  });

  it("allows YOK only for an explicit national-authority scope", () => {
    const yok = evaluate({
      resource: "news",
      ownerAcademicEntityId: "yok-council-of-higher-education",
      ownerUniversityId: "yok-council-of-higher-education",
      resolvedOwnerAcademicEntityId: "yok-council-of-higher-education",
      resolvedOwnerUniversityId: "yok-council-of-higher-education",
      scopeId: "yok-council-of-higher-education",
      authorityDomains: [],
      url: "https://www.yok.gov.tr/Sayfalar/Haberler/duyuru.aspx"
    });
    expect(yok).toMatchObject({
      allowed: true,
      status: "trusted",
      reasonCode: "authority_verified",
      matchedAuthorityDomain: "yok.gov.tr"
    });

    expect(evaluate({
      authorityDomains: ["ankara.edu.tr", "yok.gov.tr"],
      url: "https://www.yok.gov.tr/duyurular"
    })).toMatchObject({
      allowed: false,
      status: "quarantined",
      reasonCode: "national_authority_scope_mismatch"
    });
  });

  it.each([
    ["ownerAcademicEntityId", "missing_owner_academic_entity_id"],
    ["ownerUniversityId", "missing_owner_university_id"],
    ["resolvedOwnerAcademicEntityId", "missing_resolved_owner_academic_entity_id"],
    ["resolvedOwnerUniversityId", "missing_resolved_owner_university_id"],
    ["scopeType", "missing_scope_type"],
    ["scopeId", "missing_scope_id"]
  ] as const)("quarantines missing context field %s with a stable reason", (field, reasonCode) => {
    expect(evaluate({ [field]: null })).toMatchObject({
      allowed: false,
      status: "quarantined",
      reasonCode
    });
  });

  it("validates resolved owner identities and the scope-to-owner relationship", () => {
    expect(evaluate({ resolvedOwnerUniversityId: "istanbul-university" })).toMatchObject({
      allowed: false,
      reasonCode: "owner_university_mismatch"
    });
    expect(evaluate({ resolvedOwnerAcademicEntityId: "engineering-faculty" })).toMatchObject({
      allowed: false,
      reasonCode: "owner_academic_entity_mismatch"
    });
    expect(evaluate({ scopeId: "another-university" })).toMatchObject({
      allowed: false,
      reasonCode: "scope_owner_mismatch"
    });

    expect(evaluate({
      ownerAcademicEntityId: "engineering-faculty",
      resolvedOwnerAcademicEntityId: "engineering-faculty",
      scopeType: "faculty",
      scopeId: "engineering-faculty"
    })).toMatchObject({ allowed: true, reasonCode: "authority_verified" });
  });

  it("fails closed for absent, invalid, or overly broad authority domains", () => {
    expect(evaluate({ authorityDomains: [] })).toMatchObject({
      allowed: false,
      reasonCode: "missing_authority_domain"
    });
    expect(evaluate({ authorityDomains: ["*.ankara.edu.tr"] })).toMatchObject({
      allowed: false,
      reasonCode: "invalid_authority_domain"
    });
    expect(evaluate({ authorityDomains: ["edu.tr"] })).toMatchObject({
      allowed: false,
      reasonCode: "invalid_authority_domain"
    });
  });

  it("returns the same authority verdict at registration, fetch, and publication", () => {
    const boundaries: SourceAuthorityBoundary[] = ["registration", "fetch", "publication"];
    const allowed = boundaries.map((boundary) => evaluate({ boundary }));
    const denied = boundaries.map((boundary) => evaluate({
      boundary,
      url: "https://www.istanbul.edu.tr/duyurular"
    }));

    expect(new Set(allowed.map((decision) => JSON.stringify(decision))).size).toBe(1);
    expect(new Set(denied.map((decision) => JSON.stringify(decision))).size).toBe(1);
    expect(allowed[0]).toMatchObject({ allowed: true, reasonCode: "authority_verified" });
    expect(denied[0]).toMatchObject({ allowed: false, reasonCode: "source_domain_mismatch" });
  });

  it("supports every governed resource and produces deterministic decisions without mutating input", () => {
    const resources: SourceAuthorityResource[] = [
      "announcement",
      "news",
      "event",
      "academic_calendar",
      "pdf",
      "website"
    ];
    for (const resource of resources) {
      expect(evaluate({ resource })).toMatchObject({ allowed: true, reasonCode: "authority_verified" });
    }

    const input: EvaluateSourceAuthorityInput = Object.freeze({
      ...universityContext,
      authorityDomains: Object.freeze(["www.ankara.edu.tr", "ankara.edu.tr", "ankara.edu.tr"]),
      finalRedirectUrl: "https://takvim.ankara.edu.tr/calendar.pdf"
    });
    const first = sourceAuthorityPolicy.evaluate(input);
    const second = sourceAuthorityPolicy.evaluate(input);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      allowed: true,
      canonicalUrl: "https://www.ankara.edu.tr/duyurular",
      canonicalFinalRedirectUrl: "https://takvim.ankara.edu.tr/calendar.pdf",
      matchedAuthorityDomain: "ankara.edu.tr"
    });
  });
});
