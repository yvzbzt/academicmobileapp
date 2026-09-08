import { useRef } from "react";
import { PersonalExamRuntime } from "../calendar/personal-exam-runtime";
import { PersonalCalendarReminderCoordinator } from "../calendar/personal-calendar-reminders";
import { getStoredValue, setStoredValue, deleteStoredValue, createLocalId } from "./app-storage";
import type { ApplicationActions } from "./application-actions";
import type { ApplicationState } from "./useApplicationState";

type Dependencies = Pick<ApplicationActions,
  "enqueueStorageMutation"
> & Pick<ApplicationState,
  "accountGuardRef" | "setManualExamState" | "setCleanupIssue" | "setMessage"
>;

export function usePersonalCalendarRuntime(dependencies: Dependencies) {
  const {
    enqueueStorageMutation,
    accountGuardRef,
    setManualExamState,
    setCleanupIssue,
    setMessage
  } = dependencies;

  const personalExamRuntimeRef = useRef<PersonalExamRuntime | null>(null);

  if (!personalExamRuntimeRef.current) {
    personalExamRuntimeRef.current = new PersonalExamRuntime({
      storage: {
        getItemAsync: getStoredValue,
        setItemAsync: (key, value) => enqueueStorageMutation(() => setStoredValue(key, value)),
        deleteItemAsync: (key) => enqueueStorageMutation(() => deleteStoredValue(key))
      },
      ownerGuard: accountGuardRef.current,
      createId: () => createLocalId("manual-exam"),
      onStateChange: setManualExamState,
      onPersistenceError: (ownerId) => {
        const snapshot = accountGuardRef.current.capture();
        if (!snapshot || snapshot.ownerId !== ownerId) return;
        setCleanupIssue({
          action: "manual_exam_save",
          failedTargets: ["manual_exam_storage"],
          ownerId
        });
        setMessage({ text: "Kişisel takvim cihazda saklanamadı. Lütfen tekrar dene.", tone: "error" });
      }
    });
  }

  const personalExamRuntime = personalExamRuntimeRef.current;

  const personalCalendarReminderCoordinatorRef = useRef<PersonalCalendarReminderCoordinator | null>(null);

  if (!personalCalendarReminderCoordinatorRef.current) {
    personalCalendarReminderCoordinatorRef.current = new PersonalCalendarReminderCoordinator({
      getItemAsync: getStoredValue,
      setItemAsync: (key, value) => enqueueStorageMutation(() => setStoredValue(key, value)),
      deleteItemAsync: (key) => enqueueStorageMutation(() => deleteStoredValue(key)),
    });
  }

  const personalCalendarReminderCoordinator = personalCalendarReminderCoordinatorRef.current;

  return {
    personalExamRuntimeRef,
    personalExamRuntime,
    personalCalendarReminderCoordinatorRef,
    personalCalendarReminderCoordinator
  };
}

export type PersonalCalendarRuntime = ReturnType<typeof usePersonalCalendarRuntime>;
