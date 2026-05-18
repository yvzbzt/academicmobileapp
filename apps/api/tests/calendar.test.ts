import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { CalendarService } from "../src/modules/calendars/calendar.service.js";
import { InMemoryCalendarRepository } from "../src/modules/calendars/in-memory-calendar.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";

class FakeEmailVerificationSenderService extends EmailVerificationSenderService {
  override async sendVerificationEmail(_input: SendVerificationEmailInput): Promise<void> {}
}

async function createStudentWithUniversity() {
  const authRepository = new InMemoryAuthRepository();
  const authService = new AuthApplicationService(authRepository, new InMemoryCatalogRepository(), new PasswordHasher(), new TokenService(), new FakeEmailVerificationSenderService());
  const registerResult = await authService.register({
    fullName: "Calendar User",
    email: "calendar@campus.edu.tr",
    password: "StrongPass123!",
    deviceId: "device-1",
    universityId: "sample-university-1",
    facultyId: "sample-faculty-1",
    departmentId: "sample-department-1"
  });

  const session = await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });
  await authRepository.updateUserAcademicSelection(session.user.id, {
    universityId: "sample-university-1",
    facultyId: "sample-faculty-1",
    departmentId: "sample-department-1"
  });
  return { authRepository, session };
}

describe("CalendarService", () => {
  it("requires university selection for my calendar", async () => {
    const authRepository = new InMemoryAuthRepository();
    const authService = new AuthApplicationService(authRepository, new InMemoryCatalogRepository(), new PasswordHasher(), new TokenService(), new FakeEmailVerificationSenderService());
    const registerResult = await authService.register({
      fullName: "No University User",
      email: "no-university@campus.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });
    const session = await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });
    await authRepository.updateUserAcademicSelection(session.user.id, { universityId: "" });
    const service = new CalendarService(new InMemoryCalendarRepository(), authRepository);

    await expect(service.getMyCalendar(session.user.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns published calendar and events for selected university", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const service = new CalendarService(new InMemoryCalendarRepository(), authRepository);

    const response = await service.getMyCalendar(session.user.id);

    expect(response.calendar.status).toBe("published");
    expect(response.events.length).toBeGreaterThan(0);
    expect(response.events.every((event) => event.status === "published")).toBe(true);
    expect(response.events.some((event) => event.title.includes("Diger Fakulteler"))).toBe(false);
  });

  it("returns upcoming events sorted by start date", async () => {
    const { authRepository, session } = await createStudentWithUniversity();
    const service = new CalendarService(new InMemoryCalendarRepository(), authRepository);

    const events = await service.getUpcomingEvents(session.user.id, 10);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.startDate.getTime()).toBeLessThanOrEqual(events[events.length - 1]?.startDate.getTime() ?? 0);
    expect(events.some((event) => event.title.includes("Diger Fakulteler"))).toBe(false);
  });

  it("filters public event search by category", async () => {
    const service = new CalendarService(new InMemoryCalendarRepository(), new InMemoryAuthRepository());

    const events = await service.searchEvents({ category: "final_exam" });

    expect(events.length).toBe(1);
    expect(events[0]?.category).toBe("final_exam");
  });
});
