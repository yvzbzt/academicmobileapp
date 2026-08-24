export type AccountGenerationSnapshot = Readonly<{
  ownerId: string;
  generation: number;
}>;

export type AccountCompletionRejectionReason =
  | "no_active_account"
  | "owner_changed"
  | "generation_changed";

export type AccountCompletionResult<T> =
  | { accepted: true; value: T }
  | { accepted: false; reason: AccountCompletionRejectionReason };

/**
 * Invalidates asynchronous work whenever the active account/session changes.
 * Rejected settlements intentionally omit their value so stale account data
 * cannot be passed onward or accidentally serialized by the caller.
 */
export class AccountGenerationGuard {
  private ownerId: string | null = null;
  private generation = 0;

  activate(ownerId: string): AccountGenerationSnapshot {
    this.ownerId = requireOwnerId(ownerId);
    this.generation += 1;
    return this.capture()!;
  }

  invalidate(): void {
    this.ownerId = null;
    this.generation += 1;
  }

  capture(): AccountGenerationSnapshot | null {
    if (!this.ownerId) return null;
    return Object.freeze({ ownerId: this.ownerId, generation: this.generation });
  }

  isCurrent(snapshot: AccountGenerationSnapshot | null | undefined): boolean {
    return Boolean(
      snapshot
      && this.ownerId
      && snapshot.ownerId === this.ownerId
      && snapshot.generation === this.generation
    );
  }

  settle<T>(
    snapshot: AccountGenerationSnapshot | null | undefined,
    value: T
  ): AccountCompletionResult<T> {
    if (!snapshot || !this.ownerId) return { accepted: false, reason: "no_active_account" };
    if (snapshot.ownerId !== this.ownerId) return { accepted: false, reason: "owner_changed" };
    if (snapshot.generation !== this.generation) return { accepted: false, reason: "generation_changed" };
    return { accepted: true, value };
  }
}

export type AuthOperation =
  | "login"
  | "register"
  | "verify_email"
  | "resend_verification"
  | "request_password_recovery"
  | "confirm_password_recovery"
  | "refresh_session"
  | "google_sign_in"
  | "apple_sign_in"
  | "logout"
  | "delete_account";

export type ControlledAuthErrorCode =
  | "network_unavailable"
  | "invalid_credentials"
  | "email_not_verified"
  | "email_already_registered"
  | "invalid_verification_code"
  | "verification_code_expired"
  | "verification_request_invalid"
  | "invalid_password_recovery_code"
  | "password_recovery_code_expired"
  | "password_confirmation_mismatch"
  | "password_invalid"
  | "session_expired"
  | "disabled_account"
  | "google_sign_in_cancelled"
  | "google_sign_in_failed"
  | "google_configuration_error"
  | "apple_sign_in_cancelled"
  | "apple_sign_in_failed"
  | "rate_limited"
  | "not_allowed"
  | "validation_failed"
  | "server_unavailable"
  | "unknown";

export type ControlledAuthError = {
  code: ControlledAuthErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
};

export type AuthErrorClassificationInput = {
  operation: AuthOperation;
  status?: number;
  body?: unknown;
  error?: unknown;
};

const AUTH_ERROR_MESSAGES: Record<ControlledAuthErrorCode, string> = {
  network_unavailable: "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.",
  invalid_credentials: "E-posta adresi veya şifre hatalı.",
  email_not_verified: "Devam etmek için önce e-posta adresini doğrulamalısın.",
  email_already_registered: "Bu e-posta adresiyle bir hesap zaten var.",
  invalid_verification_code: "Doğrulama kodu geçersiz. Kodu kontrol edip tekrar dene.",
  verification_code_expired: "Doğrulama kodunun süresi dolmuş. Yeni bir kod iste.",
  verification_request_invalid: "Bu e-posta için doğrulama isteği bulunamadı. Adresi kontrol edip tekrar dene.",
  invalid_password_recovery_code: "Şifre sıfırlama kodu geçersiz. Kodu kontrol edip tekrar dene.",
  password_recovery_code_expired: "Şifre sıfırlama kodunun süresi dolmuş. Yeni bir kod iste.",
  password_confirmation_mismatch: "Yeni şifre ve şifre tekrarı aynı olmalıdır.",
  password_invalid: "Yeni şifren en az 8 karakter olmalı ve büyük harf, küçük harf, rakam ve özel karakter gruplarından en az üçünü içermelidir.",
  session_expired: "Oturumunun süresi doldu. Lütfen tekrar giriş yap.",
  disabled_account: "Bu hesap devre dışı. Destek ekibiyle iletişime geç.",
  google_sign_in_cancelled: "Google ile giriş iptal edildi.",
  google_sign_in_failed: "Google ile giriş tamamlanamadı. Lütfen tekrar dene.",
  google_configuration_error: "Bu sürümde Google ile giriş yapılandırması tamamlanmamış.",
  apple_sign_in_cancelled: "Apple ile giriş iptal edildi.",
  apple_sign_in_failed: "Apple ile giriş tamamlanamadı. Lütfen tekrar dene.",
  rate_limited: "Çok sık denedin. Biraz bekleyip tekrar dene.",
  not_allowed: "Bu işlemi yapma yetkin yok.",
  validation_failed: "Bilgileri kontrol edip tekrar dene.",
  server_unavailable: "İşlem şu anda tamamlanamadı. Biraz sonra tekrar dene.",
  unknown: "İşlem tamamlanamadı. Lütfen tekrar dene."
};

