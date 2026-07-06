import { describe, expect, it } from "vitest";
import { academicCalendarSchema, academicEventSchema, announcementItemSchema, announcementSourceSchema, departmentSchema, deviceTokenSchema, extractedEventSchema, facultySchema, notificationJobSchema, notificationPreferenceSchema, pdfSourceSchema, refreshTokenSchema, universitySchema, userSchema } from "../src/database/mongoose-schemas.js";

describe("mongoose schemas", () => {
  it("defines users collection and email unique index", () => {
    expect(userSchema.get("collection")).toBe("users");
    const indexes = userSchema.indexes();
    expect(indexes).toEqual(expect.arrayContaining([[{ email: 1 }, expect.objectContaining({ unique: true })]]));
  });

  it("defines refresh token TTL cleanup index", () => {
    expect(refreshTokenSchema.get("collection")).toBe("refresh_tokens");
    const indexes = refreshTokenSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([[{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]])
    );
  });

  it("defines catalog collection indexes", () => {
    expect(universitySchema.get("collection")).toBe("universities");
    expect(facultySchema.get("collection")).toBe("faculties");
    expect(departmentSchema.get("collection")).toBe("departments");
    expect(universitySchema.indexes()).toEqual(expect.arrayContaining([[{ slug: 1 }, expect.objectContaining({ unique: true })]]));
    expect(facultySchema.indexes()).toEqual(expect.arrayContaining([[{ universityId: 1, slug: 1 }, expect.objectContaining({ unique: true })]]));
    expect(departmentSchema.indexes()).toEqual(expect.arrayContaining([[{ facultyId: 1, slug: 1 }, expect.objectContaining({ unique: true })]]));
  });

  it("defines academic calendar and event indexes", () => {
    expect(academicCalendarSchema.get("collection")).toBe("academic_calendars");
    expect(academicEventSchema.get("collection")).toBe("academic_events");
    expect(academicCalendarSchema.indexes()).toEqual(
      expect.arrayContaining([[{ universityId: 1, academicYear: 1, status: 1 }, expect.objectContaining({ name: "calendars_published_lookup" })]])
    );
    expect(academicEventSchema.indexes()).toEqual(
      expect.arrayContaining([[{ universityId: 1, status: 1, startDate: 1 }, expect.objectContaining({ name: "events_university_status_start" })]])
    );
  });

  it("defines PDF source and extracted event indexes", () => {
    expect(pdfSourceSchema.get("collection")).toBe("pdf_sources");
    expect(extractedEventSchema.get("collection")).toBe("extracted_events");
    expect(pdfSourceSchema.indexes()).toEqual(
      expect.arrayContaining([[{ universityId: 1, fileHash: 1 }, expect.objectContaining({ unique: true })]])
    );
    expect(extractedEventSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, confidenceScore: 1, createdAt: -1 }, expect.objectContaining({ name: "extracted_review_queue" })]])
    );
  });

  it("defines announcement source and item indexes", () => {
    expect(announcementSourceSchema.get("collection")).toBe("announcement_sources");
    expect(announcementItemSchema.get("collection")).toBe("announcement_items");
    expect(announcementSourceSchema.indexes()).toEqual(
      expect.arrayContaining([[{ sourceUrl: 1, scopeType: 1, scopeId: 1 }, expect.objectContaining({ unique: true })]])
    );
    expect(announcementItemSchema.indexes()).toEqual(
      expect.arrayContaining([[{ sourceId: 1, link: 1 }, expect.objectContaining({ unique: true })]])
    );
  });

  it("defines notification device, preference and job indexes", () => {
    expect(deviceTokenSchema.get("collection")).toBe("device_tokens");
    expect(notificationPreferenceSchema.get("collection")).toBe("notification_preferences");
    expect(notificationJobSchema.get("collection")).toBe("notification_jobs");
    expect(deviceTokenSchema.indexes()).toEqual(expect.arrayContaining([[{ token: 1 }, expect.objectContaining({ unique: true })]]));
    expect(notificationPreferenceSchema.indexes()).toEqual(expect.arrayContaining([[{ userId: 1 }, expect.objectContaining({ unique: true })]]));
    expect(notificationJobSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, scheduledAt: 1 }, expect.objectContaining({ name: "notification_jobs_due" })]])
    );
  });
});
