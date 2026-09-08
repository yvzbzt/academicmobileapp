import { resolveHomeImportantDestination } from "../../src/home/home-destination";
import type { HomeImportantItem } from "../../src/home/home-model";

const selectedItem: HomeImportantItem = {
  id: "event-1",
  title: "Kayıt duyurusu",
  category: "course_registration",
  date: "2026-09-08",
  temporalKind: "date",
  kind: "registration",
};

describe("Home important-item destination", () => {
  it("opens the exact in-app event detail when meaningful detail is available", () => {
    const destination = resolveHomeImportantDestination({
      item: selectedItem,
      events: [{
        id: "event-1",
        title: "Kayıt duyurusu",
        category: "course_registration",
        startDate: "2026-09-08",
        temporalKind: "date",
        description: "Kayıt adımları ve danışman onayı ayrıntıları.",
        sourceUrl: "https://example.edu.tr/akademik-takvim.pdf",
      }],
      manualExams: [],
      academicSourceLabel: "Örnek Üniversitesi Akademik Takvimi",
    });

    expect(destination).toMatchObject({
      kind: "calendar_detail",
      item: {
        routeId: "event-1",
        id: "event-1",
        startDate: "2026-09-08",
        description: "Kayıt adımları ve danışman onayı ayrıntıları.",
      },
    });
  });

  it("hands a title-only event to its exact official source and retains exact detail as a failure fallback", () => {
    const destination = resolveHomeImportantDestination({
      item: selectedItem,
      events: [{
        id: "event-1",
        title: "Kayıt duyurusu",
        category: "course_registration",
        startDate: "2026-09-08",
        temporalKind: "date",
        sourceUrl: "https://example.edu.tr/akademik-takvim.pdf",
      }],
      manualExams: [],
      academicSourceLabel: "Örnek Üniversitesi Akademik Takvimi",
    });

    expect(destination).toMatchObject({
      kind: "official_source",
      url: "https://example.edu.tr/akademik-takvim.pdf",
      fallbackItem: {
        routeId: "event-1",
        startDate: "2026-09-08",
      },
    });
  });

  it("does not open an unsafe source and keeps a valid exact event inside the app", () => {
    const destination = resolveHomeImportantDestination({
      item: selectedItem,
      events: [{
        id: "event-1",
        title: "Kayıt duyurusu",
        category: "course_registration",
        startDate: "2026-09-08",
        temporalKind: "date",
        sourceUrl: "javascript:alert(1)",
      }],
      manualExams: [],
      academicSourceLabel: "Örnek Üniversitesi Akademik Takvimi",
    });

    expect(destination).toMatchObject({
      kind: "calendar_detail",
      item: { routeId: "event-1", startDate: "2026-09-08" },
    });
  });
});
