import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { SafeOutboundResponse } from "../src/common/network/safe-outbound-request.js";
import type { ResolvedSourceAuthorityContext } from "../src/bootstrap/source-authority-context.js";
import type { VerifiedAcademicUnitSource, VerifiedRegistrySourceEvidence } from "../src/bootstrap/verified-source-registry.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { InMemoryAuditRepository } from "../src/modules/audit/in-memory-audit.repository.js";
import {
  AcademicUnitScheduleIngestionService,
  parseScheduleCandidates,
  type AcademicUnitScheduleFetcher
} from "../src/modules/calendars/academic-unit-schedule-ingestion.service.js";
import { InMemoryAcademicUnitScheduleRepository } from "../src/modules/calendars/in-memory-academic-unit-schedule.repository.js";
import type { AcademicUnitScheduleType } from "../src/modules/calendars/academic-unit-schedule.types.js";

describe("academic-unit schedule ingestion", () => {
  it("does not turn CMS publication metadata into exam rows", () => {
    const candidates = parseScheduleCandidates([
      "Eklenme tarihi: 10.09.2026 10:00",
      "Son g\u00fcncelleme tarihi: 11.09.2026 11:30",
      "Added date: 2026-09-10 12:00",
      "Last updated: 2026-09-11 13:00",
      "Published on: 2026-09-11 14:00",
      "Modified: 2026-09-11 15:00",
      "05.01.2027 10:00-11:00 MAT101 Final Sinavi"
    ].join("\n"), "exam_schedule");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ date: "2027-01-05", startTime: "10:00", title: "MAT101 Final Sinavi" });
  });

  it("fails closed for a legacy registry URL without final revalidation evidence", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00-10:00 Matematik"), false);

    await expect(harness.service.provisionVerifiedRegistry()).resolves.toEqual({
      created: 0,
      existing: 0,
      refreshed: 0,
      disabled: 0,
      skipped: 1,
      skippedByReason: { missing_final_revalidation_evidence: 1 }
    });
    await expect(harness.repository.listSources({ limit: 10, offset: 0 })).resolves.toEqual([]);
  });

  it("provisions verified evidence idempotently and persists its URL/provenance hashes", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00-10:00 Matematik"));

    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ created: 1, skipped: 0 });
    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ existing: 1, created: 0, skipped: 0 });
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });

    expect(source).toMatchObject({
      lifecycle: "ready",
      scheduleType: "course_schedule",
      sourceUrl: "https://schedule.uni.edu.tr/course",
      verifiedFinalUrl: "https://schedule.uni.edu.tr/course",
      revision: 0,
      evidence: expect.objectContaining({ runId: "final-run", sourceType: "course_schedule" })
    });
    expect(source?.sourceUrlHash).toMatch(/^[a-f\d]{64}$/u);
    expect(source?.verifiedFinalUrlHash).toMatch(/^[a-f\d]{64}$/u);
    expect(source?.evidenceHash).toMatch(/^[a-f\d]{64}$/u);
  });

  it("rejects evidence whose content digest and artifact path provenance disagree", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    harness.registrySource.verificationByField!.courseScheduleUrl!.evidencePath = `evidence/html/${"c".repeat(64)}.html.gz`;

    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({
      created: 0,
      skipped: 1,
      skippedByReason: { final_revalidation_evidence_path_invalid: 1 }
    });
  });

  it("rejects cross-owned and partially bound HTML schedule evidence", async () => {
    const crossOwned = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    crossOwned.registrySource.verificationByField!.courseScheduleUrl!.scopeId = "other-department";
    await expect(crossOwned.service.provisionVerifiedRegistry()).resolves.toMatchObject({
      created: 0,
      skipped: 1,
      skippedByReason: { final_revalidation_scope_mismatch: 1 }
    });

    const partial = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    delete partial.registrySource.verificationByField!.courseScheduleUrl!.parserEvidencePath;
    await expect(partial.service.provisionVerifiedRegistry()).resolves.toMatchObject({
      created: 0,
      skipped: 1,
      skippedByReason: { final_revalidation_parser_evidence_invalid: 1 }
    });
  });

  it("authority-checks browser and raw final URLs for document schedule evidence", async () => {
    const harness = await createHarness("exam_schedule", binaryResponse(
      textPdf("05.01.2027 10:00 Final Sinavi"),
      "application/pdf",
      "https://schedule.uni.edu.tr/exam.pdf"
    ));
    harness.registrySource.verificationByField!.examScheduleUrl!.browserFinalUrl = "https://attacker.example/exam.pdf";
    harness.registrySource.verificationByField!.examScheduleUrl!.browserNetworkProofs = [
      { hostname: "attacker.example", addresses: ["93.184.216.34"] }
    ];

    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({
      created: 0,
      skipped: 1,
      skippedByReason: { source_authority_source_domain_mismatch: 1 }
    });
  });

  it("checks every redirect against authority and quarantines an authority-valid final URL that drifted from evidence", async () => {
    let checkedRedirect = false;
    const fetcher: AcademicUnitScheduleFetcher = async (url, options) => {
      expect(url).toBe("https://schedule.uni.edu.tr/course");
      expect(options.maximumResponseBytes).toBe(12 * 1024 * 1024);
      expect(() => options.validateUrl?.("https://attacker.example/schedule", url)).toThrow(/REDIRECT_DOMAIN_MISMATCH/u);
      expect(options.validateUrl?.("https://cdn.uni.edu.tr/course", url)).toBe("https://cdn.uni.edu.tr/course");
      checkedRedirect = true;
      return htmlResponse("Pazartesi 09:00-10:30 Matematik A101", "https://cdn.uni.edu.tr/course");
    };
    const harness = await createHarness("course_schedule", fetcher);
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });

    const result = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);

    expect(checkedRedirect).toBe(true);
    expect(result.lifecycle).toBe("quarantined");
    expect(result.reviewResult).toMatchObject({
      outcome: "definition_drift_review",
      reasonCode: "definition_drift",
      format: "html",
      parser: "none",
      finalUrl: "https://cdn.uni.edu.tr/course",
      candidateCount: 0,
      candidates: []
    });
    expect(result.reviewResult?.finalUrlHash).toMatch(/^[a-f\d]{64}$/u);
    expect(result.reviewResult?.contentSha256).toMatch(/^[a-f\d]{64}$/u);
  });

  it.each([
    {
      label: "PDF",
      type: "exam_schedule" as const,
      response: binaryResponse(textPdf("05.01.2027 10:00-11:00 Final Sinavi"), "application/pdf", "https://schedule.uni.edu.tr/exam.pdf"),
      format: "pdf",
      parser: "pdf_binary_text"
    },
    {
      label: "XLSX",
      type: "exam_schedule" as const,
      response: binaryResponse(createZip({
        "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>05.01.2027 10:00-11:00 Final Sinavi</t></is></c></row></sheetData></worksheet>"
      }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "https://schedule.uni.edu.tr/exam.xlsx"),
      format: "xlsx",
      parser: "office_xlsx"
    }
  ])("reuses the existing $label parser and records review candidates", async ({ type, response, format, parser }) => {
    const harness = await createHarness(type, response);
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });

    const result = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);

    expect(result.reviewResult).toMatchObject({ outcome: "parsed_pending_review", format, parser, candidateCount: 1 });
    expect(result.reviewResult?.candidates[0]).toMatchObject({ date: "2027-01-05", startTime: "10:00", endTime: "11:00" });
  });

  it("records parse-zero and OCR-required outcomes without claiming success", async () => {
    const zero = await createHarness("course_schedule", htmlResponse("Ders programi yakinda yayimlanacaktir"));
    await zero.service.provisionVerifiedRegistry();
    const [zeroSource] = await zero.repository.listSources({ limit: 10, offset: 0 });
    const zeroResult = await zero.service.ingestSource({ kind: "global" }, zeroSource!.id, 0);
    expect(zeroResult.reviewResult).toMatchObject({ outcome: "parse_zero_review", candidateCount: 0, reasonCode: "no_schedule_rows_parsed" });

    const image = await createHarness("exam_schedule", binaryResponse(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
      "https://schedule.uni.edu.tr/exam.png"
    ));
    await image.service.provisionVerifiedRegistry();
    const [imageSource] = await image.repository.listSources({ limit: 10, offset: 0 });
    const imageResult = await image.service.ingestSource({ kind: "global" }, imageSource!.id, 0);
    expect(imageResult.reviewResult).toMatchObject({ outcome: "unsupported_ocr_review", format: "image", reasonCode: "ocr_not_configured" });
  });

  it("persists a bounded review-visible failure when outbound retrieval fails", async () => {
    const harness = await createHarness("exam_schedule", async () => {
      throw new Error("OUTBOUND_DNS_LOOKUP_FAILED:https://secret.invalid/path");
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });

    const result = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);

    expect(result).toMatchObject({
      lifecycle: "review_required",
      reviewResult: {
        outcome: "fetch_failed_review",
        reasonCode: "outbound_dns_lookup_failed",
        candidateCount: 0,
        candidates: []
      }
    });
    expect(JSON.stringify(result.reviewResult)).not.toContain("secret.invalid");
  });

  it("uses a CAS lease so concurrent/stale ingestion cannot overwrite review state", async () => {
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const harness = await createHarness("course_schedule", async () => {
      fetchStarted();
      await gate;
      return htmlResponse("Pazartesi 09:00-10:00 Matematik");
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });

    const first = harness.service.ingestSource({ kind: "global" }, source!.id, 0);
    await started;
    await expect(harness.service.ingestSource({ kind: "global" }, source!.id, 0)).rejects.toMatchObject({ status: 409 });
    releaseFetch();
    await expect(first).resolves.toMatchObject({ lifecycle: "review_required", revision: 2 });
  });

  it("reclaims an expired processing lease without admitting a stale revision", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00-10:00 Matematik"));
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const expired = new Date(Date.now() - 1_000);
    const claimed = await harness.repository.claimSource({
      id: source!.id,
      expectedRevision: source!.revision,
      definitionHash: source!.definitionHash,
      now: expired,
      leaseUntil: expired
    });

    await expect(harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision))
      .rejects.toMatchObject({ status: 409 });
    await expect(harness.service.ingestSource({ kind: "global" }, source!.id, claimed!.revision))
      .resolves.toMatchObject({ lifecycle: "review_required", revision: 3 });
  });

  it("rechecks registry evidence at ingestion even if reconciliation has not run", async () => {
    let fetched = false;
    const harness = await createHarness("course_schedule", async () => {
      fetched = true;
      return htmlResponse("Pazartesi 09:00 Matematik");
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    delete harness.registrySource.verificationByField;

    await expect(harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision)).rejects.toMatchObject({ status: 409 });
    expect(fetched).toBe(false);
  });

  it("recovers an unchanged temporarily disabled definition without losing its review result", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const reviewed = await harness.service.ingestSource({ kind: "global" }, source!.id, 0);
    const evidence = structuredClone(harness.registrySource.verificationByField!);
    delete harness.registrySource.verificationByField;
    await harness.service.provisionVerifiedRegistry();
    harness.registrySource.verificationByField = evidence;

    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ refreshed: 1 });
    const recovered = await harness.repository.findSourceById(source!.id);
    expect(recovered).toMatchObject({
      lifecycle: "review_required",
      reviewResult: reviewed.reviewResult
    });
    expect(recovered?.reviewDecision).toBeUndefined();
  });

  it("clears a stale review decision when a changed verified definition is reprovisioned", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "reject",
      reason: "Yanlis tanim"
    });
    const evidence = harness.registrySource.verificationByField!.courseScheduleUrl!;
    evidence.sha256 = "c".repeat(64);
    evidence.evidencePath = `evidence/documents/${"c".repeat(64)}.bin`;

    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ refreshed: 1 });
    const refreshed = await harness.repository.findSourceById(source!.id);
    expect(refreshed).toMatchObject({ lifecycle: "ready" });
    expect(refreshed?.reviewResult).toBeUndefined();
    expect(refreshed?.reviewDecision).toBeUndefined();
  });

  it("revokes a persisted source when final evidence disappears and fences an in-flight stale result", async () => {
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const harness = await createHarness("course_schedule", async () => {
      fetchStarted();
      await gate;
      return htmlResponse("Pazartesi 09:00-10:00 Matematik");
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingestion = harness.service.ingestSource({ kind: "global" }, source!.id, 0);
    await started;

    delete harness.registrySource.verificationByField;
    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ skipped: 1, disabled: 1 });
    releaseFetch();
    await expect(ingestion).rejects.toMatchObject({ status: 409 });

    const revoked = await harness.repository.findSourceById(source!.id);
    expect(revoked).toMatchObject({ lifecycle: "disabled", revision: 2 });
    await expect(harness.service.ingestSource({ kind: "global" }, source!.id, revoked!.revision)).rejects.toMatchObject({ status: 409 });
  });

  it("hides other universities' review sources from scoped admins", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    await harness.service.provisionVerifiedRegistry();

    await expect(harness.service.listSources({ kind: "university", universityId: "other" }, {})).resolves.toEqual([]);
    await expect(harness.service.listSources({ kind: "university", universityId: "uni" }, {})).resolves.toHaveLength(1);
  });

  it("edits a bounded candidate with revision CAS and records the scoped audit event", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00-10:00 Matematik"));
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "university", universityId: "uni" }, source!.id, 0);

    const updated = await harness.service.updateCandidate(
      { kind: "university", universityId: "uni" },
      "editor-1",
      source!.id,
      1,
      { expectedRevision: ingested.revision, title: "Matematik I", location: "A101" }
    );

    expect(updated.reviewResult?.candidates[0]).toMatchObject({ title: "Matematik I", location: "A101", rawText: expect.stringContaining("Matematik") });
    await expect(harness.service.updateCandidate(
      { kind: "university", universityId: "uni" },
      "editor-2",
      source!.id,
      1,
      { expectedRevision: ingested.revision, title: "Stale" }
    )).rejects.toMatchObject({ status: 409 });
    await expect(harness.audit.listByEntity("academic_unit_schedule_source", source!.id)).resolves.toEqual([
      expect.objectContaining({ actorId: "editor-1", action: "academic_unit_schedule.candidate_updated" })
    ]);
  });

  it("returns a retryable conflict without calendar or event side effects when no published calendar exists", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00-10:00 Matematik"));
    const createCalendar = vi.spyOn(harness.calendars, "createCalendar");
    const upsertEvents = vi.spyOn(harness.calendars, "upsertScheduleReviewEvents");
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, 0);
    const reviewInput = {
      expectedRevision: ingested.revision,
      decision: "approve" as const,
      academicYear: "2026-2027",
      term: "fall" as const,
      courseRangeStart: "2026-09-01",
      courseRangeEnd: "2026-09-14",
      approvedRowNumbers: [1]
    };

    await expect(harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, reviewInput)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Publish a standard academic calendar")
    });

    expect(createCalendar).not.toHaveBeenCalled();
    expect(upsertEvents).not.toHaveBeenCalled();
    await expect(harness.repository.findSourceById(source!.id)).resolves.toMatchObject({
      lifecycle: "materializing",
      reviewDecision: { materializationStatus: "materializing", approvedRowNumbers: [1] }
    });
    await expect(harness.calendars.findPublishedCalendar("uni", "2026-2027")).resolves.toBeNull();
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);

    const calendar = await harness.calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    createCalendar.mockClear();
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, reviewInput);
    expect(staged).toMatchObject({ lifecycle: "staged", reviewDecision: { calendarId: calendar.id, materializationStatus: "staged" } });
    expect(createCalendar).not.toHaveBeenCalled();
    await expect(harness.calendars.listEventsByCalendar(calendar.id)).resolves.toHaveLength(2);
  });

  it("reopens a staged review with revision CAS, archives its rows, and publishes only the corrected decision", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00-10:00 Matematik"));
    const wrongCalendar = await harness.calendars.createCalendar({
      universityId: "uni",
      academicYear: "2025-2026",
      title: "Wrong calendar",
      status: "published",
      version: 1
    });
    const correctedCalendar = await harness.calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Corrected calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2025-2026",
      term: "fall",
      courseRangeStart: "2025-09-01",
      courseRangeEnd: "2025-09-08"
    });
    const originalReviewKey = staged.reviewDecision!.reviewKey;
    const originalEvents = await harness.calendars.listEventsByCalendar(wrongCalendar.id);
    expect(originalEvents.length).toBeGreaterThan(0);
    expect(originalEvents.every((event) => event.status === "approved" && event.scheduleReviewKey === originalReviewKey)).toBe(true);
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);

    await expect(harness.service.reopenReview({ kind: "global" }, "super-1", source!.id, staged.revision - 1))
      .rejects.toMatchObject({ status: 409 });
    await expect(harness.repository.findSourceById(source!.id)).resolves.toMatchObject({ lifecycle: "staged", revision: staged.revision });
    expect((await harness.calendars.listEventsByCalendar(wrongCalendar.id)).every((event) => event.status === "approved")).toBe(true);

    const reopened = await harness.service.reopenReview({ kind: "global" }, "super-1", source!.id, staged.revision);
    expect(reopened).toMatchObject({ lifecycle: "review_required", revision: staged.revision + 2 });
    expect(reopened.reviewDecision).toBeUndefined();
    expect((await harness.calendars.listEventsByCalendar(wrongCalendar.id)).every((event) => event.status === "archived")).toBe(true);
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
    await expect(harness.audit.listByEntity("academic_unit_schedule_source", source!.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: "super-1",
        action: "academic_unit_schedule.review_reopened",
        metadata: expect.objectContaining({ reviewKey: originalReviewKey, archivedEventCount: originalEvents.length })
      })
    ]));

    const corrected = await harness.service.reviewSource({ kind: "global" }, "editor-2", source!.id, {
      expectedRevision: reopened.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall",
      courseRangeStart: "2026-09-07",
      courseRangeEnd: "2026-09-14"
    });
    expect(corrected).toMatchObject({
      lifecycle: "staged",
      reviewDecision: { calendarId: correctedCalendar.id, materializationStatus: "staged", academicYear: "2026-2027" }
    });
    expect(corrected.reviewDecision?.reviewKey).not.toBe(originalReviewKey);
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);

    const published = await harness.service.publishStagedSource({ kind: "global" }, "super-2", source!.id, corrected.revision);
    const publicEvents = await harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 });
    expect(publicEvents.length).toBeGreaterThan(0);
    expect(publicEvents.every((event) => event.calendarId === correctedCalendar.id
      && event.academicYear === "2026-2027"
      && event.scheduleReviewKey === published.reviewDecision?.reviewKey
      && event.status === "published")).toBe(true);
    await expect(harness.service.reopenReview({ kind: "global" }, "super-3", source!.id, published.revision))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("immutable") });
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 }))
      .resolves.toEqual(publicEvents);
    expect((await harness.calendars.listEventsByCalendar(wrongCalendar.id)).every((event) => event.status === "archived")).toBe(true);
  });

  it("fences an in-flight materializer when a review is reopened and leaves no old rows visible", async () => {
    const calendars = new PausingMaterializationCalendarRepository();
    const harness = await createHarness(
      "course_schedule",
      htmlResponse("Pazartesi 09:00-10:00 Matematik"),
      true,
      calendars
    );
    const calendar = await calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    const materialization = harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall",
      courseRangeStart: "2026-09-07",
      courseRangeEnd: "2026-09-14"
    });
    await calendars.waitUntilRowsStaged();
    const materializing = await harness.repository.findSourceById(source!.id);
    expect(materializing).toMatchObject({ lifecycle: "materializing", reviewDecision: { materializationStatus: "materializing" } });

    const reopened = await harness.service.reopenReview({ kind: "global" }, "super-1", source!.id, materializing!.revision);
    expect(reopened).toMatchObject({ lifecycle: "review_required" });
    calendars.releaseMaterialization();
    await expect(materialization).rejects.toMatchObject({ status: 409 });
    expect((await calendars.listEventsByCalendar(calendar.id)).every((event) => event.status === "archived")).toBe(true);
    await expect(calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
  });

  it("stages into an existing published calendar and only the explicit super-admin publication action exposes rows", async () => {
    const harness = await createHarness("exam_schedule", binaryResponse(
      textPdf("05.01.2027 10:00-11:00 Final Sinavi"),
      "application/pdf",
      "https://schedule.uni.edu.tr/exam.pdf"
    ));
    const calendar = await harness.calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, 0);
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall"
    });

    expect(staged.reviewDecision?.calendarId).toBe(calendar.id);
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
    const published = await harness.service.publishStagedSource({ kind: "global" }, "super-1", source!.id, staged.revision);
    expect(published).toMatchObject({ lifecycle: "published", reviewDecision: { materializationStatus: "published", publishedBy: "super-1" } });
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ status: "published", category: "final_exam", universityId: "uni", facultyId: source!.facultyId, departmentId: source!.departmentId })
    ]);

    delete harness.registrySource.verificationByField;
    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ disabled: 1, skipped: 1 });
    await expect(harness.repository.findSourceById(source!.id)).resolves.toMatchObject({ lifecycle: "disabled" });
    await expect(harness.calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
  });

  it("revokes rows when registry disable races an in-flight publication claim", async () => {
    const calendars = new PausingPublicationCalendarRepository();
    const harness = await createHarness("exam_schedule", binaryResponse(
      textPdf("05.01.2027 10:00-11:00 Final Sinavi"),
      "application/pdf",
      "https://schedule.uni.edu.tr/exam.pdf"
    ), true, calendars);
    await calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall"
    });

    const publication = harness.service.publishStagedSource({ kind: "global" }, "super-1", source!.id, staged.revision);
    await calendars.waitUntilRowsPublished();
    delete harness.registrySource.verificationByField;
    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ disabled: 1 });
    calendars.releasePublication();

    await expect(publication).rejects.toMatchObject({ status: 409 });
    await expect(harness.repository.findSourceById(source!.id)).resolves.toMatchObject({ lifecycle: "disabled" });
    await expect(calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
  });

  it("retires published rows before replacing a definition during an in-flight publication", async () => {
    const calendars = new PausingPublicationCalendarRepository();
    const harness = await createHarness("exam_schedule", binaryResponse(
      textPdf("05.01.2027 10:00-11:00 Final Sinavi"),
      "application/pdf",
      "https://schedule.uni.edu.tr/exam.pdf"
    ), true, calendars);
    await calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall"
    });

    const publication = harness.service.publishStagedSource({ kind: "global" }, "super-1", source!.id, staged.revision);
    await calendars.waitUntilRowsPublished();
    const evidence = harness.registrySource.verificationByField!.examScheduleUrl!;
    evidence.sha256 = "c".repeat(64);
    evidence.evidencePath = `evidence/documents/${"c".repeat(64)}.bin`;
    await expect(harness.service.provisionVerifiedRegistry()).resolves.toMatchObject({ disabled: 1, refreshed: 1 });
    calendars.releasePublication();

    await expect(publication).rejects.toMatchObject({ status: 409 });
    await expect(harness.repository.findSourceById(source!.id)).resolves.toMatchObject({ lifecycle: "ready" });
    await expect(calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
  });

  it("does not roll back a newer publication owner after an expired lease takeover", async () => {
    const calendars = new PausingFirstPublicationCalendarRepository();
    const repository = new ExpiringFirstPublicationLeaseRepository();
    const harness = await createHarness("exam_schedule", binaryResponse(
      textPdf("05.01.2027 10:00-11:00 Final Sinavi"),
      "application/pdf",
      "https://schedule.uni.edu.tr/exam.pdf"
    ), true, calendars, repository);
    await calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall"
    });

    const first = harness.service.publishStagedSource({ kind: "global" }, "super-1", source!.id, staged.revision);
    await calendars.waitUntilFirstRowsPublished();
    const expiredOwner = await repository.findSourceById(source!.id);
    const successor = harness.service.publishStagedSource({ kind: "global" }, "super-2", source!.id, expiredOwner!.revision);
    await repository.waitUntilSuccessorCompletes();
    calendars.releaseFirstPublication();

    await expect(first).rejects.toMatchObject({ status: 409 });
    repository.releaseSuccessorCompletion();
    await expect(successor).resolves.toMatchObject({
      lifecycle: "published",
      reviewDecision: { materializationStatus: "published", publishedBy: "super-2" }
    });
    await expect(calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toHaveLength(1);
  });

  it("leaves successor cleanup intact when takeover fails before the stale owner resumes", async () => {
    const calendars = new PausingFirstFailingSecondPublicationCalendarRepository();
    const repository = new ExpiringFirstPublicationLeaseRepository();
    const harness = await createHarness("exam_schedule", binaryResponse(
      textPdf("05.01.2027 10:00-11:00 Final Sinavi"),
      "application/pdf",
      "https://schedule.uni.edu.tr/exam.pdf"
    ), true, calendars, repository);
    await calendars.createCalendar({
      universityId: "uni",
      academicYear: "2026-2027",
      title: "Published calendar",
      status: "published",
      version: 1
    });
    await harness.service.provisionVerifiedRegistry();
    const [source] = await repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, source!.revision);
    const staged = await harness.service.reviewSource({ kind: "global" }, "editor-1", source!.id, {
      expectedRevision: ingested.revision,
      decision: "approve",
      academicYear: "2026-2027",
      term: "fall"
    });

    const first = harness.service.publishStagedSource({ kind: "global" }, "super-1", source!.id, staged.revision);
    await calendars.waitUntilFirstRowsPublished();
    const expiredOwner = await repository.findSourceById(source!.id);
    await expect(harness.service.publishStagedSource({ kind: "global" }, "super-2", source!.id, expiredOwner!.revision))
      .rejects.toThrow("SECOND_PUBLICATION_FAILED");
    calendars.releaseFirstPublication();
    await expect(first).rejects.toMatchObject({ status: 409 });

    const released = await repository.findSourceById(source!.id);
    expect(released).toMatchObject({ lifecycle: "staged", reviewDecision: { materializationStatus: "staged" } });
    await expect(calendars.listPublishedEvents({ universityId: "uni", limit: 20, offset: 0 })).resolves.toEqual([]);
    await expect(harness.service.publishStagedSource({ kind: "global" }, "super-3", source!.id, released!.revision))
      .resolves.toMatchObject({ lifecycle: "published", reviewDecision: { publishedBy: "super-3" } });
  });

  it("lets a university editor reject only its own parsed source without materialization", async () => {
    const harness = await createHarness("course_schedule", htmlResponse("Pazartesi 09:00 Matematik"));
    await harness.service.provisionVerifiedRegistry();
    const [source] = await harness.repository.listSources({ limit: 10, offset: 0 });
    const ingested = await harness.service.ingestSource({ kind: "global" }, source!.id, 0);
    await expect(harness.service.reviewSource(
      { kind: "university", universityId: "other" }, "foreign-editor", source!.id,
      { expectedRevision: ingested.revision, decision: "reject", reason: "no" }
    )).rejects.toMatchObject({ status: 404 });
    await expect(harness.service.reviewSource(
      { kind: "university", universityId: "uni" }, "stale-editor", source!.id,
      { expectedRevision: ingested.revision - 1, decision: "reject", reason: "stale" }
    )).rejects.toMatchObject({ status: 409 });
    const rejected = await harness.service.reviewSource(
      { kind: "university", universityId: "uni" }, "editor-1", source!.id,
      { expectedRevision: ingested.revision, decision: "reject", reason: "Yanlış dönem" }
    );
    expect(rejected).toMatchObject({ lifecycle: "rejected", reviewDecision: { decision: "rejected", reason: "Yanlış dönem" } });
    expect(await harness.calendars.findPublishedCalendar("uni")).toBeNull();
  });
});

