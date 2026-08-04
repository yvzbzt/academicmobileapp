import { UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthApplicationService } from "../src/modules/auth/auth-application.service.js";
import { EmailVerificationSenderService } from "../src/modules/auth/email-verification-sender.service.js";
import type { GoogleIdentityVerifier, VerifiedGoogleIdentity } from "../src/modules/auth/firebase-google-identity.verifier.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
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
      password: "wrong-password"
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const result = await fixture.service.createRecentAuthenticationProof(user.id, {
      method: "password",
      password: "CurrentPassword123!"
    });
    expect(result).toEqual({
      proof: expect.any(String),
      expiresInSeconds: fixture.tokenService.getRecentAuthenticationTtlSeconds()
    });
    expect(fixture.tokenService.verifyRecentAuthenticationProof(result.proof)).toEqual({
      sub: user.id,
      credentialGeneration: 0,
      method: "password"
    });
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
      password: "UnusableGeneratedPassword123!"
    })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(fixture.service.createRecentAuthenticationProof(user.id, {
      method: "google",
      idToken: "other-google-token"
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const result = await fixture.service.createRecentAuthenticationProof(user.id, {
      method: "google",
      idToken: "matching-google-token"
    });
    expect(fixture.tokenService.verifyRecentAuthenticationProof(result.proof)).toEqual({
      sub: user.id,
      credentialGeneration: 0,
      method: "google"
    });
  });
});
