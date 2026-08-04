import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { AuthUserRecord, RecentAuthenticationPurpose } from "./auth.types.js";
import { PASSWORD_RECOVERY_CODE_LENGTH, PASSWORD_RECOVERY_TTL_SECONDS } from "./auth.constants.js";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AuthUserRecord["role"];
  credentialGeneration: number;
}

export interface RecentAuthenticationPayload {
  sub: string;
  credentialGeneration: number;
  method: "password" | "google";
  purpose: RecentAuthenticationPurpose;
  jti: string;
}

export interface RecentAuthenticationProofIssueResult {
  proof: string;
  jti: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface RefreshTokenIssueResult {
  rawToken: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export interface EmailVerificationTokenIssueResult {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export type PasswordRecoveryTokenIssueResult = EmailVerificationTokenIssueResult;

@Injectable()
export class TokenService {
  private readonly accessTokenTtlSeconds = 900;
  private readonly refreshTokenTtlDays = 30;
  private readonly emailVerificationTtlMinutes = 10;
  private readonly recentAuthenticationTtlSeconds = 5 * 60;

  signAccessToken(user: Pick<AuthUserRecord, "id" | "email" | "role" | "credentialGeneration">): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        kind: "access",
        credentialGeneration: user.credentialGeneration
      },
      this.accessTokenSecret(),
      { expiresIn: this.accessTokenTtlSeconds }
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = jwt.verify(token, this.accessTokenSecret());
    if (!payload || typeof payload !== "object") throw new Error("INVALID_ACCESS_TOKEN");
    const candidate = payload as Record<string, unknown>;
    if (
      typeof candidate.sub !== "string"
      || typeof candidate.email !== "string"
      || typeof candidate.role !== "string"
      || (candidate.kind !== undefined && candidate.kind !== "access")
    ) {
      throw new Error("INVALID_ACCESS_TOKEN_PAYLOAD");
    }
    return {
      sub: candidate.sub,
      email: candidate.email,
      role: candidate.role as AuthUserRecord["role"],
      credentialGeneration: normalizeCredentialGeneration(candidate.credentialGeneration)
    };
  }

  issueRecentAuthenticationProof(
    user: Pick<AuthUserRecord, "id" | "credentialGeneration">,
    method: RecentAuthenticationPayload["method"],
    purpose: RecentAuthenticationPurpose
  ): RecentAuthenticationProofIssueResult {
    const issuedAtSeconds = Math.floor(Date.now() / 1_000);
    const expiresAtSeconds = issuedAtSeconds + this.recentAuthenticationTtlSeconds;
    const jti = randomBytes(32).toString("base64url");
    const proof = jwt.sign(
      {
        sub: user.id,
        kind: "recent_authentication",
        credentialGeneration: user.credentialGeneration,
        method,
        purpose,
        jti,
        iat: issuedAtSeconds,
        exp: expiresAtSeconds
      },
      this.accessTokenSecret()
    );
    return {
      proof,
      jti,
      createdAt: new Date(issuedAtSeconds * 1_000),
      expiresAt: new Date(expiresAtSeconds * 1_000)
    };
  }

  verifyRecentAuthenticationProof(token: string): RecentAuthenticationPayload {
    const payload = jwt.verify(token, this.accessTokenSecret());
    if (!payload || typeof payload !== "object") throw new Error("INVALID_RECENT_AUTHENTICATION_PROOF");
    const candidate = payload as Record<string, unknown>;
    if (
      candidate.kind !== "recent_authentication"
      || typeof candidate.sub !== "string"
      || (candidate.method !== "password" && candidate.method !== "google")
      || (candidate.purpose !== "delete_personal_data" && candidate.purpose !== "delete_account")
      || typeof candidate.jti !== "string"
      || !/^[A-Za-z0-9_-]{43}$/u.test(candidate.jti)
      || !Number.isSafeInteger(candidate.credentialGeneration)
      || (candidate.credentialGeneration as number) < 0
      || !Number.isSafeInteger(candidate.iat)
      || !Number.isSafeInteger(candidate.exp)
      || (candidate.exp as number) - (candidate.iat as number) !== this.recentAuthenticationTtlSeconds
      || (candidate.iat as number) > Math.floor(Date.now() / 1_000) + 5
    ) {
      throw new Error("INVALID_RECENT_AUTHENTICATION_PROOF");
    }
    return {
      sub: candidate.sub,
      credentialGeneration: candidate.credentialGeneration as number,
      method: candidate.method,
      purpose: candidate.purpose,
      jti: candidate.jti
    };
  }

  hashRecentAuthenticationJti(jti: string): string {
    return createHash("sha256")
      .update(`recent-authentication-jti:v1:${jti}`)
      .digest("hex");
  }

  issueRefreshToken(existingFamilyId?: string): RefreshTokenIssueResult {
    const rawToken = `${randomUUID()}.${randomBytes(48).toString("base64url")}`;
    const tokenHash = this.hashOpaqueToken(rawToken);
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    return {
      rawToken,
      tokenHash,
      familyId: existingFamilyId ?? randomUUID(),
      expiresAt
    };
  }

  issueEmailVerificationToken(): EmailVerificationTokenIssueResult {
    const rawToken = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
    return {
      rawToken,
      tokenHash: this.hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + this.emailVerificationTtlMinutes * 60 * 1000)
    };
  }

  issuePasswordRecoveryToken(email: string): PasswordRecoveryTokenIssueResult {
    const rawToken = randomInt(0, 10 ** PASSWORD_RECOVERY_CODE_LENGTH).toString().padStart(PASSWORD_RECOVERY_CODE_LENGTH, "0");
    return {
      rawToken,
      tokenHash: this.hashPasswordRecoveryToken(email, rawToken),
      expiresAt: new Date(Date.now() + PASSWORD_RECOVERY_TTL_SECONDS * 1000)
    };
  }

  hashPasswordRecoveryToken(email: string, rawToken: string): string {
    const normalizedEmail = email.trim().toLowerCase();
    return createHmac("sha256", this.passwordRecoverySecret())
      .update(`password-recovery:${normalizedEmail}:${rawToken.trim()}`)
      .digest("hex");
  }

  hashPasswordRecoveryOperation(tokenHash: string, credentialGeneration: number, password: string): string {
    return createHmac("sha256", this.passwordRecoverySecret())
      .update(`password-recovery-operation:${tokenHash}:${credentialGeneration}:${password}`)
      .digest("hex");
  }

  hashOpaqueToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  hashRefreshToken(rawToken: string): string {
    return this.hashOpaqueToken(rawToken);
  }

  getAccessTokenTtlSeconds(): number {
    return this.accessTokenTtlSeconds;
  }

  getRecentAuthenticationTtlSeconds(): number {
    return this.recentAuthenticationTtlSeconds;
  }

  private accessTokenSecret(): string {
    return process.env.JWT_ACCESS_SECRET ?? "development-access-secret-change-me-32-chars";
  }

  private passwordRecoverySecret(): string {
    const configuredSecret = process.env.PASSWORD_RECOVERY_TOKEN_PEPPER ?? process.env.JWT_ACCESS_SECRET;
    if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret.length < 32)) {
      throw new Error("PASSWORD_RECOVERY_TOKEN_PEPPER_NOT_CONFIGURED");
    }
    return configuredSecret ?? "development-password-recovery-pepper-change-me";
  }
}

function normalizeCredentialGeneration(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
