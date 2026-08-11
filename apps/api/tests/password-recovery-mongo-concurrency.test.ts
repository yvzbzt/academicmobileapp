import { HttpException, HttpStatus } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Connection } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import { passwordRecoveryTokenSchema, refreshTokenSchema, userSchema } from "../src/database/mongoose-schemas.js";
import { getModel } from "../src/database/mongoose-utils.js";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { AUTH_ERROR_CODES } from "../src/modules/auth/auth.constants.js";
import {
  EmailVerificationSenderService,
  type SendPasswordRecoveryEmailInput
} from "../src/modules/auth/email-verification-sender.service.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { TokenService } from "../src/modules/auth/token.service.js";
import type { AuthUserRecord, PasswordRecoveryTokenRecord } from "../src/modules/auth/auth.types.js";

const TEST_DATABASE_PATTERN = /^academic_recovery_concurrency_test_[0-9]+_[A-Za-z0-9_-]+$/u;
const PRODUCTION_DATABASE_NAMES = new Set([
  "academic_calendar",
  "akademik_takvim",
  "akademik_takvim_ci",
  "admin",
  "config",
  "local"
]);
const OLD_PASSWORD = "OldPassword123!";
const TEST_TIMEOUT_MS = 120_000;

interface IsolatedMongoTarget {
  uri: string;
  databaseName: string;
}

interface RecoveryFixture {
  repository: MongoAuthRepository;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  service: AuthApplicationService;
}

class NoopRecoverySender extends EmailVerificationSenderService {
  override async sendPasswordRecoveryEmail(input: SendPasswordRecoveryEmailInput): Promise<void> {
    void input;
  }
}

// Keep this suite focused on Mongo's document-level compare-and-swap behavior.
// Production-cost bcrypt work before the barrier makes participant arrival depend
// on unrelated full-suite CPU load and can expire the barrier before the CAS runs.
class FastTestPasswordHasher extends PasswordHasher {
  override async hash(password: string): Promise<string> {
    return createHash("sha256").update(password).digest("hex");
  }

  override async verify(password: string, passwordHash: string): Promise<boolean> {
    return (await this.hash(password)) === passwordHash;
  }
}

function isolatedMongoTarget(environment: NodeJS.ProcessEnv): IsolatedMongoTarget {
  if (environment.NODE_ENV !== "test") throw new Error("RECOVERY_TEST_NODE_ENV_MUST_BE_TEST");
  if (environment.MONGODB_URI?.trim()) throw new Error("RECOVERY_TEST_MONGODB_URI_MUST_BE_UNSET");
  if (environment.MONGO_APP_DATABASE?.trim()) throw new Error("RECOVERY_TEST_PRODUCTION_DATABASE_NAME_MUST_BE_UNSET");

  const uri = environment.MONGODB_TEST_URI?.trim();
  if (!uri) throw new Error("RECOVERY_TEST_MONGODB_TEST_URI_REQUIRED");

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("RECOVERY_TEST_MONGODB_TEST_URI_INVALID");
  }

  if (parsed.protocol !== "mongodb:") throw new Error("RECOVERY_TEST_MONGODB_SCHEME_UNSAFE");
  if (parsed.username || parsed.password) throw new Error("RECOVERY_TEST_MONGODB_CREDENTIALS_FORBIDDEN");
  if (parsed.host.includes(",")) throw new Error("RECOVERY_TEST_MONGODB_MULTIPLE_HOSTS_FORBIDDEN");
  if (parsed.hostname !== "127.0.0.1") throw new Error("RECOVERY_TEST_MONGODB_HOST_NOT_LOOPBACK");
  if (!parsed.port || !/^\d+$/u.test(parsed.port)) throw new Error("RECOVERY_TEST_MONGODB_EXPLICIT_PORT_REQUIRED");
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("RECOVERY_TEST_MONGODB_PORT_INVALID");
  }
  if (parsed.search || parsed.hash) throw new Error("RECOVERY_TEST_MONGODB_OPTIONS_FORBIDDEN");

  const rawDatabaseName = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname;
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(rawDatabaseName);
  } catch {
    throw new Error("RECOVERY_TEST_MONGODB_DATABASE_NAME_INVALID");
  }
  if (rawDatabaseName !== databaseName || !TEST_DATABASE_PATTERN.test(databaseName)) {
    throw new Error("RECOVERY_TEST_MONGODB_DATABASE_NAME_UNSAFE");
  }
  if (!databaseName.includes("_test_") || PRODUCTION_DATABASE_NAMES.has(databaseName)) {
    throw new Error("RECOVERY_TEST_MONGODB_DATABASE_NAME_FORBIDDEN");
  }

  return { uri, databaseName };
}