async function createHarness(
  scheduleType: AcademicUnitScheduleType,
  responseOrFetcher: SafeOutboundResponse | AcademicUnitScheduleFetcher,
  includeEvidence = true,
  calendars: InMemoryCalendarRepository = new InMemoryCalendarRepository(),
  repository: InMemoryAcademicUnitScheduleRepository = new InMemoryAcademicUnitScheduleRepository()
) {
  const catalog = new InMemoryCatalogRepository();
  const university = await catalog.createUniversity({ name: "University", slug: "uni", city: "Ankara", type: "state", status: "active" });
  const faculty = await catalog.createFaculty({ universityId: university.id, name: "Engineering", slug: "engineering", status: "active" });
  const department = await catalog.createDepartment({
    universityId: university.id,
    facultyId: faculty.id,
    name: "Computer Engineering",
    slug: "computer-engineering",
    educationLevel: "bachelor",
    status: "active"
  });
  const url = scheduleType === "course_schedule"
    ? "https://schedule.uni.edu.tr/course"
    : responseOrFetcher instanceof Function
      ? "https://schedule.uni.edu.tr/exam"
      : responseOrFetcher.finalUrl;
  const evidence = verificationEvidence(scheduleType, url, university.id, department.id);
  const registrySource: VerifiedAcademicUnitSource = {
    scopeType: "department",
    universityId: university.id,
    facultyId: faculty.id,
    departmentId: department.id,
    ...(scheduleType === "course_schedule" ? { courseScheduleUrl: url } : { examScheduleUrl: url }),
    ...(includeEvidence ? {
      verificationByField: scheduleType === "course_schedule"
        ? { courseScheduleUrl: evidence }
        : { examScheduleUrl: evidence }
    } : {})
  };
  const audit = new AuditService(new InMemoryAuditRepository());
  const fetcher: AcademicUnitScheduleFetcher = responseOrFetcher instanceof Function
    ? responseOrFetcher
    : async () => responseOrFetcher;
  const authority: ResolvedSourceAuthorityContext = {
    authorityStatus: "verified",
    reasonCodes: [],
    context: {
      ownerAcademicEntityId: department.id,
      ownerUniversityId: university.id,
      resolvedOwnerAcademicEntityId: department.id,
      resolvedOwnerUniversityId: university.id,
      scopeType: "department",
      scopeId: department.id,
      authorityDomains: ["uni.edu.tr"]
    }
  };
  const service = new AcademicUnitScheduleIngestionService(repository, catalog, async () => [registrySource], fetcher, async () => authority, calendars, audit);
  return { service, repository, registrySource, calendars, audit };
}

