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
  | { status: "failed"; reason: "provider_unavailable" | "provider_rejected" };

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
      const code = firebaseMessagingErrorCode(error);
      if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
        return { status: "invalid_token" };
      }
      if (
        code === "messaging/server-unavailable"
        || code === "messaging/internal-error"
        || code === "messaging/unknown-error"
        || (error instanceof Error && error.message === "FIREBASE_NOT_CONFIGURED")
      ) {
        return { status: "failed", reason: "provider_unavailable" };
      }
      return { status: "failed", reason: "provider_rejected" };
    }
  }
}

function firebaseMessagingErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
