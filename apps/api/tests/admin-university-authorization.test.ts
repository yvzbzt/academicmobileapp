import { ConflictException, ForbiddenException, NotFoundException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  adminUniversityAccessFor,
  type AdminUniversityAccess
} from "../src/common/authorization/admin-university-access.js";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import { AnnouncementIngestionService } from "../src/modules/announcements/announcement-ingestion.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { AdminCalendarService } from "../src/modules/calendars/admin-calendar.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import type { DepartmentRecord, FacultyRecord, UniversityRecord } from "../src/modules/catalog/catalog.types.js";
import { InMemoryPdfRepository } from "../src/modules/pdf/in-memory-pdf.repository.js";
import { PdfProcessingService } from "../src/modules/pdf/pdf-processing.service.js";

const universityOneAccess: AdminUniversityAccess = { kind: "university", universityId: "university-one" };
const globalAccess: AdminUniversityAccess = { kind: "global" };
const disabledOcr = { extractText: async () => null };

describe("server-derived admin university scope", () => {
  it.each(["content_editor", "university_admin"] as const)("requires a university for %s", (role) => {
    expect(adminUniversityAccessFor(adminUser(role, "university-one"))).toEqual(universityOneAccess);
    expect(() => adminUniversityAccessFor(adminUser(role))).toThrow(ForbiddenException);
  });

  it("keeps super admins global", () => {
    expect(adminUniversityAccessFor(adminUser("super_admin"))).toEqual(globalAccess);
  });

  it("hydrates university and academic-unit scope from the current server user", async () => {
    const repository = new InMemoryAuthRepository();
    const user = await repository.createUser({
      fullName: "Scoped Editor",
      email: "editor@university-one.edu.tr",
      passwordHash: "hash",
      role: "content_editor",
      universityId: "university-one",
      facultyId: "faculty-one",
      departmentId: "department-one",
      status: "active"
    });
    const tokenService = new TokenService();
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${tokenService.signAccessToken(user)}` }
    };

    await expect(new JwtAuthGuard(tokenService, repository).canActivate(executionContext(request))).resolves.toBe(true);
    expect(request.user).toEqual(expect.objectContaining({
      universityId: "university-one",
      facultyId: "faculty-one",
      departmentId: "department-one"
    }));
  });
});

describe("announcement-source university authorization", () => {
  it("scopes reads and rejects foreign source IDs while allowing own writes", async () => {
    const catalog = new InMemoryCatalogRepository();
    const first = await createAcademicTree(catalog, "one");
    const second = await createAcademicTree(catalog, "two");
    const repository = new InMemoryAnnouncementRepository();
    const ownUniversitySource = await repository.upsertSource(sourceInput("university", first.university.id, "Own university", first.university.websiteUrl!));
    const ownFacultySource = await repository.upsertSource(sourceInput("faculty", first.faculty.id, "Own faculty", first.faculty.websiteUrl!));
    const ownDepartmentSource = await repository.upsertSource(sourceInput("department", first.department.id, "Own department", first.department.websiteUrl!));
    const foreignSource = await repository.upsertSource(sourceInput("university", second.university.id, "Foreign", second.university.websiteUrl!));
    const service = new AnnouncementIngestionService(catalog, repository);
    const access: AdminUniversityAccess = { kind: "university", universityId: first.university.id };

    const visible = await service.listSourcesForAdmin(access, { status: "active" });
    expect(visible.map((source) => source.id)).toEqual(expect.arrayContaining([
      ownUniversitySource.id,
      ownFacultySource.id,
      ownDepartmentSource.id
    ]));
    expect(visible.map((source) => source.id)).not.toContain(foreignSource.id);

    const ingestSpy = vi.spyOn(service, "ingestSource").mockImplementation(async (source) => ({
      sourceId: source.id,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      status: "healthy",
      itemCount: 0,
      sampleTitles: []
    }));
    const ingestion = await service.runIngestionForAdmin(access);
    expect(ingestion.results.map((result) => result.sourceId)).toEqual(expect.arrayContaining([
      ownUniversitySource.id,
      ownFacultySource.id,
      ownDepartmentSource.id
    ]));
    expect(ingestion.results.map((result) => result.sourceId)).not.toContain(foreignSource.id);
    ingestSpy.mockRestore();

    await expect(service.updateManualSourceForAdmin(access, ownUniversitySource.id, sourceEditRequest(ownUniversitySource, { status: "inactive" })))
      .resolves.toMatchObject({ source: { id: ownUniversitySource.id, status: "inactive" }, ingestion: null });
    await expect(service.updateManualSourceForAdmin(access, foreignSource.id, sourceEditRequest(foreignSource, { status: "inactive" })))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deactivateManualSourceForAdmin(access, ownUniversitySource.id, sourceReviewRequest(ownUniversitySource)))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.deactivateManualSourceForAdmin(access, foreignSource.id, sourceReviewRequest(foreignSource)))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.ingestSourceByIdForAdmin(access, foreignSource.id))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createManualSourceForAdmin(access, {
      scopeType: "university",
      universityId: second.university.id,
      sourceName: "Foreign source",
      sourceUrl: `${second.university.websiteUrl}/announcements`,
      contentType: "announcement",
      parser: "html",
      priority: 10,
      fetchIntervalMinutes: 60
    })).rejects.toBeInstanceOf(ForbiddenException);

    await expect(service.updateManualSourceForAdmin(globalAccess, foreignSource.id, sourceEditRequest(foreignSource, { status: "inactive" })))
      .resolves.toMatchObject({ source: { id: foreignSource.id, status: "inactive" } });
  });
});

describe("PDF university authorization", () => {
  it("scopes aggregate reads and all source/event ID operations", async () => {
    const repository = new InMemoryPdfRepository();
    const service = new PdfProcessingService(repository, disabledOcr as never);
    const ownSource = await service.createPdfSource(pdfInput("university-one", "own.pdf"));
    const foreignSource = await service.createPdfSource(pdfInput("university-two", "foreign.pdf"));
    const ownProcessed = await service.processPdfSource(ownSource.id);
    const foreignProcessed = await service.processPdfSource(foreignSource.id);
    const ownEvent = ownProcessed.extractedEvents[0]!;
    const foreignEvent = foreignProcessed.extractedEvents[0]!;

    await expect(service.createPdfSourceForAdmin(universityOneAccess, pdfInput("university-two", "blocked.pdf")))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listExtractedEventsForAdmin(universityOneAccess, {}))
      .resolves.toEqual([expect.objectContaining({ id: ownEvent.id, universityId: "university-one" })]);
    await expect(service.getPdfSourceForAdmin(universityOneAccess, foreignSource.id))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.processPdfSourceForAdmin(universityOneAccess, foreignSource.id))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listExtractedEventsForAdmin(universityOneAccess, { pdfSourceId: foreignSource.id }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getExtractedEventForAdmin(universityOneAccess, foreignEvent.id))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateExtractedEventForAdmin(universityOneAccess, foreignEvent.id, { normalizedTitle: "Blocked" }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.approveExtractedEventForAdmin(universityOneAccess, foreignEvent.id, "editor-one"))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.rejectExtractedEventForAdmin(universityOneAccess, foreignEvent.id, "editor-one"))
      .rejects.toBeInstanceOf(NotFoundException);

    await expect(service.updateExtractedEventForAdmin(universityOneAccess, ownEvent.id, { normalizedTitle: "Own update" }))
      .resolves.toMatchObject({ id: ownEvent.id, normalizedTitle: "Own update" });
    await expect(service.getPdfSourceForAdmin(globalAccess, foreignSource.id))
      .resolves.toMatchObject({ id: foreignSource.id, universityId: "university-two" });
  });
});

describe("course-schedule university authorization", () => {
  it("validates academic-unit ownership and scopes series archive atomically", async () => {
    const catalog = new InMemoryCatalogRepository();
    const first = await createAcademicTree(catalog, "one");
    const second = await createAcademicTree(catalog, "two");
    const calendars = new InMemoryCalendarRepository();
    const service = new AdminCalendarService(
      calendars,
      new InMemoryPdfRepository(),
      undefined,
      undefined,
      catalog
    );
    await publishCalendar(service, first.university.id);
    await publishCalendar(service, second.university.id);
    const firstAccess: AdminUniversityAccess = { kind: "university", universityId: first.university.id };
    const secondAccess: AdminUniversityAccess = { kind: "university", universityId: second.university.id };
    const own = await service.createCourseScheduleSeriesForAdmin(firstAccess, scheduleInput(first));
    const foreign = await service.createCourseScheduleSeriesForAdmin(secondAccess, scheduleInput(second));

    await expect(service.listCourseSchedulesForAdmin(firstAccess, {
      universityId: first.university.id,
      departmentId: first.department.id
    })).resolves.toHaveLength(1);
    await expect(service.listCourseSchedulesForAdmin(firstAccess, {
      universityId: second.university.id,
      departmentId: second.department.id
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createCourseScheduleSeriesForAdmin(firstAccess, {
      ...scheduleInput(first),
      facultyId: second.faculty.id,
      departmentId: second.department.id
    })).rejects.toBeInstanceOf(NotFoundException);

    await expect(service.archiveCourseScheduleSeriesForAdmin(firstAccess, foreign.seriesId))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listCourseSchedulesForAdmin(secondAccess, {
      universityId: second.university.id,
      departmentId: second.department.id
    })).resolves.toHaveLength(1);
    await expect(service.archiveCourseScheduleSeriesForAdmin(firstAccess, own.seriesId))
      .resolves.toEqual({ seriesId: own.seriesId, archivedCount: 1 });
    await expect(service.archiveCourseScheduleSeriesForAdmin(globalAccess, foreign.seriesId))
      .resolves.toEqual({ seriesId: foreign.seriesId, archivedCount: 1 });
  });
});

function adminUser(role: "content_editor" | "university_admin" | "super_admin", universityId?: string) {
  return {
    id: `${role}-1`,
    email: `${role}@example.edu.tr`,
    role,
    ...(universityId ? { universityId } : {})
  };
}

function executionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

async function createAcademicTree(catalog: InMemoryCatalogRepository, suffix: string): Promise<{
  university: UniversityRecord;
  faculty: FacultyRecord;
  department: DepartmentRecord;
}> {
  const fixture = suffix === "one"
    ? {
      universityName: "Abdullah Gul Universitesi Kayseri",
      universitySlug: "abdullah-gul-universitesi-kayseri",
      universityUrl: "https://www.agu.edu.tr",
      city: "Kayseri",
      facultyName: "Muhendislik Fakultesi",
      facultySlug: "muhendislik-fakultesi",
      departmentName: "Bilgisayar Muhendisligi",
      departmentSlug: "bilgisayar-muhendisligi"
    }
    : {
      universityName: "Adana Alparslan Turkes Bilim ve Teknoloji Universitesi",
      universitySlug: "adana-alparslan-turkes-bilim-ve-teknoloji-universitesi",
      universityUrl: "https://www.atu.edu.tr",
      city: "Adana",
      facultyName: "Muhendislik Fakultesi",
      facultySlug: "muhendislik-fakultesi",
      departmentName: "Elektrik Elektronik Muhendisligi",
      departmentSlug: "elektrik-elektronik-muhendisligi"
    };
  const university = await catalog.createUniversity({
    name: fixture.universityName,
    slug: fixture.universitySlug,
    city: fixture.city,
    type: "state",
    websiteUrl: fixture.universityUrl,
    status: "active"
  });
  const faculty = await catalog.createFaculty({
    universityId: university.id,
    name: fixture.facultyName,
    slug: fixture.facultySlug,
    websiteUrl: new URL("/faculty", fixture.universityUrl).toString(),
    status: "active"
  });
  const department = await catalog.createDepartment({
    universityId: university.id,
    facultyId: faculty.id,
    name: fixture.departmentName,
    slug: fixture.departmentSlug,
    educationLevel: "bachelor",
    websiteUrl: new URL("/department", fixture.universityUrl).toString(),
    status: "active"
  });
  return { university, faculty, department };
}

function sourceInput(
  scopeType: "university" | "faculty" | "department",
  scopeId: string,
  sourceName: string,
  homepageUrl: string
) {
  return {
    scopeType,
    scopeId,
    sourceName,
    sourceUrl: `${homepageUrl}/announcements`,
    contentType: "announcement" as const,
    parser: "html" as const,
    priority: 10,
    status: "active" as const,
    homepageUrl,
    discoveryMethod: "manual" as const,
    trustStatus: "trusted" as const
  };
}

function sourceEditRequest(source: AnnouncementSourceRecord, updates: { status: "active" | "inactive" }) {
  return {
    ...sourceReviewRequest(source),
    expectedUpdatedAt: source.updatedAt.toISOString(),
    ...updates
  };
}

function sourceReviewRequest(source: AnnouncementSourceRecord) {
  return {
    expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
    expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
    expectedTrustStatus: source.trustStatus ?? "quarantined" as const,
    expectedSourceStatus: source.status,
    expectedApprovalPending: source.approvalPending === true
  };
}

function pdfInput(universityId: string, fileName: string) {
  return {
    universityId,
    fileName,
    mimeType: "application/pdf",
    magicBytesHex: "25504446",
    fileSize: 1024,
    pageCount: 1,
    academicYear: "2026-2027",
    uploadedBy: "admin-1",
    rawText: "01.09.2026 Güz dönemi başlangıcı"
  };
}

async function publishCalendar(service: AdminCalendarService, universityId: string): Promise<void> {
  const draft = await service.createManualDraft({
    universityId,
    academicYear: "2026-2027",
    title: `${universityId} calendar`,
    createdBy: "super-admin",
    events: [{
      title: "Fall term start",
      category: "fall_term_start",
      term: "fall",
      startDate: "2026-09-01"
    }]
  });
  await service.publishCalendar(draft.calendar.id, "super-admin");
}

function scheduleInput(tree: { university: UniversityRecord; faculty: FacultyRecord; department: DepartmentRecord }) {
  return {
    universityId: tree.university.id,
    facultyId: tree.faculty.id,
    departmentId: tree.department.id,
    academicYear: "2026-2027",
    term: "fall" as const,
    title: "Data structures",
    startDate: "2026-09-07T09:00:00+03:00"
  };
}