class PausingPublicationCalendarRepository extends InMemoryCalendarRepository {
  private release!: () => void;
  private started!: () => void;
  private readonly releaseGate = new Promise<void>((resolve) => { this.release = resolve; });
  private readonly startedGate = new Promise<void>((resolve) => { this.started = resolve; });

  override async publishScheduleReviewEvents(reviewKey: string, universityId: string): Promise<number> {
    const published = await super.publishScheduleReviewEvents(reviewKey, universityId);
    this.started();
    await this.releaseGate;
    return published;
  }

  waitUntilRowsPublished(): Promise<void> {
    return this.startedGate;
  }

  releasePublication(): void {
    this.release();
  }
}

class PausingMaterializationCalendarRepository extends InMemoryCalendarRepository {
  private release!: () => void;
  private started!: () => void;
  private readonly releaseGate = new Promise<void>((resolve) => { this.release = resolve; });
  private readonly startedGate = new Promise<void>((resolve) => { this.started = resolve; });

  override async upsertScheduleReviewEvents(
    input: Parameters<InMemoryCalendarRepository["upsertScheduleReviewEvents"]>[0]
  ) {
    const events = await super.upsertScheduleReviewEvents(input);
    this.started();
    await this.releaseGate;
    return events;
  }

  waitUntilRowsStaged(): Promise<void> {
    return this.startedGate;
  }

