import { describe, expect, it } from "vitest";
import {
  GoogleCalendarService,
  GoogleCalendarSyncError,
  buildGoogleCalendarSyncItems,
  type GoogleCalendarAnnouncement
} from "../../apps/mobile-native/src/google-calendar/google-calendar-sync";

describe("GoogleCalendarService", () => {
  it("maps only source-authored dates and excludes news, undated, and crawl-dated content", () => {
    const fetchedOnly = {
      id: "fetched-1",
      title: "Yayin tarihi olmayan duyuru",
      link: "https://example.edu.tr/duyuru/3",
      contentType: "announcement" as const,
      fetchedAt: "2026-08-23T09:00:00.000Z"
    } as GoogleCalendarAnnouncement & { fetchedAt: string };
    const items = buildGoogleCalendarSyncItems(
      [
        {
          id: "academic-1",
          title: "Ders kayitlari",
          category: "course_registration",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-09-03T00:00:00.000Z"
        }
      ],
      [
        {
          id: "announcement-1",
          title: "Kayit duyurusu",
          link: "https://example.edu.tr/duyuru/1",
          contentType: "announcement",
          publishedAt: "2026-08-20T09:00:00.000Z"
        },
        {
          id: "event-1",
          title: "Kariyer gunu",
          link: "https://example.edu.tr/etkinlik/1",
          contentType: "event",
          sourceUpdatedAt: "2026-08-21T09:00:00.000Z"
        },
        {
          id: "news-1",
          title: "Kampus haberi",
          link: "https://example.edu.tr/haber/1",
          contentType: "news",
          publishedAt: "2026-08-22T09:00:00.000Z"
        },
        {
          id: "undated-1",
          title: "Tarihsiz duyuru",
          link: "https://example.edu.tr/duyuru/2",
          contentType: "announcement"
        },
        fetchedOnly
      ]
    );

    expect(items.map((item) => item.sourceId)).toEqual([
      "announcement:announcement-1",
      "event:event-1",
      "academic-event:academic-1"
    ]);
    expect(items[1]?.description).toContain("kaynak güncelleme tarihi");
    expect(items[2]).toEqual(expect.objectContaining({
      startDate: "2026-09-01",
      endDate: "2026-09-04"
    }));
  });

  it("creates events once, returns durable mappings, and skips them on repeated sync", async () => {
    const api = new MemoryGoogleCalendarApi();
    const service = new GoogleCalendarService(api.fetch);
    const input = syncInput();

    const first = await service.sync(input);
    const second = await service.sync(input);

    expect(first).toEqual(expect.objectContaining({
      created: 2,
      updated: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
      total: 2,
      verified: 2,
      partial: false,
      failures: []
    }));
    expect(first.mappings).toHaveLength(2);
    expect(first.mappings.map((mapping) => mapping.sourceId)).toEqual([
      "academic-event:academic-1",
      "announcement:announcement-1"
    ]);
    expect(first.mappings.every((mapping) => Boolean(mapping.googleEventId && mapping.fingerprint))).toBe(true);
    expect(second).toEqual(expect.objectContaining({
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 2,
      failed: 0,
      total: 2,
      verified: 2,
      partial: false
    }));
    expect(second.mappings).toEqual(first.mappings);
    expect(api.events.size).toBe(2);
  });

  it("performs a paginated, non-mutating live authorization check", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.pageSize = 1;
    api.seedManagedEvent("owned-1", "app-user-1", "announcement:one", "fingerprint-1");
    api.seedManagedEvent("owned-2", "app-user-1", "academic-event:two", "fingerprint-2");
    api.seedManagedEvent("other-owner", "other-user", "announcement:other", "other");
    api.seedPersonalEvent("personal-1");
    const service = new GoogleCalendarService(api.fetch);

    const verification = await service.verifyAuthorization({
      accessToken: "google-access-token",
      ownerId: "app-user-1"
    });

    expect(verification).toEqual({
      authorized: true,
      managedEventCount: 2,
      mappings: [
        {
          sourceId: "academic-event:two",
          sourceType: "academic_event",
          googleEventId: "owned-2",
          fingerprint: "fingerprint-2"
        },
        {
          sourceId: "announcement:one",
          sourceType: "announcement",
          googleEventId: "owned-1",
          fingerprint: "fingerprint-1"
        }
      ]
    });
    expect(api.methods.every((method) => method === "GET")).toBe(true);
    expect(api.methods).toHaveLength(4);
  });

  it("classifies expired live authorization without retaining provider bodies or tokens", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.listFailure = {
      status: 401,
      body: { error: { message: "expired secret-provider-token" } }
    };
    const service = new GoogleCalendarService(api.fetch);

    const error = await service.verifyAuthorization({
      accessToken: "secret-access-token",
      ownerId: "app-user-1"
    }).catch((reason: unknown) => reason);

    expect(error).toEqual(expect.objectContaining<Partial<GoogleCalendarSyncError>>({
      code: "GOOGLE_CALENDAR_AUTH_EXPIRED",
      status: 401,
      message: "Google Calendar authorization has expired."
    }));
    expect(JSON.stringify(error)).not.toContain("secret-access-token");
    expect(String((error as Error).message)).not.toContain("secret-provider-token");
  });

  it("propagates the supplied abort signal to every listing, mutation, and verification request", async () => {
    const api = new MemoryGoogleCalendarApi();
    const controller = new AbortController();
    const observedSignals: Array<AbortSignal | null | undefined> = [];
    const service = new GoogleCalendarService(async (input, init) => {
      observedSignals.push(init?.signal);
      return api.fetch(input, init);
    });

    await service.sync({ ...syncInput(), signal: controller.signal });
    const changed = syncInput();
    changed.calendarEvents = [{ ...changed.calendarEvents[0]!, title: "Updated academic date" }];
    changed.announcements = [];
    await service.sync({ ...changed, signal: controller.signal });

    expect(observedSignals).toHaveLength(8);
    expect(observedSignals.every((signal) => signal === controller.signal)).toBe(true);
  });

  it("surfaces an aborted request without wrapping it as a Google Calendar network error", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error("Calendar sync aborted."), { name: "AbortError" });
    let observedSignal: AbortSignal | null | undefined;
    const service = new GoogleCalendarService(async (_input, init) => {
      observedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(abortError);
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(abortError), { once: true });
      });
    });

    const pendingSync = service.sync({ ...syncInput(), signal: controller.signal });
    controller.abort();
    const rejection = await pendingSync.catch((error: unknown) => error);

    expect(observedSignal).toBe(controller.signal);
    expect(rejection).toBe(abortError);
    expect(rejection).not.toBeInstanceOf(GoogleCalendarSyncError);
  });

  it("updates changed events and removes only stale records tagged for the matching owner", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("other-user-event", "other-user", "announcement:foreign", "foreign");
    api.seedPersonalEvent("personal-event");
    const service = new GoogleCalendarService(api.fetch);
    await service.sync(syncInput());

    const changed = syncInput();
    changed.calendarEvents = [{ ...changed.calendarEvents[0]!, title: "Updated academic date" }];
    changed.announcements = [];
    const result = await service.sync(changed);

    expect(result).toEqual(expect.objectContaining({ updated: 1, deleted: 1, verified: 1, partial: false }));
    expect(api.events.has("other-user-event")).toBe(true);
    expect(api.events.has("personal-event")).toBe(true);
    expect([...api.events.values()].some((event) => event.summary === "Updated academic date")).toBe(true);
  });

  it("separates safe create/update work from deletion eligibility for partial sources", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("old-announcement", "app-user-1", "announcement:old", "old");
    api.seedManagedEvent("old-academic", "app-user-1", "academic-event:old", "old");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.sync({
      accessToken: "google-access-token",
      ownerId: "app-user-1",
      calendarEvents: [],
      announcements: syncInput().announcements,
      deletionEligibleSourceTypes: ["academic_event"]
    });

    expect(result).toEqual(expect.objectContaining({ created: 1, deleted: 1, verified: 1, partial: false }));
    expect(api.events.has("old-academic")).toBe(false);
    expect(api.events.has("old-announcement")).toBe(true);
  });

  it("removes all managed items when the last complete trusted source items disappear", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("old-announcement", "app-user-1", "announcement:old", "old");
    api.seedManagedEvent("old-academic", "app-user-1", "academic-event:old", "old");
    api.seedPersonalEvent("personal-event");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.sync({
      accessToken: "google-access-token",
      ownerId: "app-user-1",
      calendarEvents: [],
      announcements: [],
      deletionEligibleSourceTypes: ["academic_event", "announcement", "event"]
    });

    expect(result).toEqual(expect.objectContaining({ total: 0, deleted: 2, verified: 0, partial: false }));
    expect(result.mappings).toHaveLength(0);
    expect(api.events.has("personal-event")).toBe(true);
  });

  it("collapses duplicate app-owned mappings even when that source family is partial", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("duplicate-a", "app-user-1", "announcement:announcement-1", "old-a");
    api.seedManagedEvent("duplicate-b", "app-user-1", "announcement:announcement-1", "old-b");
    api.seedManagedEvent("unseen-partial-item", "app-user-1", "announcement:unseen", "old");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.sync({
      ...syncInput(),
      calendarEvents: [],
      deletionEligibleSourceTypes: ["academic_event"]
    });

    expect(result).toEqual(expect.objectContaining({ updated: 1, deleted: 1, verified: 1, partial: false }));
    expect(result.mappings.filter((mapping) => mapping.sourceId === "announcement:announcement-1")).toHaveLength(1);
    expect(api.events.has("unseen-partial-item")).toBe(true);
  });

  it("reconciles duplicate managed mappings while retaining a single updated event", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("duplicate-a", "app-user-1", "academic-event:academic-1", "old-a");
    api.seedManagedEvent("duplicate-b", "app-user-1", "academic-event:academic-1", "old-b");
    const service = new GoogleCalendarService(api.fetch);
    const input = syncInput();
    input.announcements = [];

    const result = await service.sync(input);

    expect(result).toEqual(expect.objectContaining({ updated: 1, deleted: 1, verified: 1, partial: false }));
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]).toEqual(expect.objectContaining({
      sourceId: "academic-event:academic-1",
      googleEventId: "duplicate-a"
    }));
  });

  it("returns controlled partial mutation outcomes and never includes credentials", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.failCreateSourceIds.add("announcement:announcement-1");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.sync({ ...syncInput(), accessToken: "secret-access-token" });

    expect(result).toEqual(expect.objectContaining({
      created: 1,
      failed: 1,
      verified: 1,
      partial: true
    }));
    expect(result.failures).toEqual([{
      operation: "create",
      code: "GOOGLE_CALENDAR_REQUEST_FAILED",
      sourceId: "announcement:announcement-1",
      status: 500
    }]);
    expect(JSON.stringify(result)).not.toContain("secret-access-token");
    expect(JSON.stringify(result)).not.toContain("secret-provider-payload");
  });

  it("removes and verifies only managed events belonging to the requested app owner", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("owned-1", "app-user-1", "announcement:one", "one");
    api.seedManagedEvent("owned-2", "app-user-1", "academic-event:two", "two");
    api.seedManagedEvent("other-owner", "app-user-2", "announcement:other", "other");
    api.seedPersonalEvent("personal");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.removeManagedEvents({
      accessToken: "google-access-token",
      ownerId: "app-user-1"
    });

    expect(result).toEqual({
      deleted: 2,
      failed: 0,
      remaining: 0,
      partial: false,
      failures: [],
      mappings: []
    });
    expect([...api.events.keys()].sort()).toEqual(["other-owner", "personal"]);
  });

  it("reports a partial disconnect removal without clearing the failed mapping", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("owned-1", "app-user-1", "announcement:one", "one");
    api.seedManagedEvent("owned-2", "app-user-1", "academic-event:two", "two");
    api.failDeleteEventIds.add("owned-2");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.removeManagedEvents({
      accessToken: "google-access-token",
      ownerId: "app-user-1"
    });

    expect(result).toEqual(expect.objectContaining({
      deleted: 1,
      failed: 1,
      remaining: 1,
      partial: true
    }));
    expect(result.mappings).toEqual([{
      sourceId: "academic-event:two",
      sourceType: "academic_event",
      googleEventId: "owned-2",
      fingerprint: "two"
    }]);
  });

  it("classifies a disabled Calendar API without exposing it as a network failure", async () => {
    const service = new GoogleCalendarService(async () =>
      jsonResponse({
        error: {
          message: "Google Calendar API has not been used in project before or it is disabled.",
          errors: [{ reason: "accessNotConfigured" }]
        }
      }, 403)
    );

    await expect(service.sync(syncInput())).rejects.toEqual(expect.objectContaining<Partial<GoogleCalendarSyncError>>({
      code: "GOOGLE_CALENDAR_API_UNAVAILABLE",
      status: 403
    }));
  });
});

