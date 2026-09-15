import { afterEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import { safeOutboundRequest, type SafeOutboundRequestDependencies } from "../src/common/network/safe-outbound-request.js";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn<(...args: unknown[]) => Promise<LookupAddress[]>>() }));
vi.mock("node:dns/promises", () => ({ lookup }));

const publicV4 = { address: "93.184.216.34", family: 4 };
const publicV6 = { address: "2606:4700:4700::1111", family: 6 };
const requestUrl = "https://example.edu.tr/announcements";
const dnsError = (code: string) => Object.assign(new Error(code), { code });
const successfulHop = () => vi.fn<NonNullable<SafeOutboundRequestDependencies["requestHop"]>>(async (_url, pinned) => ({
  status: 200, headers: {}, body: Buffer.from("ok"), remoteAddress: pinned.address
}));

afterEach(() => {
  lookup.mockReset();
  vi.useRealTimers();
});

describe("bounded system DNS transient retry", () => {
  it("recovers from one EAI_AGAIN with all IPv4 and IPv6 addresses still visible", async () => {
    lookup.mockRejectedValueOnce(dnsError("EAI_AGAIN")).mockResolvedValueOnce([publicV6, publicV4]);
    const requestHop = successfulHop();

    const result = await safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop });

    expect(result.body.toString()).toBe("ok");
    expect(lookup.mock.calls).toEqual([
      ["example.edu.tr", { all: true, verbatim: true }],
      ["example.edu.tr", { all: true, verbatim: true }]
    ]);
    expect(requestHop.mock.calls[0]?.[1]).toEqual(publicV6);
  });

  it("stops after the second transient DNS failure", async () => {
    lookup.mockRejectedValue(dnsError("EAI_AGAIN"));
    const requestHop = successfulHop();

    await expect(safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop }))
      .rejects.toThrow("OUTBOUND_DNS_LOOKUP_FAILED");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(requestHop).not.toHaveBeenCalled();
  });

  it.each(["ENOTFOUND", "ENODATA", "ETIMEOUT", "EACCES"])("does not retry %s", async (code) => {
    lookup.mockRejectedValue(dnsError(code));
    const requestHop = successfulHop();

    await expect(safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop }))
      .rejects.toThrow("OUTBOUND_DNS_LOOKUP_FAILED");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("does not reset the seven-second request deadline when DNS is retried", async () => {
    vi.useFakeTimers();
    lookup.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(dnsError("EAI_AGAIN")), 6000);
    })).mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve([publicV4]), 1500);
    }));
    const requestHop = successfulHop();
    const request = safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop });
    const failed = expect(request).rejects.toThrow("OUTBOUND_REQUEST_TIMEOUT");

    await vi.advanceTimersByTimeAsync(6000);
    expect(lookup).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    await vi.advanceTimersByTimeAsync(500);
    expect(requestHop).not.toHaveBeenCalled();
  });

  it.each([
    [{ address: "10.0.0.7", family: 4 }],
    [publicV4, { address: "fd00::7", family: 6 }],
    [publicV6, { address: "10.0.0.7", family: 4 }]
  ])("still rejects private or mixed DNS answers after recovery: %j", async (...addresses) => {
    lookup.mockRejectedValueOnce(dnsError("EAI_AGAIN")).mockResolvedValueOnce(addresses);
    const requestHop = successfulHop();

    await expect(safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop }))
      .rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("does not redo DNS or transport when a pinned connection fails TLS validation", async () => {
    lookup.mockResolvedValueOnce([publicV4]);
    const requestHop = successfulHop().mockRejectedValueOnce(dnsError("CERT_HAS_EXPIRED"));

    await expect(safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop }))
      .rejects.toThrow("CERT_HAS_EXPIRED");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("still rejects a connection to an address different from the DNS-pinned address", async () => {
    lookup.mockRejectedValueOnce(dnsError("EAI_AGAIN")).mockResolvedValueOnce([publicV4]);
    const requestHop = successfulHop().mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from("wrong"), remoteAddress: "142.250.74.14" });

    await expect(safeOutboundRequest(requestUrl, { timeoutMs: 7000 }, { requestHop }))
      .rejects.toThrow("OUTBOUND_CONNECTED_ADDRESS_MISMATCH");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });
});
