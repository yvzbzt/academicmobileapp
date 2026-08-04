import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  useDeviceLanguage,
  type Auth
} from "firebase/auth";
import { readFirebaseWebConfiguration } from "./firebase-config.js";

const firebaseConfiguration = readFirebaseWebConfiguration({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID
});

let authClient: Auth | null | undefined;

export function getGoogleAuthClient(): Auth | null {
  if (authClient !== undefined) return authClient;
  if (!firebaseConfiguration.configured) {
    authClient = null;
    return authClient;
  }

  const app = getApps()[0] ?? initializeApp(firebaseConfiguration.options);
  authClient = getAuth(app);
  useDeviceLanguage(authClient);
  return authClient;
}

export function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export function shouldUseGoogleRedirect(error: unknown): boolean {
  const code = getFirebaseErrorCode(error);
  return code === "auth/popup-blocked" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

export function formatGoogleAuthError(error: unknown): string {
  const code = getFirebaseErrorCode(error);
  if (code === "auth/popup-closed-by-user") return "Google ile giriş tamamlanmadan kapatıldı.";
  if (code === "auth/popup-blocked") return "Tarayıcınız Google giriş penceresini engelledi.";
  if (code === "auth/unauthorized-domain") return "Bu adres Google ile giriş için henüz yetkilendirilmemiş. Lütfen daha sonra tekrar deneyin.";
  if (code === "auth/network-request-failed") return "Google girişine şu anda ulaşılamıyor. Bağlantıyı kontrol edip tekrar deneyin.";
  return error instanceof Error ? error.message : "Google ile giriş tamamlanamadı.";
}

function getFirebaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}
