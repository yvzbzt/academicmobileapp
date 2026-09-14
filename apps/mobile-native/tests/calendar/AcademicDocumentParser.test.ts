import type { DeviceAcademicPdfSource, EventRecord } from "../../src/app/app-types";
import {
  mergeServerAndDeviceAcademicEvents,
  parseDeviceAcademicPdfText,
} from "../../src/calendar/academic-document-parser";

const capabilityBase = {
  mode: "device_text" as const,
  sourceUrl: "https://files.example.edu.tr/schedule.pdf",
  allowedOfficialDomain: "example.edu.tr",
  expectedSha256: "a".repeat(64),
  expectedByteLength: 128,
  authorizedAt: "2026-09-14T10:00:00.000Z",
  validUntil: "2026-09-14T10:15:00.000Z",
};

describe("device academic PDF text parser", () => {
  it("turns an academic-calendar text-layer row into a dated event", () => {
    const source: DeviceAcademicPdfSource = {
      ...capabilityBase,
      document: {
        kind: "academic_calendar",
        universityId: "uni",
        academicYear: "2026-2027",
        approvedEvents: [{
          normalizedTitle: "Course Registration",
          category: "custom_event",
          startDate: "2026-09-15",
          temporalKind: "date",
        }],
      },
    };

    const events = parseDeviceAcademicPdfText(
      "Course Registration 15.09.2026\n",
      source,
      { universityId: "uni", sourceLabel: "Academic calendar" },
    );

    expect(events).toEqual([
      expect.objectContaining({
        title: "Course Registration",
        category: "custom_event",
        startDate: "2026-09-15",
        temporalKind: "date",
        universityId: "uni",
        sourceUrl: source.sourceUrl,
      }),
    ]);
  });

  it("rejects an academic-calendar row that is not in the backend-approved semantic descriptors", () => {
    const source: DeviceAcademicPdfSource = {
      ...capabilityBase,
      document: {
        kind: "academic_calendar",
        universityId: "uni",
        academicYear: "2026-2027",
        approvedEvents: [{
          normalizedTitle: "Approved Registration",
          category: "custom_event",
          startDate: "2026-09-15",
          temporalKind: "date",
        }],
      },
    };

    expect(parseDeviceAcademicPdfText(
      "Unreviewed Registration 15.09.2026\n",
      source,
      { universityId: "uni", sourceLabel: "Academic calendar" },
    )).toEqual([]);
  });

  it("materializes only backend-approved course rows within the bounded date range", () => {
    const source: DeviceAcademicPdfSource = {
      ...capabilityBase,
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
    };

    const events = parseDeviceAcademicPdfText(
      "Monday 09:00-10:00 Data Structures\nTuesday 11:00-12:00 Unapproved Course",
      source,
      { universityId: "uni", facultyId: "faculty", departmentId: "department", sourceLabel: "Course schedule" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Data Structures",
      courseName: "Data Structures",
      category: "course_schedule",
      startDate: "2026-09-14T09:00:00+03:00",
      endDate: "2026-09-14T10:00:00+03:00",
    });
    expect(parseDeviceAcademicPdfText(
      "Monday 09:00-10:00 Different Course",
      source,
      { universityId: "uni", facultyId: "faculty", departmentId: "department", sourceLabel: "Course schedule" },
    )).toEqual([]);
  });

  it("parses approved exam rows as timestamp events", () => {
    const source: DeviceAcademicPdfSource = {
      ...capabilityBase,
      document: {
        kind: "exam_schedule",
        universityId: "uni",
        facultyId: "faculty",
        departmentId: "department",
        academicYear: "2026-2027",
        term: "fall",
        approvedRowNumbers: [1],
        approvedRows: [{ rowNumber: 1, normalizedTitle: "Data Structures Final", date: "2027-01-05", startTime: "10:00", endTime: "11:00" }],
      },
    };

    const events = parseDeviceAcademicPdfText(
      "05.01.2027 10:00-11:00 Data Structures Final",
      source,
      { universityId: "uni", facultyId: "faculty", departmentId: "department", sourceLabel: "Exam schedule" },
    );

    expect(events).toEqual([
      expect.objectContaining({
        title: "Data Structures Final",
        category: "final_exam",
        startDate: "2027-01-05T10:00:00+03:00",
      }),
    ]);
  });

  it("deduplicates device rows against published server events without dropping server data", () => {
    const serverEvent: EventRecord = {
      id: "server-event",
      title: "Data Structures",
      category: "course_schedule",
      startDate: "2026-09-14T06:00:00.000Z",
      endDate: "2026-09-14T07:00:00.000Z",
      universityId: "uni",
      facultyId: "faculty",
      departmentId: "department",
    };
    const deviceEvent: EventRecord = {
      ...serverEvent,
      id: "device-event",
      startDate: "2026-09-14T09:00:00+03:00",
      endDate: "2026-09-14T10:00:00+03:00",
    };

    expect(mergeServerAndDeviceAcademicEvents([serverEvent], [deviceEvent], true)).toEqual([serverEvent]);
    expect(mergeServerAndDeviceAcademicEvents([serverEvent], [{ ...deviceEvent, title: "New reviewed row" }], false)).toEqual([serverEvent]);
  });
});
