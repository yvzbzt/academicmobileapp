import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { AppleIdentityVerifier, verifyAppleIdentityToken } from "../src/modules/auth/apple-identity.verifier.js";

const audience = "com.anssoft.akademiktakvim";
const nonce = "7f".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
  setSafeOutboundRequestDependenciesForTesting(undefined);
});

async function appleToken(input: {
  audience?: string;
  nonce?: string;
  expiresIn?: string;
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwks: JSONWebKeySet = {
    keys: [{ ...publicJwk, kid: "apple-test-key", alg: "RS256", use: "sig" }]
  };
  const token = await new SignJWT({
    nonce: input.nonce ?? nonce,
    email: "apple.owner@privaterelay.appleid.com",
    email_verified: "true",
    is_private_email: "true"
  })
    .setProtectedHeader({ alg: "RS256", kid: "apple-test-key" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(input.audience ?? audience)
    .setSubject("000123.apple-owner")
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? "5m")
    .sign(privateKey);
  return { jwks, token };
}

describe("Apple identity token verification", () => {
  it("accepts a signed Apple token only for the configured client and nonce", async () => {
    const fixture = await appleToken();

    await expect(verifyAppleIdentityToken(fixture.token, nonce, [audience], fixture.jwks)).resolves.toEqual({
      subject: "000123.apple-owner",
      email: "apple.owner@privaterelay.appleid.com",
      emailVerified: true,
      isPrivateEmail: true
    });
  });

  it("rejects wrong nonce, wrong audience, and expired credentials", async () => {
    const valid = await appleToken();
    await expect(verifyAppleIdentityToken(valid.token, "wrong-nonce", [audience], valid.jwks)).rejects.toThrow(
      "APPLE_TOKEN_CLAIMS_INVALID"
    );

    const wrongAudience = await appleToken({ audience: "com.example.other" });
    await expect(verifyAppleIdentityToken(wrongAudience.token, nonce, [audience], wrongAudience.jwks)).rejects.toThrow();

    const expired = await appleToken({ expiresIn: "-1s" });
    await expect(verifyAppleIdentityToken(expired.token, nonce, [audience], expired.jwks)).rejects.toThrow();
  });

  it("loads Apple keys only from the pinned safe-outbound policy and caches them", async () => {
    const fixture = await appleToken();
    const publicAddress: ResolvedOutboundAddress = { address: "17.0.0.1", family: 4 };
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: { providerPolicy: string }
    ): Promise<SafeOutboundHopResponse> => {
      expect(url).toBe("https://appleid.apple.com/auth/keys");
      expect(input.providerPolicy).toBe("apple-jwks");
      return {
        status: 200,
        headers: { "cache-control": "public, max-age=3600" },
        body: Buffer.from(JSON.stringify(fixture.jwks)),
        remoteAddress: pinnedAddress.address
      };
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });
    vi.stubEnv("APPLE_SIGN_IN_CLIENT_IDS", audience);
    const verifier = new AppleIdentityVerifier();

    await expect(verifier.verifyIdentityToken(fixture.token, nonce)).resolves.toEqual(
      expect.objectContaining({ subject: "000123.apple-owner" })
    );
    await expect(verifier.verifyIdentityToken(fixture.token, nonce)).resolves.toEqual(
      expect.objectContaining({ subject: "000123.apple-owner" })
    );
    expect(requestHop).toHaveBeenCalledTimes(1);
  });
});
