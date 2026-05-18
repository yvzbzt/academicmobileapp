import { Injectable } from "@nestjs/common";
import type { AnnouncementRepository, AnnouncementSourceRecord } from "./announcements.types.js";

@Injectable()
export class InMemoryAnnouncementRepository implements AnnouncementRepository {
  private readonly sources: AnnouncementSourceRecord[];

  constructor() {
    const now = new Date();
    this.sources = [
      {
        id: "sample-source-university",
        scopeType: "university",
        scopeId: "sample-university-1",
        sourceName: "University Announcements",
        sourceUrl: "https://example.edu.tr/university/announcements",
        parser: "auto",
        priority: 10,
        status: "active",
        fallbackItems: [
          {
            title: "University Senate Calendar Decision",
            link: "https://example.edu.tr/university/announcements/senate-calendar",
            publishedAt: new Date("2026-05-06T09:00:00.000Z"),
            summary: "Updated date windows for term transition have been published."
          },
          {
            title: "Library Extended Hours During Finals",
            link: "https://example.edu.tr/university/announcements/library-finals",
            publishedAt: new Date("2026-05-04T09:00:00.000Z")
          }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "sample-source-faculty",
        scopeType: "faculty",
        scopeId: "sample-faculty-1",
        sourceName: "Engineering Faculty Announcements",
        sourceUrl: "https://example.edu.tr/engineering/announcements",
        parser: "auto",
        priority: 20,
        status: "active",
        fallbackItems: [
          {
            title: "Internship Orientation Session",
            link: "https://example.edu.tr/engineering/announcements/internship-orientation",
            publishedAt: new Date("2026-05-09T11:00:00.000Z")
          }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "sample-source-department",
        scopeType: "department",
        scopeId: "sample-department-1",
        sourceName: "Computer Engineering Announcements",
        sourceUrl: "https://example.edu.tr/ceng/announcements",
        parser: "auto",
        priority: 30,
        status: "active",
        fallbackItems: [
          {
            title: "Data Structures Midterm Classroom Update",
            link: "https://example.edu.tr/ceng/announcements/data-structures-midterm-room",
            publishedAt: new Date("2026-05-10T08:00:00.000Z"),
            summary: "Classroom changed from B201 to A113."
          }
        ],
        createdAt: now,
        updatedAt: now
      }
    ];
  }

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    return this.sources
      .filter((source) => source.status === "active")
      .filter((source) => {
        if (source.scopeType === "university") return source.scopeId === input.universityId;
        if (source.scopeType === "faculty") return Boolean(input.facultyId && source.scopeId === input.facultyId);
        return Boolean(input.departmentId && source.scopeId === input.departmentId);
      })
      .sort((left, right) => right.priority - left.priority);
  }
}
