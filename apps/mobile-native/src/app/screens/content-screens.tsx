import { Platform } from "react-native";
import { UnknownRouteState } from "../../navigation/SystemStateScreens";
import { Banner } from "../../design-system";
import { HomeDailyBrief } from "../../home/HomeDailyBrief";
import { CalendarExperience } from "../../calendar/CalendarExperience";
import { CalendarEventDetail } from "../../calendar/CalendarEventDetail";
import { AnnouncementsFeed } from "../../announcements/AnnouncementsFeed";
import { AnnouncementDetail } from "../../announcements/AnnouncementDetail";
import { SummerSchoolScreen, YokAnnouncementsScreen } from "../../announcements/SourceDestinationScreens";
import { formatDateTimeShort } from "../app-content";
import { googleCalendarLifecycleLabel } from "../calendar-presentations";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";
import type { HomeContentData } from "../useHomeContentData";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "session" | "registerUniversityId" | "calendar" | "upcoming" | "announcements"
  | "googleCalendarState" | "notificationLifecycle" | "setAccountDrawerVisible" | "requestAppRoute"
  | "calendarCreateRequestSequenceRef" | "setCalendarCreateIntent" | "contentFeedLimit"
  | "contentFeedPagination" | "message" | "setMessage" | "notificationDestinationNotice"
  | "setNotificationDestinationNotice" | "summerSchool" | "busy" | "yokAnnouncements"
  | "calendarCreateIntent" | "manualExamsHydrated" | "manualExamOwnerId" | "courseSchedule"
  | "appleCalendarState" | "appleCalendarStoredState" | "appleCalendarError"
  | "appleCalendarWarnings" | "appleCalendarBusy" | "googleCalendarIntegration"
  | "googleCalendarLastResult" | "googleCalendarError" | "googleCalendarWarnings"
  | "googleCalendarBusy" | "activeTrustedDetail" | "announcementDetailLoad"
  | "announcementSaveStatus" | "activeCalendarDetail"
> & Pick<ApplicationDerivedState,
  "selectedUniversity" | "selectedFaculty" | "selectedDepartment" | "announcementFeed"
  | "yokAnnouncementItems" | "summerSchoolAnnouncements" | "contentFeedLoading"
  | "contentFeedAttempted" | "contentFeedHasRetainedData" | "contentFeedError" | "contentFeedStale"
  | "contentFeedPartial" | "contentFeedHasMore" | "controlledActiveRoute" | "summerSchoolEvents"
  | "universityAcademicCalendarEvents" | "appleCalendarPresentation" | "googleCalendarLive"
> & Pick<HomeContentData,
  "homeEvents" | "homeManualExams"
> & Pick<ApplicationActions,
  "openTrustedContentRecord" | "openHomeImportantItem" | "loadMyCalendar" | "loadCourseSchedule"
  | "loadUpcoming" | "refreshContentFeed" | "loadMoreContentFeed" | "openContentFeedItem"
  | "openAnnouncement" | "retryPendingNotificationDestination" | "refreshSummerSchool"
  | "openCalendarItem" | "createPersonalExam" | "updatePersonalExam" | "syncAppleCalendar"
  | "syncGoogleCalendar" | "loadProtectedAnnouncementDetail" | "toggleAnnouncementSaved"
  | "deletePersonalExam"
>;

