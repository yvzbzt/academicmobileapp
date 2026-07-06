import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import { RolesGuard } from "../src/common/guards/roles.guard.js";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";

class FakeEmailVerificationSenderService extends EmailVerificationSenderService {
  public readonly sent: SendVerificationEmailInput[] = [];
  override async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

function createExecutionContext(request: Record<string, unknown>, requiredRoles?: string[]): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata("roles", requiredRoles, handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

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

    const canActivate = new JwtAuthGuard(tokenService).canActivate(createExecutionContext(request));

    expect(canActivate).toBe(true);
    expect(request.user).toEqual(expect.objectContaining({ id: session.user.id, role: "student" }));
  });

  it("rejects missing bearer token", () => {
    const guard = new JwtAuthGuard(new TokenService());
    expect(() => guard.canActivate(createExecutionContext({ headers: {} }))).toThrow(UnauthorizedException);
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
    const usersService = new UsersService(authRepository, catalogRepository);
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

  it("lists, updates and deletes users for admin management", async () => {
    const authRepository = new InMemoryAuthRepository();
    const usersService = new UsersService(authRepository, new InMemoryCatalogRepository());
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
  });
});
