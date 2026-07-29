import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { AuthUserRecord } from "./auth.types.js";
import { PASSWORD_RECOVERY_CODE_LENGTH, PASSWORD_RECOVERY_TTL_SECONDS } from "./auth.constants.js";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AuthUserRecord["role"];
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

  signAccessToken(user: Pick<AuthUserRecord, "id" | "email" | "role">): string {
    const secret = process.env.JWT_ACCESS_SECRET ?? "development-access-secret-change-me-32-chars";
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role
      },
      secret,
      { expiresIn: this.accessTokenTtlSeconds }
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const secret = process.env.JWT_ACCESS_SECRET ?? "development-access-secret-change-me-32-chars";
    const payload = jwt.verify(token, secret);
    if (!payload || typeof payload !== "object") throw new Error("INVALID_ACCESS_TOKEN");
    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.sub !== "string" || typeof candidate.email !== "string" || typeof candidate.role !== "string") {
      throw new Error("INVALID_ACCESS_TOKEN_PAYLOAD");
    }
    return {
      sub: candidate.sub,
      email: candidate.email,
      role: candidate.role as AuthUserRecord["role"]
    };
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
    const configuredSecret = process.env.PASSWORD_RECOVERY_TOKEN_PEPPER ?? process.env.JWT_ACCESS_SECRET;
    if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret.length < 32)) {
      throw new Error("PASSWORD_RECOVERY_TOKEN_PEPPER_NOT_CONFIGURED");
    }
    const secret = configuredSecret ?? "development-password-recovery-pepper-change-me";
    const normalizedEmail = email.trim().toLowerCase();
    return createHmac("sha256", secret).update(`password-recovery:${normalizedEmail}:${rawToken.trim()}`).digest("hex");
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
}