export function createContentScreens(dependencies: Dependencies) {
  const {
    session,
    registerUniversityId,
    selectedUniversity,
    selectedFaculty,
    selectedDepartment,
    homeEvents,
    homeManualExams,
    announcementFeed,
    calendar,
    upcoming,
    announcements,
    googleCalendarState,
    notificationLifecycle,
    setAccountDrawerVisible,
    requestAppRoute,
    openTrustedContentRecord,
    openHomeImportantItem,
    calendarCreateRequestSequenceRef,
    setCalendarCreateIntent,
    loadMyCalendar,
    loadCourseSchedule,
    loadUpcoming,
    refreshContentFeed,
    yokAnnouncementItems,
    summerSchoolAnnouncements,
    contentFeedLoading,
    contentFeedAttempted,
    contentFeedHasRetainedData,
    contentFeedError,
    contentFeedStale,
    contentFeedPartial,
    contentFeedLimit,
    contentFeedHasMore,
    contentFeedPagination,
    loadMoreContentFeed,
    openContentFeedItem,
    openAnnouncement,
    controlledActiveRoute,
    message,
    setMessage,
    notificationDestinationNotice,
    retryPendingNotificationDestination,
    setNotificationDestinationNotice,
    summerSchool,
    summerSchoolEvents,
    refreshSummerSchool,
    busy,
    yokAnnouncements,
    universityAcademicCalendarEvents,
    calendarCreateIntent,
    manualExamsHydrated,
    manualExamOwnerId,
    courseSchedule,
    appleCalendarState,
    appleCalendarPresentation,
    appleCalendarStoredState,
    appleCalendarError,
    appleCalendarWarnings,
    appleCalendarBusy,
    googleCalendarIntegration,
    googleCalendarLastResult,
    googleCalendarError,
    googleCalendarWarnings,
    googleCalendarBusy,
    googleCalendarLive,
    openCalendarItem,
    createPersonalExam,
    updatePersonalExam,
    syncAppleCalendar,
    syncGoogleCalendar,
    activeTrustedDetail,
    announcementDetailLoad,
    loadProtectedAnnouncementDetail,
    toggleAnnouncementSaved,
    announcementSaveStatus,
    activeCalendarDetail,
    deletePersonalExam
  } = dependencies;

  const homeDailyBrief = session ? (
    <HomeDailyBrief
      fullName={session.user.fullName}
      profileComplete={Boolean(registerUniversityId)}
      universityName={selectedUniversity?.name ?? (registerUniversityId ? "Üniversite bilgisi kayıtlı" : undefined)}
      facultyName={selectedFaculty?.name}
      departmentName={selectedDepartment?.name}
      events={homeEvents}
      manualExams={homeManualExams}
      announcements={announcementFeed}
      calendarLoading={calendar.loading || upcoming.loading}
      calendarAttempted={Boolean(calendar.attempted && upcoming.attempted)}
      calendarError={calendar.error ?? upcoming.error}
      calendarStale={calendar.stale || upcoming.stale}
      announcementLoading={announcements.loading}
      announcementAttempted={Boolean(announcements.attempted)}
      announcementError={announcements.error}
      announcementStale={announcements.stale}
      announcementState={announcements.data?.state}
      googleCalendarState={googleCalendarState}
      notificationPermission={notificationLifecycle.permission}
      notificationPreferenceEnabled={notificationLifecycle.preferenceEnabled}
      notificationActive={notificationLifecycle.active}
      onOpenAccountMenu={() => setAccountDrawerVisible(true)}
      onCompleteProfile={() => requestAppRoute("AcademicProfileSettings")}
      onOpenAnnouncement={(item) => {
        openTrustedContentRecord(item, "academic");
      }}
      onOpenAnnouncements={() => requestAppRoute("Announcements")}
      onOpenImportantItem={openHomeImportantItem}
      onOpenCalendar={() => requestAppRoute("Calendar")}
      onCreatePersonalEvent={() => {
        const key = ++calendarCreateRequestSequenceRef.current;
        setCalendarCreateIntent({ key, ownerId: session.user.id });
        requestAppRoute("Calendar");
      }}
      onOpenGoogleCalendarSettings={() => requestAppRoute("GoogleCalendarSettings")}
      onOpenNotificationSettings={() => requestAppRoute("NotificationSettings")}
      onRefresh={() => {
        void Promise.allSettled([loadMyCalendar(), loadCourseSchedule(), loadUpcoming(), refreshContentFeed()]);
      }}
    />
  ) : null;

  const announcementsContentFeed = session ? (
    <AnnouncementsFeed
      academicItems={announcementFeed}
      yokItems={yokAnnouncementItems}
      summerItems={summerSchoolAnnouncements}
      universityName={selectedUniversity?.name}
      facultyName={selectedFaculty?.name}
      departmentName={selectedDepartment?.name}
      loading={contentFeedLoading}
      attempted={contentFeedAttempted}
      refreshing={contentFeedLoading && contentFeedHasRetainedData}
      error={contentFeedError}
      stale={contentFeedStale}
      partial={contentFeedPartial}
      serverLimit={contentFeedLimit}
      hasMore={contentFeedHasMore}
      paginationLoading={contentFeedPagination.loading}
      paginationError={contentFeedPagination.error}
      notificationPreferenceEnabled={notificationLifecycle.preferenceEnabled}
      notificationActive={notificationLifecycle.active}
      onRefresh={() => void refreshContentFeed()}
      onRetry={() => void refreshContentFeed()}
      onLoadMore={() => void loadMoreContentFeed()}
      onRetryPagination={() => void loadMoreContentFeed()}
      onOpenItem={openContentFeedItem}
      onOpenOfficialSource={openAnnouncement}
      onOpenAccountMenu={() => setAccountDrawerVisible(true)}
      onOpenNotificationSettings={() => requestAppRoute("NotificationSettings")}
      onOpenYok={() => requestAppRoute("YokAnnouncements")}
      onOpenSummerSchool={() => requestAppRoute("SummerSchool")}
    />
  ) : null;

  const announcementDestinationActive = controlledActiveRoute === "SummerSchool"
    || controlledActiveRoute === "YokAnnouncements";

  const announcementDestinationFeedback = (
    <>
      {announcementDestinationActive && message ? (
        <Banner
          dismissAccessibilityLabel="İşlem mesajını kapat"
          message={message.text}
          onDismiss={() => setMessage(null)}
          title={message.tone === "error"
            ? "İşlem tamamlanamadı"
            : message.tone === "success"
              ? "İşlem tamamlandı"
              : "Bilgi"}
          tone={message.tone}
        />
      ) : null}
      {announcementDestinationActive && session && notificationDestinationNotice ? (
        <Banner
          actionLabel={notificationDestinationNotice.status === "temporarily_unavailable"
            ? "Hedefi tekrar doğrula"
            : undefined}
          dismissAccessibilityLabel="Bildirim hedefi mesajını kapat"
          message={notificationDestinationNotice.status === "opened"
            ? notificationDestinationNotice.title ?? "İstenen içerik güvenli biçimde açıldı."
            : notificationDestinationNotice.status === "temporarily_unavailable"
              ? "Bağlantı veya sunucu hatası nedeniyle hedef doğrulanamadı. Kayıt korundu; tekrar deneyebilirsin."
              : "İçerik bu hesaba ait güncel ve güvenilir kaynaklarda bulunamadığı için başka bir kayıt açılmadı."}
          onAction={notificationDestinationNotice.status === "temporarily_unavailable"
            ? () => void retryPendingNotificationDestination()
            : undefined}
          onDismiss={() => setNotificationDestinationNotice(null)}
          title={notificationDestinationNotice.status === "opened"
            ? "Bildirim hedefi doğrulandı"
            : notificationDestinationNotice.status === "temporarily_unavailable"
              ? "Bildirim hedefi şu anda doğrulanamıyor"
              : "Bildirim hedefi artık kullanılamıyor"}
          tone={notificationDestinationNotice.status === "opened" ? "success" : "warning"}
        />
      ) : null}
    </>
  );

  const summerSchoolScreen = session ? (
    <SummerSchoolScreen
      announcements={summerSchoolAnnouncements}
      calendarAttempted={Boolean(calendar.attempted)}
      calendarError={calendar.error}
      calendarLoading={calendar.loading}
      calendarStale={calendar.stale}
      contentAttempted={Boolean(summerSchool.attempted)}
      contentError={summerSchool.error}
      contentLoading={summerSchool.loading}
      contentStale={summerSchool.stale}
      contentState={summerSchool.data?.contentState}
      events={summerSchoolEvents}
      feedback={announcementDestinationFeedback}
      onOpenAnnouncement={(item) => {
        openTrustedContentRecord(item, "summer-school");
      }}
      onOpenOfficialSource={(url) => openAnnouncement(url)}
      onRefresh={() => void refreshSummerSchool()}
      refreshDisabled={busy}
      requirements={summerSchool.data?.requirements ?? []}
      sameDepartmentOptions={summerSchool.data?.sameDepartmentOptions ?? []}
      universityName={selectedUniversity?.name}
      universitySelected={Boolean(registerUniversityId)}
    />
  ) : null;

  const yokAnnouncementsScreen = session ? (
    <YokAnnouncementsScreen
      attempted={Boolean(yokAnnouncements.attempted)}
      collectionState={yokAnnouncements.data?.state}
      error={yokAnnouncements.error}
      feedback={announcementDestinationFeedback}
      items={yokAnnouncementItems}
      loading={yokAnnouncements.loading}
      onOpenItem={(item) => {
        openTrustedContentRecord(item, "yok");
      }}
      onRefresh={() => void refreshContentFeed()}
      refreshDisabled={busy}
      stale={yokAnnouncements.stale}
    />
  ) : null;

  const calendarRouteFeedback = (
    (controlledActiveRoute === "Calendar" || controlledActiveRoute === "CalendarEventDetail") && message ? (
      <Banner
        dismissAccessibilityLabel="Takvim işlem mesajını kapat"
        message={message.text}
        onDismiss={() => setMessage(null)}
        title={message.tone === "error"
          ? "İşlem tamamlanamadı"
          : message.tone === "success"
            ? "İşlem tamamlandı"
            : "Bilgi"}
        tone={message.tone}
      />
    ) : null
  );

  const calendarExperience = session ? (
    <CalendarExperience
      academicEvents={universityAcademicCalendarEvents}
      createPersonalExamRequestKey={calendarCreateIntent?.ownerId === session.user.id
        ? calendarCreateIntent.key
        : undefined}
      personalExams={homeManualExams}
      personalExamsReady={manualExamsHydrated && manualExamOwnerId === session.user.id}
      calendarTitle={calendar.data?.calendar.title}
      academicYear={calendar.data?.calendar.academicYear}
      universityName={selectedUniversity?.name}
      loading={calendar.loading || courseSchedule.loading}
      attempted={Boolean(calendar.attempted)}
      error={calendar.error}
      stale={Boolean(calendar.stale || courseSchedule.stale)}
      partial={calendar.data?.sourceStatus === "source_only" || courseSchedule.data?.sourceStatus === "source_only"}
      apple={Platform.OS === "ios" ? {
        state: appleCalendarState,
        stateLabel: appleCalendarPresentation.label,
        managedCount: Object.keys(appleCalendarStoredState.mappings).length,
        lastSyncedLabel: appleCalendarStoredState.integration?.lastSuccessfulSyncAt
          ? `Son eşitleme: ${formatDateTimeShort(appleCalendarStoredState.integration.lastSuccessfulSyncAt)}`
          : undefined,
        error: appleCalendarError ?? undefined,
        warnings: appleCalendarWarnings,
        busy: appleCalendarBusy,
        connected: appleCalendarPresentation.connected,
      } : undefined}
      google={{
        state: googleCalendarState,
        stateLabel: googleCalendarLifecycleLabel(googleCalendarState),
        accountEmail: googleCalendarIntegration?.accountEmail,
        verifiedCount: googleCalendarIntegration
          ? googleCalendarLastResult?.verified ?? googleCalendarIntegration.mappings.length
          : undefined,
        lastSyncedLabel: googleCalendarIntegration?.lastSyncedAt
          ? `Son eşitleme: ${formatDateTimeShort(googleCalendarIntegration.lastSyncedAt)}`
          : undefined,
        error: googleCalendarError ?? undefined,
        warnings: googleCalendarWarnings,
        busy: googleCalendarBusy,
        connected: googleCalendarLive
      }}
      feedback={calendarRouteFeedback}
      onOpenAccountMenu={() => setAccountDrawerVisible(true)}
      onRefresh={() => void Promise.allSettled([loadMyCalendar(), loadCourseSchedule()])}
      onOpenItem={openCalendarItem}
      onCreatePersonalExam={createPersonalExam}
      onConsumeCreatePersonalExamRequest={(requestKey) => {
        setCalendarCreateIntent((current) => (
          current?.ownerId === session.user.id && current.key === requestKey
            ? null
            : current
        ));
      }}
      onUpdatePersonalExam={updatePersonalExam}
      onSyncApple={Platform.OS === "ios" ? () => void syncAppleCalendar() : undefined}
      onManageApple={Platform.OS === "ios" ? () => requestAppRoute("AppleCalendarSettings") : undefined}
      onSyncGoogle={() => void syncGoogleCalendar(!googleCalendarIntegration)}
      onManageGoogle={() => requestAppRoute("GoogleCalendarSettings")}
    />
  ) : null;

  const routeBoundAnnouncementDetail = activeTrustedDetail?.type === "announcement"
    && (!announcementDetailLoad || activeTrustedDetail.id === announcementDetailLoad.id)
    ? activeTrustedDetail
    : null;

  const announcementDetail = (
    <AnnouncementDetail
      item={routeBoundAnnouncementDetail?.item ?? null}
      loading={Boolean(announcementDetailLoad?.loading)}
      error={announcementDetailLoad?.error}
      onRetry={announcementDetailLoad?.error
        ? () => loadProtectedAnnouncementDetail(announcementDetailLoad.id)
        : undefined}
      onOpenOfficialSource={openAnnouncement}
      onOpenNotificationSettings={() => requestAppRoute("NotificationSettings")}
      onToggleSaved={() => routeBoundAnnouncementDetail
        ? toggleAnnouncementSaved(routeBoundAnnouncementDetail.id)
        : Promise.resolve()}
      saved={Boolean(
        routeBoundAnnouncementDetail
        && announcementSaveStatus?.id === routeBoundAnnouncementDetail.id
        && announcementSaveStatus.saved
      )}
      saveError={routeBoundAnnouncementDetail && announcementSaveStatus?.id === routeBoundAnnouncementDetail.id
        ? announcementSaveStatus.error
        : undefined}
      saveLoading={Boolean(
        routeBoundAnnouncementDetail
        && announcementSaveStatus?.id === routeBoundAnnouncementDetail.id
        && (announcementSaveStatus.loading || announcementSaveStatus.mutating)
      )}
    />
  );

  const calendarTrustedDetail = (
    <CalendarEventDetail
      item={activeCalendarDetail}
      feedback={calendarRouteFeedback}
      academicYear={calendar.data?.calendar.academicYear}
      universityName={selectedUniversity?.name}
      facultyName={selectedFaculty?.name}
      departmentName={selectedDepartment?.name}
      onOpenOfficialSource={openAnnouncement}
      onUpdatePersonalExam={updatePersonalExam}
      onDeletePersonalExam={deletePersonalExam}
    />
  );

  const unknownRoute = (
    <UnknownRouteState
      authenticated={Boolean(session)}
      onReturn={() => requestAppRoute(session ? "Home" : "Login")}
    />
  );

  return {
    homeDailyBrief,
    announcementsContentFeed,
    announcementDestinationActive,
    announcementDestinationFeedback,
    summerSchoolScreen,
    yokAnnouncementsScreen,
    calendarRouteFeedback,
    calendarExperience,
    routeBoundAnnouncementDetail,
    announcementDetail,
    calendarTrustedDetail,
    unknownRoute
  };
}
