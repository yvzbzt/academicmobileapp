import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailVerificationSenderService } from "../src/modules/auth/email-verification-sender.service.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("EmailVerificationSenderService", () => {
  it("fails closed in production when SMTP is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    await expect(
      new EmailVerificationSenderService().sendVerificationEmail({
        email: "student@example.com",
        fullName: "Student Example",
        code: "123456",
        expiresAt: new Date("2026-07-21T12:00:00.000Z")
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("does not log verification, recovery, or deletion codes and personal data when SMTP is unavailable", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const sender = new EmailVerificationSenderService();
    const verificationInput = {
      email: "private.student@example.com",
      fullName: "Private Student",
      code: "482104",
      expiresAt: new Date("2026-07-21T12:00:00.000Z")
    };
    const deletionInput = {
      ...verificationInput,
      code: "739512"
    };
    const recoveryInput = {
      ...verificationInput,
      code: "618204"
    };

    await sender.sendVerificationEmail(verificationInput);
    await sender.sendAccountDeletionVerificationEmail(deletionInput);
    await sender.sendPasswordRecoveryEmail(recoveryInput);

    const serializedWarnings = JSON.stringify(warnSpy.mock.calls);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(logSpy).not.toHaveBeenCalled();
    expect(serializedWarnings).not.toContain(verificationInput.email);
    expect(serializedWarnings).not.toContain(verificationInput.fullName);
    expect(serializedWarnings).not.toContain(verificationInput.code);
    expect(serializedWarnings).not.toContain(deletionInput.code);
    expect(serializedWarnings).not.toContain(recoveryInput.code);
  });
});
