export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const MANAGED_PROPERTY = "amaManaged";
const OWNER_PROPERTY = "amaOwnerId";
const SOURCE_ID_PROPERTY = "amaSourceId";
const SOURCE_TYPE_PROPERTY = "amaSourceType";
const FINGERPRINT_PROPERTY = "amaFingerprint";

export const GOOGLE_CALENDAR_SOURCE_TYPES = ["academic_event", "announcement", "event"] as const;

export type GoogleCalendarSourceType = (typeof GOOGLE_CALENDAR_SOURCE_TYPES)[number];

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
  sourceUpdatedAt?: string;
  summary?: string;
  contentType?: "announcement" | "news" | "event";
};

export type GoogleCalendarSyncItem = {
  sourceId: string;
  sourceType: GoogleCalendarSourceType;
  summary: string;
  description: string;
  startDate: string;
  endDate: string;
  fingerprint: string;
};

export type GoogleCalendarEventMapping = {
  sourceId: string;
  sourceType: GoogleCalendarSourceType;
  googleEventId: string;
  fingerprint: string;
};

export type GoogleCalendarMutationOperation = "create" | "update" | "delete" | "verify";

export type GoogleCalendarMutationFailure = {
  operation: GoogleCalendarMutationOperation;
  code: GoogleCalendarErrorCode;
  sourceId?: string;
  googleEventId?: string;
  status?: number;
};

export type GoogleCalendarSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: number;
  total: number;
  verified: number;
  partial: boolean;
  failures: GoogleCalendarMutationFailure[];
  mappings: GoogleCalendarEventMapping[];
};

export type GoogleCalendarSyncInput = {
  accessToken: string;
  ownerId: string;
  calendarEvents: GoogleCalendarAcademicEvent[];
  announcements: GoogleCalendarAnnouncement[];
  /**
   * Only source families known to be complete may delete missing remote events.
   * Items from incomplete/partial families are still safe to create or update.
   */
  deletionEligibleSourceTypes?: GoogleCalendarSourceType[];
  /** @deprecated Use deletionEligibleSourceTypes. Retained for the current App caller. */
  replaceSourceTypes?: GoogleCalendarSourceType[];
  signal?: AbortSignal;
};

export type GoogleCalendarAuthorizationVerification = {
  authorized: true;
  managedEventCount: number;
  mappings: GoogleCalendarEventMapping[];
};

