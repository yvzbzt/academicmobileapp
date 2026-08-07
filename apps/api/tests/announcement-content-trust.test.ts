import { describe, expect, it } from "vitest";
import {
  canonicalContentKey,
  canonicalizeContentUrl,
  decodeHtmlEntities,
  evaluateContentTrust,
  isNavigationOrChromeTitle,
  isOfficialContentUrl,
  normalizeContentTitle,
  normalizeDisplayText,
  normalizeTrustedItemsForSource,
  toIsoString,
  toTrustedAcademicContentDto
} from "../src/modules/announcements/announcement-content-trust.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import type { AnnouncementItem, AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import type { AuthRepository, AuthUserRecord } from "../src/modules/auth/auth.types.js";

describe("academic content trust primitives", () => {
  it("decodes named, decimal, hexadecimal, nested, and non-breaking entities", () => {
    expect(decodeHtmlEntities("&raquo; Araştırma &amp; Geliştirme&nbsp;&#187;&#x20AC; &amp;raquo;"))
      .toBe("» Araştırma & Geliştirme »€ »");
    expect(normalizeDisplayText("<b>Bilim&nbsp;&amp;&nbsp;Teknoloji</b>"))
      .toBe("Bilim & Teknoloji");
    expect(decodeHtmlEntities("M&uuml;hendislik &Uuml;niversitesi &deg;&ensp;&unknown;"))
      .toBe("Mühendislik Üniversitesi °  ");
    expect(normalizeDisplayText("Burs &amp;amp;amp;amp;raquo; &deg; Duyurusu"))
      .toBe("Burs » ° Duyurusu");
  });

  it.each([
    "Sonraki",
    "Önceki",
    "Ana Sayfa",
    "Bağlı Kuruluşlar",
    "Geçmiş Duyurular",
    "Tüm Duyurular",
    "Devamını Oku",
    "Duyurular",
    "2",
    "1 / 10",
    "1 2 3 4",
    "Sayfa 2 / 10",
    "6 of 10 --",
    "Menu",
    "Breadcrumb",
    "Sidebar",
    "Footer",
    "Alt Bilgi",
    "Sayfa Sonu",
    "Yan Menü",
    "Üst Menü",
    "»"
  ])("rejects navigation, pagination, menu, breadcrumb, sidebar, and footer title %s", (title) => {
    expect(isNavigationOrChromeTitle(title)).toBe(true);
    expect(evaluateContentTrust({
      rawTitle: title,
      url: "https://www.ankara.edu.tr/duyurular/ogrenci",
      officialSourceUrl: "https://www.ankara.edu.tr/duyurular",
      contentType: "announcement"
    }).status).toBe("rejected");
  });

  it("normalizes an unusable non-navigation title while preserving its raw audit value", () => {
    const result = normalizeContentTitle("---", "announcement", "https://www.ankara.edu.tr/duyurular/yatay-gecis-basvurulari");
    expect(result).toEqual({
      rawTitle: "---",
      title: "Yatay Gecis Basvurulari",
      rejected: false
    });
  });

  it("removes a pagination prefix from real content and preserves the byte-exact raw title", () => {
    const rawTitle = `6 of 10 -- Ｂurs Başvurusu ${"x".repeat(4_100)}`;
    const result = normalizeContentTitle(rawTitle, "announcement", "https://www.ankara.edu.tr/duyurular/burs");
    expect(result.rejected).toBe(false);
    expect(result.rawTitle).toBe(rawTitle);
    expect(result.title).toMatch(/^Burs Başvurusu/u);
    expect(result.title).not.toContain("6 of 10");
    expect(normalizeContentTitle(
      "2026/2027 Eğitim-Öğretim Yılı Duyurusu",
      "announcement",
      "https://www.ankara.edu.tr/duyurular/akademik-yil"
    ).title).toBe("2026/2027 Eğitim-Öğretim Yılı Duyurusu");
  });

  it("accepts only real, unambiguous ISO timestamps", () => {
    expect(toIsoString("2026-02-28T10:30:00+03:00")).toBe("2026-02-28T07:30:00.000Z");
    expect(toIsoString("2024-02-29")).toBe("2024-02-29T00:00:00.000Z");
    expect(toIsoString("2026-02-30T10:30:00Z")).toBeUndefined();
    expect(toIsoString("07/30/2026 10:30")).toBeUndefined();
    expect(toIsoString("2026-07-30T10:30:00")).toBeUndefined();
  });

  it("canonicalizes safe official URLs and detects duplicates without trusting schemes or hosts", () => {
    const left = canonicalizeContentUrl("HTTPS://WWW.ANKARA.EDU.TR/duyuru/1/?utm_source=test&b=2&a=1#footer");
    const right = canonicalizeContentUrl("https://ankara.edu.tr/duyuru/1?a=1&b=2");
    expect(left).toBe("https://www.ankara.edu.tr/duyuru/1?a=1&b=2");
    expect(canonicalContentKey(left!)).toBe(canonicalContentKey(right!));
    expect(canonicalContentKey("https://ankara.edu.tr/Duyuru/FileA"))
      .not.toBe(canonicalContentKey("https://ankara.edu.tr/duyuru/filea"));
    expect(isOfficialContentUrl(left!, "https://ankara.edu.tr/duyurular")).toBe(true);
    expect(isOfficialContentUrl("https://example.edu.tr/duyuru/1", "https://ankara.edu.tr/duyurular")).toBe(false);
    expect(canonicalizeContentUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeContentUrl("data:text/html,test")).toBeNull();
    expect(canonicalizeContentUrl("file:///etc/passwd")).toBeNull();
    expect(canonicalizeContentUrl("http://127.0.0.1/internal")).toBeNull();
    expect(canonicalizeContentUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(canonicalizeContentUrl("http://[::1]/internal")).toBeNull();
    expect(canonicalizeContentUrl("http://[::ffff:7f00:1]/internal")).toBeNull();
    expect(canonicalizeContentUrl("https://user:secret@ankara.edu.tr/duyuru")).toBeNull();
  });
});

describe("mobile announcement API presentation", () => {
  it("whitelists normalized trusted fields, separates all timestamps, deduplicates, and suppresses rejected content", async () => {
    const repository = new InMemoryAnnouncementRepository();
    const source = await repository.upsertSource({
      scopeType: "university",
      scopeId: "ankara-university",
      sourceName: "Ankara &amp; Üniversitesi",
      sourceUrl: "https://www.ankara.edu.tr/duyurular/",
      contentType: "announcement",
      parser: "auto",
      priority: 20,
      status: "active"
    });
    const fetchedAt = new Date().toISOString();
    const items: AnnouncementItem[] = [
      {
        id: "trusted-1",
        sourceId: source.id,
        sourceName: source.sourceName,
        contentType: "announcement",
        scopeType: "university",
        scopeId: source.scopeId,
        title: "&raquo; Araştırma &amp; Geliştirme Duyurusu",
        rawTitle: "&raquo; Araştırma &amp; Geliştirme Duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/1?utm_source=crawler",
        publishedAt: "2026-07-28T07:00:00.000Z",
        publicationTimeSource: "source",
        sourceUpdatedAt: "2026-07-29T09:00:00.000Z",
        sourceUpdateTimeSource: "source",
        discoveredAt: "2026-07-29T10:00:00.000Z",
        fetchedAt,
        summary: "<p>Başvurular&nbsp;açıldı.</p>",
        rawInternalField: "must-not-leak"
      } as AnnouncementItem & { rawInternalField: string },
      {
        id: "duplicate",
        sourceId: source.id,
        sourceName: source.sourceName,
        contentType: "announcement",
        scopeType: "university",
        scopeId: source.scopeId,
        title: "&raquo; Araştırma &amp; Geliştirme Duyurusu",
        link: "https://ankara.edu.tr/duyuru/1",
        publishedAt: "2026-07-28T07:00:00.000Z",
        publicationTimeSource: "source",
        discoveredAt: "2026-07-20T10:00:00.000Z",
        fetchedAt,
        summary: "<p>Başvurular&nbsp;açıldı.</p>"
      },
      {
        id: "crawl-time-only",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Öğrenci işleri duyurusu",
        link: "https://www.ankara.edu.tr/duyuru/2",
        publishedAt: fetchedAt,
        discoveredAt: fetchedAt,
        fetchedAt
      },
      {
        id: "navigation",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Devamını Oku",
        link: "https://www.ankara.edu.tr/duyuru/3",
        fetchedAt
      },
      {
        id: "unsafe",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Güvenli görünmeyen duyuru",
        link: "javascript:alert(1)",
        fetchedAt
      },
      {
        id: "quarantined",
        sourceId: source.id,
        sourceName: source.sourceName,
        scopeType: "university",
        scopeId: source.scopeId,
        title: "Karantinadaki duyuru",
        link: "https://www.ankara.edu.tr/duyuru/4",
        fetchedAt,
        trustStatus: "quarantined"
      }
    ];
    await repository.replaceItemsForSource(source, items);
    const service = new AnnouncementsService(createAuthRepository(), repository);

    const result = await service.getMyAnnouncements("student-1", 20);

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.id === "trusted-1")).toEqual(expect.objectContaining({
      id: "trusted-1",
      sourceName: "Ankara & Üniversitesi",
      title: "Araştırma & Geliştirme Duyurusu",
      link: "https://www.ankara.edu.tr/duyuru/1",
      canonicalUrl: "https://www.ankara.edu.tr/duyuru/1",
      publishedAt: "2026-07-28T07:00:00.000Z",
      sourceUpdatedAt: "2026-07-29T09:00:00.000Z",
      discoveredAt: "2026-07-29T10:00:00.000Z",
      fetchedAt,
      summary: "Başvurular açıldı."
    }));
    expect(result.find((item) => item.id === "crawl-time-only")).not.toHaveProperty("publishedAt");
    expect(JSON.stringify(result)).not.toContain("rawTitle");
    expect(JSON.stringify(result)).not.toContain("rawInternalField");
    expect(JSON.stringify(result)).not.toContain("trustStatus");
    expect(JSON.stringify(result)).not.toContain("Devamını Oku");
    expect(JSON.stringify(result)).not.toContain("javascript:");
  });

  it("requires an explicitly trusted item and matching active trusted source", () => {
    const base: AnnouncementItem = {
      id: "item",
      sourceId: "source",
      sourceName: "YÖK",
      scopeType: "university",
      scopeId: "yok",
      title: "Duyuru başlığı",
      link: "https://www.yok.gov.tr/tr/duyuru/1",
      officialSourceUrl: "https://www.yok.gov.tr/tr/announcements"
    };
    const source: AnnouncementSourceRecord = {
      id: "source",
      scopeType: "university",
      scopeId: "yok",
      sourceName: "YÃ–K",
      sourceUrl: "https://www.yok.gov.tr/tr/announcements",
      parser: "auto",
      priority: 100,
      status: "active",
      trustStatus: "trusted",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const trusted = { ...base, trustStatus: "trusted" as const };
    const legacySource: AnnouncementSourceRecord = { ...source };
    delete legacySource.trustStatus;

    expect(toTrustedAcademicContentDto(trusted, source)).not.toBeNull();
    expect(toTrustedAcademicContentDto(base, source)).toBeNull();
    expect(toTrustedAcademicContentDto(trusted)).toBeNull();
    expect(toTrustedAcademicContentDto(trusted, { ...source, id: "different-source" })).toBeNull();
    expect(toTrustedAcademicContentDto(trusted, legacySource)).toBeNull();
    expect(toTrustedAcademicContentDto(trusted, { ...source, trustStatus: "rejected" })).toBeNull();
    expect(toTrustedAcademicContentDto(trusted, { ...source, trustStatus: "quarantined" })).toBeNull();
    expect(toTrustedAcademicContentDto({ ...base, trustStatus: "rejected" }, source)).toBeNull();
    expect(toTrustedAcademicContentDto({ ...base, trustStatus: "quarantined" }, source)).toBeNull();
  });

  it("does not collapse different valid fingerprints merely because their canonical URL matches", () => {
    const source: AnnouncementSourceRecord = {
      id: "source-one",
      scopeType: "university",
      scopeId: "university-one",
      sourceName: "Örnek Üniversitesi",
      sourceUrl: "https://example.edu.tr/duyurular",
      canonicalUrl: "https://example.edu.tr/duyurular",
      parser: "auto",
      priority: 10,
      status: "active",
      trustStatus: "trusted",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const shared = {
      sourceId: source.id,
      sourceName: source.sourceName,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      link: "https://example.edu.tr/duyurular/shared-location",
      canonicalUrl: "https://example.edu.tr/duyurular/shared-location",
      officialSourceUrl: source.sourceUrl,
      trustStatus: "trusted" as const
    };

    const normalized = normalizeTrustedItemsForSource(source, [
      { ...shared, id: "stored-a", title: "Birinci akademik duyuru" },
      { ...shared, id: "stored-b", title: "İkinci akademik duyuru" }
    ]);

    expect(normalized).toHaveLength(2);
    expect(new Set(normalized.map((item) => item.contentFingerprint)).size).toBe(2);
  });

  it("rejects item-owned provenance that conflicts with the authoritative source", () => {
    const source = {
      id: "ankara-source",
      scopeType: "university" as const,
      scopeId: "ankara-university",
      sourceName: "Ankara Üniversitesi",
      sourceUrl: "https://www.ankara.edu.tr/duyurular",
      canonicalUrl: "https://www.ankara.edu.tr/duyurular",
      parser: "auto" as const,
      priority: 20,
      status: "active" as const,
      trustStatus: "trusted" as const,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const item: AnnouncementItem = {
      id: "forged",
      sourceId: source.id,
      sourceName: "YÖK",
      scopeType: "university",
      scopeId: "yok",
      title: "Kurul duyurusu",
      link: "https://www.yok.gov.tr/tr/duyuru/1",
      officialSourceUrl: "https://www.yok.gov.tr/tr/announcements",
      trustStatus: "trusted"
    };
    expect(toTrustedAcademicContentDto(item, source)).toBeNull();
    const sameDomain = toTrustedAcademicContentDto({
      ...item,
      link: "https://www.ankara.edu.tr/duyuru/1",
      officialSourceUrl: "https://www.ankara.edu.tr/duyurular"
    }, source);
    expect(sameDomain).toEqual(expect.objectContaining({
      sourceName: "Ankara Üniversitesi",
      scopeId: "ankara-university"
    }));
  });
});

function createAuthRepository(): AuthRepository {
  const now = new Date();
  const user: AuthUserRecord = {
    id: "student-1",
    credentialGeneration: 0,
    fullName: "Student",
    email: "student@ankara.edu.tr",
    passwordHash: "hash",
    role: "student",
    universityId: "ankara-university",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  return {
    async findUserById(id: string) {
      return id === user.id ? user : null;
    }
  } as unknown as AuthRepository;
}
