import { describe, expect, it } from "vitest";
import {
  EXCLUDED_UNIVERSITIES,
  buildTargetManifest,
  canonicalizeUrl,
  classifyCandidateUrl,
  countDateSignals,
  detectDocumentType,
  detectSoft404,
  hasTimetableStructure,
  isExcludedDomain,
  isLikelyListingUrl,
  isOfficialUrl,
  normalizeUniversityName,
  registrableDomain,
  tokenSimilarity,
  validateDocument,
  validateHtmlSemantic,
  validateVerifiedOutputShape
} from "../../scripts/university-source-discovery/core.js";

describe("university source discovery core", () => {
  it("normalizes Turkish characters, aliases, and repeated city suffixes", () => {
    expect(normalizeUniversityName("  AKDENİZ ÜNİVERSİTESİ (ANTALYA) (ANTALYA) ")).toBe("akdeniz universitesi");
    expect(normalizeUniversityName("AĞRI İBRAHİM ÇEÇEN ÜNİVERSİTESİ")).toBe("agri ibrahim cecen universitesi");
  });

  it("derives 201 targets from the canonical 208 while preserving explicit exclusions", () => {
    const sources = [
      ...EXCLUDED_UNIVERSITIES.map(({ universityId, universityName }) => ({ universityId, universityName })),
      ...Array.from({ length: 201 }, (_, index) => ({
        universityId: `test-universitesi-${index + 1}`,
        universityName: `TEST ÜNİVERSİTESİ ${index + 1}`,
        announcementUrl: `https://test-${index + 1}.edu.tr/duyurular`
      }))
    ];
    const canonicalIds = sources.map((record) => record.universityId);
    const manifest = buildTargetManifest(sources, [], canonicalIds, new Date("2026-07-16T00:00:00.000Z"));

    expect(manifest.sourceUniversityCount).toBe(208);
    expect(manifest.expectedTargetCount).toBe(201);
    expect(manifest.targetCount).toBe(manifest.expectedTargetCount);
    expect(manifest.exclusionCount).toBe(EXCLUDED_UNIVERSITIES.length);
    expect(manifest.targets).toHaveLength(manifest.expectedTargetCount);
    expect(new Set(manifest.targets.map((target) => target.universityId)).size).toBe(manifest.expectedTargetCount);
    expect(manifest.targets.some((target) => EXCLUDED_UNIVERSITIES.some((excluded) => excluded.universityId === target.universityId))).toBe(false);

    const expandedSources = [
      ...sources,
      {
        universityId: "gelecek-test-universitesi",
        universityName: "GELECEK TEST ÜNİVERSİTESİ",
        city: "Ankara",
        announcementUrl: "https://gelecek-test.edu.tr/duyurular"
      }
    ];
    const expanded = buildTargetManifest(
      expandedSources,
      [],
      expandedSources.map((record) => record.universityId),
      new Date("2026-07-16T00:00:00.000Z")
    );
    expect(expanded.expectedTargetCount).toBe(manifest.expectedTargetCount + 1);
    expect(expanded.targetCount).toBe(manifest.targetCount + 1);
  });

  it("fails closed when the source registry diverges from the canonical catalog", () => {
    const sources = [
      ...EXCLUDED_UNIVERSITIES.map(({ universityId, universityName }) => ({ universityId, universityName })),
      {
        universityId: "mevcut-test-universitesi",
        universityName: "MEVCUT TEST UNIVERSITESI",
        announcementUrl: "https://mevcut-test.edu.tr/duyurular"
      }
    ];

    expect(() => buildTargetManifest(
      sources,
      [],
      [...sources.map((record) => record.universityId), "eksik-test-universitesi"],
      new Date("2026-07-16T00:00:00.000Z")
    )).toThrow(/missingSources=eksik-test-universitesi/u);
  });

  it("canonicalizes relative URLs and removes tracking without destroying hash routes", () => {
    expect(canonicalizeUrl("../duyurular?utm_source=x&id=3#top", "https://www.example.edu.tr/tr/birim/")).toBe("https://www.example.edu.tr/tr/duyurular?id=3");
    expect(canonicalizeUrl("https://example.edu.tr/#!/TR/duyurular/")).toBe("https://example.edu.tr/#!/TR/duyurular/");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("handles Turkish academic registrable domains and excluded subdomains", () => {
    expect(registrableDomain("https://dis.akdeniz.edu.tr/tr/")).toBe("akdeniz.edu.tr");
    expect(registrableDomain("oidb.ankara.edu.tr")).toBe("ankara.edu.tr");
    expect(isExcludedDomain("https://fakulte.batman.edu.tr/duyurular")).toBe(true);
    expect(isOfficialUrl("https://oidb.ankara.edu.tr/takvim", ["ankara.edu.tr"])).toBe(true);
    expect(isOfficialUrl("https://ankara-university.example/takvim", ["ankara.edu.tr"])).toBe(false);
  });

  it("classifies source categories without treating exam schedules as course schedules", () => {
    expect(classifyCandidateUrl("https://u.edu.tr/duyurular")).toBe("announcement");
    expect(classifyCandidateUrl("https://u.edu.tr/content", "Etkinlik Takvimi")).toBe("event");
    expect(classifyCandidateUrl("https://u.edu.tr/akademik-takvim.pdf")).toBe("academic_calendar");
    expect(classifyCandidateUrl("https://u.edu.tr/sinav-programi.pdf")).toBe("exam_schedule");
    expect(classifyCandidateUrl("https://u.edu.tr/haftalik-ders-programi.xlsx")).toBe("course_schedule");
    expect(classifyCandidateUrl("https://u.edu.tr/haberler/mezuniyet-coskusu")).toBe("news");
    expect(isLikelyListingUrl("https://u.edu.tr/haberler/mezuniyet-coskusu", "news")).toBe(false);
    expect(isLikelyListingUrl("https://u.edu.tr/tr/haberler", "news")).toBe(true);
    expect(isLikelyListingUrl("https://u.edu.tr/category/duyurular/", "announcement")).toBe(true);
    expect(classifyCandidateUrl("https://u.edu.tr/uploads/Etkinlik.png")).toBeNull();
  });

  it("detects explicit and homepage-fallback soft 404 pages", () => {
    expect(detectSoft404("404", "Sayfa bulunamadı", "Aradığınız içerik bulunamadı", "https://u.edu.tr/missing")).toBe(true);
    expect(detectSoft404("Üniversite", "Ana Sayfa", "Kurumsal içerik", "https://u.edu.tr/missing")).toBe(true);
    expect(detectSoft404("Duyurular", "Duyurular", "12 Temmuz 2026 kayıt duyurusu", "https://u.edu.tr/duyurular")).toBe(false);
  });

  it("requires real listing items and meaningful content for announcement sources", () => {
    const valid = validateHtmlSemantic({
      sourceType: "announcement",
      requestedUrl: "https://u.edu.tr/duyurular",
      finalUrl: "https://u.edu.tr/duyurular",
      title: "Duyurular",
      heading: "Güncel Duyurular",
      text: "Üniversitemizin öğrenciler için yayınladığı güncel duyurular burada listelenmektedir. Kayıt işlemleri ve başvuru tarihleri hakkında ayrıntılı bilgiler bulunmaktadır.",
      itemCount: 3
    });
    const empty = validateHtmlSemantic({
      sourceType: "announcement",
      requestedUrl: "https://u.edu.tr/duyurular",
      finalUrl: "https://u.edu.tr/duyurular",
      title: "Duyurular",
      heading: "Duyurular",
      text: "Duyuru bulunmamaktadır.",
      itemCount: 0
    });
    expect(valid.semanticMatch).toBe(true);
    expect(empty.semanticMatch).toBe(false);
    expect(empty.reasons).toContain("listing_items_missing");
    expect(validateHtmlSemantic({
      sourceType: "announcement",
      requestedUrl: "https://u.edu.tr/duyurular/tek-duyuru",
      finalUrl: "https://u.edu.tr/duyurular/tek-duyuru",
      title: "Kayıt Duyurusu",
      heading: "Kayıt Duyurusu",
      text: "Bu detay sayfası öğrenci kayıt tarihleri hakkında uzun ve anlamlı bir açıklama içerir. İlgili diğer duyurular sayfanın altında listelenmektedir.",
      itemCount: 4
    }).reasons).toContain("listing_url_shape_invalid");
  });

  it("validates academic-calendar date evidence", () => {
    const text = "2026-2027 Akademik Takvim Güz Yarıyılı 14.09.2026 ders başlangıcı 18.01.2027 sınav sonu";
    expect(countDateSignals(text)).toBeGreaterThanOrEqual(3);
    expect(validateHtmlSemantic({
      sourceType: "academic_calendar",
      requestedUrl: "https://u.edu.tr/akademik-takvim",
      finalUrl: "https://u.edu.tr/akademik-takvim",
      title: "Akademik Takvim",
      heading: "2026-2027 Eğitim Öğretim Yılı",
      text: `${text} Bu takvim eğitim öğretim dönemlerinin başlangıç ve bitiş tarihlerini içerir.`
    }).semanticMatch).toBe(true);
  });

  it("separates timetable structure from generic curriculum text", () => {
    const schedule = "Bilgisayar Mühendisliği Ders Programı Pazartesi 09:00 BIL101 Salı 10:00 MAT101 Çarşamba 13:30 FIZ101 Cuma 15:00";
    expect(hasTimetableStructure(schedule)).toBe(true);
    expect(hasTimetableStructure("Ders kataloğu ve müfredat bilgileri")).toBe(false);
    expect(validateHtmlSemantic({
      sourceType: "course_schedule",
      requestedUrl: "https://u.edu.tr/ders-programi",
      finalUrl: "https://u.edu.tr/ders-programi",
      title: "Ders Programı",
      heading: "Haftalık Ders Programı",
      text: `${schedule} Derslik ve öğretim elemanı bilgileri tabloda gösterilmiştir.`,
      scopeName: "Bilgisayar Mühendisliği"
    }).semanticMatch).toBe(true);
  });

  it("validates real file signatures before semantic document acceptance", () => {
    const pdf = new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048)]));
    expect(detectDocumentType(pdf)).toBe("pdf");
    const result = validateDocument({
      sourceType: "academic_calendar",
      url: "https://u.edu.tr/2026-2027-akademik-takvim.pdf",
      contentType: "application/pdf",
      body: pdf,
      extractedText: "2026-2027 Akademik Takvim Güz Yarıyılı 14.09.2026 başlangıç 18.01.2027 bitiş"
    });
    expect(result.semanticMatch).toBe(true);
  });

  it("rejects blank or unverified records from the verified dataset schema", () => {
    const valid = {
      sourceUrl: "https://u.edu.tr/duyurular",
      finalUrl: "https://u.edu.tr/duyurular",
      browserOpened: true,
      semanticMatch: true,
      soft404: false,
      officialDomain: true,
      verifiedAt: "2026-07-16T00:00:00.000Z",
      sha256: "a".repeat(64),
      evidencePath: "evidence/html/a.html.gz",
      status: "verified"
    };
    expect(validateVerifiedOutputShape(valid)).toEqual([]);
    expect(validateVerifiedOutputShape({ ...valid, sourceUrl: "", status: "rejected" })).toEqual(expect.arrayContaining(["invalid_source_url", "status_not_verified"]));
  });

  it("supports department evidence on a shared faculty schedule", () => {
    const sharedText = "Mühendislik Fakültesi Bilgisayar Mühendisliği haftalık ders programı";
    expect(tokenSimilarity("Bilgisayar Mühendisliği", sharedText)).toBe(1);
    expect(tokenSimilarity("Kimya Mühendisliği", sharedText)).toBeLessThan(1);
  });
});
