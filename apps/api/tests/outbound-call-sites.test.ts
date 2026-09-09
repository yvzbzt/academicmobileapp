import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  fetchJsonWithTimeout,
  loadTurkiyeCatalogFromYokAtlas
} from "../src/bootstrap/yok-atlas-catalog-importer.js";
import {
  setSafeOutboundRequestDependenciesForTesting,
  type ResolvedOutboundAddress,
  type SafeOutboundHopResponse,
  type SafeOutboundRequestDependencies
} from "../src/common/network/safe-outbound-request.js";
import { verifyGoogleOAuthIdToken } from "../src/modules/auth/firebase-google-identity.verifier.js";
import { fetchText } from "../src/modules/announcements/announcement-parser.js";
import { exchangeGoogleServiceAccountAccessToken, PdfOcrService, readGoogleAccessToken } from "../src/modules/pdf/pdf-ocr.service.js";
import type { PdfSourceRecord } from "../src/modules/pdf/pdf.types.js";
import { fetchConfiguredSearchResults } from "../src/modules/source-discovery/academic-source-discovery.service.js";

type RequestHopInput = Parameters<NonNullable<SafeOutboundRequestDependencies["requestHop"]>>[2];

const firstPublicAddress: ResolvedOutboundAddress = { address: "93.184.216.34", family: 4 };
const secondPublicAddress: ResolvedOutboundAddress = { address: "142.250.74.14", family: 4 };

afterEach(() => {
  vi.unstubAllEnvs();
  setSafeOutboundRequestDependenciesForTesting(undefined);
  vi.restoreAllMocks();
});

describe("YOK Atlas outbound call site", () => {
  it("uses the pinned boundary with its exact POST body, headers, timeout, and response limit", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: RequestHopInput
    ): Promise<SafeOutboundHopResponse> => {
      expect(url).toBe("https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search");
      expect(input).toEqual(expect.objectContaining({
        method: "POST",
        maximumResponseBytes: 32 * 1024 * 1024,
        providerPolicy: "yok-atlas"
      }));
      expect(input.headers).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://yokatlas.yok.gov.tr"
      });
      expect(JSON.parse(input.body?.toString("utf8") ?? "null")).toEqual(expect.objectContaining({
        universiteId: [],
        ilKodu: []
      }));
      return jsonResponse([], pinnedAddress.address);
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(loadTurkiyeCatalogFromYokAtlas(1_000)).resolves.toEqual(expect.objectContaining({
      source: "yok_atlas",
      sourceRowCount: 0,
      includedRowCount: 0
    }));
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects a private DNS result before the YOK transport opens", async () => {
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "10.8.0.4", family: 4 }],
      requestHop
    });

    await expect(loadTurkiyeCatalogFromYokAtlas(1_000))
      .rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("cannot reuse the YOK provider policy for an arbitrary destination", async () => {
    await expect(fetchJsonWithTimeout("https://attacker.example/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }, 1_000)).rejects.toThrow("OUTBOUND_YOK_ATLAS_AUTHORITY_FORBIDDEN");
  });
});

