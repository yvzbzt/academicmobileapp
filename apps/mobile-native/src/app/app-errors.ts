import { type AccountCleanupTarget } from "../auth/session-integrity";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export class StaleAccountRequestError extends Error {
  constructor() {
    super("Stale account request ignored.");
    this.name = "StaleAccountRequestError";
  }
}

export type ApiErrorPayload = {
  errorCode?: string;
  message?: unknown;
  error?: unknown;
  resendAvailableAt?: string;
  details?: Record<string, unknown>;
};

export function readApiErrorPayload(body: string): ApiErrorPayload {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const payload = parsed as Record<string, unknown>;
    const details = payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
      ? payload.details as Record<string, unknown>
      : undefined;
    return {
      ...(typeof payload.errorCode === "string" ? { errorCode: payload.errorCode } : {}),
      ...(typeof payload.message === "string" || Array.isArray(payload.message) ? { message: payload.message } : {}),
      ...(typeof payload.error === "string" ? { error: payload.error } : {}),
      ...(typeof payload.resendAvailableAt === "string" ? { resendAvailableAt: payload.resendAvailableAt } : {}),
      ...(details ? { details } : {})
    };
  } catch {
    return {};
  }
}

export function parseApiErrorMessage(body: string, fallback: string, status?: number): string {
  const trimmed = body.trim();
  if (!trimmed) return toUserFacingErrorMessage(fallback, status);

  try {
    const payload = JSON.parse(trimmed) as { message?: unknown; error?: unknown };
    if (Array.isArray(payload.message)) return toUserFacingErrorMessage(payload.message.map(String).join(" "), status);
    if (typeof payload.message === "string" && payload.message.trim()) return toUserFacingErrorMessage(payload.message.trim(), status);
    if (typeof payload.error === "string" && payload.error.trim()) return toUserFacingErrorMessage(payload.error.trim(), status);
  } catch {
    // Never surface an untrusted raw response body.
  }

  return toUserFacingErrorMessage(fallback, status);
}

export function toUserFacingErrorMessage(message: string, status?: number): string {
  const normalized = message.toLocaleLowerCase("tr-TR");

  if (status === 0 || normalized.includes("network request failed") || normalized.includes("failed to fetch")) {
    return "Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.";
  }
  if (status === 401 || normalized.includes("unauthorized") || normalized.includes("token") || normalized.includes("jwt")) {
    return "Oturum süren dolmuş olabilir. Lütfen tekrar giriş yap.";
  }
  if (status === 403 || normalized.includes("forbidden")) {
    return "Bu işlem için yetkin yok.";
  }
  if (status === 404 || normalized.includes("not found")) {
    return "İstenen bilgi bulunamadı.";
  }
  if (status === 429 || normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Çok sık denedin. Biraz bekleyip tekrar dene.";
  }
  if (status && status >= 500) {
    return "Şu anda işlem tamamlanamadı. Biraz sonra tekrar dene.";
  }
  if (normalized.includes("user must select a university")) {
    return "Devam etmek için önce Profil sekmesinden üniversiteni seçmelisin.";
  }
  if (normalized.includes("invalid") && normalized.includes("google")) {
    return "Google oturumu doğrulanamadı. Lütfen tekrar dene.";
  }
  if (
    normalized.includes("react-native-google-signin")
    || normalized.includes("developer_error")
    || normalized.includes("api_exception: 10")
    || normalized.includes("status code: 10")
    || normalized.includes("troubleshooting")
  ) {
    return "Bu APK için Google giriş ayarları tamamlanmamış görünüyor. Lütfen uygulamanın güncel sürümünü kullan veya e-posta ile giriş yap.";
  }
  if (normalized.startsWith("{") || normalized.includes("statuscode") || normalized.includes("exception")) {
    return "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar dene.";
  }

  return "İşlem tamamlanamadı. Lütfen tekrar dene.";
}

export function userMessageFromError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return toUserFacingErrorMessage(error.message);
  if (typeof error === "string") return toUserFacingErrorMessage(error);
  return fallback;
}

export function cleanupTargetLabel(target: AccountCleanupTarget): string {
  const labels: Record<AccountCleanupTarget, string> = {
    server_session: "sunucu oturumu",
    server_account: "sunucudaki hesap silme işlemi",
    device_registration: "cihaz bildirim kaydı",
    session_storage: "cihaz oturumu",
    pending_verification_storage: "doğrulama kurtarma kaydı",
    pending_notification_storage: "bekleyen bildirim hedefi",
    manual_exam_storage: "kişisel takvim kaydı",
    google_connection_storage: "Google Takvim bağlantı kaydı",
    google_managed_events: "Google Takvim'e eklenen uygulama kayıtları",
    google_access: "Google erişim izni",
    google_sign_in: "Google hesap seçimi",
    apple_managed_events: "Apple Takvim'e eklenen uygulama kayıtları",
    in_memory_state: "ekrandaki hesap verileri"
  };
  return labels[target];
}
