import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse
} from "../src/common/network/safe-outbound-request.js";
import { downloadPdfData } from "../src/modules/pdf/pdf-ocr.service.js";

const publicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };

afterEach(() => {
  setSafeOutboundRequestDependenciesForTesting(undefined);
});

describe("PDF OCR source network trust", () => {
  it("downloads only a bounded PDF from an official public destination", async () => {
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop: async (_url, pinnedAddress): Promise<SafeOutboundHopResponse> => ({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: Buffer.from("%PDF-1.7\nfixture"),
        remoteAddress: pinnedAddress.address
      })
    });

    await expect(downloadPdfData("https://www.example.edu.tr/calendar.pdf"))
      .resolves.toEqual(Buffer.from("%PDF-1.7\nfixture"));
  });

  it("rejects a private DNS destination before opening a socket", async () => {
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
      requestHop
    });

    await expect(downloadPdfData("https://www.example.edu.tr/calendar.pdf"))
      .rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("rejects redirects away from the official university domain", async () => {
    const requestHop = vi.fn(async (_url: string, pinnedAddress: ResolvedOutboundAddress): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://evil.example/calendar.pdf" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [publicAddress],
      requestHop
    });

    await expect(downloadPdfData("https://www.example.edu.tr/calendar.pdf"))
      .rejects.toThrow("OCR_SOURCE_DOMAIN_UNTRUSTED");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });
});