  releaseMaterialization(): void {
    this.release();
  }
}

class PausingFirstPublicationCalendarRepository extends InMemoryCalendarRepository {
  private calls = 0;
  private release!: () => void;
  private started!: () => void;
  private readonly releaseGate = new Promise<void>((resolve) => { this.release = resolve; });
  private readonly startedGate = new Promise<void>((resolve) => { this.started = resolve; });

  override async publishScheduleReviewEvents(reviewKey: string, universityId: string): Promise<number> {
    const published = await super.publishScheduleReviewEvents(reviewKey, universityId);
    this.calls += 1;
    if (this.calls === 1) {
      this.started();
      await this.releaseGate;
    }
    return published;
  }

  waitUntilFirstRowsPublished(): Promise<void> {
    return this.startedGate;
  }

  releaseFirstPublication(): void {
    this.release();
  }
}

class PausingFirstFailingSecondPublicationCalendarRepository extends PausingFirstPublicationCalendarRepository {
  private attempts = 0;

  override async publishScheduleReviewEvents(reviewKey: string, universityId: string): Promise<number> {
    const attempt = ++this.attempts;
    const published = await super.publishScheduleReviewEvents(reviewKey, universityId);
    if (attempt === 2) throw new Error("SECOND_PUBLICATION_FAILED");
    return published;
  }
}

