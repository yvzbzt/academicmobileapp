import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AnnouncementsService } from "../src/modules/announcements/announcements.service.js";
import { InMemoryAnnouncementRepository } from "../src/modules/announcements/in-memory-announcement.repository.js";
import type { AnnouncementSourceRecord } from "../src/modules/announcements/announcements.types.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { CalendarService } from "../src/modules/calendars/calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import type { UniversityRecord } from "../src/modules/catalog/catalog.types.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { TestUserDataRepository } from "./support/test-user-data.repository.js";

describe("multi-university student contract", () => {
  it("returns an empty feed without a primary university and supports one or multiple followed universities", async () => {
    const fixture = await createFixture();
    const student = await createStudent(fixture.auth, "student-without-primary@example.com");

    await expect(fixture.announcements.getMyAnnouncementsCollection(student.id, 10)).resolves.toEqual({
      items: [],
      state: "fresh",
      sourceCount: 0,
      failedSourceCount: 0
    });
    await expect(fixture.announcements.getMyTrustedAnnouncement(student.id, "missing-content"))
      .rejects.toBeInstanceOf(NotFoundException);

    await fixture.users.addFollowedScope(student.id, { universityId: fixture.universities.first.id });
    expect((await fixture.announcements.getMyAnnouncements(student.id, 10)).map((item) => item.title))
      .toEqual(["First followed announcement"]);

    await fixture.users.addFollowedScope(student.id, { universityId: fixture.universities.second.id });
    expect((await fixture.announcements.getMyAnnouncements(student.id, 10)).map((item) => item.title))
      .toEqual(["First followed announcement", "Second followed announcement"]);
  });

  it("merges 0/1/2/3 followed universities, removes a duplicate primary scope, then applies one global order and limit", async () => {
    const fixture = await createFixture();

    await expect(fixture.announcements.getMyAnnouncements(fixture.student.id, 10))
      .resolves.toMatchObject([{ title: "Primary announcement" }]);

    const duplicatePrimary = await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.primary.id
    });
    await expect(fixture.announcements.getMyAnnouncementsCollection(fixture.student.id, 10))
      .resolves.toMatchObject({
        items: [{ title: "Primary announcement" }],
        sourceCount: 1
      });

    const firstFollow = await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.first.id
    });
    expect((await fixture.announcements.getMyAnnouncements(fixture.student.id, 10)).map((item) => item.title))
      .toEqual(["First followed announcement", "Primary announcement"]);

    const secondFollow = await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.second.id
    });
    expect((await fixture.announcements.getMyAnnouncements(fixture.student.id, 10)).map((item) => item.title))
      .toEqual(["First followed announcement", "Second followed announcement", "Primary announcement"]);

    const thirdFollow = await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.third.id
    });
    const globallyLimited = await fixture.announcements.getMyAnnouncementsCollection(fixture.student.id, 3);
    expect(globallyLimited.items.map((item) => item.title)).toEqual([
      "Third followed announcement",
      "First followed announcement",
      "Second followed announcement"
    ]);
    expect(globallyLimited.sourceCount).toBe(4);

    await expect(fixture.users.listFollowedScopes(fixture.student.id)).resolves.toEqual([
      duplicatePrimary,
      firstFollow,
      secondFollow,
      thirdFollow
    ]);
  });

  it("attributes every primary and followed-university item to its own university", async () => {
    const fixture = await createFixture();

    await Promise.all([
      fixture.users.addFollowedScope(fixture.student.id, {
        universityId: fixture.universities.first.id
      }),
      fixture.users.addFollowedScope(fixture.student.id, {
        universityId: fixture.universities.second.id
      }),
      fixture.users.addFollowedScope(fixture.student.id, {
        universityId: fixture.universities.third.id
      })
    ]);

    const response = await fixture.announcements.getMyAnnouncementsCollection(fixture.student.id, 10);
    const universityByTitle = Object.fromEntries(response.items.map((item) => [
      item.title,
      {
        scopeId: item.scopeId,
        universityId: item.universityId,
        universityName: item.universityName
      }
    ]));

    expect(universityByTitle).toEqual({
      "Primary announcement": {
        scopeId: fixture.universities.primary.id,
        universityId: fixture.universities.primary.id,
        universityName: fixture.universities.primary.name
      },
      "First followed announcement": {
        scopeId: fixture.universities.first.id,
        universityId: fixture.universities.first.id,
        universityName: fixture.universities.first.name
      },
      "Second followed announcement": {
        scopeId: fixture.universities.second.id,
        universityId: fixture.universities.second.id,
        universityName: fixture.universities.second.name
      },
      "Third followed announcement": {
        scopeId: fixture.universities.third.id,
        universityId: fixture.universities.third.id,
        universityName: fixture.universities.third.name
      }
    });
  });

  it("includes the exact faculty and department hierarchy for unit-scoped content", async () => {
    const fixture = await createFixture();
    const university = fixture.universities.primary;
    const faculty = await fixture.catalog.createFaculty({
      universityId: university.id,
      name: "Engineering Faculty",
      slug: "engineering-faculty",
      status: "active"
    });
    const department = await fixture.catalog.createDepartment({
      universityId: university.id,
      facultyId: faculty.id,
      name: "Computer Engineering",
      slug: "computer-engineering",
      educationLevel: "bachelor",
      status: "active"
    });
    await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: university.id,
      facultyId: faculty.id,
      departmentId: department.id
    });

    const facultySource = await fixture.announcementRepository.upsertSource({
      scopeType: "faculty",
      scopeId: faculty.id,
      sourceName: "Engineering Faculty News",
      sourceUrl: "https://primary-university.edu.tr/faculty/news",
      contentType: "news",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    const departmentSource = await fixture.announcementRepository.upsertSource({
      scopeType: "department",
      scopeId: department.id,
      sourceName: "Computer Engineering Events",
      sourceUrl: "https://primary-university.edu.tr/department/events",
      contentType: "event",
      parser: "auto",
      priority: 20,
      status: "active",
      trustStatus: "trusted"
    });
    await Promise.all([
      fixture.announcementRepository.replaceItemsForSource(facultySource, [{
        id: "faculty-news",
        sourceId: facultySource.id,
        sourceName: facultySource.sourceName,
        scopeType: "faculty",
        scopeId: faculty.id,
        title: "Faculty research news",
        link: `${facultySource.sourceUrl}/research`,
        publishedAt: "2026-08-25T08:00:00.000Z",
        publicationTimeSource: "source"
      }]),
      fixture.announcementRepository.replaceItemsForSource(departmentSource, [{
        id: "department-event",
        sourceId: departmentSource.id,
        sourceName: departmentSource.sourceName,
        scopeType: "department",
        scopeId: department.id,
        title: "Department research event",
        link: `${departmentSource.sourceUrl}/research`,
        publishedAt: "2026-08-26T08:00:00.000Z",
        publicationTimeSource: "source"
      }])
    ]);
    await approveAllReviewFixtures(fixture.announcementRepository);

    const response = await fixture.announcements.getMyAnnouncementsCollection(fixture.student.id, 10);
    expect(response.items.find((item) => item.id === "faculty-news")).toMatchObject({
      universityId: university.id,
      universityName: university.name,
      facultyId: faculty.id,
      facultyName: faculty.name,
      scopeType: "faculty",
      scopeId: faculty.id
    });
    expect(response.items.find((item) => item.id === "department-event")).toMatchObject({
      universityId: university.id,
      universityName: university.name,
      facultyId: faculty.id,
      facultyName: faculty.name,
      departmentId: department.id,
      departmentName: department.name,
      scopeType: "department",
      scopeId: department.id
    });
  });

  it("re-evaluates trusted detail access after follow add/remove and isolates every user's follows", async () => {
    const fixture = await createFixture();
    const firstItemId = fixture.itemIds.get(fixture.universities.first.id)!;
    const secondItemId = fixture.itemIds.get(fixture.universities.second.id)!;

    await expect(fixture.announcements.getMyTrustedAnnouncement(fixture.student.id, firstItemId))
      .rejects.toBeInstanceOf(NotFoundException);

    const firstFollow = await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.first.id
    });
    await expect(fixture.announcements.getMyTrustedAnnouncement(fixture.student.id, firstItemId))
      .resolves.toMatchObject({ id: firstItemId, scopeId: fixture.universities.first.id });

    const otherUserFollow = await fixture.users.addFollowedScope(fixture.otherStudent.id, {
      universityId: fixture.universities.second.id
    });
    expect((await fixture.announcements.getMyAnnouncements(fixture.student.id, 10)).some((item) => item.id === secondItemId))
      .toBe(false);
    await expect(fixture.announcements.getMyTrustedAnnouncement(fixture.student.id, secondItemId))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(fixture.announcements.getMyTrustedAnnouncement(fixture.otherStudent.id, secondItemId))
      .resolves.toMatchObject({ id: secondItemId, scopeId: fixture.universities.second.id });
    await expect(fixture.users.removeFollowedScope(fixture.student.id, otherUserFollow.id))
      .rejects.toBeInstanceOf(NotFoundException);

    await fixture.users.removeFollowedScope(fixture.student.id, firstFollow.id);
    await expect(fixture.announcements.getMyTrustedAnnouncement(fixture.student.id, firstItemId))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects missing and inactive universities without persisting a follow", async () => {
    const fixture = await createFixture();

    await expect(fixture.users.addFollowedScope(fixture.student.id, { universityId: "missing-university" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.inactive.id
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(fixture.users.listFollowedScopes(fixture.student.id)).resolves.toEqual([]);
  });

  it("keeps the calendar and trusted calendar detail bound to the primary university", async () => {
    const fixture = await createFixture();
    const calendars = new InMemoryCalendarRepository();
    const primaryCalendar = await calendars.createCalendar({
      universityId: fixture.universities.primary.id,
      academicYear: "2026-2027",
      title: "Primary university academic calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-08-01T00:00:00.000Z")
    });
    const followedCalendar = await calendars.createCalendar({
      universityId: fixture.universities.first.id,
      academicYear: "2026-2027",
      title: "Followed university academic calendar",
      status: "published",
      version: 1,
      publishedAt: new Date("2026-08-01T00:00:00.000Z")
    });
    const [primaryEvent] = await calendars.createEvents([calendarEvent(
      primaryCalendar.id,
      fixture.universities.primary.id,
      "Primary university event",
      "2026-09-01T09:00:00.000Z"
    )]);
    const [followedEvent] = await calendars.createEvents([calendarEvent(
      followedCalendar.id,
      fixture.universities.first.id,
      "Followed university event",
      "2026-09-02T09:00:00.000Z"
    )]);
    await fixture.users.addFollowedScope(fixture.student.id, {
      universityId: fixture.universities.first.id
    });
    const calendar = new CalendarService(calendars, fixture.auth);

    const response = await calendar.getMyCalendar(fixture.student.id);
    expect(response.calendar.id).toBe(primaryCalendar.id);
    expect(response.events.map((event) => event.id)).toEqual([primaryEvent!.id]);
    await expect(calendar.getMyTrustedCalendarEvent(fixture.student.id, primaryEvent!.id))
      .resolves.toMatchObject({ id: primaryEvent!.id });
    await expect(calendar.getMyTrustedCalendarEvent(fixture.student.id, followedEvent!.id))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

async function createFixture() {
  const auth = new InMemoryAuthRepository();
  const catalog = new InMemoryCatalogRepository();
  const userData = new TestUserDataRepository();
  const announcementRepository = new InMemoryAnnouncementRepository();
  const universities = {
    primary: await createUniversity(catalog, "Primary University", "primary-university", "active"),
    first: await createUniversity(catalog, "First Followed University", "first-followed-university", "active"),
    second: await createUniversity(catalog, "Second Followed University", "second-followed-university", "active"),
    third: await createUniversity(catalog, "Third Followed University", "third-followed-university", "active"),
    inactive: await createUniversity(catalog, "Inactive University", "inactive-university", "inactive")
  };
  const student = await createStudent(auth, "student-a@example.com", universities.primary.id);
  const otherStudent = await createStudent(auth, "student-b@example.com", universities.primary.id);
  const itemIds = new Map<string, string>();
  await seedAnnouncement(announcementRepository, universities.primary, "Primary announcement", "2026-08-20T08:00:00.000Z", "2026-08-27T08:00:00.000Z", itemIds);
  await seedAnnouncement(announcementRepository, universities.first, "First followed announcement", "2026-08-23T08:00:00.000Z", "2026-08-26T08:00:00.000Z", itemIds);
  await seedAnnouncement(announcementRepository, universities.second, "Second followed announcement", "2026-08-21T08:00:00.000Z", "2026-08-25T08:00:00.000Z", itemIds);
  await seedAnnouncement(announcementRepository, universities.third, "Third followed announcement", "2026-08-24T08:00:00.000Z", "2026-08-24T08:00:00.000Z", itemIds);
  await approveAllReviewFixtures(announcementRepository);

  return {
    auth,
    catalog,
    announcementRepository,
    universities,
    student,
    otherStudent,
    itemIds,
    users: new UsersService(auth, catalog, userData),
    announcements: new AnnouncementsService(auth, announcementRepository, catalog, undefined, undefined, userData)
  };
}

async function createUniversity(
  catalog: InMemoryCatalogRepository,
  name: string,
  slug: string,
  status: UniversityRecord["status"]
): Promise<UniversityRecord> {
  return catalog.createUniversity({ name, slug, city: "Ankara", type: "state", status });
}

async function createStudent(
  auth: InMemoryAuthRepository,
  email: string,
  universityId?: string
): Promise<AuthUserRecord> {
  return auth.createUser({
    fullName: email.split("@")[0]!,
    email,
    passwordHash: "unused",
    role: "student",
    status: "active",
    ...(universityId ? { universityId } : {})
  });
}

async function seedAnnouncement(
  repository: InMemoryAnnouncementRepository,
  university: UniversityRecord,
  title: string,
  publishedAt: string,
  discoveredAt: string,
  ids: Map<string, string>
): Promise<void> {
  const source = await repository.upsertSource({
    scopeType: "university",
    scopeId: university.id,
    sourceName: university.name,
    sourceUrl: `https://${university.slug}.edu.tr/duyurular`,
    parser: "auto",
    priority: 20,
    status: "active",
    trustStatus: "trusted"
  });
  const id = `${university.id}-announcement`;
  ids.set(university.id, id);
  await repository.replaceItemsForSource(source, [{
    id,
    sourceId: source.id,
    sourceName: source.sourceName,
    scopeType: "university",
    scopeId: university.id,
    title,
    link: `${source.sourceUrl}/${id}`,
    publishedAt,
    publicationTimeSource: "source",
    discoveredAt,
    fetchedAt: "2026-08-27T08:00:00.000Z"
  }]);
}

async function approveAllReviewFixtures(repository: InMemoryAnnouncementRepository): Promise<void> {
  const items = await repository.listReviewItems({ limit: 1_000 });
  for (const item of items) {
    if (!item.contentFingerprint) throw new Error(`Fixture ${item.id} is missing contentFingerprint.`);
    const result = await repository.updateReviewItem(item.id, { reviewStatus: "approved" }, {
      ...(item.snapshotId ? { expectedSnapshotId: item.snapshotId } : {}),
      expectedContentFingerprint: item.contentFingerprint,
      ...(item.reviewRevision ? { expectedReviewRevision: item.reviewRevision } : {})
    });
    if (!result) throw new Error(`Fixture ${item.id} could not be approved.`);
  }
}

function calendarEvent(calendarId: string, universityId: string, title: string, startDate: string) {
  return {
    calendarId,
    universityId,
    academicYear: "2026-2027",
    term: "fall" as const,
    category: "course_registration" as const,
    title,
    startDate: new Date(startDate),
    timezone: "Europe/Istanbul" as const,
    status: "published" as const,
    notificationRules: []
  };
}
