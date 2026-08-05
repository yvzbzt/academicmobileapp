import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AccountGenerationGuard,
  classifyAuthError,
  runObservableAccountCleanup
} from "../../apps/mobile-native/src/auth/session-integrity";
import {
  createManualExamStorageKey,
  planLegacyManualExamMigration,
  readManualExamEnvelope,
  serializeManualExamEnvelope
} from "../../apps/mobile-native/src/session-integrity/manual-exam-storage";

const exam = {
  id: "exam-1",
  title: "Private Algorithms Midterm",
  examDate: "2026-08-01T09:00:00.000Z"
};

describe("user-scoped manual-exam storage", () => {
  it("creates distinct SecureStore-compatible keys without embedding the raw owner ID", () => {
    const first = createManualExamStorageKey("user:one@example.com");
    const second = createManualExamStorageKey("user:two@example.com");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(first).not.toContain("user:one@example.com");
  });

  it("round-trips only the manual-exam persistence contract for the matching owner", () => {
    const unsafeExam = {
      ...exam,
      password: "do-not-store",
      verificationCode: "1739",
      accessToken: "secret-token"
    };
    const raw = serializeManualExamEnvelope(
      "user-1",
      [unsafeExam],
      "2026-07-29T08:00:00.000Z"
    );
    const result = readManualExamEnvelope(raw, "user-1");

    expect(result).toEqual({
      status: "loaded",
      exams: [exam],
      updatedAt: "2026-07-29T08:00:00.000Z",
      shouldDelete: false
    });
    expect(raw).not.toContain("do-not-store");
    expect(raw).not.toContain("1739");
    expect(raw).not.toContain("secret-token");
  });

  it("never exposes an envelope belonging to another account", () => {
    const raw = serializeManualExamEnvelope("user-1", [exam], "2026-07-29T08:00:00.000Z");
    const result = readManualExamEnvelope(raw, "user-2");

    expect(result).toEqual({ status: "owner_mismatch", exams: [], shouldDelete: true });
    expect(JSON.stringify(result)).not.toContain(exam.title);
  });

  it("discards owner-unknown legacy content without returning its exam payload", () => {
    const legacyValue = JSON.stringify([{ ...exam, accessToken: "legacy-token" }]);
    const result = planLegacyManualExamMigration({ legacyValue, currentOwnerId: "user-2" });

    expect(result).toEqual({ status: "discard_unowned" });
    expect(JSON.stringify(result)).not.toContain(exam.title);
    expect(JSON.stringify(result)).not.toContain("legacy-token");
  });

  it("distinguishes absent and invalid legacy data without exposing either value", () => {
    expect(planLegacyManualExamMigration({
      legacyValue: null,
      currentOwnerId: "user-1"
    })).toEqual({ status: "no_data" });

    const invalid = planLegacyManualExamMigration({
      legacyValue: "private malformed exam content",
      currentOwnerId: "user-1",
      verifiedLegacyOwnerId: "user-1"
    });
    expect(invalid).toEqual({ status: "discard_invalid" });
    expect(JSON.stringify(invalid)).not.toContain("private malformed exam content");
  });

  it("distinguishes owner mismatch and permits migration only with explicit matching proof", () => {
    const legacyValue = JSON.stringify([exam]);

    expect(planLegacyManualExamMigration({
      legacyValue,
      currentOwnerId: "user-2",
      verifiedLegacyOwnerId: "user-1"
    })).toEqual({ status: "discard_owner_mismatch" });

    const allowed = planLegacyManualExamMigration({
      legacyValue,
      currentOwnerId: "user-1",
      verifiedLegacyOwnerId: "user-1",
      updatedAt: "2026-07-29T08:00:00.000Z"
    });
    expect(allowed.status).toBe("migrate");
    if (allowed.status !== "migrate") throw new Error("Expected a verified migration.");
    expect(allowed.examCount).toBe(1);
    expect(readManualExamEnvelope(allowed.serializedEnvelope, "user-1")).toMatchObject({
      status: "loaded",
      exams: [exam]
    });
  });
});