describe("configured web-search outbound call site", () => {
  it.each([
    ["non-HTTP scheme", "file:///etc/passwd"],
    ["embedded credentials", "https://user:password@search.example/api/search"],
    ["literal loopback", "http://127.0.0.1/api/search"],
    ["literal link-local", "http://169.254.169.254/api/search"]
  ])("rejects a configured endpoint with %s", async (_label, endpoint) => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", endpoint);
    const resolveHostname = vi.fn(async () => [firstPublicAddress]);
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname, requestHop });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(requestHop).not.toHaveBeenCalled();
  });

  it.each([
    ["private DNS", "10.20.30.40"],
    ["loopback DNS", "127.0.0.1"],
    ["link-local DNS", "169.254.169.254"]
  ])("rejects a %s result before opening a socket", async (_label, address) => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address, family: 4 }],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("rejects an unsafe configured port before DNS or transport", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example:8443/api/search");
    const resolveHostname = vi.fn(async () => [firstPublicAddress]);
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname, requestHop });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("rejects a safe host redirecting to a private destination", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("re-resolves a same-authority search redirect and rejects a private second-hop DNS result", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const resolveHostname = vi.fn(async () => resolveHostname.mock.calls.length === 1
      ? [firstPublicAddress]
      : [{ address: "10.20.30.40", family: 4 as const }]);
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "/api/result" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({ resolveHostname, requestHop });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(resolveHostname).toHaveBeenCalledTimes(2);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to a different public search authority", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "https://other-search.example/api/result" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects DNS rebinding to a private address at connection time", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: {},
      body: Buffer.from("[]"),
      remoteAddress: "10.20.30.40"
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects a connected public address that does not match the validated address", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: {},
      body: Buffer.from("[]"),
      remoteAddress: secondPublicAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized search response at the call-site limit", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 200,
      headers: {},
      body: Buffer.alloc(1024 * 1024 + 1),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("bounds a search request whose transport never settles", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    vi.stubEnv("WEB_SOURCE_SEARCH_TIMEOUT_MS", "20");
    const requestHop = vi.fn(() => new Promise<SafeOutboundHopResponse>(() => undefined));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it.each(["development", "production"])("does not retry or bypass invalid TLS in %s", async (environment) => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async () => {
      throw new Error("CERT_HAS_EXPIRED");
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });
    vi.stubEnv("NODE_ENV", environment);

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([]);
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("allows only same-authority redirects and bounded JSON results", async () => {
    vi.stubEnv("WEB_SOURCE_SEARCH_ENDPOINT", "https://search.example/api/search");
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => url.includes("/api/search")
      ? {
          status: 302,
          headers: { location: "/api/result" },
          body: Buffer.alloc(0),
          remoteAddress: pinnedAddress.address
        }
      : jsonResponse([{ url: "https://university.edu.tr/calendar", title: "Academic calendar" }], pinnedAddress.address));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(fetchConfiguredSearchResults("academic calendar")).resolves.toEqual([{
      url: "https://university.edu.tr/calendar",
      title: "Academic calendar"
    }]);
    expect(requestHop).toHaveBeenCalledTimes(2);
  });
});

