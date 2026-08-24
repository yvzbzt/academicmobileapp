import { Injectable } from "@nestjs/common";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet
} from "jose";
import {
  APPLE_JWKS_URL,
  safeOutboundRequest
} from "../../common/network/safe-outbound-request.js";

const APPLE_IDENTITY_ISSUER = "https://appleid.apple.com";
const DEFAULT_JWKS_CACHE_SECONDS = 6 * 60 * 60;
const MAX_JWKS_CACHE_SECONDS = 24 * 60 * 60;

export interface VerifiedAppleIdentity {
  subject: string;
  email?: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

export interface AppleIdentityTokenVerifier {
  verifyIdentityToken(identityToken: string, nonce: string): Promise<VerifiedAppleIdentity>;
}

type CachedAppleJwks = {
  expiresAtMs: number;
  value: JSONWebKeySet;
};

@Injectable()
export class AppleIdentityVerifier implements AppleIdentityTokenVerifier {
  private cachedJwks?: CachedAppleJwks;

  async verifyIdentityToken(identityToken: string, nonce: string): Promise<VerifiedAppleIdentity> {
    const audiences = readAllowedAppleClientIds();
    if (audiences.length === 0) throw new Error("APPLE_SIGN_IN_NOT_CONFIGURED");

    const header = decodeProtectedHeader(identityToken);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
      throw new Error("APPLE_TOKEN_HEADER_INVALID");
    }

    let jwks = await this.readAppleJwks(false);
    if (!jwks.keys.some((key) => key.kid === header.kid)) {
      jwks = await this.readAppleJwks(true);
    }

    return verifyAppleIdentityToken(identityToken, nonce, audiences, jwks);
  }

  private async readAppleJwks(forceRefresh: boolean): Promise<JSONWebKeySet> {
    if (!forceRefresh && this.cachedJwks && this.cachedJwks.expiresAtMs > Date.now()) {
      return this.cachedJwks.value;
    }

    const response = await safeOutboundRequest(APPLE_JWKS_URL, {
      timeoutMs: 8_000,
      method: "GET",
      headers: { Accept: "application/json" },
      maximumRedirects: 0,
      maximumResponseBytes: 512 * 1024,
      providerPolicy: "apple-jwks"
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error("APPLE_JWKS_UNAVAILABLE");
    }

    const jwks = parseAppleJwks(response.body);
    const cacheSeconds = readCacheMaxAge(response.headers["cache-control"]);
    this.cachedJwks = {
      value: jwks,
      expiresAtMs: Date.now() + cacheSeconds * 1_000
    };
    return jwks;
  }
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  nonce: string,
  audiences: readonly string[],
  jwks: JSONWebKeySet
): Promise<VerifiedAppleIdentity> {
  if (!nonce || audiences.length === 0) throw new Error("APPLE_TOKEN_CONTEXT_INVALID");
  const { payload } = await jwtVerify(identityToken, createLocalJWKSet(jwks), {
    algorithms: ["RS256"],
    issuer: APPLE_IDENTITY_ISSUER,
    audience: [...audiences]
  });
  if (typeof payload.sub !== "string" || !payload.sub || payload.nonce !== nonce) {
    throw new Error("APPLE_TOKEN_CLAIMS_INVALID");
  }

  const email = typeof payload.email === "string" && payload.email.trim()
    ? payload.email.trim()
    : undefined;
  return {
    subject: payload.sub,
    ...(email ? { email } : {}),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === "true"
  };
}

function parseAppleJwks(body: Buffer): JSONWebKeySet {
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("APPLE_JWKS_INVALID");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { keys?: unknown }).keys)) {
    throw new Error("APPLE_JWKS_INVALID");
  }
  const jwks = payload as JSONWebKeySet;
  if (
    jwks.keys.length === 0
    || jwks.keys.some((key) => (
      key.kty !== "RSA"
      || typeof key.kid !== "string"
      || !key.kid
      || typeof key.n !== "string"
      || typeof key.e !== "string"
    ))
  ) {
    throw new Error("APPLE_JWKS_INVALID");
  }
  return jwks;
}

function readAllowedAppleClientIds(): string[] {
  return [...new Set([
    process.env.APPLE_SIGN_IN_CLIENT_IDS,
    process.env.APPLE_CLIENT_ID,
    process.env.APPLE_BUNDLE_ID
  ].flatMap((value) => (value ?? "").split(/[,\s]+/u)).map((value) => value.trim()).filter(Boolean))];
}

function readCacheMaxAge(value: string | string[] | undefined): number {
  const source = Array.isArray(value) ? value.join(",") : value ?? "";
  const parsed = Number(source.match(/(?:^|,)\s*max-age=(\d+)/iu)?.[1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_JWKS_CACHE_SECONDS;
  return Math.min(parsed, MAX_JWKS_CACHE_SECONDS);
}
