import { describe, expect, it } from "vitest";
import {
  applyDateSelection,
  applyTimeSelection,
  buildCalendarItems,
  buildMonthSummary,
  buildWeekSummary,
  calendarItemStartDateOnly,
  calendarPeriod,
  composePersonalExamTimestamp,
  moveCalendarAnchor,
  personalExamDraftFromRecord,
  resolveCalendarPresentationState,
  selectUniversityAcademicCalendarEvents,
  selectCalendarItemsForView,
  validatePersonalExamDraft,
} from "../../apps/mobile-native/src/calendar/calendar-model";
import {
  createManualExamStorageKey,
  readManualExamEnvelope,
  serializeManualExamEnvelope,
  type ManualExamRecord,
} from "../../apps/mobile-native/src/session-integrity/manual-exam-storage";

const academicEvents = [
  {
    id: "registration-range",
    title: "Ders kayıt dönemi",
    category: "course_registration",
    startDate: "2026-08-03",
    endDate: "2026-08-07",
    temporalKind: "date" as const,
    endTemporalKind: "date" as const,
  },
  {
    id: "final-exam",
    title: "Final sınavları",
    category: "final_exam",
    startDate: "2026-08-10",
    temporalKind: "date" as const,
  },
  {
    id: "timestamped-orientation",
    title: "Çevrim içi oryantasyon",
    category: "orientation",
    startDate: "2026-08-12T18:30:00.000Z",
    temporalKind: "timestamp" as const,
  },
];

const personalExams: ManualExamRecord[] = [{
  id: "personal-1",
  title: "Lineer Cebir",
  examDate: "2026-08-11T06:00:00.000Z",
}];

