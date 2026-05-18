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
  override async sendVerificationEmail(_input: SendVerificationEmailInput): Promise<void> {}
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
    const authService = new AuthApplicationService(authRepository, new InMemoryCatalogRepository(), new PasswordHasher(), tokenService, new FakeEmailVerificationSenderService());
    const registerResult = await authService.register({
      fullName: "Guard User",
      email: "guard@campus.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });
    const session = await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });
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
    const authService = new AuthApplicationService(authRepository, new InMemoryCatalogRepository(), new PasswordHasher(), new TokenService(), new FakeEmailVerificationSenderService());
    const usersService = new UsersService(authRepository);
    const registerResult = await authService.register({
      fullName: "Profile User",
      email: "profile@campus.edu.tr",
      password: "StrongPass123!",
      deviceId: "device-1",
      universityId: "sample-university-1",
      facultyId: "sample-faculty-1",
      departmentId: "sample-department-1"
    });
    const session = await authService.verifyEmail({ token: registerResult.previewVerificationToken!, deviceId: "device-1" });

    const updated = await usersService.updateMyUniversity(session.user.id, {
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      classLevel: 2
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: session.user.id,
        universityId: "university-1",
        facultyId: "faculty-1",
        departmentId: "department-1",
        classLevel: 2
      })
    );
  });
});
