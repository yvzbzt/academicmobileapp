import "reflect-metadata";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_AUTHENTICATION_PURPOSE_KEY,
  RecentAuthGuard
} from "../src/common/guards/recent-auth.guard.js";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService } from "../src/modules/auth/email-verification-sender.service.js";
import type { GoogleIdentityVerifier, VerifiedGoogleIdentity } from "../src/modules/auth/firebase-google-identity.verifier.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import type { RecentAuthenticationPurpose } from "../src/modules/auth/auth.types.js";
import { TokenService } from "../src/modules/auth/token.service.js";

class FastPasswordHasher extends PasswordHasher {
  override async hash(password: string): Promise<string> {
    return createHash("sha256").update(password).digest("hex");
  }

  override async verify(password: string, passwordHash: string): Promise<boolean> {
    return (await this.hash(password)) === passwordHash;
  }
}

class FakeGoogleVerifier implements GoogleIdentityVerifier {
  constructor(private readonly identities: Record<string, VerifiedGoogleIdentity>) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    const identity = this.identities[idToken];
    if (!identity) throw new Error("GOOGLE_TOKEN_INVALID");
    return identity;
  }
}

function createService(verifier?: GoogleIdentityVerifier) {
  const repository = new InMemoryAuthRepository();
  const hasher = new FastPasswordHasher();
  const tokenService = new TokenService();
  const service = new AuthApplicationService(
    repository,
    hasher,
    tokenService,
    new EmailVerificationSenderService(),
    verifier
  );
  return { repository, hasher, tokenService, service };
}