describe("Google provider and metadata outbound call sites", () => {
  it("sends Document AI OCR only to its trusted regional authority through the safe boundary", async () => {
    configureDocumentAi();
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: RequestHopInput
    ): Promise<SafeOutboundHopResponse> => {
      expect(url).toBe("https://eu-documentai.googleapis.com/v1/projects/project-fixture/locations/eu/processors/processor-fixture:process");
      expect(input.method).toBe("POST");
      expect(input.providerPolicy).toBe("google-document-ai");
      expect(input.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer access-token-fixture",
        "Content-Type": "application/json"
      }));
      expect(JSON.parse(input.body?.toString("utf8") ?? "null")).toEqual({
        rawDocument: { content: Buffer.from("%PDF-fixture").toString("base64"), mimeType: "application/pdf" }
      });
      return jsonResponse({ document: { text: "OCR text", pages: [] } }, pinnedAddress.address);
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(new PdfOcrService().extractText({
      pdfSource: pdfSourceFixture(),
      pdfData: Buffer.from("%PDF-fixture")
    })).resolves.toEqual({ provider: "google_document_ai", text: "OCR text" });
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("rejects a forbidden Document AI DNS destination before sending credentials or body", async () => {
    configureDocumentAi();
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
      requestHop
    });

    await expect(new PdfOcrService().extractText({
      pdfSource: pdfSourceFixture(),
      pdfData: Buffer.from("%PDF-fixture")
    })).rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).not.toHaveBeenCalled();
  });

  it("reads a metadata token only from the fixed link-local endpoint with the required header", async () => {
    vi.stubEnv("GOOGLE_OAUTH_ACCESS_TOKEN", undefined);
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: RequestHopInput
    ): Promise<SafeOutboundHopResponse> => {
      expect(url).toBe("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token");
      expect(input).toEqual(expect.objectContaining({
        method: "GET",
        maximumResponseBytes: 32 * 1024,
        providerPolicy: "google-metadata-token"
      }));
      expect(input.headers).toMatchObject({ "Metadata-Flavor": "Google" });
      return jsonResponse({ access_token: "metadata-token-fixture" }, pinnedAddress.address);
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      requestHop
    });

    await expect(readGoogleAccessToken()).resolves.toBe("metadata-token-fixture");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("does not follow a metadata redirect", async () => {
    vi.stubEnv("GOOGLE_OAUTH_ACCESS_TOKEN", undefined);
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
    const requestHop = vi.fn(async (
      _url: string,
      pinnedAddress: ResolvedOutboundAddress
    ): Promise<SafeOutboundHopResponse> => ({
      status: 302,
      headers: { location: "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" },
      body: Buffer.alloc(0),
      remoteAddress: pinnedAddress.address
    }));
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      requestHop
    });

    await expect(readGoogleAccessToken()).resolves.toBeUndefined();
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("exchanges a service-account assertion only at the fixed Google OAuth token endpoint", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: RequestHopInput
    ): Promise<SafeOutboundHopResponse> => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(input).toEqual(expect.objectContaining({
        method: "POST",
        maximumResponseBytes: 32 * 1024,
        providerPolicy: "google-oauth-token"
      }));
      expect(input.headers).toEqual(expect.objectContaining({
        "Content-Type": "application/x-www-form-urlencoded"
      }));
      const parameters = new URLSearchParams(input.body?.toString("utf8"));
      expect(parameters.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const assertion = parameters.get("assertion")?.split(".") ?? [];
      expect(assertion).toHaveLength(3);
      expect(JSON.parse(Buffer.from(assertion[1]!, "base64url").toString("utf8"))).toEqual(expect.objectContaining({
        iss: "document-ai@example-project.iam.gserviceaccount.com",
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token"
      }));
      return jsonResponse({ access_token: "service-account-token", expires_in: 3600 }, pinnedAddress.address);
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(exchangeGoogleServiceAccountAccessToken({
      type: "service_account",
      client_email: "document-ai@example-project.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    }, new Date("2026-09-09T12:00:00.000Z"))).resolves.toEqual({
      token: "service-account-token",
      expiresInSeconds: 3600
    });
    expect(requestHop).toHaveBeenCalledTimes(1);
  });

  it("verifies Google OAuth tokeninfo through its fixed public authority", async () => {
    const requestHop = vi.fn(async (
      url: string,
      pinnedAddress: ResolvedOutboundAddress,
      input: RequestHopInput
    ): Promise<SafeOutboundHopResponse> => {
      expect(new URL(url).origin).toBe("https://oauth2.googleapis.com");
      expect(new URL(url).searchParams.get("id_token")).toBe("id-token-fixture");
      expect(input.providerPolicy).toBe("google-oauth-tokeninfo");
      return jsonResponse({
        aud: "allowed-client",
        sub: "subject-fixture",
        email: "student@example.test",
        email_verified: true
      }, pinnedAddress.address);
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });

    await expect(verifyGoogleOAuthIdToken("id-token-fixture", ["allowed-client"]))
      .resolves.toEqual(expect.objectContaining({
        uid: "google:subject-fixture",
        emailVerified: true,
        signInProvider: "google.com"
      }));
  });

  it("rejects a private OAuth tokeninfo DNS answer before sending the ID token", async () => {
    const requestHop = vi.fn();
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [{ address: "10.0.0.8", family: 4 }],
      requestHop
    });

    await expect(verifyGoogleOAuthIdToken("id-token-fixture", ["allowed-client"]))
      .rejects.toThrow("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(requestHop).not.toHaveBeenCalled();
  });
});

describe("announcement strict-TLS call site", () => {
  it.each(["development", "production"])("rejects invalid TLS without retry in %s", async (environment) => {
    const requestHop = vi.fn(async () => {
      throw new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    });
    setSafeOutboundRequestDependenciesForTesting({
      resolveHostname: async () => [firstPublicAddress],
      requestHop
    });
    vi.stubEnv("NODE_ENV", environment);

    await expect(fetchText("https://example.edu.tr/announcements", 1_000))
      .rejects.toThrow("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(requestHop).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(value: unknown, remoteAddress: string): SafeOutboundHopResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(value)),
    remoteAddress
  };
}

function configureDocumentAi(): void {
  vi.stubEnv("OCR_PROVIDER", "google_document_ai");
  vi.stubEnv("DOCUMENT_AI_PROCESSOR_NAME", "projects/project-fixture/locations/eu/processors/processor-fixture");
  vi.stubEnv("GOOGLE_OAUTH_ACCESS_TOKEN", "access-token-fixture");
}

function pdfSourceFixture(): PdfSourceRecord {
  const now = new Date("2026-08-04T00:00:00.000Z");
  return {
    id: "pdf-source-fixture",
    universityId: "university-fixture",
    fileName: "calendar.pdf",
    filePath: "fixture/calendar.pdf",
    fileHash: "hash-fixture",
    fileSize: 12,
    mimeType: "application/pdf",
    magicBytesHex: "25504446",
    pageCount: 1,
    academicYear: "2026-2027",
    version: 1,
    status: "uploaded",
    parseStatus: "pending",
    uploadedBy: "system",
    createdAt: now,
    updatedAt: now
  };
}
