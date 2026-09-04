import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import * as authorityEnforcement from "../src/domain/source-authority-enforcement.js";
import type { SourceAuthorityContext } from "../src/domain/source-authority-enforcement.js";
import {
  discoverAtuAcademicCalendarPdf,
  downloadPdf,
  fetchAtuCalendarRows
} from "../src/modules/calendars/calendar-ingestion.service.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { downloadPdfData } from "../src/modules/pdf/pdf-ocr.service.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";

const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
const ownerAuthority: SourceAuthorityContext = {
  ownerAcademicEntityId: "university-example",
  ownerUniversityId: "university-example",
  resolvedOwnerAcademicEntityId: "university-example",
  resolvedOwnerUniversityId: "university-example",
  scopeType: "university",
  scopeId: "university-example",
  authorityDomains: ["example.edu.tr"]
};
const atuAuthority: SourceAuthorityContext = {
  ...ownerAuthority,
  ownerAcademicEntityId: "university-atu",
  ownerUniversityId: "university-atu",
  resolvedOwnerAcademicEntityId: "university-atu",
  resolvedOwnerUniversityId: "university-atu",
  scopeId: "university-atu",
  authorityDomains: ["atu.edu.tr"]
};

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.restoreAllMocks();
});

describe("calendar and PDF source-authority boundaries", () => {
  it("applies the owner policy immediately before a PDF request and every redirect", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => url === "https://example.edu.tr/calendar.pdf"
      ? {
          status: 302,
          headers: { location: "https://files.example.edu.tr/calendar.pdf" },
          body: Buffer.alloc(0),
          remoteAddress: pinnedAddress.address
        }
      : {
          status: 200,
          headers: { "content-type": "application/pdf" },
          body: Buffer.from("%PDF-1.7\nfixture"),
          remoteAddress: pinnedAddress.address
        });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const requireAuthority = vi.spyOn(authorityEnforcement, "requireSourceAuthority");

    const result = await downloadPdf("https://example.edu.tr/calendar.pdf", 1_000, ownerAuthority);

    expect(result.finalUrl).toBe("https://files.example.edu.tr/calendar.pdf");
    expect(requestHop).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenNthCalledWith(1, ownerAuthority, {
      boundary: "fetch",
      resource: "pdf",
      url: "https://example.edu.tr/calendar.pdf"
    });
    expect(requireAuthority).toHaveBeenNthCalledWith(2, ownerAuthority, {
      boundary: "fetch",
      resource: "pdf",
      url: "https://example.edu.tr/calendar.pdf",
      finalRedirectUrl: "https://files.example.edu.tr/calendar.pdf"
    });
  });

  it("rejects a cross-owner PDF redirect before the redirected request", async () => {
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://other.edu.tr/calendar.pdf" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(downloadPdf("https://example.edu.tr/calendar.pdf", 1_000, ownerAuthority)).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "redirect_domain_mismatch" }
    });
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("allows an evidence-backed owner alias redirect and preserves slash-sensitive request paths", async () => {
    const aliasAuthority: SourceAuthorityContext = {
      ...ownerAuthority,
      authorityDomains: ["gantep.edu.tr", "gaziantep.edu.tr"]
    };
    const requestedUrls: string[] = [];
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (url, pinnedAddress): Promise<SafeOutboundHopResponse> => {
        requestedUrls.push(url);
        return url === "https://gantep.edu.tr/calendar/"
          ? {
              status: 302,
              headers: { location: "https://files.gaziantep.edu.tr/calendar/" },
              body: Buffer.alloc(0),
              remoteAddress: pinnedAddress.address
            }
          : {
              status: 200,
              headers: { "content-type": "application/pdf" },
              body: Buffer.from("%PDF-1.7\nfixture"),
              remoteAddress: pinnedAddress.address
            };
      }
    });

    const result = await downloadPdf("https://gantep.edu.tr/calendar/", 1_000, aliasAuthority);

    expect(result.finalUrl).toBe("https://files.gaziantep.edu.tr/calendar/");
    expect(requestedUrls).toEqual([
      "https://gantep.edu.tr/calendar/",
      "https://files.gaziantep.edu.tr/calendar/"
    ]);
  });

  it("applies the owner policy to the OCR fallback download and every redirect", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => url === "https://example.edu.tr/ocr-source.pdf"
      ? {
          status: 302,
          headers: { location: "https://files.example.edu.tr/ocr-source.pdf" },
          body: Buffer.alloc(0),
          remoteAddress: pinnedAddress.address
        }
      : {
          status: 200,
          headers: { "content-type": "application/pdf" },
          body: Buffer.from("%PDF-1.7\nfixture"),
          remoteAddress: pinnedAddress.address
        });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const requireAuthority = vi.spyOn(authorityEnforcement, "requireSourceAuthority");

    await expect(downloadPdfData("https://example.edu.tr/ocr-source.pdf", ownerAuthority)).resolves.toEqual(expect.any(Buffer));

    expect(requestHop).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenCalledTimes(2);
    expect(requireAuthority).toHaveBeenLastCalledWith(ownerAuthority, {
      boundary: "fetch",
      resource: "pdf",
      url: "https://example.edu.tr/ocr-source.pdf",
      finalRedirectUrl: "https://files.example.edu.tr/ocr-source.pdf"
    });
  });

  it("rejects a cross-owner OCR redirect before requesting the redirected URL", async () => {
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://other.edu.tr/ocr-source.pdf" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(downloadPdfData("https://example.edu.tr/ocr-source.pdf", ownerAuthority)).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "redirect_domain_mismatch" }
    });
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("applies ATU authority to both page and OData requests", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(url.includes("AkademikTakvim")
        ? { d: [] }
        : { d: { HTMLicerik: "" } })),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const requireAuthority = vi.spyOn(authorityEnforcement, "requireSourceAuthority");

    await discoverAtuAcademicCalendarPdf("2026-2027", 1_000, atuAuthority);
    await fetchAtuCalendarRows(1_000, atuAuthority);

    expect(requireAuthority).toHaveBeenCalledTimes(2);
    for (const [context, check] of requireAuthority.mock.calls) {
      expect(context).toBe(atuAuthority);
      expect(check).toEqual(expect.objectContaining({
        boundary: "fetch",
        resource: "academic_calendar"
      }));
    }
  });

  it("allows an uploaded local PDF without a URL", async () => {
    const service = new PdfProcessingService(new InMemoryPdfRepository(), { extractText: async () => null });

    await expect(service.createPdfSource(validPdfInput("manual-university"))).resolves.toEqual(expect.objectContaining({
      universityId: "manual-university",
      status: "uploaded"
    }));
  });

  it("binds an admin URL source and its extracted text to the exact downloaded PDF bytes", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const repository = new InMemoryPdfRepository();
    const pdfData = textPdf("15 Eylul 2026 Ders Kayitlari");
    const requestHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: { "content-type": "application/pdf" },
      body: pdfData,
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    const service = new PdfProcessingService(repository, { extractText: async () => null });

    const source = await service.createPdfSourceForAdmin({ kind: "global" }, {
      ...validPdfInput(university.id),
      url: "https://files.agu.edu.tr/calendar.pdf",
      fileSize: 1,
      pageCount: 99,
      rawText: "31 Aralik 2099 Sahte Takvim"
    });

    expect(requestHop).toHaveBeenCalledTimes(1);
    expect(source).toEqual(expect.objectContaining({
      binaryIdentityVerified: true,
      binarySha256: createHash("sha256").update(pdfData).digest("hex"),
      fileSize: pdfData.byteLength,
      pageCount: 1,
      activeExtractedEventIds: []
    }));
    expect(source.rawText).toContain("15 Eylul 2026 Ders Kayitlari");
    expect(source.rawText).not.toContain("Sahte Takvim");
  });

  it("rejects changed bytes at an admin URL before claiming a processing generation", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const repository = new InMemoryPdfRepository();
    let responseBody = textPdf("15 Eylul 2026 Ders Kayitlari");
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: responseBody,
        remoteAddress: pinnedAddress.address
      })
    });
    const service = new PdfProcessingService(repository, { extractText: async () => null });
    const source = await service.createPdfSourceForAdmin({ kind: "global" }, {
      ...validPdfInput(university.id),
      url: "https://files.agu.edu.tr/calendar.pdf"
    });
    const beginPdfProcessing = vi.spyOn(repository, "beginPdfProcessing");
    responseBody = textPdf("16 Eylul 2026 Degistirilmis Ders Kayitlari");

    await expect(service.processPdfSourceForAdmin({ kind: "global" }, source.id))
      .rejects.toThrow("does not match the source identity");

    expect(beginPdfProcessing).not.toHaveBeenCalled();
    await expect(repository.findPdfSourceById(source.id)).resolves.toMatchObject({
      version: 1,
      parseStatus: "pending",
      activeExtractedEventIds: []
    });
  });

  it("rejects a cross-owner URL before PDF source persistence", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const repository = new InMemoryPdfRepository();
    const createPdfSource = vi.spyOn(repository, "createPdfSource");
    const service = new PdfProcessingService(repository, { extractText: async () => null });

    await expect(service.createPdfSource({
      ...validPdfInput(university.id),
      url: "https://other.edu.tr/calendar.pdf"
    })).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "source_domain_mismatch" }
    });
    expect(createPdfSource).not.toHaveBeenCalled();
  });

  it("uses the same policy at PDF registration and immediately before persistence", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const service = new PdfProcessingService(
      new InMemoryPdfRepository(),
      { extractText: async () => null }
    );
    const requireAuthority = vi.spyOn(authorityEnforcement, "requireSourceAuthority");

    const source = await service.createPdfSource({
      ...validPdfInput(university.id),
      url: "https://files.agu.edu.tr/calendar.pdf"
    });

    expect(source.url).toBe("https://files.agu.edu.tr/calendar.pdf");
    expect(requireAuthority.mock.calls.map(([, check]) => check.boundary)).toEqual([
      "registration",
      "publication"
    ]);
  });

  it("threads the resolved owner authority into an OCR source download", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const extractText = vi.fn(async () => null);
    const service = new PdfProcessingService(new InMemoryPdfRepository(), { extractText });
    const { rawText: omittedRawText, ...inputWithoutText } = validPdfInput(university.id);
    void omittedRawText;
    const source = await service.createPdfSource({
      ...inputWithoutText,
      url: "https://files.agu.edu.tr/calendar.pdf"
    });

    await service.processPdfSource(source.id);

    expect(extractText).toHaveBeenCalledWith(expect.objectContaining({
      pdfSource: expect.objectContaining({ id: source.id }),
      sourceAuthority: expect.objectContaining({
        ownerUniversityId: university.id,
        authorityDomains: ["agu.edu.tr"]
      })
    }));
  });

  it("revalidates a stored PDF URL before changing parse state or extracted-event persistence", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, { extractText: async () => null });
    const source = await service.createPdfSource(validPdfInput(university.id));
    await repository.updatePdfSource(source.id, { url: "https://other.edu.tr/calendar.pdf" });
    const updatePdfSource = vi.spyOn(repository, "updatePdfSource");
    const createExtractedEvents = vi.spyOn(repository, "createExtractedEvents");

    await expect(service.processPdfSource(source.id)).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "source_domain_mismatch" }
    });
    expect(updatePdfSource).not.toHaveBeenCalled();
    expect(createExtractedEvents).not.toHaveBeenCalled();
  });

  it("enforces PDF authority at the common draft-persistence boundary", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const pdfRepository = new InMemoryPdfRepository();
    const pdfService = new PdfProcessingService(pdfRepository, { extractText: async () => null });
    const source = await pdfService.createPdfSource(validPdfInput(university.id));
    const processed = await pdfService.processPdfSource(source.id);
    expect(processed.extractedEvents.length).toBeGreaterThan(0);
    await pdfService.approveExtractedEvent(processed.extractedEvents[0]!.id, "admin-1");
    await pdfRepository.updatePdfSource(source.id, { url: "https://other.edu.tr/calendar.pdf" });
    const calendarRepository = new InMemoryCalendarRepository();
    const createCalendar = vi.spyOn(calendarRepository, "createCalendar");
    const createEvents = vi.spyOn(calendarRepository, "createEvents");
    const service = new AdminCalendarService(
      calendarRepository,
      pdfRepository,
      undefined,
      undefined,
      catalog
    );

    await expect(service.createDraftFromApprovedExtractedEvents({
      universityId: university.id,
      academicYear: source.academicYear,
      title: "Unsafe PDF draft",
      sourcePdfId: source.id,
      createdBy: "admin-1"
    })).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "source_domain_mismatch" }
    });
    expect(createCalendar).not.toHaveBeenCalled();
    expect(createEvents).not.toHaveBeenCalled();
  });

  it("enforces authority at the common calendar publication boundary before mutation", async () => {
    const catalog = new InMemoryCatalogRepository();
    const university = await catalog.createUniversity({
      name: "Abdullah Gul Universitesi",
      slug: "abdullah-gul-universitesi-kayseri",
      city: "Kayseri",
      type: "state",
      websiteUrl: "https://agu.edu.tr",
      status: "active"
    });
    const calendarRepository = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(
      calendarRepository,
      new InMemoryPdfRepository(),
      undefined,
      undefined,
      catalog
    );
    const draft = await service.createManualDraft({
      universityId: university.id,
      academicYear: "2026-2027",
      title: "Unsafe source publication",
      createdBy: "admin-1",
      events: [{
        title: "Fall term starts",
        category: "fall_term_start",
        term: "fall",
        startDate: "2026-09-15"
      }]
    });
    await calendarRepository.updateCalendar(draft.calendar.id, {
      sourceUrl: "https://other.edu.tr/calendar.pdf"
    });
    const archivePublishedCalendars = vi.spyOn(calendarRepository, "archivePublishedCalendars");
    const updateCalendar = vi.spyOn(calendarRepository, "updateCalendar");
    const updateEventsByCalendar = vi.spyOn(calendarRepository, "updateEventsByCalendar");

    await expect(service.publishCalendar(draft.calendar.id, "admin-1")).rejects.toMatchObject({
      name: "SourceAuthorityError",
      decision: { reasonCode: "source_domain_mismatch" }
    });
    expect(archivePublishedCalendars).not.toHaveBeenCalled();
    expect(updateCalendar).not.toHaveBeenCalled();
    expect(updateEventsByCalendar).not.toHaveBeenCalled();
  });
});

function validPdfInput(universityId: string) {
  return {
    universityId,
    fileName: "calendar.pdf",
    mimeType: "application/pdf",
    magicBytesHex: "255044462d312e37",
    fileSize: 256,
    pageCount: 1,
    academicYear: "2026-2027",
    uploadedBy: "test",
    rawText: "15.09.2026 Course registration"
  };
}

function textPdf(text: string): Buffer {
  const escapedText = text.replace(/([\\()])/gu, "\\$1");
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body, "latin1");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
