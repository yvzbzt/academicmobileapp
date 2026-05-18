import { Injectable } from "@nestjs/common";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

export interface PushMessageInput {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  providerMessageId?: string;
  invalidToken: boolean;
}

export interface PushSender {
  send(input: PushMessageInput): Promise<PushSendResult>;
}

@Injectable()
export class FirebasePushSender implements PushSender {
  constructor() {
    if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
    }
  }

  async send(input: PushMessageInput): Promise<PushSendResult> {
    if (!getApps().length) throw new Error("FIREBASE_NOT_CONFIGURED");
    try {
      const providerMessageId = await getMessaging().send({
        token: input.token,
        notification: { title: input.title, body: input.body },
        ...(input.data ? { data: input.data } : {})
      });
      return { providerMessageId, invalidToken: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { invalidToken: message.includes("registration-token") || message.includes("invalid-argument") };
    }
  }
}
