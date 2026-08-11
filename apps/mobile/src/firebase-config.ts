import type { FirebaseOptions } from "firebase/app";

export const FIREBASE_WEB_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID"
] as const;

export type FirebaseWebEnvKey = typeof FIREBASE_WEB_ENV_KEYS[number];
export type FirebaseWebEnvironment = Partial<Record<FirebaseWebEnvKey, string | undefined>>;

export type FirebaseWebConfiguration =
  | { configured: true; options: FirebaseOptions }
  | { configured: false; missing: FirebaseWebEnvKey[]; message: string };

export function readFirebaseWebConfiguration(env: FirebaseWebEnvironment): FirebaseWebConfiguration {
  const missing = FIREBASE_WEB_ENV_KEYS.filter((key) => !normalized(env[key]));
  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      message: `Firebase web authentication is not configured. Missing environment variables: ${missing.join(", ")}.`
    };
  }

  return {
    configured: true,
    options: {
      apiKey: normalized(env.VITE_FIREBASE_API_KEY),
      authDomain: normalized(env.VITE_FIREBASE_AUTH_DOMAIN),
      projectId: normalized(env.VITE_FIREBASE_PROJECT_ID),
      storageBucket: normalized(env.VITE_FIREBASE_STORAGE_BUCKET),
      messagingSenderId: normalized(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
      appId: normalized(env.VITE_FIREBASE_APP_ID)
    }
  };
}

function normalized(value: string | undefined): string {
  return value?.trim() ?? "";
}
