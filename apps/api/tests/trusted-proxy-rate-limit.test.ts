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
  const environmentFor = (trustedProxyCidrs: string): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://localhost/test",
    TRUSTED_PROXY_CIDRS: trustedProxyCidrs
  });

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

  it("enforces an IPv4-mapped IPv6 CIDR while preserving the normalized IPv4 peer", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "::FFFF:172.30.79.4" },
      headers: { "x-forwarded-for": "198.51.100.21" }
    }, ["::ffff:172.30.79.0/120"])).toBe("198.51.100.21");

    expect(resolveClientIp({
      socket: { remoteAddress: "::FFFF:172.30.79.4" },
      headers: { "x-forwarded-for": "198.51.100.21" }
    }, ["172.30.79.0/24"])).toBe("198.51.100.21");
  });

  it.each([
    ["compressed hexadecimal", "::ffff:c000:201"],
    ["expanded hexadecimal", "0:0:0:0:0:ffff:c000:201"],
    ["mixed dotted tail", "::ffff:192.0.2.1"]
  ])("enforces equivalent %s IPv4-mapped peers through IPv6 and IPv4 CIDRs", (_label, remoteAddress) => {
    const request = {
      socket: { remoteAddress },
      headers: { "x-forwarded-for": "198.51.100.22" }
    };

    expect(resolveClientIp(request, ["::ffff:0:0/96"])).toBe("198.51.100.22");
    expect(resolveClientIp(request, ["192.0.2.0/24"])).toBe("198.51.100.22");
  });

  it("bounds a multiple-hop header to the right-most address and ignores a spoofed left edge", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "172.30.79.4" },
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" }
    }, trusted)).toBe("203.0.113.9");
  });

  it.each([
    ["exact /128", "2001:db8::1", "2001:db8::1/128"],
    ["/127", "2001:db8::11", "2001:db8::10/127"],
    ["/64", "2001:db8:abcd:1234:ffff::1", "2001:db8:abcd:1234::/64"],
    ["/48", "2001:db8:abcd:1234::1", "2001:db8:abcd::/48"],
    ["/32", "2001:db8:abcd::1", "2001:db8::/32"],
    ["/0", "fd00:1234::1", "::/0"]
  ])("matches an IPv6 %s trusted-proxy range", (_label, remoteAddress, cidr) => {
    const validation = validateEnvironment(environmentFor(cidr));
    expect(validation.errors).not.toContain("TRUSTED_PROXY_CIDRS must contain only valid explicit CIDR ranges.");
    expect(resolveClientIp({
      socket: { remoteAddress },
      headers: { "x-forwarded-for": "198.51.100.40" }
    }, [cidr])).toBe("198.51.100.40");
  });

  it("does not match a different IPv6 /128 address", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db8::2" },
      headers: { "x-forwarded-for": "198.51.100.41" }
    }, ["2001:db8::1/128"])).toBe("2001:db8::2");
  });

  it("masks a non-byte-aligned IPv6 /127 boundary", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db8::12" },
      headers: { "x-forwarded-for": "198.51.100.42" }
    }, ["2001:db8::10/127"])).toBe("2001:db8::12");
  });

  it.each([
    ["expanded peer", "2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1/128"],
    ["expanded network", "2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001/128"],
    ["mixed IPv4 tail", "2001:db8::192.0.2.1", "2001:0db8:0000:0000:0000:0000:c000:0201/128"],
    ["hexadecimal case", "2001:DB8:ABCD::BEEF", "2001:db8:abcd::beef/128"]
  ])("normalizes IPv6 %s before comparison", (_label, remoteAddress, cidr) => {
    expect(resolveClientIp({
      socket: { remoteAddress },
      headers: { "x-forwarded-for": "198.51.100.43" }
    }, [cidr])).toBe("198.51.100.43");
  });

  it("ignores a spoofed forwarding header from an untrusted direct IPv6 caller", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db9::8" },
      headers: { "x-forwarded-for": "203.0.113.77" }
    }, ["2001:db8::/32"])).toBe("2001:db9::8");
  });

  it("uses the immediate IPv6 client supplied by one approved IPv6 proxy hop", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db8:abcd::4" },
      headers: { "x-forwarded-for": "2001:db8:ffff::20" }
    }, ["2001:db8:abcd::/64"])).toBe("2001:db8:ffff::20");
  });

  it("keeps an IPv6 multiple-hop chain bounded to the right-most address", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db8:abcd::4" },
      headers: { "x-forwarded-for": "2001:db8:dead::1, 2001:db8:ffff::9" }
    }, ["2001:db8:abcd::/64"])).toBe("2001:db8:ffff::9");
  });

  it.each([
    "203.0.113.9, definitely-not-an-ip",
    "definitely-not-an-ip, 203.0.113.9",
    "203.0.113.9,",
    ", 203.0.113.9"
  ])("fails a malformed forwarding chain closed: %s", (forwardedFor) => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db8:abcd::4" },
      headers: { "x-forwarded-for": forwardedFor }
    }, ["2001:db8:abcd::/64"])).toBe("2001:db8:abcd::4");
  });

  it("fails duplicate forwarding header fields closed", () => {
    expect(resolveClientIp({
      socket: { remoteAddress: "2001:db8:abcd::4" },
      headers: { "x-forwarded-for": ["2001:db8:ffff::8", "2001:db8:ffff::9"] }
    }, ["2001:db8:abcd::/64"])).toBe("2001:db8:abcd::4");
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
    const result = validateEnvironment(environmentFor("172.30.79.0/24,not-a-range"));
    expect(result.errors).toContain("TRUSTED_PROXY_CIDRS must contain only valid explicit CIDR ranges.");
  });

  it.each([
    ["invalid IPv6 address", "2001:db8::gg/64"],
    ["scoped IPv6 address", "fe80::1%eth0/64"],
    ["IPv6 prefix below zero", "2001:db8::/-1"],
    ["IPv6 prefix above 128", "2001:db8::/129"]
  ])("rejects an %s in the environment contract", (_label, cidr) => {
    const result = validateEnvironment(environmentFor(cidr));
    expect(result.errors).toContain("TRUSTED_PROXY_CIDRS must contain only valid explicit CIDR ranges.");
  });
});
