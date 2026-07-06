import { Inject, Injectable, Optional } from "@nestjs/common";
import { getMessaging } from "firebase-admin/messaging";
import { FirebaseAdminService } from "../../database/firebase-admin.service.js";

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
  constructor(@Optional() @Inject(FirebaseAdminService) private readonly firebaseAdmin?: FirebaseAdminService) {}

  async send(input: PushMessageInput): Promise<PushSendResult> {
    const app = (this.firebaseAdmin ?? new FirebaseAdminService()).getApp();
    try {
      const providerMessageId = await getMessaging(app).send({
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
