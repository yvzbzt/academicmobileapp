import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import type { AuthUserRecord } from "./auth.types.js";

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
