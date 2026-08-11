import { HttpException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService, type SendPasswordRecoveryEmailInput } from "../src/modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";

class TestPasswordHasher extends PasswordHasher {
  override async hash(password: string): Promise<string> {
    return createHash("sha256").update(password).digest("hex");
  }

  override async verify(password: string, passwordHash: string): Promise<boolean> {
    return (await this.hash(password)) === passwordHash;
  }
}

class RecoverySender extends EmailVerificationSenderService {
  readonly sent: SendPasswordRecoveryEmailInput[] = [];

  override async sendPasswordRecoveryEmail(input: SendPasswordRecoveryEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

function fixture(passwordHasher: PasswordHasher = new TestPasswordHasher()) {
  const repository = new InMemoryAuthRepository();
  const tokenService = new TokenService();
  const sender = new RecoverySender();
  const service = new AuthApplicationService(repository, passwordHasher, tokenService, sender);
  return { repository, tokenService, sender, service, passwordHasher };
}

async function activeUser(testFixture: ReturnType<typeof fixture>) {
  return testFixture.repository.createUser({
    fullName: "Generation Security Student",
    email: "generation.security@example.com",
    emailVerifiedAt: new Date(),
    passwordHash: await testFixture.passwordHasher.hash("OldPassword123!"),
    authProvider: "password",
    role: "student",
    status: "active"
  });
}

function rawMaps(repository: InMemoryAuthRepository) {
  return repository as unknown as {
    users: Map<string, Record<string, unknown>>;
    passwordRecoveryTokens: Map<string, Record<string, unknown>>;
    refreshTokens: Map<string, Record<string, unknown>>;
  };
}

function pauseNextPasswordHash(passwordHasher: PasswordHasher) {
  let releaseHash: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  vi.spyOn(passwordHasher, "hash").mockImplementationOnce(async (password) => {
    markStarted?.();
    await new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    return createHash("sha256").update(password).digest("hex");
  });
  return {
    started,
    release() {
      if (!releaseHash) throw new Error("PASSWORD_HASH_NOT_STARTED");
      releaseHash();
    }
  };
}

async function issueRecovery(testFixture: ReturnType<typeof fixture>, userId: string, email: string, generation: number) {
  const issued = testFixture.tokenService.issuePasswordRecoveryToken(email);
  const record = await testFixture.repository.createPasswordRecoveryToken({
    userId,
    credentialGeneration: generation,
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
    resendAvailableAt: new Date()
  });
  return { code: issued.rawToken, record };
}

async function confirm(testFixture: ReturnType<typeof fixture>, email: string, code: string, password: string) {
  return testFixture.service.confirmPasswordRecovery({
    email,
    code,
    newPassword: password,
    passwordConfirmation: password
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("credential-generation password recovery security", () => {
  it("treats missing legacy generations as zero and stamps new records with the advanced generation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const maps = rawMaps(testFixture.repository);
    const storedUser = maps.users.get(user.id)!;
    delete storedUser.credentialGeneration;

    const oldSession = await testFixture.service.login({
      email: user.email,
      password: "OldPassword123!",
      deviceId: "legacy-device"
    });
    await testFixture.service.requestPasswordRecovery(user.email);
    const oldCode = testFixture.sender.sent[0]!.code;
    const oldRefresh = [...maps.refreshTokens.values()][0]!;
    const oldRecovery = [...maps.passwordRecoveryTokens.values()][0]!;
    expect(oldRefresh.credentialGeneration).toBe(0);
    expect(oldRecovery.credentialGeneration).toBe(0);

    await expect(confirm(testFixture, user.email, oldCode, "NewPassword123!")).resolves.toEqual({ status: "password_reset" });
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(expect.objectContaining({ credentialGeneration: 1 }));
    await expect(testFixture.service.refresh({ refreshToken: oldSession.refreshToken, deviceId: "legacy-device" }))
      .rejects.toBeInstanceOf(HttpException);

    const newSession = await testFixture.service.login({
      email: user.email,
      password: "NewPassword123!",
      deviceId: "new-device"
    });
    const newRefresh = await testFixture.repository.findRefreshTokenByHash(
      testFixture.tokenService.hashRefreshToken(newSession.refreshToken)
    );
    expect(newRefresh?.credentialGeneration).toBe(1);

    vi.advanceTimersByTime(61_000);
    await testFixture.service.requestPasswordRecovery(user.email);
    const newCode = testFixture.sender.sent[1]!.code;
    const newRecovery = await testFixture.repository.findPasswordRecoveryTokenByHash(
      testFixture.tokenService.hashPasswordRecoveryToken(user.email, newCode)
    );
    expect(newRecovery?.credentialGeneration).toBe(1);
    vi.useRealTimers();
  });

  it("allows concurrent retries of one confirmation but changes the password and generation exactly once", async () => {
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const recovery = await issueRecovery(testFixture, user.id, user.email, 0);
    const original = testFixture.repository.completePasswordRecovery.bind(testFixture.repository);
    let completedWrites = 0;
    vi.spyOn(testFixture.repository, "completePasswordRecovery").mockImplementation(async (input) => {
      const result = await original(input);
      if (result === "completed") completedWrites += 1;
      return result;
    });

    const results = await Promise.all([
      confirm(testFixture, user.email, recovery.code, "FirstWinningPassword123!"),
      confirm(testFixture, user.email, recovery.code, "FirstWinningPassword123!")
    ]);

    expect(results).toEqual([{ status: "password_reset" }, { status: "password_reset" }]);
    expect(completedWrites).toBe(1);
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 1 })
    );
  });

  it("lets exactly one of two valid recovery records complete", async () => {
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const first = await issueRecovery(testFixture, user.id, user.email, 0);
    const second = await issueRecovery(testFixture, user.id, user.email, 0);

    const outcomes = await Promise.allSettled([
      confirm(testFixture, user.email, first.code, "FirstRacePassword123!"),
      confirm(testFixture, user.email, second.code, "SecondRacePassword123!")
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 1 })
    );
  });

  it("rejects an attempt superseded by a newer recovery request while password hashing is paused", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const before = await testFixture.repository.findUserById(user.id);
    await testFixture.service.requestPasswordRecovery(user.email);
    const oldCode = testFixture.sender.sent[0]!.code;
    const pausedHash = pauseNextPasswordHash(testFixture.passwordHasher);

    const oldConfirmation = confirm(testFixture, user.email, oldCode, "SupersededPassword123!");
    await pausedHash.started;
    vi.advanceTimersByTime(61_000);
    await testFixture.service.requestPasswordRecovery(user.email);
    pausedHash.release();

    await expect(oldConfirmation).rejects.toBeInstanceOf(HttpException);
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0, passwordHash: before!.passwordHash })
    );
  });

  it("rejects an attempt that expires while password hashing is paused", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const before = await testFixture.repository.findUserById(user.id);
    await testFixture.service.requestPasswordRecovery(user.email);
    const code = testFixture.sender.sent[0]!.code;
    const pausedHash = pauseNextPasswordHash(testFixture.passwordHasher);

    const confirmation = confirm(testFixture, user.email, code, "ExpiredDuringHash123!");
    await pausedHash.started;
    vi.advanceTimersByTime(11 * 60 * 1000);
    pausedHash.release();

    await expect(confirmation).rejects.toBeInstanceOf(HttpException);
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0, passwordHash: before!.passwordHash })
    );
  });

  it("performs zero writes when password hashing fails", async () => {
    const failingHasher = new TestPasswordHasher();
    const testFixture = fixture(failingHasher);
    const user = await activeUser(testFixture);
    const recovery = await issueRecovery(testFixture, user.id, user.email, 0);
    const before = await testFixture.repository.findUserById(user.id);
    vi.spyOn(failingHasher, "hash").mockRejectedValueOnce(new Error("HASH_FAILURE"));
    const commit = vi.spyOn(testFixture.repository, "completePasswordRecovery");
    const refreshCleanup = vi.spyOn(testFixture.repository, "revokeRefreshTokensByUserId");
    const recoveryCleanup = vi.spyOn(testFixture.repository, "invalidatePasswordRecoveryTokensByUserId");

    await expect(confirm(testFixture, user.email, recovery.code, "NeverStoredPassword123!"))
      .rejects.toThrow("HASH_FAILURE");
    expect(commit).not.toHaveBeenCalled();
    expect(refreshCleanup).not.toHaveBeenCalled();
    expect(recoveryCleanup).not.toHaveBeenCalled();
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(before);
  });

  it("changes nothing when failure is injected before the atomic security commit", async () => {
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const session = await testFixture.service.login({
      email: user.email,
      password: "OldPassword123!",
      deviceId: "pre-commit-device"
    });
    const recovery = await issueRecovery(testFixture, user.id, user.email, 0);
    vi.spyOn(testFixture.repository, "completePasswordRecovery").mockRejectedValueOnce(new Error("BEFORE_COMMIT_FAILURE"));

    await expect(confirm(testFixture, user.email, recovery.code, "NeverCommittedPassword123!"))
      .rejects.toThrow("BEFORE_COMMIT_FAILURE");
    const unchangedUser = await testFixture.repository.findUserById(user.id);
    expect(unchangedUser).toEqual(expect.objectContaining({ credentialGeneration: 0 }));
    expect(unchangedUser).not.toHaveProperty("passwordRecoveryCompletion");
    await expect(testFixture.service.refresh({ refreshToken: session.refreshToken, deviceId: "pre-commit-device" }))
      .resolves.toEqual(expect.objectContaining({ refreshToken: expect.any(String) }));
  });

  it("keeps old sessions and other recovery records invalid when physical cleanup fails", async () => {
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const oldSession = await testFixture.service.login({
      email: user.email,
      password: "OldPassword123!",
      deviceId: "cleanup-failure-device"
    });
    const losingRecovery = await issueRecovery(testFixture, user.id, user.email, 0);
    const winningRecovery = await issueRecovery(testFixture, user.id, user.email, 0);
    vi.spyOn(testFixture.repository, "revokeRefreshTokensByUserId").mockRejectedValueOnce(new Error("REFRESH_CLEANUP_FAILURE"));
    vi.spyOn(testFixture.repository, "invalidatePasswordRecoveryTokensByUserId").mockRejectedValueOnce(new Error("RECOVERY_CLEANUP_FAILURE"));

    await expect(confirm(testFixture, user.email, winningRecovery.code, "CleanupSafePassword123!"))
      .resolves.toEqual({ status: "password_reset" });
    await expect(testFixture.service.refresh({ refreshToken: oldSession.refreshToken, deviceId: "cleanup-failure-device" }))
      .rejects.toBeInstanceOf(HttpException);
    await expect(confirm(testFixture, user.email, losingRecovery.code, "LosingPassword123!"))
      .rejects.toBeInstanceOf(HttpException);
  });

  it("returns the same success after response loss without applying a second password", async () => {
    const testFixture = fixture();
    const user = await activeUser(testFixture);
    const recovery = await issueRecovery(testFixture, user.id, user.email, 0);

    await confirm(testFixture, user.email, recovery.code, "CommittedPassword123!");
    await expect(confirm(testFixture, user.email, recovery.code, "CommittedPassword123!"))
      .resolves.toEqual({ status: "password_reset" });
    await expect(confirm(testFixture, user.email, recovery.code, "RetryMustNotWin123!"))
      .rejects.toBeInstanceOf(HttpException);
    await expect(testFixture.service.login({
      email: user.email,
      password: "CommittedPassword123!",
      deviceId: "response-loss-device"
    })).resolves.toEqual(expect.objectContaining({ user: expect.objectContaining({ id: user.id }) }));
    await expect(testFixture.service.login({
      email: user.email,
      password: "RetryMustNotWin123!",
      deviceId: "response-loss-retry-device"
    })).rejects.toBeInstanceOf(HttpException);
  });

  it("uses one legacy-compatible Mongo user compare-and-set and recognizes its durable marker", async () => {
    let stored: Record<string, unknown> = {
      _id: "legacy-user",
      fullName: "Legacy User",
      email: "legacy@example.com",
      passwordHash: "old-hash",
      role: "student",
      status: "active",
      passwordRecoveryAttempt: {
        tokenHash: "legacy-recovery-hash",
        credentialGeneration: 0,
        expiresAt: new Date("2099-01-01T00:00:00.000Z")
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const document = () => ({ id: "legacy-user", toObject: () => ({ ...stored }) });
    const findOneAndUpdate = vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      expect(filter).toEqual(expect.objectContaining({
        _id: "legacy-user",
        $or: [{ credentialGeneration: 0 }, { credentialGeneration: { $exists: false } }]
      }));
      if (stored.credentialGeneration !== undefined) return null;
      stored = {
        ...stored,
        ...(update.$set as Record<string, unknown>),
        credentialGeneration: 1
      };
      return document();
    });
    const models = {
      User: {
        findOneAndUpdate,
        findOne: vi.fn(async () => document())
      }
    };
    const repository = new MongoAuthRepository({ getConnection: () => ({ models }) } as never);
    const input = {
      userId: "legacy-user",
      expectedCredentialGeneration: 0,
      tokenHash: "legacy-recovery-hash",
      operationKey: "digest-operation-key",
      passwordHash: "new-hash",
      completedAt: new Date(),
      authProvider: "password" as const
    };

    await expect(repository.completePasswordRecovery(input)).resolves.toBe("completed");
    await expect(repository.completePasswordRecovery(input)).resolves.toBe("already_completed");
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(stored).toEqual(expect.objectContaining({ credentialGeneration: 1, passwordHash: "new-hash" }));
  });
});
