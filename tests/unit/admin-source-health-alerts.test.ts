import { describe, expect, it } from "vitest";
import { buildSourceHealthAlerts } from "../../apps/admin/src/source-health-alerts.js";

describe("admin source health alerts", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("prefers daily probe fields and groups the sorted result by university and source", () => {
    const alerts = buildSourceHealthAlerts([
      {
        id: "source-b",
        sourceName: "Etkinlikler",
        sourceUrl: "https://b.example.edu/events",
        contentType: "event",
        scopeType: "university",
        scopeId: "uni-b",
        status: "active",
        healthProbeStatus: "failed",
        healthProbeFailureCode: "unsafe_redirect",
        lastHealthProbeAt: "2026-09-14T11:00:00.000Z",
        healthStatus: "healthy",
        lastCheckedAt: "2026-09-14T11:30:00.000Z"
      },
      {
        id: "source-a-2",
        sourceName: "Haberler",
        contentType: "news",
        ownerUniversityId: "uni-a",
        status: "active",
        healthProbeStatus: "degraded",
        healthProbeFailureCode: "no_items",
        lastHealthProbeAt: "2026-09-14T10:00:00.000Z"
      },
      {
        id: "source-a-1",
        sourceName: "Duyurular",
        contentType: "announcement",
        ownerUniversityId: "uni-a",
        status: "active",
        healthProbeStatus: "healthy",
        lastHealthProbeAt: "2026-09-12T20:00:00.000Z"
      }
    ], { "uni-a": "Ankara Üniversitesi", "uni-b": "Bursa Üniversitesi" }, now);

    expect(alerts.map((alert) => [alert.universityName, alert.sourceName])).toEqual([
      ["Ankara Üniversitesi", "Duyurular"],
      ["Ankara Üniversitesi", "Haberler"],
      ["Bursa Üniversitesi", "Etkinlikler"]
    ]);
    expect(alerts[1]).toMatchObject({ severity: "degraded", problem: "Kaynakta duyuru, haber veya etkinlik bulunamadı." });
    expect(alerts[2]).toMatchObject({ severity: "failed", problem: "Kaynak güvenilmeyen bir adrese yönlendirdi." });
  });

  it("falls back to legacy health fields and ignores healthy, inactive and PDF sources", () => {
    const alerts = buildSourceHealthAlerts([
      {
        id: "legacy-failed",
        sourceName: "Eski Duyurular",
        contentType: "announcement",
        scopeType: "university",
        scopeId: "uni-a",
        status: "active",
        healthStatus: "failed",
        lastCheckedAt: "2026-09-14T11:00:00.000Z",
        lastError: "SOURCE_HTML_SELECTOR_LAYOUT_INVALID"
      },
      {
        id: "healthy",
        sourceName: "Sağlıklı",
        contentType: "news",
        scopeType: "university",
        scopeId: "uni-a",
        status: "active",
        healthStatus: "healthy",
        lastCheckedAt: "2026-09-14T11:00:00.000Z"
      },
      {
        id: "inactive",
        sourceName: "Pasif",
        contentType: "event",
        status: "inactive",
        healthStatus: "failed"
      },
      {
        id: "calendar",
        sourceName: "Takvim",
        contentType: "academic_calendar",
        status: "active",
        healthStatus: "failed"
      }
    ], { "uni-a": "Ankara Üniversitesi" }, now);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      universityName: "Ankara Üniversitesi",
      sourceId: "legacy-failed",
      problem: "Veri çekme yöntemi sayfayı ayrıştıramadı."
    });
  });

  it("reads nested probes, preserves them while merging list data and never renders raw errors", () => {
    const alerts = buildSourceHealthAlerts([
      {
        id: "nested",
        sourceName: "A Haberler",
        contentType: "news",
        ownerUniversityId: "uni-a",
        status: "active",
        healthProbe: {
          healthStatus: "failed",
          lastCheckedAt: "2026-09-14T11:00:00.000Z",
          lastError: "SOURCE_FETCH_FAILED:503"
        }
      },
      {
        id: "nested",
        sourceName: "A Haberler",
        contentType: "news",
        ownerUniversityId: "uni-a",
        status: "active",
        healthStatus: "healthy",
        lastCheckedAt: "2026-09-14T11:30:00.000Z"
      },
      {
        id: "raw-error",
        sourceName: "B Duyurular",
        contentType: "announcement",
        ownerUniversityId: "uni-a",
        status: "active",
        healthProbe: {
          healthStatus: "failed",
          lastCheckedAt: "2026-09-14T11:00:00.000Z",
          lastError: "request to https://internal.example failed with token=secret"
        }
      }
    ], { "uni-a": "Ankara Üniversitesi" }, now);

    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.problem).toBe("Kaynağa ulaşılamadı.");
    expect(alerts[1]?.problem).toBe("Kaynak kontrolü teknik bir hata ile sonuçlandı.");
    expect(alerts.map((alert) => alert.problem).join(" ")).not.toContain("internal.example");
    expect(alerts.map((alert) => alert.problem).join(" ")).not.toContain("secret");
  });

  it("marks an active source with no completed daily probe as stale", () => {
    expect(buildSourceHealthAlerts([{
      id: "not-checked",
      sourceName: "Duyurular",
      contentType: "announcement",
      ownerUniversityId: "uni-a",
      status: "active",
      healthProbeStatus: "pending"
    }], { "uni-a": "Ankara Üniversitesi" }, now)).toEqual([
      expect.objectContaining({
        severity: "stale",
        stale: true,
        problem: "Günlük sağlık kontrolü henüz tamamlanmadı."
      })
    ]);
  });

  it("explains security challenges without calling the event listing empty", () => {
    const alerts = buildSourceHealthAlerts([{
      id: "iuc-events",
      sourceName: "Etkinlikler",
      sourceUrl: "https://iuc.edu.tr/etkinlikler/",
      contentType: "event",
      ownerUniversityId: "istanbul-universitesi-cerrahpasa",
      status: "active",
      healthProbeStatus: "degraded",
      healthProbeFailureCode: "SOURCE_ACCESS_CHALLENGE",
      lastHealthProbeAt: "2026-09-14T11:00:00.000Z",
    }], {}, now);
    expect(alerts[0]?.problem).toBe("Kaynak güvenlik doğrulaması istiyor; içerik otomatik olarak okunamıyor.");
  });
});