describe("Phase 9 calendar and personal-exam model", () => {
  it("classifies academic and personal records with text and icon identity", () => {
    const items = buildCalendarItems({
      academicEvents,
      personalExams,
      academicSourceLabel: "Örnek Üniversitesi Akademik Takvimi",
    });
    expect(items.map((item) => ({ id: item.id, label: item.classificationLabel, icon: item.icon }))).toEqual([
      { id: "registration-range", label: "Son Başvuru", icon: "flag-outline" },
      { id: "final-exam", label: "Sınav", icon: "document-text-outline" },
      { id: "personal-1", label: "Sınav", icon: "school-outline" },
      { id: "timestamped-orientation", label: "Etkinlik", icon: "calendar-outline" },
    ]);
    expect(items.find((item) => item.id === "personal-1")?.timezone).toBe("Europe/Istanbul");
    expect(items[0]).toMatchObject({
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      temporalKind: "date",
      endTemporalKind: "date",
    });
  });

  it("keeps the university Calendar surface free of faculty and department schedules", () => {
    expect(selectUniversityAcademicCalendarEvents([
      ...academicEvents,
      {
        id: "faculty-exam",
        title: "Fakülte sınav programı",
        category: "department_exam_schedule",
        startDate: "2026-08-13",
        facultyId: "faculty-1",
      },
      {
        id: "department-course",
        title: "Bölüm ders programı",
        category: "course_schedule",
        startDate: "2026-08-14",
        departmentId: "department-1",
      },
    ]).map((event) => event.id)).toEqual([
      "registration-range",
      "final-exam",
      "timestamped-orientation",
    ]);
  });

  it("keeps date-only ranges inclusive without manufacturing a timestamp", () => {
    const items = buildCalendarItems({ academicEvents, personalExams: [], academicSourceLabel: "Resmî kaynak" });
    const week = selectCalendarItemsForView({
      items,
      view: "week",
      anchorDate: "2026-08-09",
    });
    expect(calendarPeriod("week", "2026-08-09")).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
      label: "3 Ağu 2026 – 9 Ağu 2026",
    });
    expect(week.map((item) => item.id)).toEqual(["registration-range"]);
    expect(items[0].startDate).toBe("2026-08-03");
    expect(items[0].startDate).not.toContain("T");
  });

  it("uses Agenda as an upcoming/current projection and excludes past ranges", () => {
    const items = buildCalendarItems({ academicEvents, personalExams, academicSourceLabel: "Resmî kaynak" });
    const agenda = selectCalendarItemsForView({
      items,
      view: "agenda",
      anchorDate: "2026-08-05",
      now: new Date("2026-08-05T09:00:00.000+03:00"),
    });
    expect(agenda.map((item) => item.id)).toEqual([
      "registration-range",
      "final-exam",
      "personal-1",
      "timestamped-orientation",
    ]);
    const later = selectCalendarItemsForView({
      items,
      view: "agenda",
      anchorDate: "2026-08-08",
      now: new Date("2026-08-08T09:00:00.000+03:00"),
    });
    expect(later.map((item) => item.id)).not.toContain("registration-range");
  });

  it("builds Monday-first Week and six-row Month summaries with range counts", () => {
    const items = buildCalendarItems({ academicEvents, personalExams, academicSourceLabel: "Resmî kaynak" });
    const week = buildWeekSummary(items, "2026-08-05");
    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ date: "2026-08-03", itemCount: 1 });
    expect(week[4]).toMatchObject({ date: "2026-08-07", itemCount: 1 });
    expect(week[5]).toMatchObject({ date: "2026-08-08", itemCount: 0 });

    const month = buildMonthSummary(items, "2026-08-15");
    expect(month).toHaveLength(42);
    expect(month.find((day) => day.date === "2026-08-11")).toMatchObject({
      itemCount: 1,
      classifications: ["personal_exam"],
      inPeriod: true,
    });
  });

  it("moves Week and Month anchors deterministically across year boundaries", () => {
    expect(moveCalendarAnchor("week", "2026-12-29", 1)).toBe("2027-01-05");
    expect(moveCalendarAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(moveCalendarAnchor("month", "2026-12-15", 1)).toBe("2027-01-15");
  });

  it("renders leap-year February as one 42-cell month with adjacent-month boundaries", () => {
    const month = buildMonthSummary([], "2024-02-29");
    expect(month).toHaveLength(42);
    expect(month[0]).toMatchObject({ date: "2024-01-29", inPeriod: false });
    expect(month[41]).toMatchObject({ date: "2024-03-10", inPeriod: false });
    expect(month.filter((day) => day.date === "2024-02-29")).toEqual([{
      date: "2024-02-29",
      dayNumber: 29,
      inPeriod: true,
      itemCount: 0,
      classifications: [],
    }]);
    expect(month.filter((day) => day.date.startsWith("2024-01-")).every((day) => !day.inPeriod)).toBe(true);
    expect(month.filter((day) => day.date.startsWith("2024-03-")).every((day) => !day.inPeriod)).toBe(true);
  });

  it("builds a complete seven-day week across February 29", () => {
    expect(calendarPeriod("week", "2024-02-29")).toMatchObject({
      start: "2024-02-26",
      end: "2024-03-03",
    });
    expect(buildWeekSummary([], "2024-02-29").map((day) => day.date)).toEqual([
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
      "2024-03-03",
    ]);
  });

  it("navigates January to leap February to March and back without skipping a month", () => {
    const february = moveCalendarAnchor("month", "2024-01-15", 1);
    const march = moveCalendarAnchor("month", february, 1);
    expect([february, march]).toEqual(["2024-02-15", "2024-03-15"]);
    expect(moveCalendarAnchor("month", march, -1)).toBe("2024-02-15");
    expect(moveCalendarAnchor("month", february, -1)).toBe("2024-01-15");
    expect(moveCalendarAnchor("month", "2024-01-31", 1)).toBe("2024-02-29");
  });

  it("keeps a system-selected February 29 valid through timestamp composition", () => {
    const draft = applyDateSelection(
      { title: "Artık yıl sınavı", date: null, time: "14:20" },
      new Date(2024, 1, 29, 12, 0),
    );
    expect(draft.date).toBe("2024-02-29");
    expect(validatePersonalExamDraft(draft)).toEqual({});
    const timestamp = composePersonalExamTimestamp(draft);
    expect(timestamp).toBe("2024-02-29T11:20:00.000Z");
  });

  it("keeps date-only February 29 stable and an inclusive Feb 28–Mar 1 range on every day", () => {
    const [rangeItem, leapDayItem] = buildCalendarItems({
      academicEvents: [
        {
          id: "leap-day",
          title: "Artık yıl günü",
          category: "academic",
          startDate: "2024-02-29",
          temporalKind: "date",
        },
        {
          id: "leap-range",
          title: "Artık yıl aralığı",
          category: "course_registration",
          startDate: "2024-02-28",
          endDate: "2024-03-01",
          temporalKind: "date",
          endTemporalKind: "date",
        },
      ],
      personalExams: [],
      academicSourceLabel: "Resmî kaynak",
    });
    expect(calendarItemStartDateOnly(leapDayItem)).toBe("2024-02-29");
    const week = buildWeekSummary([rangeItem, leapDayItem], "2024-02-29");
    expect(week.find((day) => day.date === "2024-02-28")?.itemCount).toBe(1);
    expect(week.find((day) => day.date === "2024-02-29")?.itemCount).toBe(2);
    expect(week.find((day) => day.date === "2024-03-01")?.itemCount).toBe(1);
    expect(rangeItem).toMatchObject({ startDate: "2024-02-28", endDate: "2024-03-01" });
    expect(leapDayItem.startDate).toBe("2024-02-29");
    expect(leapDayItem.startDate).not.toContain("T");
  });

  it("keeps non-leap February at 28 days", () => {
    expect(calendarPeriod("month", "2023-02-14")).toMatchObject({
      start: "2023-02-01",
      end: "2023-02-28",
    });
    const month = buildMonthSummary([], "2023-02-14");
    expect(month).toHaveLength(42);
    expect(month.some((day) => day.date === "2023-02-29")).toBe(false);
    expect(moveCalendarAnchor("month", "2023-01-31", 1)).toBe("2023-02-28");
  });

  it("groups timestamped items by the academic Europe/Istanbul calendar day", () => {
    const [item] = buildCalendarItems({
      academicEvents: [{
        id: "late",
        title: "Gece etkinliği",
        category: "orientation",
        startDate: "2026-08-01T21:30:00.000Z",
        temporalKind: "timestamp",
      }],
      personalExams: [],
      academicSourceLabel: "Resmî kaynak",
    });
    const week = buildWeekSummary([item], "2026-08-02");
    expect(week.find((day) => day.date === "2026-08-02")?.itemCount).toBe(1);
    expect(week.find((day) => day.date === "2026-08-01")?.itemCount).toBe(0);
  });

  it.each([
    [{ loading: true, attempted: false, hasItems: false }, "loading"],
    [{ loading: false, attempted: true, hasItems: false }, "empty"],
    [{ loading: false, attempted: true, hasItems: false, error: "failed" }, "error"],
    [{ loading: false, attempted: true, hasItems: false, partial: true }, "partial"],
    [{ loading: false, attempted: true, hasItems: false, offline: true }, "offline"],
    [{ loading: true, attempted: true, hasItems: true }, "refreshing"],
    [{ loading: false, attempted: true, hasItems: true, error: "failed" }, "stale"],
    [{ loading: false, attempted: true, hasItems: true, partial: true }, "partial"],
    [{ loading: false, attempted: true, hasItems: true }, "populated"],
  ])("resolves one dominant availability state for %o", (input, expected) => {
    expect(resolveCalendarPresentationState(input)).toBe(expected);
  });

  it("requires explicit system-selected date and time before composing an exam", () => {
    const empty = { title: "Final", date: null, time: null };
    expect(validatePersonalExamDraft(empty)).toEqual({
      date: "Tarihi sistem seçicisinden seç.",
      time: "Saati sistem seçicisinden seç.",
    });
    const dated = applyDateSelection(empty, new Date(2026, 7, 14, 10, 0));
    expect(composePersonalExamTimestamp(dated)).toBeNull();
    const complete = applyTimeSelection(dated, new Date(2026, 7, 1, 13, 45));
    expect(validatePersonalExamDraft(complete)).toEqual({});
    expect(composePersonalExamTimestamp(complete)).toBe("2026-08-14T10:45:00.000Z");
  });

  it("round-trips an existing exam in Europe/Istanbul independently of the device timezone", () => {
    const draft = personalExamDraftFromRecord({
      id: "exam",
      title: "Fizik",
      examDate: "2026-09-01T06:20:00.000Z",
    });
    expect(draft).toEqual({
      title: "Fizik",
      kind: "exam",
      date: "2026-09-01",
      time: "09:20",
      locationNote: "",
      reminderMinutesBefore: null,
    });
  });

  it("keeps optional academic locations and personal room notes in Calendar items", () => {
    const items = buildCalendarItems({
      academicEvents: [{
        id: "located-event",
        title: "Veri Yapıları Final Sınavı",
        category: "final_exam",
        startDate: "2026-08-10T07:00:00.000Z",
        endDate: "2026-08-10T09:00:00.000Z",
        location: "Mühendislik Fak. – A Blok 201",
      }],
      personalExams: [{
        id: "personal-located",
        title: "Matematik II",
        examDate: "2026-08-11T06:00:00.000Z",
        locationNote: "D-101",
      }],
      academicSourceLabel: "Resmî kaynak",
    });

    expect(items.map((item) => item.location)).toEqual([
      "Mühendislik Fak. – A Blok 201",
      "D-101",
    ]);
  });

  it("keeps create, edit, delete, relaunch, and A/B/A storage owner-scoped", () => {
    const ownerA = "owner-a";
    const ownerB = "owner-b";
    const created: ManualExamRecord[] = [{
      id: "a-exam",
      title: "A sınavı",
      examDate: "2026-08-15T06:00:00.000Z",
    }];
    const ownerAKey = createManualExamStorageKey(ownerA);
    const ownerBKey = createManualExamStorageKey(ownerB);
    expect(ownerAKey).not.toBe(ownerBKey);

    const afterRelaunch = readManualExamEnvelope(
      serializeManualExamEnvelope(ownerA, created, "2026-08-05T09:00:00.000Z"),
      ownerA,
    );
    expect(afterRelaunch.status).toBe("loaded");
    const edited = afterRelaunch.exams.map((exam) => ({
      ...exam,
      title: "A güncel sınavı",
      examDate: "2026-08-16T07:30:00.000Z",
    }));
    const ownerAEditedEnvelope = serializeManualExamEnvelope(ownerA, edited);
    expect(readManualExamEnvelope(
      ownerAEditedEnvelope,
      ownerB,
    )).toMatchObject({ status: "owner_mismatch", exams: [] });
    expect(readManualExamEnvelope(
      serializeManualExamEnvelope(ownerB, [{
        id: "b-exam",
        title: "B sınavı",
        examDate: "2026-08-17T07:30:00.000Z",
      }]),
      ownerB,
    ).exams.map((exam) => exam.id)).toEqual(["b-exam"]);
    expect(readManualExamEnvelope(ownerAEditedEnvelope, ownerA).exams).toEqual(edited);
    expect(readManualExamEnvelope(
      serializeManualExamEnvelope(ownerA, edited.filter(() => false)),
      ownerA,
    ).exams).toEqual([]);
  });
});
