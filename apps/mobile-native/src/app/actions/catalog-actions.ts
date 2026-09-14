import { normalizeAccountAuthProvider } from "../../auth/recent-authentication";
import { type AcademicOnboardingDraft } from "../../auth/auth-ui";
import { commitAcademicProfileDraft } from "../../profile/profile-model";
import { type FollowedUniversityRecord } from "../../profile/FollowedUniversitiesSettings";
import { deleteDeviceContentCache } from "../../content/device-content-cache";
import {
  type UniversityRecord,
  type FacultyRecord,
  type DepartmentRecord,
  type UserProfile,
} from "../app-types";
import { StaleAccountRequestError, userMessageFromError, ApiRequestError } from "../app-errors";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "accountGuardRef" | "setUniversities" | "setFaculties" | "setDepartments" | "setMessage"
  | "academicSelectionPendingRef" | "accountCleanupInProgressRef" | "setAcademicSelectionPending"
  | "setSelectedUniversityId" | "setRegisterUniversityId" | "setRegisterFacultyId"
  | "setRegisterDepartmentId" | "setRegisterClassLevel" | "setFacultySearch" | "setDepartmentSearch"
  | "setRegisterPicker" | "setAcademicProfileExpanded" | "setSummerSchool" | "registerUniversityId"
  | "registerFacultyId" | "setFollowedUniversities" | "sessionRef" | "followedUniversityBusyId"
  | "followedUniversities" | "setFollowedUniversityBusyId" | "setAcademicProfileSaveState"
  | "setAcademicProfileSaveError" | "onboardingInitialDraft" | "setOnboardingInitialDraft"
  | "setFullName" | "setEmail" | "setAccountAuthProvider"
> & Pick<ApplicationActions,
  "withLoadable" | "apiRequest" | "trackAuthenticatedMutation" | "invalidateContentFeedOwnership"
  | "loadMyCalendar" | "loadCourseSchedule" | "loadUpcoming" | "loadPreferences"
  | "refreshContentFeed"
> & Pick<ApplicationDerivedState,
  "accessToken" | "academicOnboardingDraft"
>;

export function createCatalogActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "loadUniversities" | "loadFacultiesForRegistration" | "loadDepartmentsForRegistration"
  | "selectUniversity" | "selectFaculty" | "selectDepartment" | "loadFollowedUniversities"
  | "toggleFollowedUniversity" | "updateOnboardingDraft" | "discardAcademicProfileChanges"
  | "saveAcademicProfileSettings"