function assertExactTestConnection(connection: Connection, databaseName: string): void {
  if (!TEST_DATABASE_PATTERN.test(databaseName) || !databaseName.includes("_test_")) {
    throw new Error("RECOVERY_TEST_DATABASE_GUARD_REJECTED_NAME");
  }
  if (connection.host !== "127.0.0.1") throw new Error("RECOVERY_TEST_DATABASE_GUARD_REJECTED_HOST");
  if (connection.name !== databaseName) throw new Error("RECOVERY_TEST_DATABASE_GUARD_REJECTED_CONNECTION");
}

function createFixture(repository: MongoAuthRepository): RecoveryFixture {
  const passwordHasher = new FastTestPasswordHasher();
  const tokenService = new TokenService();
  const service = new AuthApplicationService(
    repository,
    passwordHasher,
    tokenService,
    new NoopRecoverySender()
  );
  return { repository, passwordHasher, tokenService, service };
}

async function createActiveUser(fixture: RecoveryFixture, email: string): Promise<AuthUserRecord> {
  return fixture.repository.createUser({
    fullName: "Real Mongo Recovery Student",
    email,
    emailVerifiedAt: new Date(),
    passwordHash: await fixture.passwordHasher.hash(OLD_PASSWORD),
    authProvider: "password",
    role: "student",
    status: "active"
  });
}

async function issueRecovery(
  fixture: RecoveryFixture,
  user: AuthUserRecord,
  code: string
): Promise<PasswordRecoveryTokenRecord> {
  return fixture.repository.createPasswordRecoveryToken({
    userId: user.id,
    credentialGeneration: user.credentialGeneration,
    tokenHash: fixture.tokenService.hashPasswordRecoveryToken(user.email, code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
    resendAvailableAt: new Date()
  });
}

async function confirmRecovery(
  fixture: RecoveryFixture,
  email: string,
  code: string,
  password: string
): Promise<{ status: "password_reset" }> {
  return fixture.service.confirmPasswordRecovery({
    email,
    code,
    newPassword: password,
    passwordConfirmation: password
  });
}

function expectInvalidRecoveryError(reason: unknown): void {
  expect(reason).toBeInstanceOf(HttpException);
  const error = reason as HttpException;
  expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  expect(error.getResponse()).toEqual(expect.objectContaining({
    statusCode: HttpStatus.UNAUTHORIZED,
    errorCode: AUTH_ERROR_CODES.PASSWORD_RECOVERY_CODE_INVALID
  }));
}

function expectInvalidSessionError(reason: unknown): void {
  expect(reason).toBeInstanceOf(HttpException);
  const error = reason as HttpException;
  expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  expect(error.getResponse()).toEqual(expect.objectContaining({
    statusCode: HttpStatus.UNAUTHORIZED,
    errorCode: AUTH_ERROR_CODES.SESSION_INVALID
  }));
}

async function expectRecoveryRejected(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    expectInvalidRecoveryError(error);
    return;
  }
  throw new Error("Expected password-recovery confirmation to be rejected.");
}

function createBarrier(participants: number, timeoutMs = 30_000): { wait: () => Promise<void> } {
  let arrived = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  const gate = new Promise<void>((resolve, rejectGate) => {
    release = resolve;
    reject = rejectGate;
  });
  const timeout = setTimeout(() => {
    reject(new Error(`RECOVERY_TEST_BARRIER_TIMEOUT:${arrived}/${participants}`));
  }, timeoutMs);

  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === participants) {
        clearTimeout(timeout);
        release();
      } else if (arrived > participants) {
        clearTimeout(timeout);
        reject(new Error("RECOVERY_TEST_BARRIER_OVERFLOW"));
      }
      await gate;
    }
  };
}

async function expectRefreshRejected(
  fixture: RecoveryFixture,
  refreshToken: string,
  deviceId: string
): Promise<void> {
  try {
    await fixture.service.refresh({ refreshToken, deviceId });
  } catch (error) {
    expectInvalidSessionError(error);
    return;
  }
  throw new Error("Expected stale refresh credential to be rejected.");
}

