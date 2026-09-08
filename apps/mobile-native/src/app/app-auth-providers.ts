import * as Crypto from "expo-crypto";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { Platform } from "react-native";

export const DEFAULT_GOOGLE_WEB_CLIENT_ID = "315186329318-911ks4c825vjrd5lpk608ugie7m8lujj.apps.googleusercontent.com";

export const GOOGLE_EXPO_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID);

export const GOOGLE_WEB_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) ?? GOOGLE_EXPO_CLIENT_ID ?? DEFAULT_GOOGLE_WEB_CLIENT_ID;

export const GOOGLE_IOS_CLIENT_ID = cleanEnvValue(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
  ?? resolveFirebaseIosClientId();

// Android OAuth identity is selected remotely from the package name and signing
// certificate. Release builds verify both upload and Play identities before Gradle runs.
export const GOOGLE_AUTH_CONFIGURED = Platform.select({
  android: Boolean(GOOGLE_WEB_CLIENT_ID),
  ios: Boolean(GOOGLE_WEB_CLIENT_ID && GOOGLE_IOS_CLIENT_ID),
  default: Boolean(GOOGLE_WEB_CLIENT_ID)
}) ?? false;

export const GOOGLE_AUTH_CONFIGURATION_MESSAGE = Platform.select({
  android: "Bu APK Google Web OAuth Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin.",
  ios: "Bu iOS derlemesi Google iOS Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin.",
  default: "Bu derleme Google Web Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin."
}) ?? "Bu derleme Google Client ID olmadan oluşturulmuş. Şimdilik e-posta ve şifre ile devam edebilirsin.";

export const GOOGLE_ID_TOKEN_CONFIGURATION_MESSAGE =
  "Google oturumu tamamlanamadı. Lütfen tekrar dene veya e-posta ile giriş yap.";

export const APPLE_AUTH_UNAVAILABLE_MESSAGE = "Apple ile giriş bu cihazda kullanılamıyor.";

export const APPLE_ID_TOKEN_ERROR_MESSAGE = "Apple oturumu doğrulama bilgisi alınamadı. Lütfen tekrar dene.";

export function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveFirebaseIosClientId(): string | undefined {
  if (Platform.OS !== "ios") return undefined;

  try {
    const firebaseApp = require("@react-native-firebase/app") as {
      getApp?: () => { options?: { clientId?: string } };
    };
    return cleanEnvValue(firebaseApp.getApp?.().options?.clientId);
  } catch {
    return undefined;
  }
}

export async function createAppleAuthenticationNonce(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function clearGoogleAccountSelection(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // No cached account to clear.
  }
}
