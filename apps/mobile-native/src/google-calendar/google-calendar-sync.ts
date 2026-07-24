export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const MANAGED_PROPERTY = "amaManaged";
const OWNER_PROPERTY = "amaOwnerId";
const SOURCE_ID_PROPERTY = "amaSourceId";
const SOURCE_TYPE_PROPERTY = "amaSourceType";
const FINGERPRINT_PROPERTY = "amaFingerprint";

export type GoogleCalendarAcademicEvent = {
  id: string;
  title: string;
  category: string;
  startDate: string;
  endDate?: string;
};

export type GoogleCalendarAnnouncement = {
  id: string;
  title: string;
  link: string;
  publishedAt?: string;
  fetchedAt?: string;
  summary?: string;
  contentType?: "announcement" | "news" | "event";
};

export type GoogleCalendarSyncItem = {
  sourceId: string;
  sourceType: "academic_event" | "announcement" | "event";
  summary: string;
  description: string;
  startDate: string;
  endDate: string;
  fingerprint: string;
};

export type GoogleCalendarSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  total: number;
  verified: number;
};

export type GoogleCalendarSyncInput = {
  accessToken: string;
  ownerId: string;
  calendarEvents: GoogleCalendarAcademicEvent[];
  announcements: GoogleCalendarAnnouncement[];
  replaceSourceTypes?: Array<GoogleCalendarSyncItem["sourceType"]>;
};

export type GoogleCalendarErrorCode =
  | "GOOGLE_CALENDAR_AUTH_EXPIRED"
  | "GOOGLE_CALENDAR_PERMISSION_DENIED"
  | "GOOGLE_CALENDAR_API_UNAVAILABLE"
  | "GOOGLE_CALENDAR_NETWORK_ERROR"
  | "GOOGLE_CALENDAR_VERIFICATION_FAILED"
  | "GOOGLE_CALENDAR_REQUEST_FAILED";

