import { type ProtectedAppRoute, type UnknownRoute, type RouteOwner } from "../navigation";
import { type NotificationDestination } from "../notifications";
import { type AccountAuthProvider } from "../auth/recent-authentication";
import { type AcademicClassLevel } from "../auth/auth-ui";
import {
  type MobileContentRecordInput,
  type MobileContentCollectionInput,
  type TrustedMobileContentRecord,
  type ContentCollectionState,
} from "../content/content-trust";
import { type AcademicTemporalKind } from "../temporal/academic-temporal";

export type AuthMode = "login" | "register";

export type AlarmMode = "all_calendar" | "selected_fields";

export type TabId = "profile" | "announcements" | "home" | "calendar" | "summer" | "yok";

export type AcademicSelectionLevel = "university" | "faculty" | "department";

export type AuthStage =
  | "auth"
  | "verify"
  | "academic_onboarding"
  | "password_recovery_request"
  | "password_recovery_code"
  | "password_recovery_confirm";

export type PendingDeepLinkRoute = {
  route: ProtectedAppRoute | UnknownRoute;
  owner: RouteOwner | null;
};

export type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    authProvider?: AccountAuthProvider;
  };
};

export type RegisterResponse = {
  status: "verification_required";
  email: string;
  verificationExpiresAt: string;
  resendAvailableAt?: string;
  previewVerificationToken?: string;
};

export type PasswordRecoveryRequestResponse = {
  status: "recovery_requested";
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  previewRecoveryCode?: string;
};

export type PasswordRecoveryConfirmResponse = {
  status: "password_reset";
};

export type UserProfile = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: "active" | "inactive" | "locked";
  authProvider?: AccountAuthProvider;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: AcademicClassLevel;
};

export type UniversityRecord = {
  id: string;
  name: string;
  city: string;
  type: string;
};

export type FacultyRecord = {
  id: string;
  name: string;
};

export type DepartmentRecord = {
  id: string;
  name: string;
  educationLevel?: string;
};

export type AnnouncementApiRecord = MobileContentRecordInput;

export type AnnouncementCollectionApiPayload = MobileContentCollectionInput;

export type AnnouncementRecord = TrustedMobileContentRecord;

export type SavedAnnouncementApiStatus = {
  announcementId: string;
  saved: boolean;
  savedAt?: string;
};

export type CalendarRecord = {
  id: string;
  title: string;
  academicYear: string;
  status: string;
  sourceUrl?: string;
};

export type EventRecord = {
  id: string;
  title: string;
  courseName?: string;
  description?: string;
  location?: string;
  category: string;
  startDate: string;
  endDate?: string;
  temporalKind?: AcademicTemporalKind;
  endTemporalKind?: AcademicTemporalKind;
  timezone?: string;
  universityId?: string;
  facultyId?: string;
  departmentId?: string;
  sourceUrl?: string;
  sourceLabel?: string;
};

export type CalendarPayload = {
  calendar: CalendarRecord;
  events: EventRecord[];
  scope?: "university";
  sourceStatus?: "parsed" | "source_only";
};

export type DepartmentSchedulePayload = {
  profile: { universityId: string; facultyId?: string; departmentId?: string };
  events: EventRecord[];
  sourceUrl?: string;
  sourceStatus: "parsed" | "source_only" | "missing";
};

export type LegacyGoogleCalendarConnectionRecord = {
  ownerId: string;
  accountEmail: string;
  lastSyncedAt: string;
};

export type NotificationDestinationNotice = {
  status: "opened" | "unavailable" | "temporarily_unavailable";
  destination: NotificationDestination;
  title?: string;
};

export type SummerSchoolApiPayload = {
  profile: {
    universityId: string;
    universityName?: string;
    facultyId?: string;
    facultyName?: string;
    departmentId?: string;
    departmentName?: string;
  };
  requirements: Array<{
    message: string;
    date?: string;
    sourceUrl?: string;
    eventId?: string;
  }>;
  ownAnnouncements: AnnouncementApiRecord[];
  sameDepartmentAnnouncements: AnnouncementApiRecord[];
  announcementStatus?: {
    state: ContentCollectionState;
    sourceCount: number;
    failedSourceCount: number;
  };
  sameDepartmentOptions: Array<{
    universityId: string;
    universityName: string;
    academicYear: string;
    sourceUrl?: string;
    events: EventRecord[];
    matchingDepartments?: Array<{
      facultyId: string;
      facultyName: string;
      departmentId: string;
      departmentName: string;
      educationLevel: string;
    }>;
  }>;
  generatedAt: string;
};

export type SummerSchoolPayload = Omit<SummerSchoolApiPayload, "ownAnnouncements" | "sameDepartmentAnnouncements"> & {
  ownAnnouncements: AnnouncementRecord[];
  sameDepartmentAnnouncements: AnnouncementRecord[];
  contentState: ContentCollectionState;
};

export type NotificationPreferencePayload = {
  enabled: boolean;
  categories: Record<string, boolean>;
  reminderOffsets: number[];
  reminderRules?: Array<{
    trigger: "before" | "at_time" | "approaching";
    amount: number;
    unit: "days" | "hours";
    enabled: boolean;
  }>;
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: "Europe/Istanbul";
  };
};

export type Loadable<T> = {
  loading: boolean;
  data?: T;
  error?: string;
  attempted?: boolean;
  stale?: boolean;
};

export type AppleCalendarLifecycleState =
  | "unavailable"
  | "disconnected"
  | "checking"
  | "connected"
  | "syncing"
  | "partial"
  | "denied"
  | "error";
