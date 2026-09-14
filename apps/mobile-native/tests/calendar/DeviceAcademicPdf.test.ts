jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  File: jest.fn(),
  Paths: { cache: "file:///cache" },
}));
jest.mock("expo-pdf-text-extract", () => ({
  extractText: jest.fn(),
  getPageCount: jest.fn(),
  isAvailable: jest.fn(() => false),
}));

import type { DeviceAcademicPdfSource, EventRecord } from "../../src/app/app-types";
import {
  DeviceAcademicPdfError,
  hydrateDeviceAcademicPdfEvents,
  loadVerifiedDeviceAcademicPdfText,
  validateDeviceAcademicPdfSource,
  type DeviceAcademicPdfDependencies,
} from "../../src/calendar/device-academic-pdf";

const now = Date.parse("2026-09-14T10:05:00.000Z");
const pdfBytes = asciiBytes("%PDF-1.7\nverified text-layer fixture\n%%EOF");
const hash = "b".repeat(64);

function capability(overrides: Partial<DeviceAcademicPdfSource> = {}): DeviceAcademicPdfSource {
  return {
    mode: "device_text",
    sourceUrl: "https://files.example.edu.tr/academic/schedule.pdf",
    allowedOfficialDomain: "example.edu.tr",
    expectedSha256: hash,
    expectedByteLength: pdfBytes.byteLength,
    authorizedAt: "2026-09-14T10:00:00.000Z",
    validUntil: "2026-09-14T10:15:00.000Z",
    document: {
      kind: "course_schedule",
      universityId: "uni",
      facultyId: "faculty",
      departmentId: "department",
      academicYear: "2026-2027",
      term: "fall",
      approvedRowNumbers: [1],
      approvedRows: [{ rowNumber: 1, normalizedTitle: "Data Structures", dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }],
      courseRangeStart: "2026-09-14",
      courseRangeEnd: "2026-09-20",
    },
    ...overrides,
  };
}

function dependencies(overrides: DeviceAcademicPdfDependencies = {}): DeviceAcademicPdfDependencies {
  return {
    now: () => now,
    fetchPdf: jest.fn(async () => response(pdfBytes)),
    sha256: jest.fn(async () => hash),
    extractTextLayer: jest.fn(async () => "Monday 09:00-10:00 Data Structures"),
    ...overrides,
  };
}

