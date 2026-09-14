import { type Dispatch, type SetStateAction } from "react";
import { type AppVisibleRoute } from "../navigation/AppNavigator";
import { type ProtectedAppRoute, type AppRouteIntent } from "../navigation";
import { type GoogleCalendarConnectionRecordV3 } from "../google-calendar/google-calendar-lifecycle";
import {
  NotificationLifecycleCoordinator,
  createPendingNotificationDestinationRecord,
  type ParsedNotificationDestination,
} from "../notifications";
import { type PendingVerificationRecord } from "../auth/auth-recovery";
import {
  type AuthOperation,
  type AccountGenerationSnapshot,
  type AccountCleanupResult,
} from "../auth/session-integrity";
import {
  type DestructiveAccountAction,
  type RecentAuthenticationMethod,
} from "../auth/recent-authentication";
import { type AcademicOnboardingDraft } from "../auth/auth-ui";
import { type HomeImportantItem } from "../home/home-model";
import { type CalendarItem } from "../calendar/calendar-model";
import {
  type PersonalExamMutationInput,
  type PersonalExamMutationResult,
} from "../calendar/personal-exam-runtime";
import { PersonalCalendarReminderCoordinator } from "../calendar/personal-calendar-reminders";
import { type NativeCalendarContext } from "../native-calendar";
import { type ContentFeedItem } from "../announcements/feed-model";
import {
  type SessionPayload,
  type Loadable,
  type NotificationPreferencePayload,
  type AlarmMode,
  type AnnouncementRecord,
} from "./app-types";
import { type TrustedContentCollection } from "../content/content-trust";