export type GoogleCalendarRemoveManagedEventsResult = {
  deleted: number;
  failed: number;
  remaining: number;
  partial: boolean;
  failures: GoogleCalendarMutationFailure[];
  mappings: GoogleCalendarEventMapping[];
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
  summary?: string;
  description?: string;
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

  /** A live, non-mutating Calendar API check. Historical local metadata is not consulted. */
  async verifyAuthorization(input: {
    accessToken: string;
    ownerId: string;
    signal?: AbortSignal;
  }): Promise<GoogleCalendarAuthorizationVerification> {
    const managedEvents = (await this.listManagedEvents(input.accessToken, input.signal))
      .filter((event) => isOwnedManagedEvent(event, input.ownerId));
    return {
      authorized: true,
      managedEventCount: managedEvents.length,
      mappings: collectEventMappings(managedEvents)
    };
  }

  async sync(input: GoogleCalendarSyncInput): Promise<GoogleCalendarSyncResult> {
    const deletionEligibleSourceTypes = new Set<GoogleCalendarSourceType>(
      input.deletionEligibleSourceTypes
        ?? input.replaceSourceTypes
        ?? GOOGLE_CALENDAR_SOURCE_TYPES
    );
    const desiredItems = buildGoogleCalendarSyncItems(input.calendarEvents, input.announcements);
    const initiallyManaged = (await this.listManagedEvents(input.accessToken, input.signal))
      .filter((event) => isOwnedManagedEvent(event, input.ownerId));
    const observedEvents = new Map(
      initiallyManaged.flatMap((event) => event.id ? [[event.id, event] as const] : [])
    );
    const existingBySourceId = new Map<string, GoogleApiEvent>();
    const duplicates: GoogleApiEvent[] = [];

    for (const event of initiallyManaged) {
      const sourceId = event.extendedProperties?.private?.[SOURCE_ID_PROPERTY];
      if (!sourceId || !event.id) continue;
      if (existingBySourceId.has(sourceId)) duplicates.push(event);
      else existingBySourceId.set(sourceId, event);
    }

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = 0;
    const failures: GoogleCalendarMutationFailure[] = [];
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
        try {
          const updatedEvent = await this.request<GoogleApiEvent>(
            input.accessToken,
            `/calendars/primary/events/${encodeURIComponent(existingEvent.id)}`,
            { method: "PATCH", body: JSON.stringify(body) },
            [],
            input.signal
          );
          observedEvents.set(existingEvent.id, { id: existingEvent.id, ...body, ...updatedEvent });
          updated += 1;
        } catch (error) {
          rethrowFatalGoogleCalendarError(error, input.signal);
          failures.push(toMutationFailure("update", error, item.sourceId, existingEvent.id));
        }
        return;
      }

      try {
        const createdEvent = await this.request<GoogleApiEvent>(
          input.accessToken,
          "/calendars/primary/events",
          { method: "POST", body: JSON.stringify(body) },
          [],
          input.signal
        );
        if (createdEvent.id) observedEvents.set(createdEvent.id, { ...body, ...createdEvent });
        created += 1;
      } catch (error) {
        rethrowFatalGoogleCalendarError(error, input.signal);
        failures.push(toMutationFailure("create", error, item.sourceId));
      }
    });

    const stale = uniqueEventsById([
      // Duplicate app-owned mappings are always safe to collapse. Source
      // completeness gates only deletion for a source item that is absent.
      ...duplicates,
      ...[...existingBySourceId.entries()]
        .filter(([sourceId, event]) => {
          const sourceType = readSourceType(event);
          return !desiredIds.has(sourceId) && Boolean(sourceType && deletionEligibleSourceTypes.has(sourceType));
        })
        .map(([, event]) => event)
    ]);

    await mapWithConcurrency(stale, 4, async (event) => {
      if (!event.id) return;
      try {
        await this.request(
          input.accessToken,
          `/calendars/primary/events/${encodeURIComponent(event.id)}`,
          { method: "DELETE" },
          [404, 410],
          input.signal
        );
        observedEvents.delete(event.id);
        deleted += 1;
      } catch (error) {
        rethrowFatalGoogleCalendarError(error, input.signal);
        failures.push(toMutationFailure(
          "delete",
          error,
          event.extendedProperties?.private?.[SOURCE_ID_PROPERTY],
          event.id
        ));
      }
    });

    let finalEvents: GoogleApiEvent[];
    try {
      finalEvents = (await this.listManagedEvents(input.accessToken, input.signal))
        .filter((event) => isOwnedManagedEvent(event, input.ownerId));
    } catch (error) {
      rethrowFatalGoogleCalendarError(error, input.signal);
      failures.push(toMutationFailure("verify", error));
      finalEvents = [...observedEvents.values()];
    }

    const mappings = collectEventMappings(finalEvents);
    const mappingsBySourceId = groupMappingsBySourceId(mappings);
    const failedSourceIds = new Set(failures.flatMap((failure) => failure.sourceId ? [failure.sourceId] : []));
    let verified = 0;
    for (const desired of desiredItems) {
      const matches = mappingsBySourceId.get(desired.sourceId) ?? [];
      if (matches.some((mapping) => mapping.fingerprint === desired.fingerprint)) {
        verified += 1;
      } else if (!failedSourceIds.has(desired.sourceId)) {
        failures.push({
          operation: "verify",
          code: "GOOGLE_CALENDAR_VERIFICATION_FAILED",
          sourceId: desired.sourceId
        });
      }
    }

    const remainingIds = new Set(finalEvents.flatMap((event) => event.id ? [event.id] : []));
    const failedGoogleEventIds = new Set(failures.flatMap((failure) => failure.googleEventId ? [failure.googleEventId] : []));
    for (const event of stale) {
      if (
        event.id
        && remainingIds.has(event.id)
        && !failedGoogleEventIds.has(event.id)
      ) {
        failures.push({
          operation: "verify",
          code: "GOOGLE_CALENDAR_VERIFICATION_FAILED",
          googleEventId: event.id,
          ...(event.extendedProperties?.private?.[SOURCE_ID_PROPERTY]
            ? { sourceId: event.extendedProperties.private[SOURCE_ID_PROPERTY] }
            : {})
        });
      }
    }

    return {
      created,
      updated,
      deleted,
      skipped,
      failed: failures.length,
      total: desiredItems.length,
      verified,
      partial: failures.length > 0,
      failures,
      mappings
    };
  }

  async removeManagedEvents(input: {
    accessToken: string;
    ownerId: string;
    signal?: AbortSignal;
  }): Promise<GoogleCalendarRemoveManagedEventsResult> {
    const managedEvents = (await this.listManagedEvents(input.accessToken, input.signal))
      .filter((event) => isOwnedManagedEvent(event, input.ownerId));
    const failures: GoogleCalendarMutationFailure[] = [];
    let deleted = 0;

    await mapWithConcurrency(managedEvents, 4, async (event) => {
      if (!event.id) return;
      try {
        await this.request(
          input.accessToken,
          `/calendars/primary/events/${encodeURIComponent(event.id)}`,
          { method: "DELETE" },
          [404, 410],
          input.signal
        );
        deleted += 1;
      } catch (error) {
        rethrowFatalGoogleCalendarError(error, input.signal);
        failures.push(toMutationFailure(
          "delete",
          error,
          event.extendedProperties?.private?.[SOURCE_ID_PROPERTY],
          event.id
        ));
      }
    });

    let remainingEvents: GoogleApiEvent[];
    try {
      remainingEvents = (await this.listManagedEvents(input.accessToken, input.signal))
        .filter((event) => isOwnedManagedEvent(event, input.ownerId));
    } catch (error) {
      rethrowFatalGoogleCalendarError(error, input.signal);
      failures.push(toMutationFailure("verify", error));
      const failedIds = new Set(failures.flatMap((failure) => failure.googleEventId ? [failure.googleEventId] : []));
      remainingEvents = managedEvents.filter((event) => Boolean(event.id && failedIds.has(event.id)));
    }

    const failedIds = new Set(failures.flatMap((failure) => failure.googleEventId ? [failure.googleEventId] : []));
    for (const event of remainingEvents) {
      if (event.id && !failedIds.has(event.id)) {
        failures.push({
          operation: "verify",
          code: "GOOGLE_CALENDAR_VERIFICATION_FAILED",
          googleEventId: event.id,
          ...(event.extendedProperties?.private?.[SOURCE_ID_PROPERTY]
            ? { sourceId: event.extendedProperties.private[SOURCE_ID_PROPERTY] }
            : {})
        });
      }
    }

    const mappings = collectEventMappings(remainingEvents);
    return {
      deleted,
      failed: failures.length,
      remaining: remainingEvents.length,
      partial: failures.length > 0 || remainingEvents.length > 0,
      failures,
      mappings
    };
  }

  private async listManagedEvents(accessToken: string, signal?: AbortSignal): Promise<GoogleApiEvent[]> {
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
        { method: "GET" },
        [],
        signal
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
    acceptedFailureStatuses: number[] = [],
    signal?: AbortSignal
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${GOOGLE_CALENDAR_API_BASE_URL}${path}`, {
        ...init,
        ...(signal ? { signal } : {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string> | undefined)
        }
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      throw new GoogleCalendarSyncError(
        "GOOGLE_CALENDAR_NETWORK_ERROR",
        "Google Calendar network request failed."
      );
    }

    if (acceptedFailureStatuses.includes(response.status)) return undefined as T;
    const responseText = await response.text();
    if (!response.ok) throwGoogleCalendarApiError(response.status, responseText);
    if (!responseText) return undefined as T;

    try {
      return JSON.parse(responseText) as T;
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
    // Only a source-authored publication/update timestamp may become a calendar date.
    // Discovery/fetch/crawl timestamps are deliberately ignored.
    const startDate = dateOnly(announcement.publishedAt ?? announcement.sourceUpdatedAt);
    if (!startDate) continue;
    const sourceType = contentType === "event" ? "event" : "announcement";
    const sourceId = `${sourceType}:${announcement.id}`;
    const label = sourceType === "event" ? "Etkinlik" : "Duyuru";
    const details = [
      label,
      announcement.summary,
      !announcement.publishedAt && announcement.sourceUpdatedAt
        ? "Kaynakta yayın tarihi bulunmadığı için kaynak güncelleme tarihi kullanıldı."
        : undefined,
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

function toGoogleEventBody(item: GoogleCalendarSyncItem, ownerId: string): GoogleApiEvent {
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
  } as GoogleApiEvent;
}

function collectEventMappings(events: GoogleApiEvent[]): GoogleCalendarEventMapping[] {
  return events.flatMap((event) => {
    const properties = event.extendedProperties?.private;
    const sourceType = readSourceType(event);
    if (
      !event.id
      || !properties?.[SOURCE_ID_PROPERTY]
      || !sourceType
      || !properties[FINGERPRINT_PROPERTY]
    ) {
      return [];
    }
    return [{
      sourceId: properties[SOURCE_ID_PROPERTY],
      sourceType,
      googleEventId: event.id,
      fingerprint: properties[FINGERPRINT_PROPERTY]
    }];
  }).sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId, "en-US")
    || left.googleEventId.localeCompare(right.googleEventId, "en-US")
  );
}

function groupMappingsBySourceId(
  mappings: GoogleCalendarEventMapping[]
): Map<string, GoogleCalendarEventMapping[]> {
  const grouped = new Map<string, GoogleCalendarEventMapping[]>();
  for (const mapping of mappings) {
    grouped.set(mapping.sourceId, [...(grouped.get(mapping.sourceId) ?? []), mapping]);
  }
  return grouped;
}

function readSourceType(event: GoogleApiEvent): GoogleCalendarSourceType | undefined {
  const value = event.extendedProperties?.private?.[SOURCE_TYPE_PROPERTY];
  return isGoogleCalendarSourceType(value) ? value : undefined;
}

function isGoogleCalendarSourceType(value: unknown): value is GoogleCalendarSourceType {
  return typeof value === "string" && GOOGLE_CALENDAR_SOURCE_TYPES.some((candidate) => candidate === value);
}

function isOwnedManagedEvent(event: GoogleApiEvent, ownerId: string): boolean {
  const properties = event.extendedProperties?.private;
  return properties?.[MANAGED_PROPERTY] === "1" && properties[OWNER_PROPERTY] === ownerId;
}

function uniqueEventsById(events: GoogleApiEvent[]): GoogleApiEvent[] {
  const unique = new Map<string, GoogleApiEvent>();
  for (const event of events) {
    if (event.id && !unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()];
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
  let fatalError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length && fatalError === undefined) {
      const index = cursor;
      cursor += 1;
      try {
        await action(values[index]!);
      } catch (error) {
        fatalError = error;
      }
    }
  });
  await Promise.all(workers);
  if (fatalError !== undefined) throw fatalError;
}

function rethrowFatalGoogleCalendarError(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || isAbortError(error)) throw error;
  if (
    error instanceof GoogleCalendarSyncError
    && (
      error.code === "GOOGLE_CALENDAR_AUTH_EXPIRED"
      || error.code === "GOOGLE_CALENDAR_PERMISSION_DENIED"
      || error.code === "GOOGLE_CALENDAR_API_UNAVAILABLE"
    )
  ) {
    throw error;
  }
}

function toMutationFailure(
  operation: GoogleCalendarMutationOperation,
  error: unknown,
  sourceId?: string,
  googleEventId?: string
): GoogleCalendarMutationFailure {
  const classified = error instanceof GoogleCalendarSyncError
    ? error
    : new GoogleCalendarSyncError(
      "GOOGLE_CALENDAR_REQUEST_FAILED",
      "Google Calendar request failed."
    );
  return {
    operation,
    code: classified.code,
    ...(sourceId ? { sourceId } : {}),
    ...(googleEventId ? { googleEventId } : {}),
    ...(classified.status === undefined ? {} : { status: classified.status })
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwGoogleCalendarApiError(status: number, body: string): never {
  const providerSignal = readProviderErrorSignal(body);

  if (status === 401) {
    throw new GoogleCalendarSyncError(
      "GOOGLE_CALENDAR_AUTH_EXPIRED",
      "Google Calendar authorization has expired.",
      status
    );
  }
  if (status === 403 && /accessnotconfigured|servicedisabled|api.*disabled/iu.test(providerSignal)) {
    throw new GoogleCalendarSyncError(
      "GOOGLE_CALENDAR_API_UNAVAILABLE",
      "Google Calendar API is unavailable for this application.",
      status
    );
  }
  if (status === 403) {
    throw new GoogleCalendarSyncError(
      "GOOGLE_CALENDAR_PERMISSION_DENIED",
      "Google Calendar permission was denied.",
      status
    );
  }
  throw new GoogleCalendarSyncError(
    "GOOGLE_CALENDAR_REQUEST_FAILED",
    "Google Calendar request failed.",
    status
  );
}

function readProviderErrorSignal(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
    return [
      parsed.error?.errors?.[0]?.reason,
      parsed.error?.status,
      parsed.error?.message
    ].filter((value): value is string => Boolean(value)).join(" ").slice(0, 2048);
  } catch {
    // The raw provider body is intentionally neither retained nor exposed.
    return "";
  }
}
