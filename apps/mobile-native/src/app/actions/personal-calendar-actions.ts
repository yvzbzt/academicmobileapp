import { type AccountGenerationSnapshot } from "../../auth/session-integrity";
import { buildCalendarItems } from "../../calendar/calendar-model";
import {
  StalePersonalExamOperationError,
  type PersonalExamMutationInput,
  type PersonalExamMutationResult,
} from "../../calendar/personal-exam-runtime";
import { PersonalCalendarReminderCoordinator } from "../../calendar/personal-calendar-reminders";
import { StaleAccountRequestError } from "../app-errors";
import type { ApplicationState } from "../useApplicationState";
import type { PersonalCalendarRuntime } from "../usePersonalCalendarRuntime";
import type { ApplicationActions } from "../application-actions";

type Dependencies = Pick<ApplicationState,
  "accountGuardRef" | "setMessage" | "accountCleanupInProgressRef" | "sessionRef"
  | "setActiveCalendarDetail" | "requestAppRoute"
> & Pick<PersonalCalendarRuntime,
  "personalExamRuntime" | "personalCalendarReminderCoordinator"
>;

export function createPersonalCalendarActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "restoreManualExams" | "personalExamMutationSnapshot" | "createPersonalExam"
  | "updatePersonalExam" | "deletePersonalExam" | "syncPersonalCalendarReminder"
> {
  const {
    accountGuardRef,
    personalExamRuntime,
    personalCalendarReminderCoordinator,
    setMessage,
    accountCleanupInProgressRef,
    sessionRef,
    setActiveCalendarDetail,
    requestAppRoute
  } = dependencies;

  async function restoreManualExams(
    ownerId: string,
    ownerSnapshot?: AccountGenerationSnapshot | null
  ): Promise<void> {
    const snapshot = ownerSnapshot ?? accountGuardRef.current.capture();
    if (!snapshot) throw new StaleAccountRequestError();
    try {
      const result = await personalExamRuntime.hydrate(ownerId, snapshot);
      const restoredItems = personalExamRuntime.getSnapshot().exams;
      void personalCalendarReminderCoordinator.reconcile(ownerId, restoredItems).catch(() => {
        if (!accountGuardRef.current.isCurrent(snapshot)) return;
        setMessage({ text: "Kişisel takvim hatırlatmaları yenilenemedi.", tone: "error" });
      });
      if (result.legacyDiscarded) {
        setMessage({
          text: "Sahibi doğrulanamayan eski kişisel takvim kayıtları bu hesaba aktarılmadı.",
          tone: "info"
        });
      }
    } catch (error) {
      if (error instanceof StalePersonalExamOperationError) throw new StaleAccountRequestError();
      throw error;
    }
  }

  function personalExamMutationSnapshot(): AccountGenerationSnapshot | null {
    if (accountCleanupInProgressRef.current) return null;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    const personalExamState = personalExamRuntime.getSnapshot();
    if (!currentSession
      || !ownerSnapshot
      || !personalExamState.hydrated
      || personalExamState.ownerId !== currentSession.user.id
      || ownerSnapshot.ownerId !== currentSession.user.id) return null;
    return ownerSnapshot;
  }

  function createPersonalExam(input: PersonalExamMutationInput): PersonalExamMutationResult {
    const ownerSnapshot = personalExamMutationSnapshot();
    if (!ownerSnapshot) return { ok: false, error: "Hesaba ait kişisel takvim henüz hazır değil." };
    const result = personalExamRuntime.create(input, ownerSnapshot);
    if (!result.ok) return result;
    const created = personalExamRuntime.getSnapshot().exams.at(-1);
    if (created) syncPersonalCalendarReminder(ownerSnapshot, created);
    setMessage({ text: "Kişisel etkinlik takvimine eklendi.", tone: "success" });
    return result;
  }

  function updatePersonalExam(
    id: string,
    input: PersonalExamMutationInput
  ): PersonalExamMutationResult {
    const ownerSnapshot = personalExamMutationSnapshot();
    if (!ownerSnapshot) return { ok: false, error: "Hesaba ait kişisel takvim henüz hazır değil." };
    const result = personalExamRuntime.update(id, input, ownerSnapshot);
    if (!result.ok) return result;
    const updatedExam = personalExamRuntime.getSnapshot().exams.find((exam) => exam.id === id);
    if (updatedExam) syncPersonalCalendarReminder(ownerSnapshot, updatedExam);
    const updatedCalendarItem = updatedExam ? buildCalendarItems({
      academicEvents: [],
      personalExams: [updatedExam],
      academicSourceLabel: "Kişisel takvim"
    })[0] : undefined;
    setActiveCalendarDetail((current) => current?.source === "personal" && current.id === id
      && updatedCalendarItem ? updatedCalendarItem
      : current);
    setMessage({ text: "Kişisel etkinlik güncellendi.", tone: "success" });
    return result;
  }

  function deletePersonalExam(id: string): PersonalExamMutationResult {
    const ownerSnapshot = personalExamMutationSnapshot();
    if (!ownerSnapshot) return { ok: false, error: "Hesaba ait kişisel takvim henüz hazır değil." };
    const result = personalExamRuntime.delete(id, ownerSnapshot);
    if (!result.ok) return result;
    void personalCalendarReminderCoordinator.cancel(ownerSnapshot.ownerId, id);
    setActiveCalendarDetail(null);
    setMessage({ text: "Kişisel etkinlik silindi.", tone: "success" });
    requestAppRoute("Calendar");
    return result;
  }

  function syncPersonalCalendarReminder(
    ownerSnapshot: AccountGenerationSnapshot,
    item: Parameters<PersonalCalendarReminderCoordinator["sync"]>[1]
  ): void {
    void personalCalendarReminderCoordinator.sync(ownerSnapshot.ownerId, item).then((status) => {
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
      if (status === "permission_denied") {
        setMessage({ text: "Etkinlik kaydedildi; bildirim izni kapalı olduğu için hatırlatma kurulmadı.", tone: "info" });
      } else if (status === "past") {
        setMessage({ text: "Etkinlik kaydedildi; seçilen hatırlatma zamanı geçmişte kaldı.", tone: "info" });
      }
    }).catch(() => {
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) {
        setMessage({ text: "Etkinlik kaydedildi; hatırlatma kurulamadı.", tone: "error" });
      }
    });
  }

  return {
    restoreManualExams,
    personalExamMutationSnapshot,
    createPersonalExam,
    updatePersonalExam,
    deletePersonalExam,
    syncPersonalCalendarReminder
  };
}
