import { describe, expect, it } from "vitest";
import {
  buildSourceAuthorityCoverage,
  stableSourceAuthorityCoverageJson,
  validateSourceAuthorityCoverage,
  type SourceAuthorityCoverageInput
} from "../src/domain/source-authority-coverage.js";

describe("source authority coverage", () => {
  it("builds the same deeply equal, stably serialized offline report twice", () => {
    const first = buildSourceAuthorityCoverage(fixture());
    const second = buildSourceAuthorityCoverage(fixture());

    expect(second).toStrictEqual(first);
    expect(stableSourceAuthorityCoverageJson(second)).toBe(stableSourceAuthorityCoverageJson(first));
    expect(stableSourceAuthorityCoverageJson(first)).not.toContain("generatedAt");
    expect(first.operationalEvidence).toStrictEqual({
      liveAccess: "unknown",
      freshness: "unknown",
      itemProduction: "unknown"
    });
    expect(first.sourceAudits.every((source) => (
      source.liveAccess === "unknown"
      && source.freshness === "unknown"
      && source.itemProduction === "unknown"
    ))).toBe(true);
  });

  it("reports honest source states, complete scope/content coverage, and missing institutions", () => {
    const report = buildSourceAuthorityCoverage(fixture());

    expect(report.summary).toStrictEqual({
      catalogInstitutions: 6,
      configuredSources: 14,
      authorityValidSources: 7,
      institutionsWithVerifiedAuthority: 4,
      institutionsWithQuarantinedAuthority: 1,
      institutionsMissingAuthority: 1
    });
    expect(report.sourceStatusCounts).toStrictEqual({
      active: { known: 0, unknown: 14 },
      trusted: 7,
      rejected: 0,
      quarantined: 7
    });
    expect(report.coverageByScopeAndContentType).toHaveLength(9);
    expect(report.coverageByScopeAndContentType).toContainEqual({
      scopeType: "university",
      contentType: "announcement",
      configured: 5,
      authorityValid: 2,
      trusted: 2,
      rejected: 0,
      quarantined: 3
    });
    expect(report.coverageByScopeAndContentType).toContainEqual({
      scopeType: "faculty",
      contentType: "news",
      configured: 1,
      authorityValid: 1,
      trusted: 1,
      rejected: 0,
      quarantined: 0
    });
    expect(report.coverageByScopeAndContentType).toContainEqual({
      scopeType: "department",
      contentType: "event",
      configured: 1,
      authorityValid: 0,
      trusted: 0,
      rejected: 0,
      quarantined: 1
    });
    expect(report.institutionsWithoutValidContentSources.announcement.map((item) => item.universityId))
      .toStrictEqual(["authority-quarantined", "gibtu", "missing-authority", "nku"]);
    expect(report.institutionsWithoutValidContentSources.news.map((item) => item.universityId))
      .toStrictEqual(["asbu", "authority-quarantined", "gibtu", "missing-authority", "nku"]);
    expect(report.institutionsWithoutValidContentSources.event.map((item) => item.universityId))
      .toStrictEqual(["asbu", "authority-quarantined", "gibtu", "good", "missing-authority", "nku"]);
    expect(report.institutionsWithoutValidContentSources.anyContent.map((item) => item.universityId))
      .toStrictEqual(["authority-quarantined", "gibtu", "missing-authority", "nku"]);
  });

  it("quarantines the targeted cross-owner, national-authority, and direct-document anomalies", () => {
    const report = buildSourceAuthorityCoverage(fixture());
    const byId = new Map(report.sourceAudits.map((source) => [source.id, source]));

    expect(byId.get("university:asbu:newsUrl")).toMatchObject({
      disposition: "quarantined",
      authorityValid: false,
      reasonCodes: ["source_domain_mismatch"]
    });
    expect(byId.get("university:asbu:summerSchoolUrl")).toMatchObject({
      disposition: "quarantined",
      authorityValid: false,
      reasonCodes: ["source_domain_mismatch"]
    });
    expect(byId.get("university:gibtu:announcementUrl")).toMatchObject({
      disposition: "quarantined",
      reasonCodes: ["source_domain_mismatch"]
    });
    expect(byId.get("university:nku:eventUrl")).toMatchObject({
      disposition: "quarantined",
      reasonCodes: ["national_authority_scope_mismatch"]
    });
    expect(byId.get("academic-unit:department:good__good-faculty__good-department:courseScheduleUrl")).toMatchObject({
      disposition: "trusted",
      authorityValid: true,
      resource: "pdf",
      matchedAuthorityDomain: "good.edu.tr"
    });
    expect(byId.get("university:authority-quarantined:announcementUrl")).toMatchObject({
      authorityStatus: "quarantined",
      disposition: "quarantined",
      reasonCodes: ["owner_evidence_missing"]
    });
  });

  it("keeps the named Ankara, Gaziantep, YÖK, and off-domain PDF anomalies visible", () => {
    const catalogInstitutions = [
      ["ankara-bilim-universitesi", "Ankara Bilim Üniversitesi"],
      ["ankara-sosyal-bilimler-universitesi", "ASBÜ"],
      ["gaziantep-islam-bilim-ve-teknoloji-universitesi", "GİBTÜ"],
      ["gaziantep-universitesi", "Gaziantep Üniversitesi"],
      ["tekirdag-namik-kemal-universitesi", "Tekirdağ Namık Kemal Üniversitesi"]
    ].map(([universityId, universityName]) => ({ universityId: universityId!, universityName: universityName! }));
    const report = buildSourceAuthorityCoverage({
      catalogInstitutions,
      authorities: [
        verifiedAuthority("ankara-bilim-universitesi", "ankarabilim.edu.tr"),
        verifiedAuthority("ankara-sosyal-bilimler-universitesi", "asbu.edu.tr"),
        verifiedAuthority("gaziantep-islam-bilim-ve-teknoloji-universitesi", "gibtu.edu.tr"),
        {
          ...verifiedAuthority("gaziantep-universitesi", "gaziantep.edu.tr"),
          authorityDomains: ["gaziantep.edu.tr", "gantep.edu.tr"]
        },
        verifiedAuthority("tekirdag-namik-kemal-universitesi", "nku.edu.tr")
      ],
      universitySources: [
        {
          universityId: "ankara-bilim-universitesi",
          universityName: "Ankara Bilim Üniversitesi",
          summerSchoolUrl: "https://www.ankara.edu.tr/yazokulu"
        },
        {
          universityId: "ankara-sosyal-bilimler-universitesi",
          universityName: "ASBÜ",
          newsUrl: "https://www.ankara.edu.tr/haberler"
        },
        {
          universityId: "gaziantep-islam-bilim-ve-teknoloji-universitesi",
          universityName: "GİBTÜ",
          announcementUrl: "https://gaziantep.edu.tr/duyurular",
          calendarUrl: "https://oidb.gantep.edu.tr/files/akademik-takvim.pdf"
        },
        {
          universityId: "gaziantep-universitesi",
          universityName: "Gaziantep Üniversitesi",
          announcementUrl: "https://gaziantep.edu.tr/duyurular"
        },
        {
          universityId: "tekirdag-namik-kemal-universitesi",
          universityName: "Tekirdağ Namık Kemal Üniversitesi",
          announcementUrl: "https://www.yok.gov.tr/duyurular"
        }
      ],
      academicUnitSources: []
    });
    const byId = new Map(report.sourceAudits.map((source) => [source.id, source]));

    expect(byId.get("university:ankara-bilim-universitesi:summerSchoolUrl")?.reasonCodes)
      .toStrictEqual(["source_domain_mismatch"]);
    expect(byId.get("university:ankara-sosyal-bilimler-universitesi:newsUrl")?.reasonCodes)
      .toStrictEqual(["source_domain_mismatch"]);
    expect(byId.get("university:gaziantep-islam-bilim-ve-teknoloji-universitesi:announcementUrl")?.reasonCodes)
      .toStrictEqual(["source_domain_mismatch"]);
    expect(byId.get("university:gaziantep-islam-bilim-ve-teknoloji-universitesi:calendarUrl"))
      .toMatchObject({ disposition: "quarantined", resource: "pdf", reasonCodes: ["source_domain_mismatch"] });
    expect(byId.get("university:gaziantep-universitesi:announcementUrl"))
      .toMatchObject({ disposition: "trusted", authorityValid: true });
    expect(byId.get("university:tekirdag-namik-kemal-universitesi:announcementUrl")?.reasonCodes)
      .toStrictEqual(["national_authority_scope_mismatch"]);
  });

  it("classifies non-PDF course and exam schedule pages as academic-calendar sources", () => {
    const report = buildSourceAuthorityCoverage({
      catalogInstitutions: [{
        universityId: "good",
        universityName: "Good University",
        faculties: [{
          slug: "good-faculty",
          departments: [{ slug: "good-department" }]
        }]
      }],
      authorities: [verifiedAuthority("good", "good.edu.tr")],
      universitySources: [],
      academicUnitSources: [{
        scopeType: "department",
        universityId: "good",
        departmentId: "good__good-faculty__good-department",
        courseScheduleUrl: "https://department.good.edu.tr/course-schedule",
        examScheduleUrl: "https://department.good.edu.tr/exam-schedule"
      }]
    });

    expect(report.sourceAudits.map((source) => ({ field: source.sourceField, resource: source.resource }))).toEqual([
      { field: "courseScheduleUrl", resource: "academic_calendar" },
      { field: "examScheduleUrl", resource: "academic_calendar" }
    ]);
  });

  it("uses catalog ownership to quarantine cross-owner and missing academic-unit scopes", () => {
    const report = buildSourceAuthorityCoverage({
      catalogInstitutions: [
        {
          universityId: "alpha",
          universityName: "Alpha University",
          faculties: [{
            slug: "engineering",
            departments: [{ slug: "computer-engineering" }]
          }]
        },
        {
          universityId: "beta",
          universityName: "Beta University",
          faculties: [{ slug: "law" }]
        }
      ],
      authorities: [
        verifiedAuthority("alpha", "alpha.edu.tr"),
        verifiedAuthority("beta", "beta.edu.tr")
      ],
      universitySources: [],
      academicUnitSources: [
        {
          scopeType: "faculty",
          universityId: "beta",
          facultyId: "alpha__engineering",
          announcementUrl: "https://faculty.beta.edu.tr/announcements"
        },
        {
          scopeType: "department",
          universityId: "beta",
          departmentId: "alpha__engineering__computer-engineering",
          newsUrl: "https://department.beta.edu.tr/news"
        },
        {
          scopeType: "department",
          universityId: "alpha",
          departmentId: "alpha__engineering__missing-department",
          eventUrl: "https://department.alpha.edu.tr/events"
        }
      ]
    });
    const byId = new Map(report.sourceAudits.map((source) => [source.id, source]));

    expect(byId.get("academic-unit:faculty:alpha__engineering:announcementUrl")).toMatchObject({
      disposition: "quarantined",
      authorityValid: false,
      reasonCodes: ["owner_university_mismatch"]
    });
    expect(byId.get("academic-unit:department:alpha__engineering__computer-engineering:newsUrl"))
      .toMatchObject({
        disposition: "quarantined",
        authorityValid: false,
        reasonCodes: ["owner_university_mismatch"]
      });
    expect(byId.get("academic-unit:department:alpha__engineering__missing-department:eventUrl"))
      .toMatchObject({
        disposition: "quarantined",
        authorityValid: false,
        reasonCodes: ["missing_resolved_owner_academic_entity_id"]
      });
  });

  it("fails validation when totals or offline evidence are falsified", () => {
    const report = buildSourceAuthorityCoverage(fixture());
    expect(() => validateSourceAuthorityCoverage(report)).not.toThrow();
    expect(() => validateSourceAuthorityCoverage({
      ...report,
      sourceStatusCounts: {
        ...report.sourceStatusCounts,
        active: { known: 1, unknown: report.sourceStatusCounts.active.unknown - 1 }
      }
    })).toThrow("SOURCE_AUTHORITY_COVERAGE_ACTIVE_EVIDENCE_INVALID");
  });
});