describe("password-recovery isolated Mongo target guard", () => {
  it.each([
    ["missing test URI", { NODE_ENV: "test" }],
    ["production environment", { NODE_ENV: "production", MONGODB_TEST_URI: "mongodb://127.0.0.1:27018/academic_recovery_concurrency_test_1_guard" }],
    ["production URI fallback", { NODE_ENV: "test", MONGODB_URI: "mongodb://127.0.0.1:27017/academic_calendar", MONGODB_TEST_URI: "mongodb://127.0.0.1:27018/academic_recovery_concurrency_test_1_guard" }],
    ["SRV URI", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb+srv://127.0.0.1/academic_recovery_concurrency_test_1_guard" }],
    ["remote host", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://192.0.2.10:27018/academic_recovery_concurrency_test_1_guard" }],
    ["multiple hosts", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://127.0.0.1:27018,127.0.0.1:27019/academic_recovery_concurrency_test_1_guard" }],
    ["missing port", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://127.0.0.1/academic_recovery_concurrency_test_1_guard" }],
    ["missing database", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://127.0.0.1:27018/" }],
    ["non-test database", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://127.0.0.1:27018/academic_calendar" }],
    ["credentials", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://user:password@127.0.0.1:27018/academic_recovery_concurrency_test_1_guard" }],
    ["URI options", { NODE_ENV: "test", MONGODB_TEST_URI: "mongodb://127.0.0.1:27018/academic_recovery_concurrency_test_1_guard?authSource=admin" }]
  ])("rejects %s", (_name, environment) => {
    expect(() => isolatedMongoTarget(environment)).toThrow(/^RECOVERY_TEST_/u);
  });

  it("accepts only the isolated loopback test shape", () => {
    const target = isolatedMongoTarget({
      NODE_ENV: "test",
      MONGODB_TEST_URI: "mongodb://127.0.0.1:27018/academic_recovery_concurrency_test_12345_guard"
    });
    expect(target.databaseName).toBe("academic_recovery_concurrency_test_12345_guard");
  });
});

describe("Mongo password-recovery concurrency", () => {
  let mongo: MongoConnectionService | undefined;
  let connection: Connection | undefined;
  let repository: MongoAuthRepository | undefined;
  let databaseName: string | undefined;

  beforeAll(async () => {
    const target = isolatedMongoTarget(process.env);
    databaseName = target.databaseName;
    mongo = new MongoConnectionService();
    connection = (await mongo.connect(target.uri)) ?? undefined;
    if (!connection) throw new Error("RECOVERY_TEST_MONGODB_CONNECTION_REQUIRED");
    assertExactTestConnection(connection, databaseName);
    // This suite verifies document-level CAS behavior, not index installation.
    // Disabling auto-indexing also guarantees the disposable test never creates,
    // replaces, or reconciles indexes from production schema declarations.
    connection.config.autoIndex = false;
    await connection.dropDatabase();
    await Promise.all([
      getModel(connection, "User", userSchema).init(),
      getModel(connection, "RefreshToken", refreshTokenSchema).init(),
      getModel(connection, "PasswordRecoveryToken", passwordRecoveryTokenSchema).init()
    ]);
    repository = new MongoAuthRepository(mongo);
  }, 30_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const activeConnection = mongo?.getConnection();
      if (activeConnection) {
        if (!databaseName) throw new Error("RECOVERY_TEST_DATABASE_NAME_LOST");
        assertExactTestConnection(activeConnection, databaseName);
        await activeConnection.dropDatabase();
      }
    } finally {
      await mongo?.onApplicationShutdown();
    }
  }, 30_000);

  function fixture(): RecoveryFixture {
    if (!repository) throw new Error("RECOVERY_TEST_REPOSITORY_NOT_READY");
    return createFixture(repository);
  }

  it("commits exactly one of 32 barrier-synchronized confirmations", async () => {
    const testFixture = fixture();
    const user = await createActiveUser(testFixture, "mongo-race-32@example.test");
    const recoveryCode = "310001";
    const recovery = await issueRecovery(testFixture, user, recoveryCode);
    const oldSessions = await Promise.all(Array.from({ length: 3 }, (_unused, index) =>
      testFixture.service.login({
        email: user.email,
        password: OLD_PASSWORD,
        deviceId: `race-32-old-device-${index}`
      })));
    const passwords = Array.from({ length: 32 }, (_unused, index) =>
      `RaceWinnerCandidate${String(index).padStart(2, "0")}!`);
    const barrier = createBarrier(passwords.length);
    const originalCommit = testFixture.repository.completePasswordRecovery.bind(testFixture.repository);
    const commitResults: string[] = [];
    vi.spyOn(testFixture.repository, "completePasswordRecovery").mockImplementation(async (input) => {
      await barrier.wait();
      const result = await originalCommit(input);
      commitResults.push(result);
      return result;
    });

    const outcomes = await Promise.allSettled(passwords.map(async (password, index) => ({
      index,
      result: await confirmRecovery(testFixture, user.email, recoveryCode, password)
    })));
    const successes = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const failures = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(31);
    expect(commitResults.filter((result) => result === "completed")).toHaveLength(1);
    expect(commitResults.filter((result) => result === "conflict")).toHaveLength(31);
    for (const failure of failures) expectInvalidRecoveryError(failure.reason);

    const winningIndex = successes[0]!.value.index;
    const winningPassword = passwords[winningIndex]!;
    const storedUser = await testFixture.repository.findUserById(user.id);
    expect(storedUser).toEqual(expect.objectContaining({
      credentialGeneration: 1,
      passwordRecoveryCompletion: expect.objectContaining({ credentialGeneration: 1 })
    }));
    expect(storedUser).not.toHaveProperty("passwordRecoveryAttempt");
    expect(await testFixture.passwordHasher.verify(winningPassword, storedUser!.passwordHash)).toBe(true);
    for (const [index, password] of passwords.entries()) {
      if (index !== winningIndex) {
        expect(await testFixture.passwordHasher.verify(password, storedUser!.passwordHash)).toBe(false);
      }
    }

    for (const [index, session] of oldSessions.entries()) {
      await expectRefreshRejected(testFixture, session.refreshToken, `race-32-old-device-${index}`);
    }
    await expectRecoveryRejected(() =>
      confirmRecovery(testFixture, user.email, recoveryCode, "OldRecoveryMustNotWin123!")
    );

    const storedOldRecovery = await testFixture.repository.findPasswordRecoveryTokenByHash(recovery.tokenHash);
    expect(storedOldRecovery).toEqual(expect.objectContaining({ credentialGeneration: 0 }));
    const newSession = await testFixture.service.login({
      email: user.email,
      password: winningPassword,
      deviceId: "race-32-new-device"
    });
    expect(testFixture.tokenService.verifyAccessToken(newSession.accessToken).credentialGeneration).toBe(1);
    await expect(testFixture.repository.findRefreshTokenByHash(
      testFixture.tokenService.hashRefreshToken(newSession.refreshToken)
    )).resolves.toEqual(expect.objectContaining({ credentialGeneration: 1 }));
    const newRecovery = await issueRecovery(testFixture, storedUser!, "310002");
    expect(newRecovery.credentialGeneration).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("commits exactly one of two same-generation recovery records", async () => {
    const testFixture = fixture();
    const user = await createActiveUser(testFixture, "mongo-race-two-records@example.test");
    const attempts = [
      { code: "320001", password: "FirstRecordPassword123!" },
      { code: "320002", password: "SecondRecordPassword123!" }
    ];
    const records = [];
    for (const attempt of attempts) records.push(await issueRecovery(testFixture, user, attempt.code));
    const barrier = createBarrier(attempts.length);
    const originalCommit = testFixture.repository.completePasswordRecovery.bind(testFixture.repository);
    const commitResults: string[] = [];
    vi.spyOn(testFixture.repository, "completePasswordRecovery").mockImplementation(async (input) => {
      await barrier.wait();
      const result = await originalCommit(input);
      commitResults.push(result);
      return result;
    });

    const outcomes = await Promise.allSettled(attempts.map(async (attempt, index) => ({
      index,
      result: await confirmRecovery(testFixture, user.email, attempt.code, attempt.password)
    })));
    const successes = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const failures = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(commitResults.filter((result) => result === "completed")).toHaveLength(1);
    expect(commitResults.filter((result) => result === "conflict")).toHaveLength(1);
    expectInvalidRecoveryError(failures[0]!.reason);

    const winningIndex = successes[0]!.value.index;
    const losingIndex = winningIndex === 0 ? 1 : 0;
    const storedUser = await testFixture.repository.findUserById(user.id);
    expect(storedUser?.credentialGeneration).toBe(1);
    expect(await testFixture.passwordHasher.verify(attempts[winningIndex]!.password, storedUser!.passwordHash)).toBe(true);
    expect(await testFixture.passwordHasher.verify(attempts[losingIndex]!.password, storedUser!.passwordHash)).toBe(false);
    await expectRecoveryRejected(() => confirmRecovery(
      testFixture,
      user.email,
      attempts[losingIndex]!.code,
      attempts[losingIndex]!.password
    ));
    for (const record of records) {
      await expect(testFixture.repository.findPasswordRecoveryTokenByHash(record.tokenHash)).resolves.toEqual(
        expect.objectContaining({ credentialGeneration: 0, invalidatedAt: expect.any(Date) })
      );
    }
  }, TEST_TIMEOUT_MS);

  it("retries deterministically after response loss without accepting another password", async () => {
    const testFixture = fixture();
    const user = await createActiveUser(testFixture, "mongo-response-loss@example.test");
    const oldSession = await testFixture.service.login({
      email: user.email,
      password: OLD_PASSWORD,
      deviceId: "response-loss-old-device"
    });
    const recoveryCode = "330001";
    const recovery = await issueRecovery(testFixture, user, recoveryCode);
    const committedPassword = "ResponseLossCommitted123!";
    const differentPassword = "ResponseLossRejected123!";
    const originalCommit = testFixture.repository.completePasswordRecovery.bind(testFixture.repository);
    let injected = false;
    const commit = vi.spyOn(testFixture.repository, "completePasswordRecovery").mockImplementation(async (input) => {
      const result = await originalCommit(input);
      if (!injected && result === "completed") {
        injected = true;
        throw new Error("SIMULATED_RESPONSE_LOSS_AFTER_SECURITY_COMMIT");
      }
      return result;
    });

    await expect(confirmRecovery(testFixture, user.email, recoveryCode, committedPassword))
      .rejects.toThrow("SIMULATED_RESPONSE_LOSS_AFTER_SECURITY_COMMIT");
    expect(injected).toBe(true);
    await expect(confirmRecovery(testFixture, user.email, recoveryCode, committedPassword))
      .resolves.toEqual({ status: "password_reset" });
    await expectRecoveryRejected(() =>
      confirmRecovery(testFixture, user.email, recoveryCode, differentPassword)
    );
    expect(commit).toHaveBeenCalledTimes(1);

    const storedUser = await testFixture.repository.findUserById(user.id);
    expect(storedUser?.credentialGeneration).toBe(1);
    expect(await testFixture.passwordHasher.verify(committedPassword, storedUser!.passwordHash)).toBe(true);
    expect(await testFixture.passwordHasher.verify(differentPassword, storedUser!.passwordHash)).toBe(false);
    await expectRefreshRejected(testFixture, oldSession.refreshToken, "response-loss-old-device");
    await expect(testFixture.repository.findPasswordRecoveryTokenByHash(recovery.tokenHash)).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );
  }, TEST_TIMEOUT_MS);

  it("leaves no partial state when failure occurs before the security commit", async () => {
    const testFixture = fixture();
    const user = await createActiveUser(testFixture, "mongo-precommit-failure@example.test");
    const oldSession = await testFixture.service.login({
      email: user.email,
      password: OLD_PASSWORD,
      deviceId: "precommit-old-device"
    });
    const recoveryCode = "340001";
    const recovery = await issueRecovery(testFixture, user, recoveryCode);
    const beforeUser = await testFixture.repository.findUserById(user.id);
    const beforeRecovery = await testFixture.repository.findPasswordRecoveryTokenByHash(recovery.tokenHash);
    const beforeRefresh = await testFixture.repository.findRefreshTokenByHash(
      testFixture.tokenService.hashRefreshToken(oldSession.refreshToken)
    );
    const commit = vi.spyOn(testFixture.repository, "completePasswordRecovery")
      .mockRejectedValueOnce(new Error("SIMULATED_FAILURE_BEFORE_SECURITY_COMMIT"));
    const refreshCleanup = vi.spyOn(testFixture.repository, "revokeRefreshTokensByUserId");
    const recoveryCleanup = vi.spyOn(testFixture.repository, "invalidatePasswordRecoveryTokensByUserId");
    const proposedPassword = "PrecommitNeverStored123!";

    await expect(confirmRecovery(testFixture, user.email, recoveryCode, proposedPassword))
      .rejects.toThrow("SIMULATED_FAILURE_BEFORE_SECURITY_COMMIT");
    expect(refreshCleanup).not.toHaveBeenCalled();
    expect(recoveryCleanup).not.toHaveBeenCalled();
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(beforeUser);
    await expect(testFixture.repository.findPasswordRecoveryTokenByHash(recovery.tokenHash)).resolves.toEqual(beforeRecovery);
    await expect(testFixture.repository.findRefreshTokenByHash(
      testFixture.tokenService.hashRefreshToken(oldSession.refreshToken)
    )).resolves.toEqual(beforeRefresh);

    commit.mockRestore();
    await expect(confirmRecovery(testFixture, user.email, recoveryCode, proposedPassword))
      .resolves.toEqual({ status: "password_reset" });
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(expect.objectContaining({
      credentialGeneration: 1
    }));
  }, TEST_TIMEOUT_MS);

  it("keeps old credentials invalid when cleanup fails after the security commit", async () => {
    const testFixture = fixture();
    const user = await createActiveUser(testFixture, "mongo-postcommit-cleanup@example.test");
    const oldSessions = await Promise.all(Array.from({ length: 2 }, (_unused, index) =>
      testFixture.service.login({
        email: user.email,
        password: OLD_PASSWORD,
        deviceId: `postcommit-old-device-${index}`
      })));
    const losingCode = "350001";
    const winningCode = "350002";
    const losingRecovery = await issueRecovery(testFixture, user, losingCode);
    const winningRecovery = await issueRecovery(testFixture, user, winningCode);
    const committedPassword = "CleanupFailureCommitted123!";
    vi.spyOn(testFixture.repository, "revokeRefreshTokensByUserId")
      .mockRejectedValue(new Error("SIMULATED_REFRESH_CLEANUP_FAILURE"));
    vi.spyOn(testFixture.repository, "invalidatePasswordRecoveryTokensByUserId")
      .mockRejectedValue(new Error("SIMULATED_RECOVERY_CLEANUP_FAILURE"));

    await expect(confirmRecovery(testFixture, user.email, winningCode, committedPassword))
      .resolves.toEqual({ status: "password_reset" });
    const storedUser = await testFixture.repository.findUserById(user.id);
    expect(storedUser).toEqual(expect.objectContaining({
      credentialGeneration: 1,
      passwordRecoveryCompletion: expect.objectContaining({ credentialGeneration: 1 })
    }));
    expect(storedUser).not.toHaveProperty("passwordRecoveryAttempt");
    expect(await testFixture.passwordHasher.verify(committedPassword, storedUser!.passwordHash)).toBe(true);

    for (const [index, session] of oldSessions.entries()) {
      const tokenHash = testFixture.tokenService.hashRefreshToken(session.refreshToken);
      await expect(testFixture.repository.findRefreshTokenByHash(tokenHash)).resolves.toEqual(
        expect.objectContaining({ credentialGeneration: 0 })
      );
      await expectRefreshRejected(testFixture, session.refreshToken, `postcommit-old-device-${index}`);
    }
    for (const recovery of [losingRecovery, winningRecovery]) {
      await expect(testFixture.repository.findPasswordRecoveryTokenByHash(recovery.tokenHash)).resolves.toEqual(
        expect.objectContaining({ credentialGeneration: 0 })
      );
    }
    await expectRecoveryRejected(() =>
      confirmRecovery(testFixture, user.email, losingCode, "CleanupLosingPassword123!")
    );
    await expect(confirmRecovery(testFixture, user.email, winningCode, committedPassword))
      .resolves.toEqual({ status: "password_reset" });
    await expectRecoveryRejected(() =>
      confirmRecovery(testFixture, user.email, winningCode, "CleanupRetryMustNotWin123!")
    );
    await expect(testFixture.repository.findUserById(user.id)).resolves.toEqual(expect.objectContaining({
      credentialGeneration: 1
    }));
  }, TEST_TIMEOUT_MS);
});
