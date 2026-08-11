export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RECOVERY_CODE_LENGTH = 6;
export const AUTH_PASSWORD_REQUIRED_CHARACTER_GROUPS = 3;

export interface AuthPasswordRequirements {
  minimumLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  digit: boolean;
  special: boolean;
  characterGroupCount: number;
  characterGroupsComplete: boolean;
}

/** Shared password truth for registration, recovery, and the visual checklist. */
export function evaluateAuthPassword(password: string): AuthPasswordRequirements {
  const uppercase = /[A-Z]/u.test(password);
  const lowercase = /[a-z]/u.test(password);
  const digit = /\d/u.test(password);
  const special = /[^\p{L}\d\s]/u.test(password);
  const characterGroupCount = [uppercase, lowercase, digit, special]
    .filter(Boolean)
    .length;

  return {
    minimumLength: password.length >= AUTH_PASSWORD_MIN_LENGTH,
    uppercase,
    lowercase,
    digit,
    special,
    characterGroupCount,
    characterGroupsComplete: characterGroupCount >= AUTH_PASSWORD_REQUIRED_CHARACTER_GROUPS,
  };
}

export function isAuthPasswordStrong(password: string): boolean {
  const requirements = evaluateAuthPassword(password);
  return requirements.minimumLength && requirements.characterGroupsComplete;
}

export const AUTH_ENDPOINTS = {
  login: "/auth/login",
  passwordRecoveryConfirm: "/auth/password-recovery/confirm",
  passwordRecoveryRequest: "/auth/password-recovery/request",
  register: "/auth/register",
  resendVerificationCode: "/auth/resend-verification-code",
  verifyEmail: "/auth/verify-email"
} as const;

export const PENDING_VERIFICATION_STORAGE_KEY = "native_pending_email_verification";

export type PendingVerificationRecord = {
  email: string;
  verificationExpiresAt: string;
  resendAvailableAt?: string;
};

export type VerificationTiming = {
  expired: boolean;
  expiresInSeconds: number;
  resendInSeconds: number;
};

export type PendingPasswordRecoveryRecord = {
  email: string;
  recoveryExpiresAt: string;
  resendAvailableAt: string;
};

export type PasswordRecoveryValidationCode =
  | "invalid_email"
  | "invalid_code"
  | "password_too_short"
  | "password_too_weak"
  | "password_confirmation_mismatch";

export type PasswordRecoveryValidationResult =
  | { valid: true }
  | { valid: false; code: PasswordRecoveryValidationCode; message: string };

export type HydrationStatus = "loading" | "ready" | "error";
export type RootSurface = "hydration_loading" | "hydration_error" | "login" | "home";

export function createPendingVerificationRecord(input: {
  email: string;
  verificationExpiresAt: string;
  resendAvailableAt?: string;
}): PendingVerificationRecord {
  const email = input.email.trim().toLowerCase();
  if (!email || !isValidIsoDate(input.verificationExpiresAt)) {
    throw new Error("Invalid pending verification record.");
  }

  return {
    email,
    verificationExpiresAt: new Date(input.verificationExpiresAt).toISOString(),
    ...(isValidIsoDate(input.resendAvailableAt)
      ? { resendAvailableAt: new Date(input.resendAvailableAt as string).toISOString() }
      : {})
  };
}

export function parsePendingVerificationRecord(raw: string | null): PendingVerificationRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingVerificationRecord>;
    if (typeof parsed.email !== "string" || typeof parsed.verificationExpiresAt !== "string") return null;
    return createPendingVerificationRecord({
      email: parsed.email,
      verificationExpiresAt: parsed.verificationExpiresAt,
      ...(typeof parsed.resendAvailableAt === "string" ? { resendAvailableAt: parsed.resendAvailableAt } : {})
    });
  } catch {
    return null;
  }
}

export function getVerificationTiming(
  record: PendingVerificationRecord,
  nowMs = Date.now()
): VerificationTiming {
  const expiresInSeconds = Math.max(0, Math.ceil((Date.parse(record.verificationExpiresAt) - nowMs) / 1_000));
  const resendInSeconds = record.resendAvailableAt
    ? Math.max(0, Math.ceil((Date.parse(record.resendAvailableAt) - nowMs) / 1_000))
    : 0;
  return {
    expired: expiresInSeconds === 0,
    expiresInSeconds,
    resendInSeconds
  };
}

export function isValidPasswordRecoveryEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

/**
 * Keeps password-recovery timing in memory only. Recovery codes and passwords
 * are intentionally excluded so callers cannot persist them with this record.
 */
export function createPendingPasswordRecoveryRecord(input: {
  email: string;
  recoveryExpiresAt: string;
  resendAvailableAt: string;
}): PendingPasswordRecoveryRecord {
  const email = input.email.trim().toLowerCase();
  if (
    !isValidPasswordRecoveryEmail(email)
    || !isValidIsoDate(input.recoveryExpiresAt)
    || !isValidIsoDate(input.resendAvailableAt)
  ) {
    throw new Error("Invalid pending password-recovery record.");
  }

  return {
    email,
    recoveryExpiresAt: new Date(input.recoveryExpiresAt).toISOString(),
    resendAvailableAt: new Date(input.resendAvailableAt).toISOString()
  };
}

export function getPasswordRecoveryTiming(
  record: PendingPasswordRecoveryRecord,
  nowMs = Date.now()
): VerificationTiming {
  return {
    expired: Date.parse(record.recoveryExpiresAt) <= nowMs,
    expiresInSeconds: Math.max(0, Math.ceil((Date.parse(record.recoveryExpiresAt) - nowMs) / 1_000)),
    resendInSeconds: Math.max(0, Math.ceil((Date.parse(record.resendAvailableAt) - nowMs) / 1_000))
  };
}

export function validatePasswordRecoveryRequest(email: string): PasswordRecoveryValidationResult {
  if (!isValidPasswordRecoveryEmail(email)) {
    return {
      valid: false,
      code: "invalid_email",
      message: "Geçerli bir e-posta adresi gir."
    };
  }
  return { valid: true };
}

export function validatePasswordRecoveryConfirmation(input: {
  code: string;
  newPassword: string;
  passwordConfirmation: string;
}): PasswordRecoveryValidationResult {
  const passwordRequirements = evaluateAuthPassword(input.newPassword);
  if (!new RegExp(`^\\d{${PASSWORD_RECOVERY_CODE_LENGTH}}$`).test(input.code.trim())) {
    return {
      valid: false,
      code: "invalid_code",
      message: `Sıfırlama kodu ${PASSWORD_RECOVERY_CODE_LENGTH} haneli olmalıdır.`
    };
  }
  if (!passwordRequirements.minimumLength) {
    return {
      valid: false,
      code: "password_too_short",
      message: `Yeni şifren en az ${AUTH_PASSWORD_MIN_LENGTH} karakter olmalıdır.`
    };
  }
  if (!passwordRequirements.characterGroupsComplete) {
    return {
      valid: false,
      code: "password_too_weak",
      message: "Yeni şifren büyük harf, küçük harf, rakam ve özel karakter gruplarından en az üçünü içermelidir."
    };
  }
  if (input.newPassword !== input.passwordConfirmation) {
    return {
      valid: false,
      code: "password_confirmation_mismatch",
      message: "Yeni şifre ve şifre tekrarı aynı olmalıdır."
    };
  }
  return { valid: true };
}

export function rootSurfaceForHydration(status: HydrationStatus, hasSession: boolean): RootSurface {
  if (status === "loading") return "hydration_loading";
  if (status === "error") return "hydration_error";
  return hasSession ? "home" : "login";
}

function isValidIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
