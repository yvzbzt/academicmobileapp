import { createHash } from "node:crypto";
import type { NotificationJobRecord } from "./notification.types.js";

const ATTEMPT_IDENTITY_DOMAIN = "academic-mobile:notification-delivery-attempt:v1\0";

export function notificationDeliveryAttemptVersion(
  job: Pick<NotificationJobRecord, "revision" | "deliveryAttemptEpoch" | "attemptCount">
): string {
  return `${job.revision}:${job.deliveryAttemptEpoch}:${job.attemptCount + 1}`;
}

export function createNotificationDeliveryAttemptIdentity(input: {
  jobId: string;
  deviceInstallationHash: string;
  attemptVersion: string;
}): string {
  if (!input.jobId.trim() || !input.deviceInstallationHash.trim() || !input.attemptVersion.trim()) {
    throw new Error("NOTIFICATION_DELIVERY_ATTEMPT_IDENTITY_INVALID");
  }
  return createHash("sha256")
    .update(ATTEMPT_IDENTITY_DOMAIN)
    .update(input.jobId)
    .update("\0")
    .update(input.deviceInstallationHash)
    .update("\0")
    .update(input.attemptVersion)
    .digest("hex");
}

export function safeProviderMessageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/u.test(normalized)) return undefined;
  return normalized;
}