export class GoogleCalendarSyncError extends Error {
  constructor(
    readonly code: GoogleCalendarErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "GoogleCalendarSyncError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type GoogleApiEvent = {
  id?: string;
  status?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

type GoogleApiEventList = {
  items?: GoogleApiEvent[];
  nextPageToken?: string;
};

export class GoogleCalendarService {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async sync(input: GoogleCalendarSyncInput): Promise<GoogleCalendarSyncResult> {
    const replaceSourceTypes = new Set<GoogleCalendarSyncItem["sourceType"]>(
      input.replaceSourceTypes ?? ["academic_event", "announcement", "event"]
    );
    const desiredItems = buildGoogleCalendarSyncItems(input.calendarEvents, input.announcements)
      .filter((item) => replaceSourceTypes.has(item.sourceType));
    const existing = (await this.listManagedEvents(input.accessToken))
      .filter((event) => event.extendedProperties?.private?.[OWNER_PROPERTY] === input.ownerId);
    const existingBySourceId = new Map<string, GoogleApiEvent>();
    const duplicates: GoogleApiEvent[] = [];

    for (const event of existing) {
      const sourceId = event.extendedProperties?.private?.[SOURCE_ID_PROPERTY];
      if (!sourceId || !event.id) continue;
      if (existingBySourceId.has(sourceId)) duplicates.push(event);
      else existingBySourceId.set(sourceId, event);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const desiredIds = new Set(desiredItems.map((item) => item.sourceId));

    await mapWithConcurrency(desiredItems, 4, async (item) => {
      const existingEvent = existingBySourceId.get(item.sourceId);
      const existingFingerprint = existingEvent?.extendedProperties?.private?.[FINGERPRINT_PROPERTY];
      if (existingEvent?.id && existingFingerprint === item.fingerprint) {
        skipped += 1;
        return;
      }

      const body = toGoogleEventBody(item, input.ownerId);
      if (existingEvent?.id) {
        await this.request(
          input.accessToken,
          `/calendars/primary/events/${encodeURIComponent(existingEvent.id)}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
        updated += 1;
        return;
      }

      await this.request(
        input.accessToken,
        "/calendars/primary/events",
        { method: "POST", body: JSON.stringify(body) }
      );
      created += 1;
    });

    const stale = [
      ...duplicates.filter((event) => {
        const sourceType = event.extendedProperties?.private?.[SOURCE_TYPE_PROPERTY] as GoogleCalendarSyncItem["sourceType"] | undefined;
        return Boolean(sourceType && replaceSourceTypes.has(sourceType));
      }),
      ...[...existingBySourceId.entries()]
        .filter(([sourceId, event]) => {
          const sourceType = event.extendedProperties?.private?.[SOURCE_TYPE_PROPERTY] as GoogleCalendarSyncItem["sourceType"] | undefined;
          return !desiredIds.has(sourceId) && Boolean(sourceType && replaceSourceTypes.has(sourceType));
        })
        .map(([, event]) => event)
    ].filter((event) => Boolean(event.id));

    await mapWithConcurrency(stale, 4, async (event) => {
      await this.request(
        input.accessToken,
        `/calendars/primary/events/${encodeURIComponent(event.id!)}`,
        { method: "DELETE" },
        [404, 410]
      );
    });

    const verifiedEvents = (await this.listManagedEvents(input.accessToken))
      .filter((event) => event.extendedProperties?.private?.[OWNER_PROPERTY] === input.ownerId);
    const verifiedSourceIds = new Set(
      verifiedEvents
        .filter((event) => {
          const properties = event.extendedProperties?.private;
          const sourceId = properties?.[SOURCE_ID_PROPERTY];
          const desired = desiredItems.find((item) => item.sourceId === sourceId);
          return Boolean(desired && properties?.[FINGERPRINT_PROPERTY] === desired.fingerprint);
        })
        .map((event) => event.extendedProperties!.private![SOURCE_ID_PROPERTY]!)
    );

    if (verifiedSourceIds.size !== desiredItems.length) {
      throw new GoogleCalendarSyncError(
        "GOOGLE_CALENDAR_VERIFICATION_FAILED",
        `Expected ${desiredItems.length} managed events but verified ${verifiedSourceIds.size}.`
      );
    }

    return {
      created,
      updated,
      deleted: stale.length,
      skipped,
      total: desiredItems.length,
      verified: verifiedSourceIds.size
    };
  }

  private async listManagedEvents(accessToken: string): Promise<GoogleApiEvent[]> {
    const events: GoogleApiEvent[] = [];
    let pageToken: string | undefined;

    do {
      const query = [
        "maxResults=2500",
        "showDeleted=false",
        "singleEvents=true",
        `privateExtendedProperty=${encodeURIComponent(`${MANAGED_PROPERTY}=1`)}`,
        ...(pageToken ? [`pageToken=${encodeURIComponent(pageToken)}`] : [])
      ].join("&");
      const page = await this.request<GoogleApiEventList>(
        accessToken,
        `/calendars/primary/events?${query}`,
        { method: "GET" }
      );
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return events;
  }

  private async request<T = unknown>(
    accessToken: string,
    path: string,
    init: RequestInit,
    acceptedFailureStatuses: number[] = []
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${GOOGLE_CALENDAR_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string> | undefined)
        }
      });
    } catch (error) {
      throw new GoogleCalendarSyncError(
        "GOOGLE_CALENDAR_NETWORK_ERROR",
        error instanceof Error ? error.message : "Google Calendar request failed."
      );
    }

    if (acceptedFailureStatuses.includes(response.status)) return undefined as T;
    const text = await response.text();
    if (!response.ok) throwGoogleCalendarApiError(response.status, text);
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GoogleCalendarSyncError(
        "GOOGLE_CALENDAR_REQUEST_FAILED",
        "Google Calendar returned an unreadable response.",
        response.status
      );
    }
  }
}

export function buildGoogleCalendarSyncItems(
  calendarEvents: GoogleCalendarAcademicEvent[],
  announcements: GoogleCalendarAnnouncement[]
): GoogleCalendarSyncItem[] {
  const items = new Map<string, GoogleCalendarSyncItem>();

  for (const event of calendarEvents) {
    const startDate = dateOnly(event.startDate);
    if (!startDate) continue;
    const inclusiveEndDate = dateOnly(event.endDate ?? event.startDate) ?? startDate;
    const sourceId = `academic-event:${event.id}`;
    const item = createSyncItem({
      sourceId,
      sourceType: "academic_event",
      summary: event.title,
      description: `Akademik Takvim\nKategori: ${event.category}`,
      startDate,
      endDate: addDays(inclusiveEndDate, 1)
    });
    items.set(sourceId, item);
  }

  for (const announcement of announcements) {
    const contentType = announcement.contentType ?? "announcement";
    if (contentType === "news") continue;
    const startDate = dateOnly(announcement.publishedAt ?? announcement.fetchedAt);
    if (!startDate) continue;
    const sourceType = contentType === "event" ? "event" : "announcement";
    const sourceId = `${sourceType}:${announcement.id}`;
    const label = sourceType === "event" ? "Etkinlik" : "Duyuru";
    const details = [
      label,
      announcement.summary,
      !announcement.publishedAt && announcement.fetchedAt ? "Kaynakta yayın tarihi bulunamadığı için uygulamaya alınma tarihi kullanıldı." : undefined,
      announcement.link ? `Kaynak: ${announcement.link}` : undefined
    ].filter((value): value is string => Boolean(value));
    const item = createSyncItem({
      sourceId,
      sourceType,
      summary: `${label}: ${announcement.title}`,
      description: details.join("\n"),
      startDate,
      endDate: addDays(startDate, 1)
    });
    items.set(sourceId, item);
  }

  return [...items.values()].sort((left, right) =>
    left.startDate.localeCompare(right.startDate) || left.summary.localeCompare(right.summary, "tr-TR")
  );
}

function createSyncItem(input: Omit<GoogleCalendarSyncItem, "fingerprint">): GoogleCalendarSyncItem {
  return {
    ...input,
    fingerprint: fingerprint([
      input.sourceId,
      input.sourceType,
      input.summary,
      input.description,
      input.startDate,
      input.endDate
    ].join("\u001f"))
  };
}

function toGoogleEventBody(item: GoogleCalendarSyncItem, ownerId: string) {
  return {
    summary: item.summary,
    description: item.description,
    start: { date: item.startDate },
    end: { date: item.endDate },
    transparency: "transparent",
    extendedProperties: {
      private: {
        [MANAGED_PROPERTY]: "1",
        [OWNER_PROPERTY]: ownerId,
        [SOURCE_ID_PROPERTY]: item.sourceId,
        [SOURCE_TYPE_PROPERTY]: item.sourceType,
        [FINGERPRINT_PROPERTY]: item.fingerprint
      }
    }
  };
}

function dateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];
  if (direct && !Number.isNaN(Date.parse(`${direct}T00:00:00.000Z`))) return direct;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  action: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await action(values[index]!);
    }
  });
  await Promise.all(workers);
}

function throwGoogleCalendarApiError(status: number, body: string): never {
  let message = body;
  let reason = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
    message = parsed.error?.message ?? body;
    reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? "";
  } catch {
    // Keep the raw body for internal classification.
  }

  if (status === 401) {
    throw new GoogleCalendarSyncError("GOOGLE_CALENDAR_AUTH_EXPIRED", message, status);
  }
  if (status === 403 && /accessnotconfigured|servicedisabled|api.*disabled/iu.test(`${reason} ${message}`)) {
    throw new GoogleCalendarSyncError("GOOGLE_CALENDAR_API_UNAVAILABLE", message, status);
  }
  if (status === 403) {
    throw new GoogleCalendarSyncError("GOOGLE_CALENDAR_PERMISSION_DENIED", message, status);
  }
  throw new GoogleCalendarSyncError("GOOGLE_CALENDAR_REQUEST_FAILED", message, status);
}