/** Cross-domain callbacks. Implementations preserve per-render state snapshots. */
export interface ApplicationActions {
  enqueueStorageMutation<T>(action: () => Promise<T>): Promise<T>;
  trackAuthenticatedMutation<T>(action: () => Promise<T>): Promise<T>;
  waitForAuthenticatedMutations(): Promise<void>;
  abortAuthenticatedRequests(): void;
  refreshAuthenticatedSession(expiredAccessToken?: string): Promise<SessionPayload | null>;
  apiRequest<T>(path: string, options?: RequestInit, token?: string, requestOptions?: {
    skipAuthRefresh?: boolean;
    authOperation?: AuthOperation;
    ownerSnapshot?: AccountGenerationSnapshot | null;
    detached?: boolean;
    timeoutMs?: number;
  }): Promise<T>;
  withLoadable<T>(setter: Dispatch<SetStateAction<Loadable<T>>>, action: () => Promise<T>, ownerSnapshot?: AccountGenerationSnapshot | null, preserveDataOnRefresh?: boolean, isOperationCurrent?: () => boolean): Promise<T | null>;
  hydrateApplication(): Promise<void>;
  restoreSession(storedValue?: string | null): Promise<SessionPayload | null>;
  restoreDeviceId(): Promise<string>;
  restorePendingVerification(): Promise<void>;
  warmAuthenticatedContext(token: string, profileUniversityId: string, ownerSnapshot: AccountGenerationSnapshot): void;
  bootstrapAuthenticatedContext(token: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null): Promise<boolean>;
  persistSession(nextSession: SessionPayload | null, afterDurableInvalidation?: () => void): Promise<void>;
  persistPendingVerification(record: PendingVerificationRecord | null): Promise<void>;
  clearPendingVerification(): Promise<void>;
  invalidateAuthenticatedWork(): void;
  activateSession(nextSession: SessionPayload): Promise<AccountGenerationSnapshot>;
  clearExpiredSession(userMessage?: string): Promise<void>;
  handleAuth(): Promise<void>;
  handleGoogleAuth(): Promise<void>;
  requestAppleCredential(requestProfile: boolean): Promise<{
    identityToken: string;
    nonce: string;
    fullName?: string;
  }>;
  handleAppleAuth(): Promise<void>;
  resendVerificationEmail(): Promise<void>;
  handleVerifyEmail(): Promise<void>;
  saveAcademicOnboarding(): Promise<void>;
  skipAcademicOnboarding(): void;
  openVerificationRecovery(candidateEmail?: string): Promise<void>;
  returnToLoginForm(): void;
  openPasswordRecovery(candidateEmail?: string): void;
  requestPasswordRecovery(): Promise<void>;
  confirmPasswordRecovery(): Promise<void>;
  continuePasswordRecoveryCode(): void;
  returnToPasswordRecoveryCode(): void;
  returnToPasswordRecoveryRequest(): void;
  cancelPasswordRecovery(): void;
  handleLogout(): Promise<void>;
  resetUserScopedState(): void;
  clearAuthenticatedMemory(): void;
  reportCleanupResult(action: "logout" | "session_expiry" | "data_deletion" | "account_deletion" | "verification_save" | "verification_clear" | "activation" | "manual_exam_save" | "notification_settings", result: AccountCleanupResult, ownerId?: string): void;
  retryFailedCleanup(): Promise<void>;
  dismissRecentAuthentication(): void;
  beginRecentAuthentication(action: DestructiveAccountAction): void;
  freshGoogleIdTokenForRecentAuthentication(): Promise<string>;
  freshAppleCredentialForRecentAuthentication(): Promise<{
    identityToken: string;
    nonce: string;
  }>;
  requestRecentAuthenticationProof(action: DestructiveAccountAction, method: RecentAuthenticationMethod, currentSession: SessionPayload, ownerSnapshot: AccountGenerationSnapshot, passwordCredential?: string): Promise<string>;
  submitRecentAuthentication(method: RecentAuthenticationMethod): Promise<void>;
  confirmDeleteMyData(): void;
  deleteMyData(recentAuthenticationProof: string): Promise<void>;
  confirmDeleteAccount(): void;
  deleteAccount(recentAuthenticationProof: string): Promise<void>;
  loadUniversities(): Promise<void>;
  loadFacultiesForRegistration(universityId: string): Promise<void>;
  loadDepartmentsForRegistration(facultyId: string): Promise<void>;
  selectUniversity(universityId: string): Promise<void>;
  selectFaculty(facultyId: string): Promise<void>;
  selectDepartment(departmentId: string): Promise<void>;
  loadFollowedUniversities(tokenOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null, preserveDataOnRefresh?: boolean): Promise<void>;
  toggleFollowedUniversity(universityId: string, shouldFollow: boolean): Promise<void>;
  updateOnboardingDraft(nextDraft: AcademicOnboardingDraft): void;
  discardAcademicProfileChanges(): void;
  saveAcademicProfileSettings(): Promise<void>;
  loadMyCalendar(tokenOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null, preserveDataOnRefresh?: boolean): Promise<void>;
  loadCourseSchedule(tokenOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null, preserveDataOnRefresh?: boolean): Promise<void>;
  loadUpcoming(tokenOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null, preserveDataOnRefresh?: boolean): Promise<void>;
  loadAnnouncements(tokenOverride?: string, universityIdOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null, preserveDataOnRefresh?: boolean, limitOverride?: number, signal?: AbortSignal, requestGeneration?: number, forceManifestRevalidation?: boolean): Promise<void>;
  loadDeviceAnnouncementCollection(token: string, ownerSnapshot: AccountGenerationSnapshot, limit: number, signal: AbortSignal | undefined, requestGeneration: number | undefined, force: boolean): Promise<TrustedContentCollection>;
  loadYokAnnouncements(preserveDataOnRefresh?: boolean, limitOverride?: number, signal?: AbortSignal, requestGeneration?: number): Promise<void>;
  loadSummerSchool(tokenOverride?: string, universityIdOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null, preserveDataOnRefresh?: boolean, signal?: AbortSignal, requestGeneration?: number): Promise<void>;
  refreshSummerSchool(): Promise<void>;
  refreshContentFeed(): Promise<void>;
  loadMoreContentFeed(): Promise<void>;
  ensureNotificationCoordinator(installationId: string): NotificationLifecycleCoordinator | null;
  detachNotificationOwnerForCleanup(): Promise<void>;
  loadPreferences(tokenOverride?: string, ownerSnapshot?: Readonly<{ ownerId: string; generation: number; }> | null): Promise<NotificationPreferencePayload | null>;
  writeNotificationPreferences(currentSession: SessionPayload, existing: NotificationPreferencePayload, enabled: boolean, ownerSnapshot: AccountGenerationSnapshot): Promise<NotificationPreferencePayload>;
  reconcileNotificationDelivery(currentSession: SessionPayload, coordinator: NotificationLifecycleCoordinator, knownPreferences?: NotificationPreferencePayload, knownSnapshot?: AccountGenerationSnapshot): Promise<void>;
  disableNotificationDeliveryFailClosed(currentSession: SessionPayload, coordinator: NotificationLifecycleCoordinator, knownPreferences?: NotificationPreferencePayload, knownSnapshot?: AccountGenerationSnapshot): Promise<void>;
  updateCategory(category: string, enabled: boolean): void;
  updateAlarmMode(mode: AlarmMode): void;
  updateAlarmEnabled(enabled: boolean): void;
  discardNotificationPreferenceChanges(): void;
  saveAlarmSettings(): Promise<void>;
  retryNotificationSettings(): Promise<void>;
  persistPendingNotificationDestination(record: ReturnType<typeof createPendingNotificationDestinationRecord> | null): Promise<void>;
  readPendingNotificationDestination(): Promise<ReturnType<typeof createPendingNotificationDestinationRecord> | null>;
  pendingNotificationDestinationIsCurrent(expected: ReturnType<typeof createPendingNotificationDestinationRecord>): Promise<boolean>;
  clearPendingNotificationDestinationIfCurrent(expected: ReturnType<typeof createPendingNotificationDestinationRecord>): Promise<boolean>;
  resolvePendingNotificationForSession(record: ReturnType<typeof createPendingNotificationDestinationRecord>, currentSession: SessionPayload, ownerSnapshot: AccountGenerationSnapshot): Promise<void>;
  receiveNotificationDestination(parsed: ParsedNotificationDestination | null): Promise<void>;
  restorePendingNotificationForSession(currentSession: SessionPayload, ownerSnapshot: AccountGenerationSnapshot): Promise<void>;
  retryPendingNotificationDestination(): Promise<void>;
  invalidateAnnouncementDetailOwnership(): void;
  invalidateContentFeedOwnership(): void;
  openContentFeedItem(item: ContentFeedItem): void;
  openTrustedContentRecord(record: AnnouncementRecord, origin: "academic" | "yok" | "summer-school"): void;
  loadAnnouncementSavedStatus(announcementId: string): void;
  toggleAnnouncementSaved(announcementId: string): Promise<void>;
  loadProtectedAnnouncementDetail(announcementId: string): void;
  openAnnouncement(link: string): Promise<boolean>;
  openProtectedAppRoute(route: ProtectedAppRoute): void;
  dispatchProtectedRouteIntent(intent: AppRouteIntent, ownerSnapshot: AccountGenerationSnapshot): boolean;
  receiveAcademicPulseUrl(url: unknown): void;
  resumePendingDeepLinkIfEligible(): void;
  openCalendarItem(item: CalendarItem): void;
  openHomeImportantItem(item: HomeImportantItem): void;
  handleNavigationRequestHandled(requestKey: string): void;
  handleVisibleRouteChange(route: AppVisibleRoute): void;
  completePreloginWelcome(): Promise<void>;
  nativeCalendarContext(ownerId: string): NativeCalendarContext;
  restoreAppleCalendarConnection(ownerId?: string, ownerSnapshot?: AccountGenerationSnapshot | null): Promise<void>;
  beginAppleCalendarNativeMutation(): () => void;
  waitForAppleCalendarNativeMutation(): Promise<void>;
  removeAppleManagedEventsForDeletion(ownerId: string): Promise<void>;
  syncAppleCalendar(): Promise<void>;
  disconnectAppleCalendar(removeManagedEvents: boolean): Promise<void>;
  openFirstManagedAppleCalendarEvent(): Promise<void>;
  restoreGoogleCalendarConnection(ownerId?: string, ownerSnapshot?: AccountGenerationSnapshot | null): Promise<void>;
  enqueueGoogleSdkOperation<T>(action: () => Promise<T>): Promise<T>;
  readCurrentGoogleCalendarAuthorization(): Promise<{
    accessToken: string;
    accountEmail: string;
    googleAccountId: string;
  }>;
  queueGoogleSignOut(signal?: AbortSignal): Promise<void>;
  revokeGoogleCalendarAccessForConnection(connection: GoogleCalendarConnectionRecordV3, signal?: AbortSignal): Promise<void>;
  persistGoogleCalendarConnection(record: GoogleCalendarConnectionRecordV3 | null, ownerId?: string | undefined): Promise<void>;
  readStoredGoogleCalendarConnection(ownerId: string): Promise<GoogleCalendarConnectionRecordV3 | null>;
  removeGoogleManagedEventsForDeletion(ownerId: string, connection: GoogleCalendarConnectionRecordV3, signal?: AbortSignal): Promise<void>;
  runAbortableGoogleCleanup(action: (signal: AbortSignal) => Promise<void>, timeoutMs?: number): Promise<void>;
  authorizeGoogleCalendar(forceAccountSelection: boolean): Promise<{
    accessToken: string;
    accountEmail: string;
    googleAccountId: string;
  }>;
  syncGoogleCalendar(forceAccountSelection?: boolean): Promise<void>;
  disconnectGoogleCalendar(options: {
    removeManagedEvents: boolean;
    revokeAccess: boolean;
  }): Promise<boolean>;
  promptGoogleCalendarAccountSwitch(): void;
  restoreManualExams(ownerId: string, ownerSnapshot?: AccountGenerationSnapshot | null): Promise<void>;
  personalExamMutationSnapshot(): AccountGenerationSnapshot | null;
  createPersonalExam(input: PersonalExamMutationInput): PersonalExamMutationResult;
  updatePersonalExam(id: string, input: PersonalExamMutationInput): PersonalExamMutationResult;
  deletePersonalExam(id: string): PersonalExamMutationResult;
  syncPersonalCalendarReminder(ownerSnapshot: AccountGenerationSnapshot, item: Parameters<PersonalCalendarReminderCoordinator["sync"]>[1]): void;
}