function fixture(): SourceAuthorityCoverageInput {
  return {
    catalogInstitutions: [
      { universityId: "nku", universityName: "Namık Kemal Üniversitesi" },
      {
        universityId: "good",
        universityName: "Good Üniversitesi",
        faculties: [{
          slug: "good-faculty",
          departments: [{ slug: "good-department" }]
        }]
      },
      { universityId: "asbu", universityName: "ASBÜ" },
      { universityId: "gibtu", universityName: "GİBTÜ" },
      { universityId: "missing-authority", universityName: "Missing Authority Üniversitesi" },
      { universityId: "authority-quarantined", universityName: "Authority Quarantined Üniversitesi" }
    ],
    authorities: [
      verifiedAuthority("good", "good.edu.tr"),
      verifiedAuthority("asbu", "asbu.edu.tr"),
      verifiedAuthority("gibtu", "gibtu.edu.tr"),
      verifiedAuthority("nku", "nku.edu.tr"),
      {
        universityId: "authority-quarantined",
        status: "quarantined",
        authorityDomains: [],
        authorityUrls: [],
        reasonCodes: ["owner_evidence_missing"]
      }
    ],
    universitySources: [
      {
        universityId: "good",
        universityName: "Good Üniversitesi",
        announcementUrl: "https://www.good.edu.tr/duyurular",
        calendarUrl: "https://oidb.good.edu.tr/2026-2027.pdf"
      },
      {
        universityId: "asbu",
        universityName: "ASBÜ",
        announcementUrl: "https://www.asbu.edu.tr/duyurular",
        newsUrl: "https://www.ankara.edu.tr/haberler",
        quarantinedSources: [{
          id: "university:asbu:summerSchoolUrl",
          field: "summerSchoolUrl",
          url: "https://www.ankara.edu.tr/yazokulu",
          reasonCode: "source_domain_mismatch"
        }]
      },
      {
        universityId: "gibtu",
        universityName: "GİBTÜ",
        announcementUrl: "https://gaziantep.edu.tr/duyurular"
      },
      {
        universityId: "nku",
        universityName: "Namık Kemal Üniversitesi",
        eventUrl: "https://www.yok.gov.tr/events"
      },
      {
        universityId: "missing-authority",
        universityName: "Missing Authority Üniversitesi",
        announcementUrl: "https://missing.edu.tr/duyurular"
      },
      {
        universityId: "authority-quarantined",
        universityName: "Authority Quarantined Üniversitesi",
        announcementUrl: "https://unknown.edu.tr/duyurular"
      }
    ],
    academicUnitSources: [
      {
        scopeType: "faculty",
        universityId: "good",
        universityName: "Good Üniversitesi",
        facultyId: "good__good-faculty",
        websiteUrl: "https://faculty.good.edu.tr",
        newsUrl: "https://faculty.good.edu.tr/haberler"
      },
      {
        scopeType: "department",
        universityId: "good",
        universityName: "Good Üniversitesi",
        facultyId: "good__good-faculty",
        departmentId: "good__good-faculty__good-department",
        announcementUrl: "https://department.good.edu.tr/duyurular",
        eventUrl: "https://other.edu.tr/etkinlikler",
        courseScheduleUrl: "https://department.good.edu.tr/files/course-schedule.pdf"
      }
    ]
  };
}

function verifiedAuthority(universityId: string, domain: string) {
  return {
    universityId,
    status: "verified" as const,
    authorityDomains: [domain],
    authorityUrls: [`https://${domain}`],
    reasonCodes: []
  };
}
