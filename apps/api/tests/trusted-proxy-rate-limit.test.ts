import { HttpException, type ExecutionContext } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitGuard } from "../src/common/guards/rate-limit.guard.js";
import { resolveClientIp } from "../src/common/network/client-ip.js";
import { validateEnvironment } from "../src/config/environment-validation.js";

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("trusted reverse-proxy client identity", () => {
  const trusted = ["172.30.79.0/24"];

  it("ignores forwarding headers on a direct untrusted connection", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "198.51.100.8" },
      headers: { "x-forwarded-for": "203.0.113.77" }
    }, trusted)).toBe("198.51.100.8");
  });

  it("uses the immediate client supplied by the checked-in trusted Caddy hop", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "::ffff:172.30.79.4" },
      headers: { "x-forwarded-for": "198.51.100.20" }
    }, trusted)).toBe("198.51.100.20");
  });

  it("bounds a multiple-hop header to the right-most address and ignores a spoofed left edge", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "172.30.79.4" },
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" }
    }, trusted)).toBe("203.0.113.9");
  });

  it("rate limits the resolved client rather than a spoofable forwarded value", async () => {
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "172.30.79.0/24");
    const guard = new RateLimitGuard();
    const requestFor = (forwardedFor: string) => ({
      method: "POST",
      route: { path: "/auth/password-recovery/request" },
      headers: { "x-forwarded-for": forwardedFor },
      socket: { remoteAddress: "172.30.79.4" }
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(guard.canActivate(context(requestFor(`192.0.2.${attempt}, 198.51.100.30`))))
        .resolves.toBe(true);
    }
    await expect(guard.canActivate(context(requestFor("203.0.113.250, 198.51.100.30"))))
      .rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(context(requestFor("198.51.100.31")))).resolves.toBe(true);
  });

  it("rejects an invalid proxy range in the environment contract", () => {
    const result = validateEnvironment({
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://localhost/test",
      TRUSTED_PROXY_CIDRS: "172.30.79.0/24,not-a-range"
    });
    expect(result.errors).toContain("TRUSTED_PROXY_CIDRS must contain only valid explicit CIDR ranges.");
  });
});