describe("AccountGenerationGuard", () => {
  it("accepts a current completion", () => {
    const guard = new AccountGenerationGuard();
    const snapshot = guard.activate("user-1");

    expect(guard.isCurrent(snapshot)).toBe(true);
    expect(guard.settle(snapshot, { value: "current" })).toEqual({
      accepted: true,
      value: { value: "current" }
    });
  });

  it("rejects late content after logout without returning the stale value", () => {
    const guard = new AccountGenerationGuard();
    const snapshot = guard.activate("user-1");
    guard.invalidate();

    const result = guard.settle(snapshot, {
      password: "private-password",
      verificationCode: "1739",
      accessToken: "secret-token",
      examTitle: exam.title
    });

    expect(guard.isCurrent(snapshot)).toBe(false);
    expect(result).toEqual({ accepted: false, reason: "no_active_account" });
    expect(JSON.stringify(result)).not.toMatch(/private-password|1739|secret-token|Private Algorithms/);
  });

  it("rejects prior-owner and prior-generation completions", () => {
    const guard = new AccountGenerationGuard();
    const firstOwner = guard.activate("user-1");
    guard.activate("user-2");
    expect(guard.settle(firstOwner, "stale")).toEqual({ accepted: false, reason: "owner_changed" });

    const firstSession = guard.capture();
    guard.activate("user-2");
    expect(guard.settle(firstSession, "stale")).toEqual({ accepted: false, reason: "generation_changed" });
  });

  it("guards the concrete native refresh, logout, and data-deletion settlement paths", () => {
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const refreshHandler = appSource.slice(
      appSource.indexOf("async function refreshAuthenticatedSession"),
      appSource.indexOf("async function apiRequest")
    );
    const persistHandler = appSource.slice(
      appSource.indexOf("async function persistSession"),
      appSource.indexOf("async function persistPendingVerification")
    );
    const logoutHandler = appSource.slice(
      appSource.indexOf("async function handleLogout"),
      appSource.indexOf("function resetUserScopedState")
    );
    const dataDeletionHandler = appSource.slice(
      appSource.indexOf("async function deleteMyData"),
      appSource.indexOf("function confirmDeleteAccount")
    );

    expect(refreshHandler).toContain("accountGuardRef.current.isCurrent(snapshot)");
    expect(refreshHandler).toContain("accountCleanupInProgressRef.current");
    expect(refreshHandler).toContain("enqueueStorageMutation");
    expect(logoutHandler).toContain("persistSession(null, invalidateAuthenticatedWork)");
    expect(logoutHandler).toContain('target: "pending_verification_storage"');
    expect(persistHandler.indexOf("SESSION_INVALIDATED_STORAGE_VALUE"))
      .toBeLessThan(persistHandler.indexOf("afterDurableInvalidation?.()"));
    expect(dataDeletionHandler.indexOf("accountCleanupInProgressRef.current = true"))
      .toBeLessThan(dataDeletionHandler.indexOf("await waitForAuthenticatedMutations()"));
    expect(dataDeletionHandler.indexOf("await waitForAuthenticatedMutations()"))
      .toBeLessThan(dataDeletionHandler.indexOf('"/me/data"'));
    expect(dataDeletionHandler.indexOf('"/me/data"'))
      .toBeLessThan(dataDeletionHandler.indexOf("invalidateAuthenticatedWork()"));
    expect(dataDeletionHandler).toContain('target: "pending_verification_storage"');
  });
});

describe("native manual-exam hydration wiring", () => {
  it("does not persist or render an empty/pre-owner exam state during startup", () => {
    const appSource = readFileSync(new URL("../../apps/mobile-native/App.tsx", import.meta.url), "utf8");
    const runtimeSource = readFileSync(
      new URL("../../apps/mobile-native/src/calendar/personal-exam-runtime.ts", import.meta.url),
      "utf8"
    );
    const runtimeWiring = appSource.slice(
      appSource.indexOf("personalExamRuntimeRef.current = new PersonalExamRuntime"),
      appSource.indexOf("const accessToken")
    );
    const visibilityGuard = appSource.slice(
      appSource.indexOf("const visibleManualExams"),
      appSource.indexOf("const extraExams")
    );

    expect(runtimeWiring).toContain("ownerGuard: accountGuardRef.current");
    expect(runtimeWiring).toContain("setItemAsync: (key, value) => enqueueStorageMutation");
    expect(runtimeWiring).toContain("onStateChange: setManualExamState");
    expect(runtimeSource).toContain("!this.options.ownerGuard.isCurrent(expectedOwnerSnapshot)");
    expect(runtimeSource).toContain("!this.state.hydrated");
    expect(visibilityGuard).toContain("session?.user.id === manualExamOwnerId && manualExamsHydrated");
  });
});

