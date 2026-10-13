import { describe, expect, it, vi } from "vitest";
import { withSourcePreviewRetry } from "../src/modules/announcements/source-preview-retry.js";

const url = "https://selcuk.edu.tr/birim/tumicerikler/5346/2";
describe("bounded source preview retry", () => {
  it("retries a timeout once with a 10-second limit", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("OUTBOUND_REQUEST_TIMEOUT")).mockResolvedValueOnce("html");
    expect(await withSourcePreviewRetry(url, 7000, operation)).toBe("html");
    expect(operation.mock.calls).toEqual([[7000], [10000]]);
  });
  it("never repeats parser, empty, auth or security errors", async () => {
    for (const code of ["SOURCE_HTML_SELECTOR_LAYOUT_INVALID", "SOURCE_LISTING_EMPTY", "SOURCE_LISTING_STALE", "SOURCE_RUNTIME_REDIRECT_REJECTED", "401"]) {
      const operation = vi.fn().mockRejectedValue(new Error(code));
      await expect(withSourcePreviewRetry(url, 7000, operation)).rejects.toThrow(code);
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });
  it("does not retry foreign domains or already-long requests", async () => {
    for (const [target, limit] of [["https://untrusted.example/birim/tumicerikler/5346/2",7000], [url,20000], ["https://selcuk.edu.tr:8443/birim/tumicerikler/5346/2",7000]] as const) {
      const operation = vi.fn().mockRejectedValue(new Error("OUTBOUND_REQUEST_TIMEOUT"));
      await expect(withSourcePreviewRetry(target, limit, operation)).rejects.toThrow("OUTBOUND_REQUEST_TIMEOUT");
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });
  it("stops after the second timeout", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("OUTBOUND_REQUEST_TIMEOUT"));
    await expect(withSourcePreviewRetry(url, 7000, operation)).rejects.toThrow("OUTBOUND_REQUEST_TIMEOUT");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
