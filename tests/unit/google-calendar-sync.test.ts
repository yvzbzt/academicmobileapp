import { describe, expect, it } from "vitest";
import {
  GoogleCalendarService,
  GoogleCalendarSyncError,
  buildGoogleCalendarSyncItems
} from "../../apps/mobile-native/src/google-calendar/google-calendar-sync";

describe("GoogleCalendarService", () => {
  it("maps academic dates, announcements, and events while excluding news", () => {
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
          publishedAt: "2026-08-21T09:00:00.000Z"
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
        {
          id: "fetched-1",
          title: "Yayin tarihi olmayan duyuru",
          link: "https://example.edu.tr/duyuru/3",
          contentType: "announcement",
          fetchedAt: "2026-08-23T09:00:00.000Z"
        }
      ]
    );

    expect(items.map((item) => item.sourceId)).toEqual([
      "announcement:announcement-1",
      "event:event-1",
      "announcement:fetched-1",
      "academic-event:academic-1"
    ]);
    expect(items[3]).toEqual(expect.objectContaining({
      startDate: "2026-09-01",
      endDate: "2026-09-04"
    }));
  });

  it("creates events once and verifies them in the primary calendar", async () => {
    const api = new MemoryGoogleCalendarApi();
    const service = new GoogleCalendarService(api.fetch);
    const input = syncInput();

    const first = await service.sync(input);
    const second = await service.sync(input);

    expect(first).toEqual({
      created: 2,
      updated: 0,
      deleted: 0,
      skipped: 0,
      total: 2,
      verified: 2
    });
    expect(second).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 2,
      total: 2,
      verified: 2
    });
    expect(api.events.size).toBe(2);
  });

  it("propagates the supplied abort signal to every listing, mutation, and verification request", async () => {
    const api = new MemoryGoogleCalendarApi();
    const controller = new AbortController();
    const observedSignals: Array<AbortSignal | null | undefined> = [];
    const service = new GoogleCalendarService(async (input, init) => {
      observedSignals.push(init?.signal);
      return api.fetch(input, init);
    });

    await service.sync({
      ...syncInput(),
      signal: controller.signal
    });
    const changed = syncInput();
    changed.calendarEvents = [{
      ...changed.calendarEvents[0]!,
      title: "Updated academic date"
    }];
    changed.announcements = [];
    await service.sync({
      ...changed,
      signal: controller.signal
    });

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

    const pendingSync = service.sync({
      ...syncInput(),
      signal: controller.signal
    });
    controller.abort();
    const rejection = await pendingSync.catch((error: unknown) => error);

    expect(observedSignal).toBe(controller.signal);
    expect(rejection).toBe(abortError);
    expect(rejection).not.toBeInstanceOf(GoogleCalendarSyncError);
  });

  it("updates changed events and removes only stale events owned by the app user", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("other-user-event", "other-user", "announcement:foreign", "foreign");
    const service = new GoogleCalendarService(api.fetch);
    await service.sync(syncInput());

    const changed = syncInput();
    changed.calendarEvents = [{
      ...changed.calendarEvents[0]!,
      title: "Updated academic date"
    }];
    changed.announcements = [];
    const result = await service.sync(changed);

    expect(result.updated).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.verified).toBe(1);
    expect(api.events.has("other-user-event")).toBe(true);
    expect([...api.events.values()].some((event) => event.summary === "Updated academic date")).toBe(true);
  });

  it("preserves source groups that were unavailable during a partial sync", async () => {
    const api = new MemoryGoogleCalendarApi();
    api.seedManagedEvent("academic-existing", "app-user-1", "academic-event:old", "old");
    api.seedManagedEvent("announcement-existing", "app-user-1", "announcement:old", "old");
    const service = new GoogleCalendarService(api.fetch);

    const result = await service.sync({
      accessToken: "google-access-token",
      ownerId: "app-user-1",
      calendarEvents: [],
      announcements: [],
      replaceSourceTypes: ["announcement", "event"]
    });

    expect(result.deleted).toBe(1);
    expect(api.events.has("academic-existing")).toBe(true);
    expect(api.events.has("announcement-existing")).toBe(false);
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
  private sequence = 0;

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const eventMatch = url.pathname.match(/\/calendars\/primary\/events\/([^/]+)$/u);

    if (method === "GET" && url.pathname.endsWith("/calendars/primary/events")) {
      return jsonResponse({ items: [...this.events.values()] });
    }
    if (method === "POST" && url.pathname.endsWith("/calendars/primary/events")) {
      this.sequence += 1;
      const id = `google-${this.sequence}`;
      const body = readBody(init);
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
      this.events.delete(decodeURIComponent(eventMatch[1]!));
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: { message: "Unexpected test request" } }, 500);
  };

  seedManagedEvent(id: string, ownerId: string, sourceId: string, fingerprint: string): void {
    this.events.set(id, {
      id,
      summary: "Foreign event",
      extendedProperties: {
        private: {
          amaManaged: "1",
          amaOwnerId: ownerId,
          amaSourceId: sourceId,
          amaSourceType: sourceId.startsWith("academic-event:") ? "academic_event" : sourceId.startsWith("event:") ? "event" : "announcement",
          amaFingerprint: fingerprint
        }
      }
    });
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
