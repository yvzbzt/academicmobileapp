import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { EmailVerificationSenderService } from "../src/modules/auth/email-verification-sender.service.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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
        code: "1234",
        expiresAt: new Date("2026-07-21T12:00:00.000Z")
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