function syncInput() {
  return {
    accessToken: "google-access-token",
    ownerId: "app-user-1",
    calendarEvents: [
      {
        id: "academic-1",
        title: "Academic date",
        category: "course_registration",
        startDate: "2026-09-01T00:00:00.000Z"
      }
    ],
    announcements: [
      {
        id: "announcement-1",
        title: "Announcement",
        link: "https://example.edu.tr/announcement/1",
        contentType: "announcement" as const,
        publishedAt: "2026-08-20T09:00:00.000Z"
      }
    ]
  };
}

type StoredGoogleEvent = {
  id: string;
  summary?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

class MemoryGoogleCalendarApi {
  events = new Map<string, StoredGoogleEvent>();
  methods: string[] = [];
  pageSize?: number;
  listFailure?: { status: number; body: unknown };
  failCreateSourceIds = new Set<string>();
  failDeleteEventIds = new Set<string>();
  private sequence = 0;

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    this.methods.push(method);
    const eventMatch = url.pathname.match(/\/calendars\/primary\/events\/([^/]+)$/u);

    if (method === "GET" && url.pathname.endsWith("/calendars/primary/events")) {
      if (this.listFailure) return jsonResponse(this.listFailure.body, this.listFailure.status);
      const events = [...this.events.values()];
      const offset = Number(url.searchParams.get("pageToken") ?? "0");
      const pageSize = this.pageSize ?? Math.max(events.length, 1);
      const nextOffset = offset + pageSize;
      return jsonResponse({
        items: events.slice(offset, nextOffset),
        ...(nextOffset < events.length ? { nextPageToken: String(nextOffset) } : {})
      });
    }
    if (method === "POST" && url.pathname.endsWith("/calendars/primary/events")) {
      const body = readBody(init);
      const sourceId = body.extendedProperties?.private?.amaSourceId;
      if (sourceId && this.failCreateSourceIds.has(sourceId)) {
        return jsonResponse({ error: { message: "secret-provider-payload" } }, 500);
      }
      this.sequence += 1;
      const id = `google-${this.sequence}`;
      this.events.set(id, { id, ...body });
      return jsonResponse(this.events.get(id), 200);
    }
    if (method === "PATCH" && eventMatch) {
      const id = decodeURIComponent(eventMatch[1]!);
      const existing = this.events.get(id);
      if (!existing) return jsonResponse({ error: { message: "Not found" } }, 404);
      this.events.set(id, { id, ...readBody(init) });
      return jsonResponse(this.events.get(id), 200);
    }
    if (method === "DELETE" && eventMatch) {
      const id = decodeURIComponent(eventMatch[1]!);
      if (this.failDeleteEventIds.has(id)) {
        return jsonResponse({ error: { message: "Delete unavailable" } }, 500);
      }
      this.events.delete(id);
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: { message: "Unexpected test request" } }, 500);
  };

  seedManagedEvent(id: string, ownerId: string, sourceId: string, fingerprint: string): void {
    this.events.set(id, {
      id,
      summary: "Managed event",
      extendedProperties: {
        private: {
          amaManaged: "1",
          amaOwnerId: ownerId,
          amaSourceId: sourceId,
          amaSourceType: sourceId.startsWith("academic-event:")
            ? "academic_event"
            : sourceId.startsWith("event:") ? "event" : "announcement",
          amaFingerprint: fingerprint
        }
      }
    });
  }

  seedPersonalEvent(id: string): void {
    this.events.set(id, { id, summary: "Personal event" });
  }
}

function readBody(init: RequestInit): Omit<StoredGoogleEvent, "id"> {
  return JSON.parse(String(init.body ?? "{}")) as Omit<StoredGoogleEvent, "id">;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
