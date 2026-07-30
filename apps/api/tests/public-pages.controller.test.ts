import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { accountDeletionHtml, PublicPagesController } from "../src/modules/public/public-pages.controller.js";
import { AccountDeletionService } from "../src/modules/public/account-deletion.service.js";
import { EmailVerificationSenderService, type SendVerificationEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { TestUserDataRepository } from "./support/test-user-data.repository.js";

class FakeEmailVerificationSenderService extends EmailVerificationSenderService {
  public readonly deletionCodes: SendVerificationEmailInput[] = [];

  override async sendVerificationEmail(): Promise<void> {
    throw new Error("Unexpected regular verification email.");
  }

  override async sendAccountDeletionVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    this.deletionCodes.push(input);
  }
}

describe("PublicPagesController", () => {
  it("serves the Google Play account deletion page", () => {
    const html = new PublicPagesController({} as AccountDeletionService).accountDeletion();

    expect(html).toBe(accountDeletionHtml);
    expect(html).toContain("<title>Akademik Takvim - Hesap ve Veri Silme</title>");
    expect(html).toContain("Hesap ve Veri Silme");
    expect(html).toContain("info@anssoft.com.tr");
    expect(html).toContain("/account-deletion/request-code");
    expect(html).toContain("/account-deletion/confirm");
    expect(html).not.toContain("Cannot GET");
    expect(html).not.toContain("statusCode");
  });
});

describe("AccountDeletionService", () => {
  it("sends an SMTP verification code and deletes only app data", async () => {
    const authRepository = new InMemoryAuthRepository();
    const notificationRepository = new InMemoryNotificationRepository();
    const passwordHasher = new PasswordHasher();
    const sender = new FakeEmailVerificationSenderService();
    const userDataRepository = new TestUserDataRepository();
    const usersService = new UsersService(authRepository, new InMemoryCatalogRepository(), userDataRepository, notificationRepository);
    const accountDeletionService = new AccountDeletionService(authRepository, passwordHasher, new TokenService(), sender, usersService);
    const user = await authRepository.createUser({
      fullName: "Deletion Test",
      email: "delete-data@example.com",
      passwordHash: await passwordHasher.hash("StrongPass123!"),
      role: "student",
      universityId: "uni-1",
      facultyId: "fac-1",
      departmentId: "dep-1",
      classLevel: 3,
      status: "active"
    });
    await notificationRepository.upsertPreferences({
      userId: user.id,
      enabled: true,
      categories: { final_exam: true },
      reminderOffsets: [60]
    });
    const suggestion = await userDataRepository.createAcademicUnitSuggestion({
      userId: user.id,
      userEmail: user.email,
      universityId: "uni-1",
      facultyName: "Deletion Faculty",
      educationLevel: "bachelor"
    });
    await userDataRepository.upsertFollowedAcademicScope({
      userId: user.id,
      universityId: "uni-1"
    });

    const requestResult = await accountDeletionService.requestCode({ email: user.email, password: "StrongPass123!" });

    expect(requestResult).toEqual(expect.objectContaining({ status: "verification_sent", email: user.email }));
    expect(sender.deletionCodes).toHaveLength(1);

    await accountDeletionService.confirm({
      email: user.email,
      password: "StrongPass123!",
      code: sender.deletionCodes[0]!.code,
      deletionType: "data"
    });

    const keptUser = await authRepository.findUserByEmail(user.email);
    expect(keptUser).toEqual(expect.objectContaining({ email: user.email, status: "active" }));
    expect(keptUser).toEqual(expect.not.objectContaining({
      universityId: "uni-1",
      facultyId: "fac-1",
      departmentId: "dep-1",
      classLevel: 3
    }));
    await expect(notificationRepository.findPreferencesByUserId(user.id)).resolves.toBeNull();
    await expect(userDataRepository.findAcademicUnitSuggestionById(suggestion.id)).resolves.toBeNull();
    await expect(userDataRepository.listFollowedAcademicScopesByUserId(user.id)).resolves.toEqual([]);
  });

  it("deletes the account after verifying the code", async () => {
    const authRepository = new InMemoryAuthRepository();
    const notificationRepository = new InMemoryNotificationRepository();
    const passwordHasher = new PasswordHasher();
    const sender = new FakeEmailVerificationSenderService();
    const userDataRepository = new TestUserDataRepository();
    const usersService = new UsersService(authRepository, new InMemoryCatalogRepository(), userDataRepository, notificationRepository);
    const accountDeletionService = new AccountDeletionService(authRepository, passwordHasher, new TokenService(), sender, usersService);
    const user = await authRepository.createUser({
      fullName: "Delete Account",
      email: "delete-account@example.com",
      passwordHash: await passwordHasher.hash("StrongPass123!"),
      role: "student",
      status: "active"
    });
    const suggestion = await userDataRepository.createAcademicUnitSuggestion({
      userId: user.id,
      userEmail: user.email,
      universityId: "uni-1",
      facultyName: "Account Deletion Faculty",
      educationLevel: "bachelor"
    });
    await userDataRepository.upsertFollowedAcademicScope({
      userId: user.id,
      universityId: "uni-1"
    });

    await accountDeletionService.requestCode({ email: user.email, password: "StrongPass123!" });
    await accountDeletionService.confirm({
      email: user.email,
      password: "StrongPass123!",
      code: sender.deletionCodes[0]!.code,
      deletionType: "account"
    });

    await expect(authRepository.findUserByEmail(user.email)).resolves.toBeNull();
    await expect(userDataRepository.findAcademicUnitSuggestionById(suggestion.id)).resolves.toBeNull();
    await expect(userDataRepository.listFollowedAcademicScopesByUserId(user.id)).resolves.toEqual([]);
    await expect(authRepository.createUser({
      fullName: "New Owner",
      email: user.email,
      passwordHash: "hash",
      role: "student",
      status: "active"
    })).resolves.toEqual(expect.objectContaining({ email: user.email }));
  });

  it("rejects an invalid password without sending a code", async () => {
    const authRepository = new InMemoryAuthRepository();
    const passwordHasher = new PasswordHasher();
    const sender = new FakeEmailVerificationSenderService();
    const accountDeletionService = new AccountDeletionService(
      authRepository,
      passwordHasher,
      new TokenService(),
      sender,
      new UsersService(authRepository, new InMemoryCatalogRepository(), new TestUserDataRepository(), new InMemoryNotificationRepository())
    );
    const user = await authRepository.createUser({
      fullName: "Bad Password",
      email: "bad-password@example.com",
      passwordHash: await passwordHasher.hash("StrongPass123!"),
      role: "student",
      status: "active"
    });

    await expect(accountDeletionService.requestCode({ email: user.email, password: "wrong-password" })).rejects.toThrow(UnauthorizedException);
    expect(sender.deletionCodes).toHaveLength(0);
  });
});