describe("controlled auth errors", () => {
  it.each([
    ["AUTH_INVALID_CREDENTIALS", "invalid_credentials"],
    ["AUTH_EMAIL_NOT_VERIFIED", "email_not_verified"],
    ["AUTH_VERIFICATION_CODE_INVALID", "invalid_verification_code"],
    ["AUTH_VERIFICATION_CODE_EXPIRED", "verification_code_expired"],
    ["AUTH_VERIFICATION_REQUEST_INVALID", "verification_request_invalid"],
    ["AUTH_SESSION_INVALID", "session_expired"],
    ["AUTH_SESSION_EXPIRED", "session_expired"],
    ["AUTH_ACCOUNT_DISABLED", "disabled_account"],
    ["AUTH_RATE_LIMITED", "rate_limited"]
  ] as const)("maps exact backend errorCode %s before status heuristics", (errorCode, expectedCode) => {
    const result = classifyAuthError({
      operation: "login",
      status: 401,
      body: { errorCode, message: `${"x".repeat(5000)} raw server detail private-password secret-token` }
    });

    expect(result.code).toBe(expectedCode);
    expect(JSON.stringify(result)).not.toMatch(/private-password|secret-token|raw server detail/);
  });

  it("classifies invalid credentials without returning raw password or token payloads", () => {
    const result = classifyAuthError({
      operation: "login",
      status: 401,
      body: {
        message: "Invalid credentials for password private-password",
        password: "private-password",
        accessToken: "secret-token"
      }
    });

    expect(result).toMatchObject({ code: "invalid_credentials", status: 401, retryable: false });
    expect(JSON.stringify(result)).not.toMatch(/private-password|secret-token|Invalid credentials/);
  });

  it("classifies verification and refresh failures without echoing codes or tokens", () => {
    const verification = classifyAuthError({
      operation: "verify_email",
      status: 400,
      body: JSON.stringify({ message: "Verification code 1739 is invalid", token: "secret-token" })
    });
    const refresh = classifyAuthError({
      operation: "refresh_session",
      status: 401,
      body: { message: "refresh token secret-token expired" }
    });

    expect(verification.code).toBe("invalid_verification_code");
    expect(refresh.code).toBe("session_expired");
    expect(JSON.stringify([verification, refresh])).not.toMatch(/1739|secret-token|refresh token/);
  });

  it("replaces untrusted server HTML with a fixed service message", () => {
    const result = classifyAuthError({
      operation: "login",
      status: 503,
      body: "<html>debug password=private-password token=secret-token</html>"
    });

    expect(result.code).toBe("server_unavailable");
    expect(JSON.stringify(result)).not.toMatch(/html|private-password|secret-token/);
  });
});

describe("observable account cleanup", () => {
  it("continues after failures and reports no thrown credential or content details", async () => {
    const executed: string[] = [];
    const result = await runObservableAccountCleanup([
      {
        target: "session_storage",
        run: () => {
          throw new Error("Failed to delete secret-token and private-password");
        }
      },
      {
        target: "manual_exam_storage",
        run: () => {
          executed.push(exam.title);
        }
      }
    ]);

    expect(executed).toEqual([exam.title]);
    expect(result).toEqual({
      complete: false,
      attemptedCount: 2,
      succeededTargets: ["manual_exam_storage"],
      failedTargets: ["session_storage"]
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-token|private-password|Private Algorithms/);
  });

  it("reports a never-settling cleanup step instead of blocking later local cleanup", async () => {
    let localCleanupCompleted = false;
    const result = await runObservableAccountCleanup([
      {
        target: "server_session",
        timeoutMs: 5,
        run: () => new Promise<void>(() => undefined)
      },
      {
        target: "session_storage",
        run: () => {
          localCleanupCompleted = true;
        }
      }
    ]);

    expect(localCleanupCompleted).toBe(true);
    expect(result.failedTargets).toEqual(["server_session"]);
    expect(result.succeededTargets).toEqual(["session_storage"]);
  });
});
