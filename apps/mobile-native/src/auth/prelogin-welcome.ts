export const PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY =
  "native_prelogin_welcome_completion_v1";

export const PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE =
  "native_prelogin_welcome_completed_v1";

/**
 * Must stay aligned with the tombstone used by native session restoration.
 * A tombstone deliberately represents the absence of a restorable session.
 */
export const INVALIDATED_SESSION_STORAGE_VALUE =
  "native_session_invalidated_v1";

export type PreloginWelcomeGate =
  | "pending"
  | "completed"
  | "restorable_session";

export interface PreloginWelcomeGateInput {
  storedCompletion: string | null | undefined;
  storedSession: string | null | undefined;
}

interface RestorableSessionShape {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
  };
}

/**
 * Mirrors the structural checks used by native session hydration without
 * importing application state or performing any storage/network work.
 */
export function hasRestorableStoredSession(
  storedSession: string | null | undefined,
): boolean {
  if (!storedSession || storedSession === INVALIDATED_SESSION_STORAGE_VALUE) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedSession);
  } catch {
    return false;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }

  const candidate = parsed as Partial<RestorableSessionShape>;
  return typeof candidate.accessToken === "string"
    && Boolean(candidate.accessToken)
    && typeof candidate.refreshToken === "string"
    && Boolean(candidate.refreshToken)
    && typeof candidate.expiresInSeconds === "number"
    && Boolean(candidate.user)
    && typeof candidate.user?.id === "string"
    && Boolean(candidate.user.id)
    && typeof candidate.user?.email === "string"
    && typeof candidate.user?.fullName === "string"
    && typeof candidate.user?.role === "string";
}

/**
 * Resolves the installation-level welcome gate from raw persisted values.
 * Only an exact, current-version completion token suppresses a first-launch
 * welcome. A structurally restorable session also bypasses it so an existing
 * user is never interrupted before session refresh.
 */
export function resolvePreloginWelcomeGate({
  storedCompletion,
  storedSession,
}: PreloginWelcomeGateInput): PreloginWelcomeGate {
  if (storedCompletion === PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE) {
    return "completed";
  }

  if (hasRestorableStoredSession(storedSession)) {
    return "restorable_session";
  }

  return "pending";
}
