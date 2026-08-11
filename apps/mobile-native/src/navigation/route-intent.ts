import type { NotificationDestination } from "../notifications/notification-destination";
import { routeForVerifiedNotification } from "./deep-link";
import {
  cloneAppRoute,
  isAppRoute,
  isNotificationDetailRoute,
  isProtectedRoute,
  isSafeRouteIdentifier,
  isValidRouteOwner,
  routeKey,
  type AppRoute,
  type NotificationDetailRoute,
  type RouteOwner
} from "./routes";

export type AppRouteIntent =
  | {
      id?: string;
      source: "notification";
      verified: true;
      route: NotificationDetailRoute;
    }
  | {
      id?: string;
      source: "deep_link" | "legacy" | "internal";
      route: Exclude<AppRoute, { name: "Hydration" } | { name: "Login" } | { name: "Register" }
        | { name: "Verification" } | { name: "PasswordRecoveryRequest" }
        | { name: "PasswordRecoveryCode" } | { name: "PasswordRecoveryConfirm" }
        | { name: "AcademicOnboarding" }>;
    };

export type RouteIntentEnqueueResult =
  | "enqueued"
  | "promoted"
  | "deduplicated"
  | "rejected_invalid"
  | "rejected_stale_owner";

type PendingIntent = {
  intent: AppRouteIntent;
  identityKeys: string[];
  sequence: number;
};

export function createVerifiedNotificationIntent(
  destination: NotificationDestination,
  id?: string
): AppRouteIntent {
  if (id !== undefined && !isSafeRouteIdentifier(id)) {
    throw new Error("A safe route-intent identifier is required.");
  }
  return {
    ...(id === undefined ? {} : { id }),
    source: "notification",
    verified: true,
    route: routeForVerifiedNotification(destination)
  };
}

/**
 * Holds short-lived post-hydration navigation work. The queue belongs to one
 * exact app owner generation. Calling consumeFor with a different owner or
 * generation invalidates all stale pending and dedupe state before rebinding.
 */
export class RouteIntentCoordinator {
  private owner: RouteOwner | null = null;
  private pending: PendingIntent[] = [];
  private seenIdentityKeys = new Set<string>();
  private sequence = 0;

  enqueue(
    intent: AppRouteIntent,
    ownerId: string,
    generation: number
  ): RouteIntentEnqueueResult;
  enqueue(intent: AppRouteIntent, owner: RouteOwner): RouteIntentEnqueueResult;
  enqueue(
    intent: AppRouteIntent,
    ownerOrId: RouteOwner | string,
    generation?: number
  ): RouteIntentEnqueueResult {
    const owner = typeof ownerOrId === "string"
      ? { ownerId: ownerOrId, generation }
      : ownerOrId;
    if (
      !isValidRouteOwner(owner.ownerId, owner.generation)
      || !isValidRouteIntent(intent)
    ) {
      return "rejected_invalid";
    }

    const exactOwner = { ownerId: owner.ownerId, generation: owner.generation as number };
    if (!this.owner) {
      this.owner = exactOwner;
    } else if (!isSameOwner(this.owner, exactOwner)) {
      return "rejected_stale_owner";
    }

    const normalizedIntent = cloneRouteIntent(intent);
    const identityKeys = identityKeysFor(normalizedIntent);
    const duplicateIndex = this.pending.findIndex((candidate) => (
      candidate.identityKeys.some((key) => identityKeys.includes(key))
    ));

    if (duplicateIndex >= 0) {
      const duplicate = this.pending[duplicateIndex];
      if (
        duplicate
        && normalizedIntent.source === "notification"
        && duplicate.intent.source !== "notification"
      ) {
        const mergedKeys = [...new Set([...duplicate.identityKeys, ...identityKeys])];
        this.pending[duplicateIndex] = {
          intent: normalizedIntent,
          identityKeys: mergedKeys,
          sequence: duplicate.sequence
        };
        mergedKeys.forEach((key) => this.seenIdentityKeys.add(key));
        return "promoted";
      }
      return "deduplicated";
    }

    if (identityKeys.some((key) => this.seenIdentityKeys.has(key))) {
      return "deduplicated";
    }

    this.sequence += 1;
    this.pending.push({
      intent: normalizedIntent,
      identityKeys,
      sequence: this.sequence
    });
    identityKeys.forEach((key) => this.seenIdentityKeys.add(key));
    return "enqueued";
  }

  consumeFor(ownerId: string, generation: number): AppRouteIntent | null {
    if (!isValidRouteOwner(ownerId, generation)) return null;
    const owner = { ownerId, generation };
    if (!this.owner) {
      this.owner = owner;
      return null;
    }
    if (!isSameOwner(this.owner, owner)) {
      this.clear();
      this.owner = owner;
      return null;
    }
    if (this.pending.length === 0) return null;

    const notificationIndex = this.pending.findIndex(
      (candidate) => candidate.intent.source === "notification"
    );
    const selectedIndex = notificationIndex >= 0 ? notificationIndex : 0;
    const [selected] = this.pending.splice(selectedIndex, 1);
    return selected ? cloneRouteIntent(selected.intent) : null;
  }

  invalidate(): void;
  invalidate(ownerId: string, generation: number): void;
  invalidate(ownerId?: string, generation?: number): void {
    if (ownerId === undefined && generation === undefined) {
      this.clear();
      this.owner = null;
      return;
    }
    if (
      !isValidRouteOwner(ownerId, generation)
      || !this.owner
      || !isSameOwner(this.owner, { ownerId: ownerId as string, generation: generation as number })
    ) {
      return;
    }
    this.clear();
    this.owner = null;
  }

  pendingCountFor(ownerId: string, generation: number): number {
    return this.owner && isSameOwner(this.owner, { ownerId, generation })
      ? this.pending.length
      : 0;
  }

  private clear(): void {
    this.pending = [];
    this.seenIdentityKeys.clear();
  }
}

function isValidRouteIntent(value: unknown): value is AppRouteIntent {
  if (!isRecord(value) || !isAppRoute(value.route)) return false;
  if (value.id !== undefined && !isSafeRouteIdentifier(value.id)) return false;

  if (value.source === "notification") {
    return value.verified === true
      && isNotificationDetailRoute(value.route)
      && hasOnlyIntentKeys(value, ["id", "source", "verified", "route"]);
  }
  return (value.source === "deep_link" || value.source === "legacy" || value.source === "internal")
    && (isProtectedRoute(value.route) || value.route.name === "Unknown")
    && hasOnlyIntentKeys(value, ["id", "source", "route"]);
}

function cloneRouteIntent(intent: AppRouteIntent): AppRouteIntent {
  if (intent.source === "notification") {
    return {
      ...(intent.id === undefined ? {} : { id: intent.id }),
      source: "notification",
      verified: true,
      route: cloneAppRoute(intent.route) as NotificationDetailRoute
    };
  }
  return {
    ...(intent.id === undefined ? {} : { id: intent.id }),
    source: intent.source,
    route: cloneAppRoute(intent.route) as Exclude<AppRoute, { name: "Hydration" }>
  } as AppRouteIntent;
}

function identityKeysFor(intent: AppRouteIntent): string[] {
  return [
    ...(intent.id === undefined ? [] : [`id:${intent.id}`]),
    `route:${routeKey(intent.route)}`
  ];
}

function isSameOwner(left: RouteOwner, right: RouteOwner): boolean {
  return left.ownerId === right.ownerId && left.generation === right.generation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyIntentKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
