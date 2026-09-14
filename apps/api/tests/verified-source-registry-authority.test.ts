import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildVerifiedSourceAuthorities } from "../../../scripts/build-verified-source-authorities.js";
import {
  findVerifiedSourceAuthority,
  listVerifiedAcademicUnitSources,
  listVerifiedSourceAuthorities,
  listVerifiedUniversitySources
} from "../src/bootstrap/verified-source-registry.js";

describe("verified source authority registry", () => {
  it("rebuilds the checked-in authority file byte-for-byte without timestamps", async () => {
    const generated = await buildVerifiedSourceAuthorities();
    const checkedIn = JSON.parse(await readFile("apps/api/src/bootstrap/verified-source-authorities.json", "utf8"));

    expect(generated).toEqual(checkedIn);
    expect(JSON.stringify(generated)).not.toContain("generatedAt");
  });

  it("binds every catalog university deterministically and quarantines only unresolved owners", async () => {
    const authorities = await listVerifiedSourceAuthorities();

    expect(authorities).toHaveLength(208);
    expect(authorities.filter((authority) => authority.status === "verified")).toHaveLength(207);
    expect(authorities.filter((authority) => authority.status === "quarantined")).toEqual([
      expect.objectContaining({
        universityId: "anka-teknoloji-universitesi",
        authorityDomains: [],
        authorityUrls: [],
        reasonCodes: ["owner_evidence_missing"]
      })
    ]);
    expect(authorities.map((authority) => authority.universityId)).toEqual(
      [...authorities.map((authority) => authority.universityId)].sort((left, right) => left.localeCompare(right, "en-US"))
    );
  });

  it("keeps only explicit, evidence-backed aliases", async () => {
    await expect(findVerifiedSourceAuthority("bahcesehir-universitesi-istanbul")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["bahcesehir.edu.tr", "bau.edu.tr"]
    }));
    await expect(findVerifiedSourceAuthority("gaziantep-universitesi")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["gantep.edu.tr", "gaziantep.edu.tr"]
    }));
    await expect(findVerifiedSourceAuthority("manisa-cel-l-bayar-universitesi")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["cbu.edu.tr", "mcbu.edu.tr"],
      evidence: expect.arrayContaining([
        { type: "CURATED_CATALOG_BINDING", url: "https://www.mcbu.edu.tr/" }
      ])
    }));
    await expect(findVerifiedSourceAuthority("hakkari-universitesi")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["hakkari.edu.tr", "hu.edu.tr"]
    }));
    await expect(findVerifiedSourceAuthority("izmir-yuksek-teknoloji-enstitusu")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["iyte.edu.tr"]
    }));
    await expect(findVerifiedSourceAuthority("izmir-kavram-meslek-yuksekokulu")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["konak.edu.tr"],
      evidence: [{ type: "YOK_HOMEPAGE", url: "https://www.konak.edu.tr/" }]
    }));
    await expect(findVerifiedSourceAuthority("turk-japon-bilim-ve-teknoloji-universitesi")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["tju.edu.tr"],
      evidence: [{ type: "CURATED_CATALOG_BINDING", url: "https://www.tju.edu.tr/" }]
    }));
    await expect(findVerifiedSourceAuthority("turkiye-uluslararasi-islam-bilim-ve-teknoloji-universitesi")).resolves.toEqual(expect.objectContaining({
      authorityDomains: ["tibu.edu.tr"],
      evidence: [{ type: "YOK_HOMEPAGE", url: "https://www.tibu.edu.tr/" }]
    }));

    const authorities = await listVerifiedSourceAuthorities();
    const domains = authorities.flatMap((authority) => authority.authorityDomains);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("removes cross-institution URLs and keeps verified replacements operational", async () => {
    const sources = await listVerifiedUniversitySources();
    const byId = new Map(sources.map((source) => [source.universityId, source]));

    expect(sources).toHaveLength(208);
    expect(byId.get("turk-japon-bilim-ve-teknoloji-universitesi")).toEqual(expect.objectContaining({
      websiteUrl: "https://www.tju.edu.tr/",
      announcementUrl: "https://www.tju.edu.tr/tr/announcements",
      newsUrl: "https://www.tju.edu.tr/tr/news",
      eventUrl: "https://www.tju.edu.tr/tr/events",
      calendarUrl: "https://tju.edu.tr/tr/calendar"
    }));
    expect(byId.get("turkiye-uluslararasi-islam-bilim-ve-teknoloji-universitesi")).toEqual(expect.objectContaining({
      websiteUrl: "https://www.tibu.edu.tr/",
      announcementUrl: "https://tibu.edu.tr/category/duyurular/",
      newsUrl: "https://tibu.edu.tr/category/haberler/"
    }));
    expect(byId.get("anka-teknoloji-universitesi")).not.toHaveProperty("websiteUrl");
    expect(byId.get("izmir-kavram-meslek-yuksekokulu")).toEqual(expect.objectContaining({
      universityName: "İZMİR KONAK MESLEK YÜKSEKOKULU",
      websiteUrl: "https://www.konak.edu.tr/",
      announcementUrl: "https://www.konak.edu.tr/duyurular",
      newsUrl: "https://www.konak.edu.tr/haberler",
      eventUrl: "https://www.konak.edu.tr/etkinlikler",
      calendarUrl: "https://www.konak.edu.tr/akademik/akademik-takvim"
    }));

    expect(byId.get("ankara-bilim-universitesi")).toEqual(expect.objectContaining({
      announcementUrl: "https://ankarabilim.edu.tr/duyurular",
      rawUrls: expect.objectContaining({ summerSchoolUrl: "https://www.ankara.edu.tr/yazokulu" }),
      quarantinedSources: [expect.objectContaining({ field: "summerSchoolUrl", reasonCode: "source_domain_mismatch" })]
    }));
    expect(byId.get("ankara-bilim-universitesi")).not.toHaveProperty("summerSchoolUrl");

    const asbu = byId.get("ankara-sosyal-bilimler-universitesi");
    expect(asbu).toEqual(expect.objectContaining({
      announcementUrl: "https://www.asbu.edu.tr/tr/duyurular",
      newsUrl: "https://www.asbu.edu.tr/tr/haberler",
      eventUrl: "https://www.asbu.edu.tr/tr/etkinlikler",
      calendarUrl: expect.stringContaining("oidb.asbu.edu.tr")
    }));
    expect(asbu).not.toHaveProperty("summerSchoolUrl");
    expect(asbu?.quarantinedSources?.map((item) => item.field)).toEqual(["summerSchoolUrl"]);

    const gibtu = byId.get("gaziantep-islam-bilim-ve-teknoloji-universitesi");
    expect(gibtu).not.toHaveProperty("announcementUrl");
    expect(gibtu).not.toHaveProperty("summerSchoolUrl");
    expect(gibtu?.calendarUrl).toBe("https://www.gibtu.edu.tr/akademiktakvim");
    expect(gibtu?.quarantinedSources).toEqual([]);

    const gaziantep = byId.get("gaziantep-universitesi");
    expect(gaziantep).not.toHaveProperty("announcementUrl");
    expect(gaziantep).toEqual(expect.objectContaining({
      calendarUrl: expect.stringContaining("gantep.edu.tr"),
      summerSchoolUrl: expect.stringContaining("gaziantep.edu.tr")
    }));

    expect(byId.get("kahramanmaras-sutcu-imam-universitesi")).toEqual(expect.objectContaining({
      announcementUrl: "https://www.ksu.edu.tr/default?DId=KSU&MI=42546",
      parserProfiles: {
        announcement: expect.objectContaining({
          parser: "html",
          parserConfig: expect.objectContaining({ itemSelector: "main article.card.blog-card" })
        })
      }
    }));
    expect(byId.get("burdur-mehmet-akif-ersoy-universitesi")?.parserProfiles).toEqual({
      news: expect.objectContaining({ parser: "html" }),
      event: expect.objectContaining({ parser: "html" })
    });
  });

  it("allows national authority only for its own scope and quarantines institutional YOK bindings", async () => {
    const universitySources = await listVerifiedUniversitySources();
    const namikKemal = universitySources.find((source) => source.universityId === "tekirdag-namik-kemal-universitesi");
    expect(namikKemal).not.toHaveProperty("announcementUrl");
    expect(namikKemal).not.toHaveProperty("newsUrl");
    expect(namikKemal?.eventUrl).toBe("https://bhi.nku.edu.tr/json/nku.json2.php?sid=");
    expect(namikKemal?.quarantinedSources).toEqual([]);

    const academicUnits = await listVerifiedAcademicUnitSources();
    const yokBoundUnits = academicUnits.filter((source) =>
      Object.values(source.rawUrls ?? {}).some((url) => new URL(url).hostname.endsWith("yok.gov.tr"))
    );
    expect(yokBoundUnits).toHaveLength(11);
    expect(yokBoundUnits.every((source) =>
      (source.quarantinedSources ?? []).some((item) => item.reasonCode === "national_authority_scope_mismatch")
    )).toBe(true);
  });

  it("checks academic-unit URLs against their owning university authority", async () => {
    const sources = await listVerifiedAcademicUnitSources();
    const bahcesehir = sources.filter((source) => source.universityId === "bahcesehir-universitesi-istanbul");
    expect(bahcesehir.length).toBeGreaterThan(0);
    expect(bahcesehir.filter((source) => source.rawUrls?.websiteUrl).every((source) => Boolean(source.websiteUrl))).toBe(true);

    const gibtu = sources.filter((source) => source.universityId === "gaziantep-islam-bilim-ve-teknoloji-universitesi");
    expect(gibtu).toHaveLength(10);
    expect(gibtu.every((source) => !source.websiteUrl)).toBe(true);
    expect(gibtu.every((source) => (source.quarantinedSources ?? []).some((item) => item.reasonCode === "source_domain_mismatch"))).toBe(true);

    const gaziantep = sources.filter((source) => source.universityId === "gaziantep-universitesi");
    expect(gaziantep).toHaveLength(53);
    expect(gaziantep.filter((source) => source.rawUrls?.websiteUrl).every((source) => Boolean(source.websiteUrl))).toBe(true);
  });

  it("accounts for every checked-in URL as operational or quarantined", async () => {
    const universitySources = await listVerifiedUniversitySources();
    const academicUnitSources = await listVerifiedAcademicUnitSources();
    const universityFields = ["websiteUrl", "announcementUrl", "newsUrl", "eventUrl", "calendarUrl", "summerSchoolUrl"] as const;
    const academicUnitFields = ["websiteUrl", "announcementUrl", "newsUrl", "eventUrl", "courseScheduleUrl", "examScheduleUrl"] as const;
    const rawUniversityCount = universitySources.reduce((total, source) => total + Object.keys(source.rawUrls ?? {}).length, 0);
    const rawAcademicUnitCount = academicUnitSources.reduce((total, source) => total + Object.keys(source.rawUrls ?? {}).length, 0);
    const operationalCount = universitySources.reduce(
      (total, source) => total + universityFields.filter((field) => Boolean(source[field])).length,
      0
    ) + academicUnitSources.reduce(
      (total, source) => total + academicUnitFields.filter((field) => Boolean(source[field])).length,
      0
    );
    const quarantined = [
      ...universitySources.flatMap((source) => source.quarantinedSources ?? []),
      ...academicUnitSources.flatMap((source) => source.quarantinedSources ?? [])
    ];

    expect({ rawUniversityCount, rawAcademicUnitCount }).toEqual({ rawUniversityCount: 609, rawAcademicUnitCount: 6146 });
    expect(operationalCount + quarantined.length).toBe(rawUniversityCount + rawAcademicUnitCount);
    expect(quarantined).toHaveLength(98);
    expect(new Set(quarantined.map((source) => source.id)).size).toBe(quarantined.length);
  });
});
