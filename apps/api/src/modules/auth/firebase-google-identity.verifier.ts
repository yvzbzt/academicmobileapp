import { Inject, Injectable } from "@nestjs/common";
import { getAuth } from "firebase-admin/auth";
import { FirebaseAdminService } from "../../database/firebase-admin.service.js";

export interface VerifiedGoogleIdentity {
  uid: string;
  email?: string;
  emailVerified: boolean;
  signInProvider?: string;
  fullName?: string;
}

export interface GoogleIdentityVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
}

@Injectable()
export class FirebaseGoogleIdentityVerifier implements GoogleIdentityVerifier {
  constructor(@Inject(FirebaseAdminService) private readonly firebaseAdmin: FirebaseAdminService) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    const allowedGoogleClientIds = readAllowedGoogleClientIds();
    let firebaseError: unknown;

    try {
      const decoded = await getAuth(this.firebaseAdmin.getApp()).verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        ...(decoded.email ? { email: decoded.email } : {}),
        emailVerified: decoded.email_verified === true,
        ...(decoded.firebase.sign_in_provider ? { signInProvider: decoded.firebase.sign_in_provider } : {}),
        ...(typeof decoded.name === "string" && decoded.name.trim() ? { fullName: decoded.name.trim() } : {})
      };
    } catch (error) {
      firebaseError = error;
    }

    if (allowedGoogleClientIds.length > 0) {
      return verifyGoogleOAuthIdToken(idToken, allowedGoogleClientIds);
    }

    if (firebaseError instanceof Error) throw firebaseError;
    throw new Error("GOOGLE_TOKEN_INVALID");
  }
}

type GoogleTokenInfoResponse = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  error?: string;
};

async function verifyGoogleOAuthIdToken(idToken: string, allowedClientIds: string[]): Promise<VerifiedGoogleIdentity> {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
    signal: AbortSignal.timeout(8000)
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenInfoResponse;
  if (!response.ok || payload.error) throw new Error("GOOGLE_TOKEN_INVALID");
  if (!payload.sub) throw new Error("GOOGLE_TOKEN_MISSING_SUBJECT");
  if (!payload.aud || !allowedClientIds.includes(payload.aud)) throw new Error("GOOGLE_TOKEN_AUDIENCE_MISMATCH");

  return {
    uid: `google:${payload.sub}`,
    ...(payload.email ? { email: payload.email } : {}),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    signInProvider: "google.com",
    ...(typeof payload.name === "string" && payload.name.trim() ? { fullName: payload.name.trim() } : {})
  };
}

function readAllowedGoogleClientIds(): string[] {
  const values = [
    process.env.GOOGLE_OAUTH_CLIENT_IDS,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
  ];

  return [...new Set(values.flatMap((value) => (value ?? "").split(/[,\s]+/)).map((value) => value.trim()).filter(Boolean))];
}