function createExecutionContext(
  request: Record<string, unknown>,
  purpose: RecentAuthenticationPurpose
): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata(RECENT_AUTHENTICATION_PURPOSE_KEY, purpose, handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

async function createPasswordFixture(purpose: RecentAuthenticationPurpose = "delete_personal_data") {
  const fixture = createService();
  const password = "CurrentPassword123!";
  const user = await fixture.repository.createUser({
    fullName: "Password Owner",
    email: `password-owner-${randomUUID()}@example.com`,
    emailVerifiedAt: new Date(),
    passwordHash: await fixture.hasher.hash(password),
    authProvider: "password",
    role: "student",
    status: "active"
  });
  const result = await fixture.service.createRecentAuthenticationProof(user.id, {
    method: "password",
    password,
    purpose
  });
  const guard = new RecentAuthGuard(fixture.tokenService, fixture.repository, new Reflector());
  return { ...fixture, guard, password, purpose, result, user };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("recent authentication", () => {
  it("creates a short-lived generation-bound proof only after password verification", async () => {
    const fixture = createService();
    const user = await fixture.repository.createUser({
      fullName: "Password Owner",
      email: "password-owner@example.com",
      emailVerifiedAt: new Date(),
      passwordHash: await fixture.hasher.hash("CurrentPassword123!"),
      authProvider: "password",
      role: "student",
      status: "active"
    });

    await expect(fixture.service.createRecentAuthenticationProof(user.id, {
      method: "password",
      password: "wrong-password",
      purpose: "delete_personal_data"
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const result = await fixture.service.createRecentAuthenticationProof(user.id, {
      method: "password",
      password: "CurrentPassword123!",
      purpose: "delete_personal_data"
    });
    expect(result).toEqual({
      proof: expect.any(String),
      expiresInSeconds: fixture.tokenService.getRecentAuthenticationTtlSeconds()
    });
    const payload = fixture.tokenService.verifyRecentAuthenticationProof(result.proof);
    expect(payload).toEqual({
      sub: user.id,
      credentialGeneration: 0,
      method: "password",
      purpose: "delete_personal_data",
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u)
    });
    const records = (fixture.repository as unknown as {
      recentAuthenticationProofs: Map<string, Record<string, unknown>>;
    }).recentAuthenticationProofs;
    const firstStoredEntry = [...records.entries()][0];
    expect(firstStoredEntry).toBeDefined();
    if (!firstStoredEntry) throw new Error("RECENT_AUTHENTICATION_RECORD_NOT_STORED");
    const [storedDigest, storedRecord] = firstStoredEntry;
    expect(storedDigest).toBe(fixture.tokenService.hashRecentAuthenticationJti(payload.jti));
    expect(storedRecord).toEqual({
      ownerId: user.id,
      credentialGeneration: 0,
      purpose: "delete_personal_data",
      jtiDigest: storedDigest,
      createdAt: expect.any(Date),
      expiresAt: expect.any(Date)
    });
    expect(storedRecord).not.toHaveProperty("jti");
    expect(storedRecord).not.toHaveProperty("proof");
    expect(storedRecord).not.toHaveProperty("method");

    const secondResult = await fixture.service.createRecentAuthenticationProof(user.id, {
      method: "password",
      password: "CurrentPassword123!",
      purpose: "delete_personal_data"
    });
    expect(fixture.tokenService.verifyRecentAuthenticationProof(secondResult.proof).jti).not.toBe(payload.jti);
  });

  it("supports the existing Google method while rejecting a token for another owner", async () => {
    const fixture = createService(new FakeGoogleVerifier({
      "matching-google-token": {
        uid: "firebase-owner-1",
        email: "google-owner@example.com",
        emailVerified: true,
        signInProvider: "google.com"
      },
      "other-google-token": {
        uid: "firebase-owner-2",
        email: "other-owner@example.com",
        emailVerified: true,
        signInProvider: "google.com"
      }
    }));
    const user = await fixture.repository.createUser({
      fullName: "Google Owner",
      email: "google-owner@example.com",
      emailVerifiedAt: new Date(),
      passwordHash: await fixture.hasher.hash("UnusableGeneratedPassword123!"),
      authProvider: "google",
      firebaseAuthUid: "firebase-owner-1",
      role: "student",
      status: "active"
    });

    await expect(fixture.service.createRecentAuthenticationProof(user.id, {
      method: "password",
      password: "UnusableGeneratedPassword123!",
      purpose: "delete_account"
    })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(fixture.service.createRecentAuthenticationProof(user.id, {
      method: "google",
      idToken: "other-google-token",
      purpose: "delete_account"
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const result = await fixture.service.createRecentAuthenticationProof(user.id, {
      method: "google",
      idToken: "matching-google-token",
      purpose: "delete_account"
    });
    expect(fixture.tokenService.verifyRecentAuthenticationProof(result.proof)).toEqual({
      sub: user.id,
      credentialGeneration: 0,
      method: "google",
      purpose: "delete_account",
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u)
    });
  });

  it("rejects a missing proof", async () => {
    const fixture = await createPasswordFixture();
    await expect(fixture.guard.canActivate(createExecutionContext({
      headers: {},
      user: { id: fixture.user.id, credentialGeneration: 0 }
    }, fixture.purpose))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a malformed proof", async () => {
    const fixture = await createPasswordFixture();
    await expect(fixture.guard.canActivate(createExecutionContext({
      headers: { "x-recent-authentication": "malformed" },
      user: { id: fixture.user.id, credentialGeneration: 0 }
    }, fixture.purpose))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects an expired proof", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T08:00:00.000Z"));
    const fixture = await createPasswordFixture();
    vi.advanceTimersByTime(fixture.tokenService.getRecentAuthenticationTtlSeconds() * 1_000 + 1_000);

    await expect(fixture.guard.canActivate(createExecutionContext({
      headers: { "x-recent-authentication": fixture.result.proof },
      user: { id: fixture.user.id, credentialGeneration: 0 }
    }, fixture.purpose))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a proof presented by another owner", async () => {
    const fixture = await createPasswordFixture();
    await expect(fixture.guard.canActivate(createExecutionContext({
      headers: { "x-recent-authentication": fixture.result.proof },
      user: { id: "another-owner", credentialGeneration: 0 }
    }, fixture.purpose))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a proof from another credential generation", async () => {
    const fixture = await createPasswordFixture();
    await expect(fixture.guard.canActivate(createExecutionContext({
      headers: { "x-recent-authentication": fixture.result.proof },
      user: { id: fixture.user.id, credentialGeneration: 1 }
    }, fixture.purpose))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects the wrong purpose without consuming the proof", async () => {
    const fixture = await createPasswordFixture("delete_personal_data");
    const request = {
      headers: { "x-recent-authentication": fixture.result.proof },
      user: { id: fixture.user.id, credentialGeneration: 0 }
    };

    await expect(fixture.guard.canActivate(
      createExecutionContext(request, "delete_account")
    )).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(fixture.guard.canActivate(
      createExecutionContext(request, "delete_personal_data")
    )).resolves.toBe(true);
  });

  it("accepts the first correct use and rejects the second", async () => {
    const fixture = await createPasswordFixture();
    const request = {
      headers: { "x-recent-authentication": fixture.result.proof },
      user: { id: fixture.user.id, credentialGeneration: 0 }
    };

    await expect(fixture.guard.canActivate(
      createExecutionContext(request, fixture.purpose)
    )).resolves.toBe(true);
    await expect(fixture.guard.canActivate(
      createExecutionContext(request, fixture.purpose)
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts exactly one of two concurrent uses", async () => {
    const fixture = await createPasswordFixture("delete_account");
    const request = {
      headers: { "x-recent-authentication": fixture.result.proof },
      user: { id: fixture.user.id, credentialGeneration: 0 }
    };
    const outcomes = await Promise.all([
      fixture.guard.canActivate(createExecutionContext(request, fixture.purpose)).then(() => "accepted", () => "rejected"),
      fixture.guard.canActivate(createExecutionContext(request, fixture.purpose)).then(() => "accepted", () => "rejected")
    ]);

    expect(outcomes.filter((outcome) => outcome === "accepted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "rejected")).toHaveLength(1);
  });

  it("uses one atomic Mongo consume keyed by digest, owner, generation, purpose, and expiry", async () => {
    const create = vi.fn(async () => undefined);
    const findOneAndUpdate = vi.fn(async () => ({ id: "proof-record" }));
    const repository = new MongoAuthRepository({
      getConnection: () => ({
        models: { RecentAuthenticationProof: { create, findOneAndUpdate } }
      })
    } as never);
    const createdAt = new Date("2026-08-04T08:00:00.000Z");
    const expiresAt = new Date("2026-08-04T08:05:00.000Z");
    const consumedAt = new Date("2026-08-04T08:01:00.000Z");
    const stored = {
      ownerId: "owner-1",
      credentialGeneration: 7,
      purpose: "delete_account" as const,
      jtiDigest: "a".repeat(64),
      createdAt,
      expiresAt
    };

    await repository.createRecentAuthenticationProof(stored);
    await expect(repository.consumeRecentAuthenticationProof({
      ownerId: stored.ownerId,
      credentialGeneration: stored.credentialGeneration,
      purpose: stored.purpose,
      jtiDigest: stored.jtiDigest,
      consumedAt
    })).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith(stored);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        ownerId: stored.ownerId,
        credentialGeneration: stored.credentialGeneration,
        purpose: stored.purpose,
        jtiDigest: stored.jtiDigest,
        consumedAt: null,
        expiresAt: { $gt: consumedAt }
      },
      { $set: { consumedAt } },
      { new: true }
    );
  });
});