const BACKEND_AUTH_ERROR_CODE_MAP: Readonly<Record<string, ControlledAuthErrorCode>> = {
  AUTH_INVALID_CREDENTIALS: "invalid_credentials",
  AUTH_EMAIL_NOT_VERIFIED: "email_not_verified",
  AUTH_VERIFICATION_CODE_INVALID: "invalid_verification_code",
  AUTH_VERIFICATION_TOKEN_INVALID: "invalid_verification_code",
  AUTH_VERIFICATION_CODE_EXPIRED: "verification_code_expired",
  AUTH_VERIFICATION_REQUEST_INVALID: "verification_request_invalid",
  AUTH_VERIFICATION_TOKEN_EXPIRED: "verification_code_expired",
  AUTH_PASSWORD_RECOVERY_CODE_INVALID: "invalid_password_recovery_code",
  AUTH_PASSWORD_RECOVERY_CODE_EXPIRED: "password_recovery_code_expired",
  AUTH_PASSWORD_CONFIRMATION_MISMATCH: "password_confirmation_mismatch",
  AUTH_PASSWORD_INVALID: "password_invalid",
  AUTH_SESSION_INVALID: "session_expired",
  AUTH_SESSION_EXPIRED: "session_expired",
  AUTH_ACCOUNT_DISABLED: "disabled_account",
  AUTH_RATE_LIMITED: "rate_limited"
};

/**
 * Converts untrusted server/SDK errors into a fixed, user-safe contract. Raw
 * bodies, exception messages, credentials, codes, and tokens are never
 * retained on or returned from the result.
 */
export function classifyAuthError(input: AuthErrorClassificationInput): ControlledAuthError {
  const status = normalizeStatus(input.status);
  const exactBackendCode = findExactBackendAuthCode(input.body, input.error);
  const signal = collectAuthErrorSignal(input.body, input.error);
  let code: ControlledAuthErrorCode;

  if (exactBackendCode) {
    code = exactBackendCode;
  } else if (status === 0 || includesAny(signal, ["network request failed", "failed to fetch", "network error", "timeout"])) {
    code = "network_unavailable";
  } else if (status === 429 || includesAny(signal, ["rate limit", "too many request"])) {
    code = "rate_limited";
  } else if (status !== undefined && status >= 500) {
    code = "server_unavailable";
  } else if (
    input.operation === "google_sign_in"
    && includesAny(signal, ["cancelled", "canceled", "sign_in_cancelled"])
  ) {
    code = "google_sign_in_cancelled";
  } else if (
    input.operation === "google_sign_in"
    && includesAny(signal, ["developer_error", "api_exception: 10", "status code: 10", "configuration"])
  ) {
    code = "google_configuration_error";
  } else if (
    input.operation === "apple_sign_in"
    && includesAny(signal, ["cancelled", "canceled", "err_request_canceled"])
  ) {
    code = "apple_sign_in_cancelled";
  } else if (input.operation === "refresh_session" && (status === 401 || status === 403)) {
    code = "session_expired";
  } else if (
    input.operation === "register"
    && (status === 409 || includesAny(signal, ["already exists", "already registered", "duplicate", "kayıtlı"]))
  ) {
    code = "email_already_registered";
  } else if (
    (input.operation === "verify_email" || input.operation === "resend_verification")
    && includesAny(signal, ["expired", "süresi dol"])
  ) {
    code = "verification_code_expired";
  } else if (
    input.operation === "confirm_password_recovery"
    && includesAny(signal, ["expired", "süresi dol"])
  ) {
    code = "password_recovery_code_expired";
  } else if (
    input.operation === "confirm_password_recovery"
    && (status === 400 || status === 401 || includesAny(signal, ["invalid", "recovery code", "sıfırlama kod"]))
  ) {
    code = "invalid_password_recovery_code";
  } else if (
    input.operation === "verify_email"
    && (status === 400 || status === 401 || includesAny(signal, ["invalid", "verification code", "doğrulama kod"]))
  ) {
    code = "invalid_verification_code";
  } else if (
    input.operation === "login"
    && includesAny(signal, ["not verified", "unverified", "verify email", "email verification"])
  ) {
    code = "email_not_verified";
  } else if (
    input.operation === "login"
    && (status === 401 || status === 403 || includesAny(signal, ["invalid credential", "wrong password"]))
  ) {
    code = "invalid_credentials";
  } else if (input.operation === "google_sign_in") {
    code = "google_sign_in_failed";
  } else if (input.operation === "apple_sign_in") {
    code = "apple_sign_in_failed";
  } else if (status === 401) {
    code = "session_expired";
  } else if (status === 403) {
    code = "not_allowed";
  } else if (status === 400 || status === 409 || status === 422) {
    code = "validation_failed";
  } else {
    code = "unknown";
  }

  const base = {
    code,
    message: AUTH_ERROR_MESSAGES[code],
    retryable: isRetryableAuthError(code)
  };
  return status === undefined ? base : { ...base, status };
}