> {
  const {
    accountGuardRef,
    withLoadable,
    setUniversities,
    apiRequest,
    setFaculties,
    setDepartments,
    accessToken,
    setMessage,
    academicSelectionPendingRef,
    accountCleanupInProgressRef,
    setAcademicSelectionPending,
    trackAuthenticatedMutation,
    setSelectedUniversityId,
    setRegisterUniversityId,
    setRegisterFacultyId,
    setRegisterDepartmentId,
    setRegisterClassLevel,
    setFacultySearch,
    setDepartmentSearch,
    setRegisterPicker,
    setAcademicProfileExpanded,
    setSummerSchool,
    invalidateContentFeedOwnership,
    loadMyCalendar,
    loadCourseSchedule,
    loadUpcoming,
    loadPreferences,
    registerUniversityId,
    registerFacultyId,
    setFollowedUniversities,
    sessionRef,
    followedUniversityBusyId,
    followedUniversities,
    setFollowedUniversityBusyId,
    refreshContentFeed,
    setAcademicProfileSaveState,
    setAcademicProfileSaveError,
    onboardingInitialDraft,
    academicOnboardingDraft,
    setOnboardingInitialDraft,
    setFullName,
    setEmail,
    setAccountAuthProvider
  } = dependencies;

  async function resetOwnedAcademicContent(ownerId: string): Promise<void> {
    invalidateContentFeedOwnership();
    await trackAuthenticatedMutation(() => deleteDeviceContentCache(ownerId)).catch(() => undefined);
    void refreshContentFeed();
  }

  async function loadUniversities(): Promise<void> {
    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(setUniversities, () =>
      apiRequest<UniversityRecord[]>("/universities?limit=500&offset=0", {}, undefined, { ownerSnapshot })
      , ownerSnapshot);
  }

  async function loadFacultiesForRegistration(universityId: string): Promise<void> {
    if (!universityId) {
      setFaculties({ loading: false, data: [] });
      return;
    }

    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(setFaculties, () =>
      apiRequest<FacultyRecord[]>(`/universities/${universityId}/faculties`, {}, undefined, { ownerSnapshot })
      , ownerSnapshot);
  }

  async function loadDepartmentsForRegistration(facultyId: string): Promise<void> {
    if (!facultyId) {
      setDepartments({ loading: false, data: [] });
      return;
    }

    const ownerSnapshot = accountGuardRef.current.capture();
    await withLoadable(setDepartments, () =>
      apiRequest<DepartmentRecord[]>(`/faculties/${facultyId}/departments`, {}, undefined, { ownerSnapshot })
      , ownerSnapshot);
  }

  async function selectUniversity(universityId: string): Promise<void> {
    if (!accessToken) {
      setMessage({ text: "Üniversite bağlamak için önce giriş yapmalısın.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current || accountCleanupInProgressRef.current) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) return;

    try {
      academicSelectionPendingRef.current = "university";
      setAcademicSelectionPending("university");
      await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({ universityId })
        },
        accessToken,
        { ownerSnapshot }
      ));
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      setSelectedUniversityId(universityId);
      setRegisterUniversityId(universityId);
      setRegisterFacultyId("");
      setRegisterDepartmentId("");
      setRegisterClassLevel(null);
      setFacultySearch("");
      setDepartmentSearch("");
      setRegisterPicker("faculty");
      setAcademicProfileExpanded(true);
      setDepartments({ loading: false, data: [] });
      setSummerSchool({ loading: false });
      await resetOwnedAcademicContent(ownerSnapshot.ownerId);
      setMessage({ text: "Üniversite güncellendi.", tone: "success" });

      void Promise.allSettled([
        loadMyCalendar(accessToken),
        loadCourseSchedule(accessToken),
        loadUpcoming(accessToken),
        loadPreferences(accessToken)
      ]);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Üniversite seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function selectFaculty(facultyId: string): Promise<void> {
    if (!accessToken || !registerUniversityId) {
      setMessage({ text: "Fakülte seçmek için önce üniversite seçmelisin.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current || accountCleanupInProgressRef.current) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) return;

    try {
      academicSelectionPendingRef.current = "faculty";
      setAcademicSelectionPending("faculty");
      await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({ universityId: registerUniversityId, facultyId })
        },
        accessToken,
        { ownerSnapshot }
      ));
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      setRegisterFacultyId(facultyId);
      setRegisterDepartmentId("");
      setRegisterClassLevel(null);
      setDepartmentSearch("");
      setRegisterPicker("department");
      setAcademicProfileExpanded(true);
      setSummerSchool({ loading: false });
      await resetOwnedAcademicContent(ownerSnapshot.ownerId);
      setMessage({ text: "Fakülte güncellendi.", tone: "success" });

    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Fakülte seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function selectDepartment(departmentId: string): Promise<void> {
    if (!accessToken || !registerUniversityId || !registerFacultyId) {
      setMessage({ text: "Bölüm seçmek için önce üniversite ve fakülte seçmelisin.", tone: "error" });
      return;
    }
    if (academicSelectionPendingRef.current || accountCleanupInProgressRef.current) return;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!ownerSnapshot) return;

    try {
      academicSelectionPendingRef.current = "department";
      setAcademicSelectionPending("department");
      await trackAuthenticatedMutation(() => apiRequest<UserProfile>(
        "/me/university",
        {
          method: "PATCH",
          body: JSON.stringify({
            universityId: registerUniversityId,
            facultyId: registerFacultyId,
            departmentId
          })
        },
        accessToken,
        { ownerSnapshot }
      ));
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      setRegisterDepartmentId(departmentId);
      setRegisterClassLevel(null);
      setRegisterPicker("none");
      setSummerSchool({ loading: false });
      await resetOwnedAcademicContent(ownerSnapshot.ownerId);
      setMessage({ text: "Bölüm güncellendi.", tone: "success" });

    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setMessage({
        text: userMessageFromError(error, "Bölüm seçimi güncellenemedi"),
        tone: "error"
      });
    } finally {
      academicSelectionPendingRef.current = null;
      setAcademicSelectionPending(null);
    }
  }

  async function loadFollowedUniversities(
    tokenOverride?: string,
    ownerSnapshot = accountGuardRef.current.capture(),
    preserveDataOnRefresh = tokenOverride === undefined
  ): Promise<void> {
    const token = tokenOverride ?? accessToken;
    if (!token) return;

    await withLoadable(
      setFollowedUniversities,
      () => apiRequest<FollowedUniversityRecord[]>("/me/follows", {}, token, { ownerSnapshot }),
      ownerSnapshot,
      preserveDataOnRefresh
    );
  }

  async function toggleFollowedUniversity(universityId: string, shouldFollow: boolean): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || followedUniversityBusyId) return;

    const existingUniversityLevelFollows = (followedUniversities.data ?? []).filter(
      (scope) => scope.universityId === universityId && !scope.facultyId && !scope.departmentId
    );
    if (shouldFollow === (existingUniversityLevelFollows.length > 0)) return;

    setFollowedUniversityBusyId(universityId);
    try {
      if (shouldFollow) {
        const created = await trackAuthenticatedMutation(() => apiRequest<FollowedUniversityRecord>(
          "/me/follows",
          { method: "POST", body: JSON.stringify({ universityId }) },
          currentSession.accessToken,
          { ownerSnapshot }
        ));
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
        setFollowedUniversities((previous) => ({
          loading: false,
          attempted: true,
          stale: false,
          data: [...(previous.data ?? []).filter((scope) => scope.id !== created.id), created]
        }));
      } else if (existingUniversityLevelFollows.length > 0) {
        const followIds = [...new Set(existingUniversityLevelFollows.map((scope) => scope.id))];
        await trackAuthenticatedMutation(() => Promise.all(followIds.map(async (followId) => {
          try {
            return await apiRequest<{ id: string; removed: true }>(
              `/me/follows/${encodeURIComponent(followId)}`,
              { method: "DELETE" },
              currentSession.accessToken,
              { ownerSnapshot }
            );
          } catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
              return { id: followId, removed: true as const };
            }
            throw error;
          }
        })));
        if (!accountGuardRef.current.isCurrent(ownerSnapshot)) return;
        setFollowedUniversities((previous) => ({
          loading: false,
          attempted: true,
          stale: false,
          data: (previous.data ?? []).filter((scope) => !(
            scope.universityId === universityId && !scope.facultyId && !scope.departmentId
          ))
        }));
      }

      await resetOwnedAcademicContent(ownerSnapshot.ownerId);
      setMessage({
        text: shouldFollow ? "Üniversite takibe eklendi." : "Üniversite takibi kaldırıldı.",
        tone: "success"
      });
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      setFollowedUniversities((previous) => ({
        ...previous,
        loading: false,
        attempted: true,
        stale: previous.data !== undefined,
        error: userMessageFromError(error, "Üniversite takibi güncellenemedi.")
      }));
    } finally {
      if (accountGuardRef.current.isCurrent(ownerSnapshot)) setFollowedUniversityBusyId(undefined);
    }
  }

  function updateOnboardingDraft(nextDraft: AcademicOnboardingDraft): void {
    setRegisterUniversityId(nextDraft.universityId);
    setRegisterFacultyId(nextDraft.facultyId);
    setRegisterDepartmentId(nextDraft.departmentId);
    setRegisterClassLevel(nextDraft.classLevel);
    setAcademicProfileSaveState("idle");
    setAcademicProfileSaveError(undefined);
    setMessage(null);
  }

  function discardAcademicProfileChanges(): void {
    setRegisterUniversityId(onboardingInitialDraft.universityId);
    setRegisterFacultyId(onboardingInitialDraft.facultyId);
    setRegisterDepartmentId(onboardingInitialDraft.departmentId);
    setRegisterClassLevel(onboardingInitialDraft.classLevel);
    setAcademicProfileSaveState("idle");
    setAcademicProfileSaveError(undefined);
    setMessage(null);
  }

  async function saveAcademicProfileSettings(): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || accountCleanupInProgressRef.current) return;

    setAcademicProfileSaveState("saving");
    setAcademicProfileSaveError(undefined);
    setMessage(null);
    try {
      const result = await commitAcademicProfileDraft(
        academicOnboardingDraft,
        (payload) => trackAuthenticatedMutation(() => apiRequest<UserProfile>(
          "/me/university",
          { method: "PATCH", body: JSON.stringify(payload) },
          currentSession.accessToken,
          { ownerSnapshot }
        ))
      );
      if (!result.ok) {
        setAcademicProfileSaveState("error");
        setAcademicProfileSaveError("Üniversite seçimi zorunludur.");
        return;
      }
      if (!accountGuardRef.current.isCurrent(ownerSnapshot)) throw new StaleAccountRequestError();

      const authoritativeDraft = result.draft;
      setSelectedUniversityId(authoritativeDraft.universityId);
      setRegisterUniversityId(authoritativeDraft.universityId);
      setRegisterFacultyId(authoritativeDraft.facultyId);
      setRegisterDepartmentId(authoritativeDraft.departmentId);
      setRegisterClassLevel(authoritativeDraft.classLevel);
      setOnboardingInitialDraft(authoritativeDraft);
      setFullName(result.profile.fullName);
      setEmail(result.profile.email);
      setAccountAuthProvider(normalizeAccountAuthProvider(result.profile.authProvider));
      setAcademicProfileSaveState("saved");
      setAcademicProfileSaveError(undefined);
      setSummerSchool({ loading: false });
      await resetOwnedAcademicContent(ownerSnapshot.ownerId);
      setMessage({ text: "Akademik profil kaydedildi.", tone: "success" });
      void Promise.allSettled([
        loadMyCalendar(currentSession.accessToken, ownerSnapshot),
        loadCourseSchedule(currentSession.accessToken, ownerSnapshot),
        loadUpcoming(currentSession.accessToken, ownerSnapshot),
        loadPreferences(currentSession.accessToken, ownerSnapshot)
      ]);
    } catch (error) {
      if (error instanceof StaleAccountRequestError) return;
      const controlledError = userMessageFromError(
        error,
        "Akademik profil kaydedilemedi. Bilgilerini kontrol edip tekrar dene."
      );
      setAcademicProfileSaveState("error");
      setAcademicProfileSaveError(controlledError);
      setMessage({ text: controlledError, tone: "error" });
    }
  }

  return {
    loadUniversities,
    loadFacultiesForRegistration,
    loadDepartmentsForRegistration,
    selectUniversity,
    selectFaculty,
    selectDepartment,
    loadFollowedUniversities,
    toggleFollowedUniversity,
    updateOnboardingDraft,
    discardAcademicProfileChanges,
    saveAcademicProfileSettings
  };
}
