import { Linking } from "react-native";
import {
  normalizeTrustedApiContentCollection,
  canonicalizeOfficialAcademicUrl,
} from "../../content/content-trust";
import {
  resolveTrustedContentOpenTarget,
  trustedContentDestinationUrl,
} from "../../announcements/content-card";
import {
  settleContentFeedLoading,
  type ContentFeedItem,
  buildContentFeed,
} from "../../announcements/feed-model";
import {
  type AnnouncementRecord,
  type SavedAnnouncementApiStatus,
  type AnnouncementApiRecord,
} from "../app-types";
import { contentFeedDetailItem } from "../app-content";
import { StaleAccountRequestError } from "../app-errors";
import type { ApplicationState } from "../useApplicationState";
import type { ApplicationActions } from "../application-actions";
import type { ApplicationDerivedState } from "../useApplicationDerivedState";

type Dependencies = Pick<ApplicationState,
  "announcementDetailRequestGenerationRef" | "announcementSaveRequestGenerationRef"
  | "setAnnouncementDetailLoad" | "setAnnouncementSaveStatus" | "setActiveTrustedDetail"
  | "contentFeedAbortControllerRef" | "contentFeedRequestCoordinatorRef" | "setAnnouncements"
  | "setYokAnnouncements" | "setSummerSchool" | "setContentFeedPagination" | "requestAppRoute"
  | "setMessage" | "sessionRef" | "accountGuardRef" | "announcementSaveStatus"
> & Pick<ApplicationActions,
  "apiRequest" | "trackAuthenticatedMutation"
> & Pick<ApplicationDerivedState,
  "announcementFeed"
>;

export function createContentNavigationActions(
  dependencies: Dependencies,
): Pick<ApplicationActions,
  "invalidateAnnouncementDetailOwnership" | "invalidateContentFeedOwnership" | "openContentFeedItem"
  | "openTrustedContentRecord" | "loadAnnouncementSavedStatus" | "toggleAnnouncementSaved"
  | "loadProtectedAnnouncementDetail" | "openAnnouncement"
