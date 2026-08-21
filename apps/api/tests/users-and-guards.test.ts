import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import {
  RECENT_AUTHENTICATION_PURPOSE_KEY,
  RecentAuthGuard
} from "../src/common/guards/recent-auth.guard.js";
import { RolesGuard } from "../src/common/guards/roles.guard.js";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { TestUserDataRepository } from "./support/test-user-data.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";

class FakeEmailVerificationSenderService extends EmailVerificationSenderService {
  public readonly sent: SendVerificationEmailInput[] = [];
  override async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

function createExecutionContext(
  request: Record<string, unknown>,
  requiredRoles?: string[],
  recentAuthenticationPurpose?: "delete_personal_data" | "delete_account"
): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata("roles", requiredRoles, handler);
  Reflect.defineMetadata(RECENT_AUTHENTICATION_PURPOSE_KEY, recentAuthenticationPurpose, handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JwtAuthGuard", () => {
  it("attaches authenticated user from bearer token", async () => {
    const authRepository = new InMemoryAuthRepository();
    const tokenService = new TokenService();
    const sender = new FakeEmailVerificationSenderService();
    const authService = new AuthApplicationService(authRepository, new PasswordHasher(), tokenService, sender);
    const registerResult = await authService.register({
      email: "guard@campus.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });
    await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });
    const session = await authService.login({ email: registerResult.email, password: "StrongPass123!", deviceId: "device-1" });
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${session.accessToken}` } };

    const canActivate = await new JwtAuthGuard(tokenService, authRepository).canActivate(createExecutionContext(request));

    expect(canActivate).toBe(true);
    expect(request.user).toEqual(expect.objectContaining({ id: session.user.id, role: "student" }));
  });

  it("rejects missing bearer token", async () => {
    const guard = new JwtAuthGuard(new TokenService(), new InMemoryAuthRepository());
    await expect(guard.canActivate(createExecutionContext({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("RolesGuard", () => {
  it("allows user with required role", () => {
    const guard = new RolesGuard(new Reflector());
    const context = createExecutionContext({ user: { role: "student" } }, ["student"]);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects user without required role", () => {
    const guard = new RolesGuard(new Reflector());
    const context = createExecutionContext({ user: { role: "content_editor" } }, ["student"]);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe("UsersService", () => {
  it("returns and updates only the authenticated user's profile", async () => {
    const authRepository = new InMemoryAuthRepository();
    const catalogRepository = new InMemoryCatalogRepository();
    const university = await catalogRepository.createUniversity({ name: "Test University", slug: "test-university", city: "Ankara", type: "state", status: "active" });
    await catalogRepository.createFaculty({ universityId: university.id, name: "Test Faculty", slug: "test-faculty", status: "active" });
    const [faculty] = await catalogRepository.listFaculties(university.id, "active");
    await catalogRepository.createDepartment({ universityId: university.id, facultyId: faculty!.id, name: "Test Department", slug: "test-department", educationLevel: "bachelor", status: "active" });
    const [department] = await catalogRepository.listDepartments(faculty!.id, "active");
    const sender = new FakeEmailVerificationSenderService();
    const authService = new AuthApplicationService(authRepository, new PasswordHasher(), new TokenService(), sender);
    const usersService = new UsersService(authRepository, catalogRepository, new TestUserDataRepository());
    const registerResult = await authService.register({
      email: "profile@campus.edu.tr",
      password: "StrongPass123!",
      passwordConfirmation: "StrongPass123!"
    });
    await authService.verifyEmail({ email: registerResult.email, code: sender.sent[0]!.code, deviceId: "device-1" });
    const session = await authService.login({ email: registerResult.email, password: "StrongPass123!", deviceId: "device-1" });

    const updated = await usersService.updateMyUniversity(session.user.id, {
      universityId: university.id,
      facultyId: faculty!.id,
      departmentId: department!.id,
      classLevel: 2
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: session.user.id,
        universityId: university.id,
        facultyId: faculty!.id,
        departmentId: department!.id,
        classLevel: 2
      })
    );
  });

  it("clears stale academic children and preserves parent-child validation", async () => {
    const authRepository = new InMemoryAuthRepository();
    const catalogRepository = new InMemoryCatalogRepository();
    const firstUniversity = await catalogRepository.createUniversity({ name: "First University", slug: "first-university", city: "Ankara", type: "state", status: "active" });
    const secondUniversity = await catalogRepository.createUniversity({ name: "Second University", slug: "second-university", city: "Izmir", type: "state", status: "active" });
    const firstFaculty = await catalogRepository.createFaculty({ universityId: firstUniversity.id, name: "First Faculty", slug: "first-faculty", status: "active" });
    const alternateFirstFaculty = await catalogRepository.createFaculty({ universityId: firstUniversity.id, name: "Alternate First Faculty", slug: "alternate-first-faculty", status: "active" });
    const secondFaculty = await catalogRepository.createFaculty({ universityId: secondUniversity.id, name: "Second Faculty", slug: "second-faculty", status: "active" });
    const alternateSecondFaculty = await catalogRepository.createFaculty({ universityId: secondUniversity.id, name: "Alternate Faculty", slug: "alternate-faculty", status: "active" });
    const firstDepartment = await catalogRepository.createDepartment({ universityId: firstUniversity.id, facultyId: firstFaculty.id, name: "First Department", slug: "first-department", educationLevel: "bachelor", status: "active" });
    const secondDepartment = await catalogRepository.createDepartment({ universityId: secondUniversity.id, facultyId: secondFaculty.id, name: "Second Department", slug: "second-department", educationLevel: "bachelor", status: "active" });
    const user = await authRepository.createUser({
      fullName: "Academic Selection Student",
      email: "academic-selection@example.com",
      passwordHash: "unused",
      role: "student",
      status: "active",
      universityId: firstUniversity.id,
      facultyId: firstFaculty.id,
      departmentId: firstDepartment.id,
      classLevel: 2
    });
    const usersService = new UsersService(authRepository, catalogRepository, new TestUserDataRepository());

    const universityChanged = await usersService.updateMyUniversity(user.id, { universityId: secondUniversity.id });
    expect(universityChanged).toEqual(expect.objectContaining({ universityId: secondUniversity.id }));
    expect(universityChanged).not.toEqual(expect.objectContaining({ facultyId: expect.any(String) }));
    expect(universityChanged).not.toEqual(expect.objectContaining({ departmentId: expect.any(String) }));
    expect(universityChanged).not.toEqual(expect.objectContaining({ classLevel: expect.any(Number) }));

    await usersService.updateMyUniversity(user.id, {
      universityId: secondUniversity.id,
      facultyId: secondFaculty.id,
      departmentId: secondDepartment.id,
      classLevel: 3
    });
    const facultyChanged = await usersService.updateMyUniversity(user.id, {
      universityId: secondUniversity.id,
      facultyId: alternateSecondFaculty.id
    });
    expect(facultyChanged).toEqual(expect.objectContaining({ universityId: secondUniversity.id, facultyId: alternateSecondFaculty.id }));
    expect(facultyChanged).not.toEqual(expect.objectContaining({ departmentId: expect.any(String) }));
    expect(facultyChanged).not.toEqual(expect.objectContaining({ classLevel: expect.any(Number) }));

    await expect(
      usersService.updateMyUniversity(user.id, { universityId: firstUniversity.id, facultyId: secondFaculty.id })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      usersService.updateMyUniversity(user.id, {
        universityId: secondUniversity.id,
        facultyId: alternateSecondFaculty.id,
        departmentId: secondDepartment.id
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    const adminUniversityChanged = await usersService.updateUserByAdmin(user.id, {
      universityId: firstUniversity.id
    });
    expect(adminUniversityChanged).toEqual(expect.objectContaining({ universityId: firstUniversity.id }));
    expect(adminUniversityChanged).not.toEqual(expect.objectContaining({ facultyId: expect.any(String) }));
    expect(adminUniversityChanged).not.toEqual(expect.objectContaining({ departmentId: expect.any(String) }));
    expect(adminUniversityChanged).not.toEqual(expect.objectContaining({ classLevel: expect.any(Number) }));

    await usersService.updateMyUniversity(user.id, {
      universityId: firstUniversity.id,
      facultyId: firstFaculty.id,
      departmentId: firstDepartment.id,
      classLevel: 2
    });
    const adminFacultyChanged = await usersService.updateUserByAdmin(user.id, {
      facultyId: alternateFirstFaculty.id
    });
    expect(adminFacultyChanged).toEqual(expect.objectContaining({
      universityId: firstUniversity.id,
      facultyId: alternateFirstFaculty.id
    }));
    expect(adminFacultyChanged).not.toEqual(expect.objectContaining({ departmentId: expect.any(String) }));
    expect(adminFacultyChanged).not.toEqual(expect.objectContaining({ classLevel: expect.any(Number) }));
  });

  it("removes only the authenticated user's followed university", async () => {
    const catalogRepository = new InMemoryCatalogRepository();
    const university = await catalogRepository.createUniversity({
      name: "Followed University",
      slug: "followed-university",
      city: "Ankara",
      type: "state",
      status: "active"
    });
    const usersService = new UsersService(
      new InMemoryAuthRepository(),
      catalogRepository,
      new TestUserDataRepository()
    );
    const followed = await usersService.addFollowedScope("student-1", { universityId: university.id });

    await expect(usersService.removeFollowedScope("student-2", followed.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(usersService.listFollowedScopes("student-1")).resolves.toEqual([followed]);

    await expect(usersService.removeFollowedScope("student-1", followed.id)).resolves.toEqual({
      id: followed.id,
      removed: true
    });
    await expect(usersService.listFollowedScopes("student-1")).resolves.toEqual([]);
  });

  it("lists, updates and deletes users for admin management", async () => {
    const authRepository = new InMemoryAuthRepository();
    const notificationRepository = new InMemoryNotificationRepository();
    const usersService = new UsersService(authRepository, new InMemoryCatalogRepository(), new TestUserDataRepository(), notificationRepository);
    const createdUser = await authRepository.createUser({
      fullName: "Managed User",
      email: "managed@campus.edu.tr",
      passwordHash: "hash",
      role: "student",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1",
      status: "active"
    });

    await notificationRepository.upsertDeviceToken({
      userId: createdUser.id,
      platform: "android",
      token: "managed-user-device-token",
      installationHash: "managed-user-installation"
    });
    await notificationRepository.upsertPreferences({
      userId: createdUser.id,
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });

    const listedUsers = await usersService.listUsers({ search: "managed", limit: 10, offset: 0 });
    expect(listedUsers).toHaveLength(1);

    const updatedUser = await usersService.updateUserByAdmin(createdUser.id, {
      fullName: "Managed Editor",
      role: "content_editor",
      status: "locked"
    });

    expect(updatedUser).toEqual(expect.objectContaining({ fullName: "Managed Editor", role: "content_editor", status: "locked" }));

    await usersService.deleteUserByAdmin(createdUser.id);
    await expect(usersService.getMe(createdUser.id)).rejects.toThrow("User not found.");
    await expect(notificationRepository.listActiveDeviceTokens(10, 0)).resolves.toEqual([]);
    await expect(notificationRepository.findPreferencesByUserId(createdUser.id)).resolves.toBeNull();
  });

  it("lets users erase app data before deleting their own account", async () => {
    const authRepository = new InMemoryAuthRepository();
    const notificationRepository = new InMemoryNotificationRepository();
    const usersService = new UsersService(authRepository, new InMemoryCatalogRepository(), new TestUserDataRepository(), notificationRepository);
    const createdUser = await authRepository.createUser({
      fullName: "Deleting Student",
      email: "deleting.student@example.com",
      passwordHash: "hash",
      role: "student",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1",
      classLevel: 2,
      status: "active"
    });
    await notificationRepository.upsertDeviceToken({
      userId: createdUser.id,
      platform: "android",
      token: "deleting-user-device-token",
      installationHash: "deleting-user-installation"
    });
    await notificationRepository.upsertPreferences({
      userId: createdUser.id,
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [1]
    });

    await usersService.deleteMyData(createdUser.id);

    const dataClearedProfile = await usersService.getMe(createdUser.id);
    expect(dataClearedProfile).toEqual(expect.not.objectContaining({
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1",
      classLevel: 2
    }));
    await expect(notificationRepository.findPreferencesByUserId(createdUser.id)).resolves.toBeNull();
    await expect(notificationRepository.listActiveDeviceTokens(10, 0)).resolves.toEqual([]);

    await usersService.deleteMe(createdUser.id, { deleteData: true });

    await expect(usersService.getMe(createdUser.id)).rejects.toThrow("User not found.");
    await expect(authRepository.findUserByEmail("deleting.student@example.com")).resolves.toBeNull();
    await expect(authRepository.createUser({
      fullName: "New Student",
      email: "deleting.student@example.com",
      passwordHash: "hash",
      role: "student",
      status: "active"
    })).resolves.toEqual(expect.objectContaining({ email: "deleting.student@example.com" }));
  });

  it("rejects an access token after the account credential generation advances", async () => {
    const authRepository = new InMemoryAuthRepository();
    const user = await authRepository.createUser({
      fullName: "Stale Access Student",
      email: "stale-access@example.com",
      passwordHash: "hash",
      role: "student",
      status: "active"
    });
    const tokenService = new TokenService();
    const accessToken = tokenService.signAccessToken(user);
    const users = (authRepository as unknown as { users: Map<string, typeof user> }).users;
    users.set(user.id, { ...user, credentialGeneration: 1 });

    const guard = new JwtAuthGuard(tokenService, authRepository);
    await expect(guard.canActivate(createExecutionContext({
      headers: { authorization: `Bearer ${accessToken}` }
    }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("RecentAuthGuard", () => {
  it("atomically accepts only an unexpired purpose-bound proof owned by the current generation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T08:00:00.000Z"));
    const tokenService = new TokenService();
    const authRepository = new InMemoryAuthRepository();
    const issue = tokenService.issueRecentAuthenticationProof(
      { id: "owner-1", credentialGeneration: 4 },
      "password",
      "delete_personal_data"
    );
    await authRepository.createRecentAuthenticationProof({
      ownerId: "owner-1",
      credentialGeneration: 4,
      purpose: "delete_personal_data",
      jtiDigest: tokenService.hashRecentAuthenticationJti(issue.jti),
      createdAt: issue.createdAt,
      expiresAt: issue.expiresAt
    });
    const guard = new RecentAuthGuard(tokenService, authRepository, new Reflector());
    const validRequest = {
      headers: { "x-recent-authentication": issue.proof },
      user: { id: "owner-1", credentialGeneration: 4 }
    };

    await expect(guard.canActivate(
      createExecutionContext(validRequest, undefined, "delete_personal_data")
    )).resolves.toBe(true);
    await expect(guard.canActivate(
      createExecutionContext(validRequest, undefined, "delete_personal_data")
    )).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(createExecutionContext({
      ...validRequest,
      user: { id: "owner-2", credentialGeneration: 4 }
    }, undefined, "delete_personal_data"))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(createExecutionContext({
      ...validRequest,
      user: { id: "owner-1", credentialGeneration: 5 }
    }, undefined, "delete_personal_data"))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(createExecutionContext({
      headers: { "x-recent-authentication": "malformed" },
      user: { id: "owner-1", credentialGeneration: 4 }
    }, undefined, "delete_personal_data"))).rejects.toBeInstanceOf(UnauthorizedException);

    vi.advanceTimersByTime(tokenService.getRecentAuthenticationTtlSeconds() * 1_000 + 1_000);
    await expect(guard.canActivate(
      createExecutionContext(validRequest, undefined, "delete_personal_data")
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