class ExpiringFirstPublicationLeaseRepository extends InMemoryAcademicUnitScheduleRepository {
  private claimCount = 0;
  private successorRevision?: number;
  private release!: () => void;
  private started!: () => void;
  private readonly releaseGate = new Promise<void>((resolve) => { this.release = resolve; });
  private readonly startedGate = new Promise<void>((resolve) => { this.started = resolve; });

  override async claimPublication(input: Parameters<InMemoryAcademicUnitScheduleRepository["claimPublication"]>[0]) {
    const claimed = await super.claimPublication(this.claimCount === 0 ? { ...input, leaseUntil: new Date(0) } : input);
    this.claimCount += 1;
    if (this.claimCount === 2 && claimed) this.successorRevision = claimed.revision;
    return claimed;
  }

  override async completePublication(input: Parameters<InMemoryAcademicUnitScheduleRepository["completePublication"]>[0]) {
    if (input.expectedRevision === this.successorRevision) {
      this.started();
      await this.releaseGate;
    }
    return super.completePublication(input);
  }

  waitUntilSuccessorCompletes(): Promise<void> {
    return this.startedGate;
  }

  releaseSuccessorCompletion(): void {
    this.release();
  }
}

function verificationEvidence(
  scheduleType: AcademicUnitScheduleType,
  url: string,
  universityId: string,
  scopeId: string
): VerifiedRegistrySourceEvidence {
  const html = !url.endsWith(".pdf") && !url.endsWith(".xlsx");
  return {
    status: "verified",
    schemaVersion: 4,
    verifierVersion: "authority-pinned-browser-and-raw-v9",
    runId: "final-run",
    manifestHash: "a".repeat(64),
    universityId,
    unitType: "department",
    scopeId,
    sourceType: scheduleType,
    sourceUrl: url,
    finalUrl: url,
    browserFinalUrl: url,
    rawFinalUrl: url,
    discoveryMethod: "academic_unit_registry",
    publicationScope: "department_specific",
    httpStatus: 200,
    contentType: url.endsWith(".pdf") ? "application/pdf" : url.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/html",
    officialDomain: true,
    semanticMatch: true,
    semanticReasons: ["schedule_heading"],
    parserCompatible: true,
    parserItemCount: 1,
    listingItemCount: 1,
    sampleItemUrls: [],
    sampleDetails: [],
    browserNetworkProofs: [{ hostname: "schedule.uni.edu.tr", addresses: ["93.184.216.34"] }],
    verifiedAt: "2026-09-10T09:00:00.000Z",
    finalRevalidatedAt: "2026-09-10T10:00:00.000Z",
    sha256: "b".repeat(64),
    evidencePath: html
      ? `evidence/html/${"b".repeat(64)}.html.gz`
      : `evidence/documents/${"b".repeat(64)}.bin`,
    ...(html ? {
      parserInputSha256: "c".repeat(64),
      parserEvidencePath: `evidence/html/${"c".repeat(64)}.html.gz`
    } : {})
  };
}

function htmlResponse(text: string, finalUrl = "https://schedule.uni.edu.tr/course"): SafeOutboundResponse {
  return binaryResponse(Buffer.from(`<html><body><table><tr><td>${text}</td></tr></table></body></html>`), "text/html; charset=utf-8", finalUrl);
}

function binaryResponse(body: Buffer, contentType: string, finalUrl: string): SafeOutboundResponse {
  return { status: 200, headers: { "content-type": contentType }, body, remoteAddress: "203.0.113.10", finalUrl };
}

function createZip(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const raw = Buffer.from(content);
    const compressed = deflateRawSync(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, compressed);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centralParts.length / 2, 8);
  end.writeUInt16LE(centralParts.length / 2, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function textPdf(text: string): Buffer {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/([\\()])/gu, "\\$1")}) Tj\nET`;
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
