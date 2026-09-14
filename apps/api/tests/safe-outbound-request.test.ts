import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";
import { describe, expect, it, vi } from "vitest";
import {
  APPLE_JWKS_URL,
  assertPinnedRemoteAddress,
  GOOGLE_METADATA_TOKEN_URL,
  isForbiddenIpAddress,
  OPENAI_RESPONSES_URL,
  requirePublicHttpUrl,
  resolveSafeOutboundAddresses,
  safeOutboundRequest,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";

const firstPublicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
const secondPublicAddress: ResolvedOutboundAddress = { address: "142.250.74.14", family: 4 };
const publicIpv6Address: ResolvedOutboundAddress = { address: "2606:4700:4700::1111", family: 6 };

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

  it("contains an unreachable pinned IPv6 socket error and falls back to pinned IPv4", async () => {
    type AutoSelectRequestOptions = RequestOptions & { autoSelectFamily?: boolean };
    const attempts: Array<{ autoSelectFamily: boolean | undefined; family: RequestOptions["family"] }> = [];
    const lookupRanAfterRequestReturn: boolean[] = [];
    let escapedNetworkError: unknown;
    const requestSpy = vi.spyOn(https, "request");

    requestSpy.mockImplementation(((
      _url: URL,
      options: AutoSelectRequestOptions,
      onResponse: (response: IncomingMessage) => void
    ) => {
      attempts.push({
        autoSelectFamily: options.autoSelectFamily,
        family: options.family
      });
      const request = new EventEmitter() as EventEmitter & {
        destroy: (error?: Error) => ClientRequest;
        end: () => ClientRequest;
        setTimeout: () => ClientRequest;
      };
      request.setTimeout = () => request as unknown as ClientRequest;
      request.destroy = (error?: Error) => {
        if (error) process.nextTick(() => request.emit("error", error));
        process.nextTick(() => request.emit("close"));
        return request as unknown as ClientRequest;
      };
      request.end = () => request as unknown as ClientRequest;
      const lookup = options.lookup as unknown as (
        hostname: string,
        lookupOptions: { all: false },
        callback: (error: Error | null, address: string, family: number) => void
      ) => void;
      let requestReturned = false;
      lookup("example.edu.tr", { all: false }, (error, address, family) => {
        lookupRanAfterRequestReturn.push(requestReturned);
        if (error) {
          request.emit("error", error);
          return;
        }

        if (family === 6) {
          const socket = new EventEmitter();
          socket.once("error", (socketError) => request.emit("error", socketError));
          const unreachable = Object.assign(new Error(`connect ENETUNREACH ${address}:443`), {
            code: "ENETUNREACH"
          });
          try {
            socket.emit("error", unreachable);
          } catch (networkError) {
            escapedNetworkError = networkError;
            process.nextTick(() => request.emit("error", unreachable));
          }
          request.emit("close");
          return;
        }

        const response = new EventEmitter() as EventEmitter & {
          destroy: () => void;
          headers: IncomingMessage["headers"];
          socket: { remoteAddress: string };
          statusCode: number;
        };
        response.destroy = () => undefined;
        response.headers = { "content-type": "text/plain" };
        response.socket = { remoteAddress: address };
        response.statusCode = 200;
        onResponse(response as unknown as IncomingMessage);
        process.nextTick(() => {
          response.emit("data", Buffer.from("ipv4 fallback"));
          response.emit("end");
          request.emit("close");
        });
      });
      requestReturned = true;
      return request as unknown as ClientRequest;
    }) as never);

    try {
      await expect(safeOutboundRequest("https://example.edu.tr/announcements", {
        timeoutMs: 1_000
      }, {
        resolveHostname: async () => [publicIpv6Address, firstPublicAddress]
      })).resolves.toEqual(expect.objectContaining({
        body: Buffer.from("ipv4 fallback"),
        remoteAddress: firstPublicAddress.address,
        status: 200
      }));
      expect(attempts).toEqual([
        { autoSelectFamily: false, family: 6 },
        { autoSelectFamily: false, family: 4 }
      ]);
      expect(lookupRanAfterRequestReturn).toEqual([true, true]);
      expect(escapedNetworkError).toBeUndefined();
    } finally {
      requestSpy.mockRestore();
    }
  });

  it("returns a 304 conditional response without requiring a redirect location", async () => {
    const response = await safeOutboundRequest("https://example.edu.tr/announcements", {
      timeoutMs: 1_000,
      headers: { "If-None-Match": '"snapshot-v1"' }
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop: async (_url, pinnedAddress, input) => {
        expect(input.headers).toMatchObject({ "If-None-Match": '"snapshot-v1"' });
        return {
          status: 304,
          headers: { etag: '"snapshot-v1"' },
          body: Buffer.alloc(0),
          remoteAddress: pinnedAddress.address
        };
      }
    });

    expect(response).toEqual(expect.objectContaining({
      status: 304,
      finalUrl: "https://example.edu.tr/announcements"
    }));
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

  it("supports bounded methods, headers, and request bodies without bypassing the pinned transport", async () => {
    const requestHop = vi.fn(async (_url, pinnedAddress: ResolvedOutboundAddress, input): Promise<SafeOutboundHopResponse> => {
      expect(input.method).toBe("POST");
      expect(input.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(input.body?.toString("utf8")).toBe('{"query":"safe"}');
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        remoteAddress: pinnedAddress.address
      };
    });

    await expect(safeOutboundRequest("https://example.edu.tr/search", {
      timeoutMs: 1_000,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"query":"safe"}',
      maximumRequestBytes: 100,
      maximumResponseBytes: 100,
      maximumRedirects: 0
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    })).resolves.toEqual(expect.objectContaining({ status: 200 }));
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("allows the fixed Google metadata token endpoint only with its exact header and connected address", async () => {
    await expect(safeOutboundRequest(GOOGLE_METADATA_TOKEN_URL, {
      timeoutMs: 1_000,
      headers: { "Metadata-Flavor": "Google" },
      maximumRedirects: 0,
      maximumResponseBytes: 1024,
      providerPolicy: "google-metadata-token"
    }, {
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      requestHop: async (_url, pinnedAddress) => ({
        status: 200,
        headers: {},
        body: Buffer.from('{"access_token":"fixture"}'),
        remoteAddress: pinnedAddress.address
      })
    })).resolves.toEqual(expect.objectContaining({ status: 200 }));

    await expect(safeOutboundRequest("http://169.254.169.254/latest/meta-data", {
      timeoutMs: 1_000,
      headers: { "Metadata-Flavor": "Google" },
      maximumRedirects: 0,
      maximumResponseBytes: 1024,
      providerPolicy: "google-metadata-token"
    })).rejects.toThrow("OUTBOUND_METADATA_URL_FORBIDDEN");

    await expect(safeOutboundRequest(GOOGLE_METADATA_TOKEN_URL, {
      timeoutMs: 1_000,
      maximumRedirects: 0,
      maximumResponseBytes: 1024,
      providerPolicy: "google-metadata-token"
    })).rejects.toThrow("OUTBOUND_METADATA_HEADER_REQUIRED");
  });

  it("rejects provider policies used for arbitrary authorities", async () => {
    await expect(safeOutboundRequest("https://attacker.example/auth/keys", {
      timeoutMs: 1_000,
      maximumRedirects: 0,
      maximumResponseBytes: 1024,
      providerPolicy: "apple-jwks"
    })).rejects.toThrow("OUTBOUND_APPLE_AUTHORITY_FORBIDDEN");

    expect(APPLE_JWKS_URL).toBe("https://appleid.apple.com/auth/keys");

    await expect(safeOutboundRequest("https://attacker.example/tokeninfo?id_token=fixture", {
      timeoutMs: 1_000,
      maximumRedirects: 0,
      maximumResponseBytes: 1024,
      providerPolicy: "google-oauth-tokeninfo"
    })).rejects.toThrow("OUTBOUND_GOOGLE_AUTHORITY_FORBIDDEN");

    await expect(safeOutboundRequest("https://attacker.example/v1/projects/p/locations/eu/processors/x:process", {
      timeoutMs: 1_000,
      method: "POST",
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "application/json"
      },
      body: "{}",
      maximumRedirects: 0,
      maximumRequestBytes: 1024,
      maximumResponseBytes: 1024,
      providerPolicy: "google-document-ai"
    })).rejects.toThrow("OUTBOUND_GOOGLE_AUTHORITY_FORBIDDEN");
  });

  it("pins OpenAI Responses requests to the exact HTTPS endpoint and never follows redirects", async () => {
    const authorization = "Bearer test-openai-key";
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: { method: string; headers: Record<string, unknown>; body?: Buffer; providerPolicy: string }
    ): Promise<SafeOutboundHopResponse> => {
      expect(url).toBe(OPENAI_RESPONSES_URL);
      expect(input).toMatchObject({
        method: "POST",
        providerPolicy: "openai-responses",
        headers: { authorization, "content-type": "application/json" }
      });
      expect(input.body?.toString("utf8")).toBe('{"model":"gpt-5-mini"}');
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        remoteAddress: pinnedAddress.address
      };
    });

    await expect(safeOutboundRequest(OPENAI_RESPONSES_URL, {
      timeoutMs: 20_000,
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: '{"model":"gpt-5-mini"}',
      maximumRedirects: 0,
      maximumRequestBytes: 128 * 1024,
      maximumResponseBytes: 1024 * 1024,
      providerPolicy: "openai-responses"
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    })).resolves.toEqual(expect.objectContaining({ status: 200, finalUrl: OPENAI_RESPONSES_URL }));

    await expect(safeOutboundRequest("https://attacker.example/v1/responses", {
      timeoutMs: 20_000,
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: "{}",
      maximumRedirects: 0,
      maximumRequestBytes: 128 * 1024,
      maximumResponseBytes: 1024 * 1024,
      providerPolicy: "openai-responses"
    })).rejects.toThrow("OUTBOUND_OPENAI_AUTHORITY_FORBIDDEN");

    const redirectHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 307,
      headers: { location: "https://attacker.example/collect" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    await expect(safeOutboundRequest(OPENAI_RESPONSES_URL, {
      timeoutMs: 20_000,
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: "{}",
      maximumRedirects: 0,
      maximumRequestBytes: 128 * 1024,
      maximumResponseBytes: 1024 * 1024,
      providerPolicy: "openai-responses"
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop: redirectHop
    })).rejects.toThrow("OUTBOUND_OPENAI_AUTHORITY_FORBIDDEN");
    expect(redirectHop).toHaveBeenCalledOnce();
  });

  it("does not forward credential-bearing headers across authorities", async () => {
    const requestHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://cdn.example.edu.tr/result" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    await expect(safeOutboundRequest("https://example.edu.tr/start", {
      timeoutMs: 1_000,
      headers: { Authorization: "Bearer fixture" }
    }, {
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    })).rejects.toThrow("OUTBOUND_REDIRECT_SENSITIVE_HEADERS_FORBIDDEN");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });
});
