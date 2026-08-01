import { describe, expect, it } from "vitest";
import {
  HOME_RECENT_ANNOUNCEMENT_LIMIT,
  formatRemainingTime,
  homeAvailability,
  isSameLocalCalendarDay,
  orderHomeAnnouncements,
  resolveActionableIntegration,
  resolveHomeLayout,
  resolveHomePrimaryState,
  selectNearestImportantItem,
  selectRecentAnnouncements,
  selectTodayItems,
} from "../../apps/mobile-native/src/home/home-model";
import type { TrustedMobileContentRecord } from "../../apps/mobile-native/src/content/content-trust";

const now = new Date(2026, 7, 1, 10, 0, 0);

function announcement(id: string, publishedAt?: string, sourceUpdatedAt?: string): TrustedMobileContentRecord {
  return {
    id,
    sourceId: `source-${id}`,
    sourceName: "Öğrenci İşleri",
    scopeType: "university",
    scopeId: "university-1",
    title: `${id} akademik duyurusu`,
    link: `https://uni.edu.tr/${id}`,
    canonicalUrl: `https://uni.edu.tr/${id}`,
    trustStatus: "trusted",
    ...(publishedAt ? { publishedAt } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
  };
}

describe("Phase 7 Home daily-brief contracts", () => {
  it("uses the device local calendar day instead of UTC date slicing", () => {
    const localToday = new Date(2026, 7, 1, 0, 30).toISOString();
    const localTomorrow = new Date(2026, 7, 2, 0, 0).toISOString();
    expect(isSameLocalCalendarDay(localToday, now)).toBe(true);
    expect(isSameLocalCalendarDay(localTomorrow, now)).toBe(false);
    expect(selectTodayItems([
      { id: "today", title: "Bugünkü kayıt", category: "course_registration", startDate: localToday },
      { id: "tomorrow", title: "Yarınki kayıt", category: "event", startDate: localTomorrow },
    ], [{ id: "exam", title: "Kişisel sınav", examDate: new Date(2026, 7, 1, 15).toISOString() }], now).map((item) => item.id)).toEqual(["today", "exam"]);
  });

  it("selects the nearest future exam, deadline, registration period, or event", () => {
    const selected = selectNearestImportantItem([
      { id: "past", title: "Geçmiş", category: "final_exam", startDate: new Date(2026, 6, 1).toISOString() },
      { id: "later", title: "Daha sonra", category: "course_registration", startDate: new Date(2026, 7, 3).toISOString() },
      { id: "nearest", title: "En yakın", category: "application_deadline", startDate: new Date(2026, 7, 1, 12).toISOString() },
    ], [], now);
    expect(selected).toMatchObject({ id: "nearest", kind: "deadline" });
    expect(formatRemainingTime(selected!.date, now)).toBe("2 saat kaldı");
  });

  it("orders announcements by publication/update time and caps recent items", () => {
    const items = [
      announcement("old", "2026-07-01T08:00:00.000Z"),
      announcement("updated", undefined, "2026-08-01T09:00:00.000Z"),
      announcement("new", "2026-08-01T10:00:00.000Z"),
      announcement("four", "2026-06-01T10:00:00.000Z"),
      announcement("five", "2026-05-01T10:00:00.000Z"),
    ];
    expect(orderHomeAnnouncements(items).map((item) => item.id)).toEqual(["new", "updated", "old", "four", "five"]);
    expect(selectRecentAnnouncements(items, "new")).toHaveLength(HOME_RECENT_ANNOUNCEMENT_LIMIT);
  });

  it("keeps loading, empty, populated, error, and incomplete-profile states exclusive", () => {
    expect(resolveHomePrimaryState({ profileComplete: false, loading: true, attempted: false, hasData: false })).toBe("incomplete_profile");
    expect(resolveHomePrimaryState({ profileComplete: true, loading: true, attempted: false, hasData: false })).toBe("initial_loading");
    expect(resolveHomePrimaryState({ profileComplete: true, loading: true, attempted: true, hasData: true, error: "failed" })).toBe("populated");
    expect(resolveHomePrimaryState({ profileComplete: true, loading: false, attempted: true, hasData: false })).toBe("empty");
    expect(resolveHomePrimaryState({ profileComplete: true, loading: false, attempted: true, hasData: false, error: "failed" })).toBe("recoverable_error");
  });

  it("preserves retained data as refreshing or stale after refresh failure", () => {
    expect(homeAvailability({ loading: true, hasRetainedData: true })).toBe("refreshing");
    expect(homeAvailability({ loading: false, hasRetainedData: true, error: "offline" })).toBe("stale");
    expect(homeAvailability({ loading: false, hasRetainedData: true, contentState: "partial" })).toBe("partial");
    expect(homeAvailability({ loading: false, hasRetainedData: true, offline: true })).toBe("offline");
  });

  it("shows only integration states that are actionable and profile-backed", () => {
    expect(resolveActionableIntegration({ profileComplete: false, googleCalendarState: "disconnected", notificationPermission: "denied", notificationPreferenceEnabled: true, notificationActive: false })).toBeNull();
    expect(resolveActionableIntegration({ profileComplete: true, googleCalendarState: "connected", notificationPermission: "permanently_denied", notificationPreferenceEnabled: true, notificationActive: false })).toBe("notifications");
    expect(resolveActionableIntegration({ profileComplete: true, googleCalendarState: "disconnected", notificationPermission: "granted", notificationPreferenceEnabled: true, notificationActive: true })).toBe("google_calendar");
    expect(resolveActionableIntegration({ profileComplete: true, googleCalendarState: "connected", notificationPermission: "granted", notificationPreferenceEnabled: true, notificationActive: true })).toBeNull();
  });

  it("keeps a single-column readable contract at 320 dp and 200% font scale", () => {
    expect(resolveHomeLayout(320, 2)).toEqual({ gutter: 16, maxWidth: 720, columns: 1, supportsLargeText: true });
    expect(resolveHomeLayout(390, 1)).toMatchObject({ gutter: 20, columns: 1, supportsLargeText: false });
  });
});
