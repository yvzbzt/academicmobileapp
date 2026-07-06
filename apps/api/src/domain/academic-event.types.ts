export const academicEventCategories = [
  "academic_year_start",
  "academic_year_end",
  "fall_term_start",
  "fall_term_end",
  "spring_term_start",
  "spring_term_end",
  "course_registration",
  "course_renewal",
  "course_add_drop",
  "course_schedule",
  "midterm_exam",
  "final_exam",
  "makeup_exam",
  "single_course_exam",
  "department_exam_schedule",
  "graduation_application",
  "tuition_payment",
  "horizontal_transfer",
  "summer_school_registration",
  "summer_school_start",
  "summer_school_end",
  "holiday",
  "orientation",
  "custom_event"
] as const;

export type AcademicEventCategory = (typeof academicEventCategories)[number];

export type AcademicTerm = "fall" | "spring" | "summer" | "full_year" | "unknown";

export type DatePrecision = "day" | "date_range" | "week" | "term" | "academic_year" | "unknown";

export interface NormalizedDateResult {
  originalDateText: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  hasExplicitTime?: boolean;
  datePrecision: DatePrecision;
  academicYear?: string;
  term?: AcademicTerm;
  warnings: string[];
}

export interface ExtractedAcademicEventDraft {
  originalText: string;
  originalDateText: string;
  normalizedTitle: string;
  normalizedCategory: AcademicEventCategory;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  hasExplicitTime?: boolean;
  timezone: "Europe/Istanbul";
  datePrecision: DatePrecision;
  academicYear?: string;
  term: AcademicTerm;
  sourcePdfId: string;
  sourcePage: number;
  confidenceScore: number;
  status: "pending_review" | "approved" | "rejected" | "published";
}
