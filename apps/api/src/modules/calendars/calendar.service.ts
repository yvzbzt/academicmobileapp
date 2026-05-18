import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AcademicEventCategory } from "../../domain/academic-event.types.js";
import type { AuthRepository } from "../auth/auth.types.js";
import type { AcademicCalendarRecord, AcademicEventRecord, CalendarRepository } from "./calendar.types.js";

export interface CalendarWithEventsResponse {
  calendar: AcademicCalendarRecord;
  events: AcademicEventRecord[];
}

@Injectable()
export class CalendarService {
  constructor(
    @Inject("CalendarRepository") private readonly calendarRepository: CalendarRepository,
    @Inject("AuthRepository") private readonly authRepository: AuthRepository
  ) {}

  async getMyCalendar(userId: string): Promise<CalendarWithEventsResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");

    const calendar = await this.calendarRepository.findPublishedCalendar(user.universityId);
    if (!calendar) throw new NotFoundException("Published calendar not found.");

    const events = await this.calendarRepository.listPublishedEvents({
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      limit: 200,
      offset: 0
    });

    return { calendar, events };
  }

  async getUniversityCalendar(universityId: string, academicYear?: string): Promise<CalendarWithEventsResponse> {
    const calendar = await this.calendarRepository.findPublishedCalendar(universityId, academicYear);
    if (!calendar) throw new NotFoundException("Published calendar not found.");
    const events = await this.calendarRepository.listPublishedEvents({
      universityId,
      limit: 200,
      offset: 0
    });
    return { calendar, events };
  }

  async getUpcomingEvents(userId: string, limit = 10): Promise<AcademicEventRecord[]> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundException("User not found.");
    if (!user.universityId) throw new BadRequestException("User must select a university first.");
    return this.calendarRepository.listUpcomingEvents({
      universityId: user.universityId,
      ...(user.facultyId ? { facultyId: user.facultyId } : {}),
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      fromDate: new Date(),
      limit: Math.min(Math.max(limit, 1), 50)
    });
  }

  async getEventDetail(eventId: string): Promise<AcademicEventRecord> {
    const event = await this.calendarRepository.findPublishedEventById(eventId);
    if (!event) throw new NotFoundException("Event not found.");
    return event;
  }

  async searchEvents(input: { category?: AcademicEventCategory; startDate?: Date; endDate?: Date; limit?: number; offset?: number }): Promise<AcademicEventRecord[]> {
    return this.calendarRepository.listPublishedEvents({
      ...(input.category ? { category: input.category } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
      offset: Math.max(input.offset ?? 0, 0)
    });
  }
}