export type AccountCleanupTarget =
  | "server_session"
  | "server_account"
  | "device_registration"
  | "session_storage"
  | "pending_verification_storage"
  | "pending_notification_storage"
  | "manual_exam_storage"
  | "google_connection_storage"
  | "google_managed_events"
  | "google_access"
  | "google_sign_in"
  | "in_memory_state";

export type AccountCleanupTask = {
  target: AccountCleanupTarget;
  run: () => void | Promise<void>;
  timeoutMs?: number;
};

export type AccountCleanupResult = {
  complete: boolean;
  attemptedCount: number;
  succeededTargets: AccountCleanupTarget[];
  failedTargets: AccountCleanupTarget[];
};

/** Runs every cleanup step and reports only controlled target identifiers. */
export async function runObservableAccountCleanup(
  tasks: readonly AccountCleanupTask[]
): Promise<AccountCleanupResult> {
  const succeededTargets: AccountCleanupTarget[] = [];
  const failedTargets: AccountCleanupTarget[] = [];

  for (const task of tasks) {
    try {
      await runCleanupTaskWithTimeout(task);
      succeededTargets.push(task.target);
    } catch {
      // Error objects can contain tokens or PII. Record only the controlled target.
      failedTargets.push(task.target);
    }
  }

  return {
    complete: failedTargets.length === 0,
    attemptedCount: tasks.length,
    succeededTargets,
    failedTargets
  };
}

async function runCleanupTaskWithTimeout(task: AccountCleanupTask): Promise<void> {
  if (task.timeoutMs === undefined) {
    await task.run();
    return;
  }

  const timeoutMs = task.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid cleanup timeout.");

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(task.run),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Cleanup step timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function requireOwnerId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("An account owner is required.");
  return normalized;
}

function normalizeStatus(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function collectAuthErrorSignal(body: unknown, error: unknown): string {
  const values = [...readSignalValues(body), ...readSignalValues(error)];
  return values.join(" ").slice(0, 4096).toLowerCase();
}

function readSignalValues(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (value instanceof Error) {
    const errorWithCode = value as Error & { code?: unknown; errorCode?: unknown };
    return [errorWithCode.errorCode, errorWithCode.code, value.name, value.message]
      .flatMap((item) => readSignalValues(item, depth + 1));
  }
  if (typeof value === "string") {
    const trimmed = value.slice(0, 4096);
    try {
      return readSignalValues(JSON.parse(trimmed), depth + 1);
    } catch {
      return [trimmed];
    }
  }
  if (Array.isArray(value)) return value.slice(0, 5).flatMap((item) => readSignalValues(item, depth + 1));
  if (!isPlainRecord(value)) return [];

  return [value.errorCode, value.code, value.message, value.error]
    .flatMap((item) => readSignalValues(item, depth + 1))
    .slice(0, 12);
}

function findExactBackendAuthCode(body: unknown, error: unknown): ControlledAuthErrorCode | null {
  for (const candidate of [...readBackendCodeCandidates(body), ...readBackendCodeCandidates(error)]) {
    const mapped = BACKEND_AUTH_ERROR_CODE_MAP[candidate.trim().toUpperCase()];
    if (mapped) return mapped;
  }
  return null;
}

function readBackendCodeCandidates(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (BACKEND_AUTH_ERROR_CODE_MAP[trimmed.toUpperCase()]) return [trimmed];
    try {
      return readBackendCodeCandidates(JSON.parse(trimmed), depth + 1);
    } catch {
      return [];
    }
  }
  if (value instanceof Error) {
    const errorWithCode = value as Error & { code?: unknown; errorCode?: unknown };
    return [errorWithCode.errorCode, errorWithCode.code]
      .flatMap((item) => readBackendCodeCandidates(item, depth + 1));
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).flatMap((item) => readBackendCodeCandidates(item, depth + 1));
  }
  if (!isPlainRecord(value)) return [];
  return [value.errorCode, value.code]
    .flatMap((item) => readBackendCodeCandidates(item, depth + 1));
}

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function isRetryableAuthError(code: ControlledAuthErrorCode): boolean {
  return code === "network_unavailable"
    || code === "rate_limited"
    || code === "server_unavailable"
    || code === "google_sign_in_cancelled"
    || code === "google_sign_in_failed"
    || code === "apple_sign_in_cancelled"
    || code === "apple_sign_in_failed"
    || code === "unknown";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
