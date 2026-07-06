import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  useDeviceLanguage,
  type Auth
} from "firebase/auth";

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyCtlK38zMVpz04lMdHcLzJQKzMMDjjBvO4",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "academic-mobile-app-7629.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "academic-mobile-app-7629",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "academic-mobile-app-7629.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "315186329318",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:315186329318:web:f44c4e262896d87679ad27"
};

let authClient: Auth | null | undefined;

export function getGoogleAuthClient(): Auth | null {
  if (authClient !== undefined) return authClient;
  if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) {
    authClient = null;
    return authClient;
  }

  const app = getApps()[0] ?? initializeApp(firebaseConfig);
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
  if (code === "auth/unauthorized-domain") return "Bu alan adı Firebase'de Google girişi için yetkilendirilmemiş.";
  if (code === "auth/network-request-failed") return "Google girişi Firebase'e ulaşamadı. Bağlantıyı kontrol edip tekrar deneyin.";
  return error instanceof Error ? error.message : "Google ile giriş tamamlanamadı.";
}

function getFirebaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}