> {
  const {
    announcementDetailRequestGenerationRef,
    announcementSaveRequestGenerationRef,
    setAnnouncementDetailLoad,
    setAnnouncementSaveStatus,
    setActiveTrustedDetail,
    contentFeedAbortControllerRef,
    contentFeedRequestCoordinatorRef,
    setAnnouncements,
    setYokAnnouncements,
    setSummerSchool,
    setContentFeedPagination,
    requestAppRoute,
    setMessage,
    sessionRef,
    accountGuardRef,
    apiRequest,
    announcementSaveStatus,
    trackAuthenticatedMutation,
    announcementFeed
  } = dependencies;

  function invalidateAnnouncementDetailOwnership(): void {
    announcementDetailRequestGenerationRef.current += 1;
    announcementSaveRequestGenerationRef.current += 1;
    setAnnouncementDetailLoad(null);
    setAnnouncementSaveStatus(null);
    setActiveTrustedDetail((previous) => previous?.type === "announcement" ? null : previous);
  }

  function invalidateContentFeedOwnership(): void {
    contentFeedAbortControllerRef.current?.abort();
    contentFeedAbortControllerRef.current = null;
    contentFeedRequestCoordinatorRef.current.reset();
    setAnnouncements((previous) => settleContentFeedLoading(previous));
    setYokAnnouncements((previous) => settleContentFeedLoading(previous));
    setSummerSchool((previous) => settleContentFeedLoading(previous));
    setContentFeedPagination({ loading: false });
    invalidateAnnouncementDetailOwnership();
  }

  function openContentFeedItem(item: ContentFeedItem): void {
    announcementDetailRequestGenerationRef.current += 1;
    setAnnouncementDetailLoad(null);
    setActiveTrustedDetail({
      type: "announcement",
      id: item.record.id,
      title: item.record.title,
      item
    });
    loadAnnouncementSavedStatus(item.record.id);
    requestAppRoute("AnnouncementDetail", { announcementId: item.record.id });
  }

  function openTrustedContentRecord(
    record: AnnouncementRecord,
    origin: "academic" | "yok" | "summer-school",
  ): void {
    const target = resolveTrustedContentOpenTarget(record);
    if (target?.kind === "detail") {
      const detailItem = contentFeedDetailItem(record, origin);
      if (detailItem) {
        openContentFeedItem(detailItem);
        return;
      }
    }
    const officialUrl = target?.kind === "official_source"
      ? target.url
      : trustedContentDestinationUrl(record);
    if (officialUrl) {
      void openAnnouncement(officialUrl);
      return;
    }
    setMessage({ text: "Bu içeriğin güvenilir ayrıntısı veya resmî bağlantısı kullanılamıyor.", tone: "error" });
  }

  function loadAnnouncementSavedStatus(announcementId: string): void {
    const requestGeneration = ++announcementSaveRequestGenerationRef.current;
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    setAnnouncementSaveStatus({
      id: announcementId,
      saved: false,
      loading: true,
      mutating: false
    });
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId) {
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: false,
        loading: false,
        mutating: false,
        error: "Kaydetme durumu doğrulanamadı."
      });
      return;
    }

    void apiRequest<SavedAnnouncementApiStatus>(
      `/announcements/my/saved/${encodeURIComponent(announcementId)}`,
      {},
      currentSession.accessToken,
      { ownerSnapshot }
    ).then((payload) => {
      if (
        requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
        || payload.announcementId !== announcementId
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: payload.saved === true,
        loading: false,
        mutating: false
      });
    }).catch((error: unknown) => {
      if (
        error instanceof StaleAccountRequestError
        || requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: false,
        loading: false,
        mutating: false,
        error: "Kaydetme durumu şu anda yüklenemedi."
      });
    });
  }

  async function toggleAnnouncementSaved(announcementId: string): Promise<void> {
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    const current = announcementSaveStatus?.id === announcementId
      ? announcementSaveStatus
      : null;
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId || current?.mutating) return;
    const targetSaved = !current?.saved;
    const requestGeneration = ++announcementSaveRequestGenerationRef.current;
    setAnnouncementSaveStatus({
      id: announcementId,
      saved: current?.saved ?? false,
      loading: false,
      mutating: true
    });
    try {
      const payload = await trackAuthenticatedMutation(() => apiRequest<SavedAnnouncementApiStatus>(
        `/announcements/my/saved/${encodeURIComponent(announcementId)}`,
        { method: targetSaved ? "PUT" : "DELETE" },
        currentSession.accessToken,
        { ownerSnapshot }
      ));
      if (
        requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
        || payload.announcementId !== announcementId
        || payload.saved !== targetSaved
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: targetSaved,
        loading: false,
        mutating: false
      });
    } catch (error) {
      if (
        error instanceof StaleAccountRequestError
        || requestGeneration !== announcementSaveRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      setAnnouncementSaveStatus({
        id: announcementId,
        saved: current?.saved ?? false,
        loading: false,
        mutating: false,
        error: targetSaved
          ? "Duyuru kaydedilemedi. Lütfen tekrar dene."
          : "Duyuru kayıtlı içeriklerden çıkarılamadı. Lütfen tekrar dene."
      });
    }
  }

  function loadProtectedAnnouncementDetail(announcementId: string): void {
    loadAnnouncementSavedStatus(announcementId);
    const requestGeneration = ++announcementDetailRequestGenerationRef.current;
    const cachedItem = buildContentFeed({
      academic: announcementFeed,
      yok: [],
      summerSchool: []
    }).find((item) => item.record.id === announcementId);

    setActiveTrustedDetail((previous) => previous?.type === "announcement" ? null : previous);
    if (cachedItem) {
      setAnnouncementDetailLoad(null);
      setActiveTrustedDetail({
        type: "announcement",
        id: cachedItem.record.id,
        title: cachedItem.record.title,
        item: cachedItem
      });
      return;
    }

    setAnnouncementDetailLoad({ id: announcementId, loading: true });
    const currentSession = sessionRef.current;
    const ownerSnapshot = accountGuardRef.current.capture();
    if (!currentSession || !ownerSnapshot || currentSession.user.id !== ownerSnapshot.ownerId) {
      setAnnouncementDetailLoad({
        id: announcementId,
        loading: false,
        error: "Güvenilir içerik doğrulanamadı."
      });
      return;
    }

    void apiRequest<AnnouncementApiRecord>(
      `/announcements/my/trusted/${encodeURIComponent(announcementId)}`,
      {},
      currentSession.accessToken,
      { ownerSnapshot }
    ).then((payload) => {
      if (
        requestGeneration !== announcementDetailRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      const record = normalizeTrustedApiContentCollection([payload]).items
        .find((item) => item.id === announcementId);
      const detailItem = record ? contentFeedDetailItem(record, "academic") : null;
      if (!detailItem) {
        setAnnouncementDetailLoad({
          id: announcementId,
          loading: false,
          error: "Güvenilir içerik doğrulanamadı."
        });
        return;
      }
      setActiveTrustedDetail({
        type: "announcement",
        id: detailItem.record.id,
        title: detailItem.record.title,
        item: detailItem
      });
      setAnnouncementDetailLoad(null);
    }).catch((error: unknown) => {
      if (
        error instanceof StaleAccountRequestError
        || requestGeneration !== announcementDetailRequestGenerationRef.current
        || !accountGuardRef.current.isCurrent(ownerSnapshot)
      ) return;
      setAnnouncementDetailLoad({
        id: announcementId,
        loading: false,
        error: "Güvenilir içerik şu anda yüklenemedi."
      });
    });
  }

  async function openAnnouncement(link: string): Promise<boolean> {
    const safeLink = canonicalizeOfficialAcademicUrl(link);
    if (!safeLink) {
      setMessage({ text: "Yalnızca doğrulanmış HTTP veya HTTPS bağlantıları açılabilir.", tone: "error" });
      return false;
    }
    try {
      const supported = await Linking.canOpenURL(safeLink);
      if (!supported) {
        setMessage({ text: "Bu resmî bağlantı cihazda açılamıyor.", tone: "error" });
        return false;
      }
      await Linking.openURL(safeLink);
      return true;
    } catch {
      setMessage({ text: "Resmî bağlantı açılamadı. Lütfen tekrar dene.", tone: "error" });
      return false;
    }
  }

  return {
    invalidateAnnouncementDetailOwnership,
    invalidateContentFeedOwnership,
    openContentFeedItem,
    openTrustedContentRecord,
    loadAnnouncementSavedStatus,
    toggleAnnouncementSaved,
    loadProtectedAnnouncementDetail,
    openAnnouncement
  };
}