describe("verified device academic PDF pipeline", () => {
  it("accepts a short-lived backend capability and extracts only after URL, bytes, and hash verification", async () => {
    const source = capability();
    const deps = dependencies();

    await expect(loadVerifiedDeviceAcademicPdfText(source, deps)).resolves.toBe("Monday 09:00-10:00 Data Structures");
    expect(deps.fetchPdf).toHaveBeenCalledWith(source.sourceUrl, expect.objectContaining({
      credentials: "omit",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    }));
    expect(deps.sha256).toHaveBeenCalledWith(pdfBytes);
    expect(deps.extractTextLayer).toHaveBeenCalledWith(pdfBytes, source);
  });

  it("allows a redirect only inside the same verified official university domain", async () => {
    const sameUniversityFetch = jest.fn()
      .mockResolvedValueOnce(response(asciiBytes("redirect"), {
        status: 302,
        location: "https://www.example.edu.tr/files/schedule.pdf",
      }))
      .mockResolvedValueOnce(response(pdfBytes, { url: "https://www.example.edu.tr/files/schedule.pdf" }));
    const sameUniversity = dependencies({
      fetchPdf: sameUniversityFetch,
    });
    await expect(loadVerifiedDeviceAcademicPdfText(capability(), sameUniversity)).resolves.toContain("Data Structures");
    expect(sameUniversityFetch).toHaveBeenNthCalledWith(2, "https://www.example.edu.tr/files/schedule.pdf", expect.any(Object));

    const extractor = jest.fn(async () => "This must not run after a rejected redirect");
    const otherUniversityFetch = jest.fn(async () => response(asciiBytes("redirect"), {
      status: 302,
      location: "https://files.other.edu.tr/schedule.pdf",
    }));
    const otherUniversity = dependencies({
      fetchPdf: otherUniversityFetch,
      extractTextLayer: extractor,
    });
    await expect(loadVerifiedDeviceAcademicPdfText(capability(), otherUniversity)).rejects.toMatchObject({ code: "source_redirect" });
    expect(otherUniversityFetch).toHaveBeenCalledTimes(1);
    expect(extractor).not.toHaveBeenCalled();
  });

  it("rejects a LAN redirect before issuing any request to that target", async () => {
    const requestedUrls: string[] = [];
    const fetchPdf: NonNullable<DeviceAcademicPdfDependencies["fetchPdf"]> = jest.fn(async (url) => {
      requestedUrls.push(url);
      return response(asciiBytes("redirect"), { status: 302, location: "http://127.0.0.1/private.pdf" });
    });

    await expect(loadVerifiedDeviceAcademicPdfText(capability(), dependencies({ fetchPdf }))).rejects.toMatchObject({ code: "source_redirect" });
    expect(requestedUrls).toEqual([capability().sourceUrl]);
  });

  it("bounds same-domain redirect chains", async () => {
    let requestCount = 0;
    const fetchPdf: NonNullable<DeviceAcademicPdfDependencies["fetchPdf"]> = jest.fn(async () => {
      requestCount += 1;
      return response(asciiBytes("redirect"), {
        status: 302,
        location: `https://files.example.edu.tr/redirect-${requestCount}.pdf`,
      });
    });

    await expect(loadVerifiedDeviceAcademicPdfText(capability(), dependencies({ fetchPdf }))).rejects.toMatchObject({ code: "source_redirect" });
    expect(fetchPdf).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["wrong MIME", { fetchPdf: jest.fn(async () => response(pdfBytes, { contentType: "text/html" })) }, "source_mime"],
    ["wrong byte length", { fetchPdf: jest.fn(async () => response(pdfBytes.slice(0, -1))) }, "source_size"],
    ["wrong SHA-256", { sha256: jest.fn(async () => "c".repeat(64)) }, "source_hash"],
  ])("fails closed for %s", async (_label, override, code) => {
    await expect(loadVerifiedDeviceAcademicPdfText(capability(), dependencies(override))).rejects.toMatchObject({ code });
  });

  it("rejects expired, non-canonical, overlong, and unsorted capabilities before network access", () => {
    expect(validateDeviceAcademicPdfSource(capability({ validUntil: "2026-09-14T10:04:59.000Z" }), now)).toBeNull();
    expect(validateDeviceAcademicPdfSource(capability({ sourceUrl: "https://FILES.example.edu.tr/academic/schedule.pdf" }), now)).toBeNull();
    expect(validateDeviceAcademicPdfSource(capability({ expectedByteLength: 12 * 1024 * 1024 + 1 }), now)).toBeNull();
    expect(validateDeviceAcademicPdfSource(capability({
      document: {
        kind: "exam_schedule",
        universityId: "uni",
        facultyId: "faculty",
        departmentId: "department",
        academicYear: "2026-2027",
        term: "fall",
        approvedRowNumbers: [2, 1],
        approvedRows: [
          { rowNumber: 2, normalizedTitle: "Second", date: "2027-01-06", startTime: "10:00" },
          { rowNumber: 1, normalizedTitle: "First", date: "2027-01-05", startTime: "10:00" },
        ],
      },
    }), now)).toBeNull();
  });

  it("requires bounded backend-approved semantic descriptors for academic calendars", () => {
    const academicBase = {
      ...capability(),
      document: {
        kind: "academic_calendar" as const,
        universityId: "uni",
        academicYear: "2026-2027",
      },
    };
    expect(validateDeviceAcademicPdfSource(academicBase, now)).toBeNull();
    expect(validateDeviceAcademicPdfSource({
      ...academicBase,
      document: {
        ...academicBase.document,
        approvedEvents: [{
          normalizedTitle: "Course Registration",
          category: "course_registration",
          startDate: "2026-09-15",
          temporalKind: "date",
        }],
      },
    }, now)).not.toBeNull();
  });

  it("never downloads or extracts in server_ocr mode", async () => {
    const serverEvent: EventRecord = {
      id: "server-ocr-event",
      title: "Server OCR result",
      category: "course_schedule",
      startDate: "2026-09-14T09:00:00+03:00",
    };
    const deps = dependencies();

    await expect(hydrateDeviceAcademicPdfEvents({
      processingMode: "server_ocr",
      source: capability(),
      serverEvents: [serverEvent],
      context: { universityId: "uni", facultyId: "faculty", departmentId: "department", sourceLabel: "Course schedule" },
    }, deps)).resolves.toEqual([serverEvent]);
    expect(deps.fetchPdf).not.toHaveBeenCalled();
    expect(deps.extractTextLayer).not.toHaveBeenCalled();
  });

  it("preserves backend events when the PDF has no usable text layer", async () => {
    const serverEvent: EventRecord = {
      id: "published-event",
      title: "Published backend event",
      category: "course_schedule",
      startDate: "2026-09-14T09:00:00+03:00",
    };
    const deps = dependencies({ extractTextLayer: jest.fn(async () => " \n 12 ") });

    await expect(hydrateDeviceAcademicPdfEvents({
      processingMode: "device_text",
      source: capability(),
      serverEvents: [serverEvent],
      context: { universityId: "uni", facultyId: "faculty", departmentId: "department", sourceLabel: "Course schedule" },
    }, deps)).resolves.toEqual([serverEvent]);
  });

  it("preserves backend events when a native row does not match its approved semantic descriptor", async () => {
    const serverEvent: EventRecord = {
      id: "published-event",
      title: "Published backend event",
      category: "course_schedule",
      startDate: "2026-09-14T09:00:00+03:00",
    };
    const deps = dependencies({ extractTextLayer: jest.fn(async () => "Monday 09:00-10:00 Different Course") });

    await expect(hydrateDeviceAcademicPdfEvents({
      processingMode: "device_text",
      source: capability(),
      serverEvents: [serverEvent],
      context: { universityId: "uni", facultyId: "faculty", departmentId: "department", sourceLabel: "Course schedule" },
    }, deps)).resolves.toEqual([serverEvent]);
  });

  it("aborts a stalled download at the bounded timeout", async () => {
    jest.useFakeTimers();
    const fetchPdf: NonNullable<DeviceAcademicPdfDependencies["fetchPdf"]> = jest.fn((_url, init) => (
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
    ));
    const promise = loadVerifiedDeviceAcademicPdfText(capability(), dependencies({ fetchPdf, networkTimeoutMs: 100 }));
    const assertion = expect(promise).rejects.toEqual(new DeviceAcademicPdfError("timeout"));
    await jest.advanceTimersByTimeAsync(101);
    await assertion;
    jest.useRealTimers();
  });
});

function response(
  bytes: Uint8Array,
  overrides: { url?: string; contentType?: string; contentLength?: string; status?: number; location?: string } = {},
): Awaited<ReturnType<NonNullable<DeviceAcademicPdfDependencies["fetchPdf"]>>> {
  const status = overrides.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: overrides.url ?? "https://files.example.edu.tr/academic/schedule.pdf",
    headers: new Headers({
      "content-type": overrides.contentType ?? "application/pdf",
      "content-length": overrides.contentLength ?? String(bytes.byteLength),
      ...(overrides.location ? { location: overrides.location } : {}),
    }),
    body: stream(bytes),
  };
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const split = Math.min(8, bytes.byteLength);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}
