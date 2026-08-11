import { Inject, Injectable, Optional } from "@nestjs/common";
import { getMessaging } from "firebase-admin/messaging";
import { FirebaseAdminService } from "../../database/firebase-admin.service.js";

export interface PushMessageInput {
  token: string;
  title: string;
  body: string;
  androidChannelId: string;
  data?: Record<string, string>;
}

export type PushSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "invalid_token" }
  /** The provider or local adapter explicitly proved that no message was accepted. */
  | { status: "failed"; reason: "provider_unavailable" | "provider_rejected" }
  /** Acceptance is unknown; callers must fence and must not automatically resend. */
  | { status: "ambiguous"; reason: "provider_unavailable" | "provider_rejected"; providerMessageId?: string };

export interface PushSender {
  send(input: PushMessageInput): Promise<PushSendResult>;
}

@Injectable()
export class FirebasePushSender implements PushSender {
  constructor(@Optional() @Inject(FirebaseAdminService) private readonly firebaseAdmin?: FirebaseAdminService) {}

  async send(input: PushMessageInput): Promise<PushSendResult> {
    try {
      const app = (this.firebaseAdmin ?? new FirebaseAdminService()).getApp();
      const providerMessageId = await getMessaging(app).send({
        token: input.token,
        notification: { title: input.title, body: input.body },
        android: { notification: { channelId: input.androidChannelId } },
        ...(input.data ? { data: input.data } : {})
      });
      return { status: "sent", providerMessageId };
    } catch (error) {
      return classifyFirebaseMessagingFailure(error);
    }
  }
}

const DEFINITIVE_PROVIDER_REJECTION_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/mismatched-credential",
  "messaging/sender-id-mismatch",
  "messaging/third-party-auth-error"
]);

export function classifyFirebaseMessagingFailure(error: unknown): Exclude<PushSendResult, { status: "sent" }> {
  const code = firebaseMessagingErrorCode(error);
  if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
    return { status: "invalid_token" };
  }
  if (error instanceof Error && error.message === "FIREBASE_NOT_CONFIGURED") {
    return { status: "failed", reason: "provider_unavailable" };
  }
  if (code && DEFINITIVE_PROVIDER_REJECTION_CODES.has(code)) {
    return { status: "failed", reason: "provider_rejected" };
  }
  return { status: "ambiguous", reason: code ? "provider_unavailable" : "provider_rejected" };
}

function firebaseMessagingErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
