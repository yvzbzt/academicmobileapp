import { describe, expect, it, vi } from "vitest";
import {
  assertPinnedRemoteAddress,
  isForbiddenIpAddress,
  requirePublicHttpUrl,
  resolveInvalidTlsPolicy,
  resolveSafeOutboundAddresses,
  safeOutboundRequest,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";

const firstPublicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
const secondPublicAddress: ResolvedOutboundAddress = { address: "142.250.74.14", family: 4 };

describe("safe outbound requests", () => {
  it("rejects unsafe URL forms and literal private destinations before transport", () => {
    for (const candidate of [
      "file:///etc/passwd",
      "https://user:password@example.edu.tr/announcements",
      "https://example.edu.tr:8443/announcements",
      "http://localhost/announcements",
      "http://127.0.0.1/announcements",
      "http://[::1]/announcements",
      "http://[fe80::1]/announcements"
    ]) {
      expect(() => requirePublicHttpUrl(candidate)).toThrow(/OUTBOUND_/u);
    }
    expect(requirePublicHttpUrl("https://example.edu.tr/announcements"))
      .toBe("https://example.edu.tr/announcements");
  });

  it("blocks private, local, carrier, documentation, benchmark, multicast, and mapped ranges", () => {
    for (const address of [
      "0.0.0.1",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.1.1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2002:c0a8:101::"
    ]) {
      expect(isForbiddenIpAddress(address), address).toBe(true);
    }
    expect(isForbiddenIpAddress(firstPublicAddress.address)).toBe(false);
    expect(isForbiddenIpAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects mixed public/private DNS answers instead of selecting a convenient address", async () => {
    await expect(resolveSafeOutboundAddresses("example.edu.tr", async () => [
      firstPublicAddress,
      { address: "10.0.0.7", family: 4 }
    ])).rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
  });

  it("resolves, validates, and pins every redirect hop to the address actually connected", async () => {
    const resolver = vi.fn(async (hostname: string) => (
      hostname === "example.edu.tr" ? [firstPublicAddress] : [secondPublicAddress]
    ));
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => (
      url.endsWith("/start")
        ? {
            status: 302,
            headers: { location: "https://cdn.example.edu.tr/document" },
            body: Buffer.alloc(0),
            remoteAddress: pinnedAddress.address
          }
        : {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: Buffer.from("trusted"),
            // IPv4-mapped socket reporting must compare equal to a pinned IPv4.
            remoteAddress: `::ffff:${pinnedAddress.address}`
          }
    ));

    const response = await safeOutboundRequest("https://example.edu.tr/start", {
      timeoutMs: 1_000
    }, { resolveHostname: resolver, requestHop });

    expect(response.finalUrl).toBe("https://cdn.example.edu.tr/document");
    expect(response.body.toString("utf8")).toBe("trusted");
    expect(resolver.mock.calls).toEqual([["example.edu.tr"], ["cdn.example.edu.tr"]]);
    expect(requestHop.mock.calls.map((call) => call[1])).toEqual([
      firstPublicAddress,
      secondPublicAddress
    ]);
  });

  it("rejects a connected address that differs from the DNS-pinned destination", async () => {
    await expect(safeOutboundRequest("https://example.edu.tr/start", {
      timeoutMs: 1_000
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop: async () => ({
        status: 200,
        headers: {},
        body: Buffer.from("untrusted"),
        remoteAddress: secondPublicAddress.address
      })
    })).rejects.toThrow("OUTBOUND_CONNECTED_ADDRESS_MISMATCH");
    expect(() => assertPinnedRemoteAddress(firstPublicAddress, "127.0.0.1"))
      .toThrow("OUTBOUND_CONNECTED_ADDRESS_FORBIDDEN");
  });

  it("validates redirect destinations before a second request", async () => {
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
      body: Buffer.alloc(0),
      remoteAddress: firstPublicAddress.address
    }));
    await expect(safeOutboundRequest("https://example.edu.tr/start", {
      timeoutMs: 1_000
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    })).rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("re-resolves redirect hostnames and rejects a private second-hop DNS answer", async () => {
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://cdn.example.edu.tr/document" },
      body: Buffer.alloc(0),
      remoteAddress: firstPublicAddress.address
    }));
    await expect(safeOutboundRequest("https://example.edu.tr/start", {
      timeoutMs: 1_000
    }, {
      resolveHostname: async (hostname) => hostname === "example.edu.tr"
        ? [firstPublicAddress]
        : [{ address: "10.0.0.9", family: 4 }],
      requestHop
    })).rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("permits invalid TLS only behind an explicit development-only gate", () => {
    expect(resolveInvalidTlsPolicy(false, "production")).toBe(false);
    expect(resolveInvalidTlsPolicy(true, "development")).toBe(true);
    expect(() => resolveInvalidTlsPolicy(true, "production"))
      .toThrow("OUTBOUND_INVALID_TLS_DEVELOPMENT_ONLY");
    expect(() => resolveInvalidTlsPolicy(true, "test"))
      .toThrow("OUTBOUND_INVALID_TLS_DEVELOPMENT_ONLY");
  });
});
