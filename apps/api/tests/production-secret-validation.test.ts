import { afterEach, describe, expect, it, vi } from "vitest";
import { validateEnvironment } from "../src/config/environment-validation.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import type { AuthRepository } from "../src/modules/auth/auth.types.js";
import { CalendarService } from "../src/modules/calendars/calendar.service.js";
import type { CalendarRepository } from "../src/modules/calendars/calendar.types.js";

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  MONGODB_URI: "mongodb://127.0.0.1:27017/academic_test",
  JWT_ACCESS_SECRET: "test-access-secret-with-at-least-32-characters",
  JWT_REFRESH_SECRET: "test-refresh-secret-with-at-least-32-characters",
  EMAIL_VERIFICATION_TOKEN_PEPPER: "test-email-verification-pepper-with-at-least-32-characters",
  PASSWORD_RECOVERY_TOKEN_PEPPER: "test-recovery-pepper-with-at-least-32-characters",
  CALENDAR_FEED_SECRET: "test-calendar-secret-with-at-least-32-characters",
  DATA_ENCRYPTION_KEY_ID: "test-v1",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  DATA_LOOKUP_HMAC_SECRET: Buffer.alloc(32, 2).toString("base64")
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production runtime secret validation", () => {
  it.each([
    { label: "missing", invalidSecrets: [undefined] },
    { label: "blank", invalidSecrets: [""] },
    { label: "whitespace-only", invalidSecrets: ["                               "] },
    { label: "short", invalidSecrets: ["x".repeat(31)] },
    {
      label: "known placeholders",
      invalidSecrets: [
        "change-me-access-secret-with-32-plus-chars",
        "example-access-secret-with-32-plus-chars",
        "placeholder-calendar-secret-with-32-plus-chars"
      ]
    }
  ])("fails startup validation for $label production secrets", ({ invalidSecrets }) => {
    for (const invalidSecret of invalidSecrets) {
      const result = validateEnvironment({
        ...productionEnvironment,
        JWT_ACCESS_SECRET: invalidSecret,
        CALENDAR_FEED_SECRET: invalidSecret
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("JWT_ACCESS_SECRET must be set to a 32+ character secret in production.");
      expect(result.errors).toContain("CALENDAR_FEED_SECRET must be set to a 32+ character secret in production.");
    }
  });

  it("accepts independently configured production-grade runtime secrets", () => {
    expect(validateEnvironment(productionEnvironment)).toEqual(expect.objectContaining({
      valid: true,
      errors: []
    }));
  });

  it("does not treat a Firebase project id as an Admin credential", () => {
    const result = validateEnvironment({
      ...productionEnvironment,
      FIREBASE_PROJECT_ID: "academic-mobile-app-7629"
    });

    expect(result.warnings).toContain(
      "Firebase Admin credentials or Cloud Run application default credentials are required before production push delivery is enabled."
    );
  });

  it.each([
    { FIREBASE_SERVICE_ACCOUNT_JSON: "{\"project_id\":\"configured\"}" },
    { GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/firebase.json" },
    { K_SERVICE: "academic-api" }
  ])("accepts an explicit Firebase Admin credential source", (firebaseEnvironment) => {
    const result = validateEnvironment({
      ...productionEnvironment,
      FIREBASE_PROJECT_ID: "academic-mobile-app-7629",
      ...firebaseEnvironment
    });

    expect(result.warnings).not.toContain(
      "Firebase Admin credentials or Cloud Run application default credentials are required before production push delivery is enabled."
    );
  });

  it("rejects reusing the access-token signing value for the production Calendar feed", () => {
    const result = validateEnvironment({
      ...productionEnvironment,
      CALENDAR_FEED_SECRET: productionEnvironment.JWT_ACCESS_SECRET
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("CALENDAR_FEED_SECRET must differ from JWT_ACCESS_SECRET in production.");
  });

  it("refuses to sign production access credentials with the development fallback", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ACCESS_SECRET", "");

    expect(() => new TokenService().signAccessToken({
      id: "student-1",
      email: "student@example.test",
      role: "student",
      credentialGeneration: 0
    })).toThrow("JWT_ACCESS_SECRET_NOT_CONFIGURED");
  });

  it("refuses a checked-in placeholder as a production password-recovery secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ACCESS_SECRET", "");
    vi.stubEnv("PASSWORD_RECOVERY_TOKEN_PEPPER", "change-me-password-recovery-pepper-with-32-plus-chars");

    expect(() => new TokenService().issuePasswordRecoveryToken("student@example.test"))
      .toThrow("PASSWORD_RECOVERY_TOKEN_PEPPER_NOT_CONFIGURED");
  });

  it.each(["", productionEnvironment.JWT_ACCESS_SECRET!])(
    "refuses to issue a production calendar feed with a missing or reused dedicated secret",
    async (calendarFeedSecret) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("JWT_ACCESS_SECRET", productionEnvironment.JWT_ACCESS_SECRET!);
      vi.stubEnv("CALENDAR_FEED_SECRET", calendarFeedSecret);
      const authRepository = {
        findUserById: vi.fn().mockResolvedValue({
          id: "student-1",
          email: "student@example.test",
          role: "student",
          status: "active",
          authProvider: "password",
          emailVerifiedAt: new Date(),
          credentialGeneration: 0,
          universityId: "university-1",
          createdAt: new Date(),
          updatedAt: new Date()
        })
      } as unknown as AuthRepository;
      const service = new CalendarService({} as CalendarRepository, authRepository);

      await expect(service.getMyCalendarIntegrationLinks("student-1", "https://api.example.test"))
        .rejects.toThrow("CALENDAR_FEED_SECRET_NOT_CONFIGURED");
    }
  );
});
