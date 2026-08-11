import { describe, expect, it } from "vitest";
import {
  mapAcademicEventsToNativeCalendarEvents,
  mapManualExamsToNativeCalendarEvents
} from "../../apps/mobile-native/src/native-calendar/event-mapper.js";

describe("native academic calendar event mapping", () => {
  it("keeps date-only ranges all-day and converts the inclusive end to an exclusive end", () => {
    expect(mapAcademicEventsToNativeCalendarEvents([{
      id: "registration",
      title: "Ders kayıtları",
      category: "course_registration",
      temporalKind: "date",
      endTemporalKind: "date",
      startDate: "2026-09-01",
      endDate: "2026-09-03"
    }])).toEqual([expect.objectContaining({
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-04T00:00:00.000Z",
      allDay: true,
      timezone: "Europe/Istanbul"
    })]);
  });

  it("preserves real timestamp instants and real range ends", () => {
    expect(mapAcademicEventsToNativeCalendarEvents([{
      id: "exam",
      title: "Ara sınav",
      temporalKind: "timestamp",
      endTemporalKind: "timestamp",
      startDate: "2026-11-10T09:30:00+03:00",
      endDate: "2026-11-10T11:00:00+03:00"
    }])).toEqual([expect.objectContaining({
      startDate: "2026-11-10T06:30:00.000Z",
      endDate: "2026-11-10T08:00:00.000Z",
      allDay: false,
      timezone: "Europe/Istanbul"
    })]);
  });

  it("maps a date-only inclusive end on a timed event to Istanbul's next midnight", () => {
    expect(mapAcademicEventsToNativeCalendarEvents([{
      id: "mixed-range",
      title: "Başvuru",
      temporalKind: "timestamp",
      endTemporalKind: "date",
      startDate: "2026-09-01T09:30:00+03:00",
      endDate: "2026-09-03"
    }])[0]).toEqual(expect.objectContaining({
      startDate: "2026-09-01T06:30:00.000Z",
      endDate: "2026-09-03T21:00:00.000Z",
      allDay: false
    }));
  });

  it("preserves a real timed end when the range starts on a date-only day", () => {
    expect(mapAcademicEventsToNativeCalendarEvents([{
      id: "inverse-mixed-range",
      title: "BaÅŸvuru sonucu",
      temporalKind: "date",
      endTemporalKind: "timestamp",
      startDate: "2026-09-01",
      endDate: "2026-09-03T17:00:00+03:00"
    }])[0]).toEqual(expect.objectContaining({
      startDate: "2026-08-31T21:00:00.000Z",
      endDate: "2026-09-03T14:00:00.000Z",
      allDay: false,
      timezone: "Europe/Istanbul"
    }));
  });

  it("keeps academic locations and personal exam room notes", () => {
    expect(mapAcademicEventsToNativeCalendarEvents([{
      id: "located-event",
      title: "Veri Yapıları Final Sınavı",
      category: "final_exam",
      temporalKind: "timestamp",
      startDate: "2026-11-10T09:30:00+03:00",
      location: "Mühendislik Fakültesi, A Blok 201"
    }])[0]).toEqual(expect.objectContaining({
      location: "Mühendislik Fakültesi, A Blok 201"
    }));

    expect(mapManualExamsToNativeCalendarEvents([{
      id: "personal-exam",
      title: "Matematik II Finali",
      examDate: "2026-11-10T09:30:00+03:00",
      locationNote: "D-101"
    }])[0]).toEqual(expect.objectContaining({
      location: "D-101"
    }));
  });
});
