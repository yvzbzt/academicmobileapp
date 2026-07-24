import { Inject, Injectable } from "@nestjs/common";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { FirestoreDatabaseService } from "../../database/firestore.service.js";
import { cleanFirestoreData, getAllFirestoreRecords, newFirestoreId, toFirestoreRecord } from "../../database/firestore-utils.js";
import type { DeviceTokenRecord, NotificationDeliveryRecord, NotificationJobRecord, NotificationJobStatus, NotificationPreferenceRecord, NotificationRepository, StudentAlarmRecord } from "./notification.types.js";

@Injectable()
export class FirestoreNotificationRepository implements NotificationRepository {
  constructor(@Inject(FirestoreDatabaseService) private readonly firestore: FirestoreDatabaseService) {}

  async upsertDeviceToken(input: Omit<DeviceTokenRecord, "id" | "createdAt" | "updatedAt" | "lastSeenAt" | "status">): Promise<DeviceTokenRecord> {
    const now = new Date();
    const existing = (await getAllFirestoreRecords<DeviceTokenRecord>(this.deviceTokens.where("token", "==", input.token)))[0];
    const device: DeviceTokenRecord = {
      ...(existing ?? { id: newFirestoreId(), createdAt: now }),
      userId: input.userId,
      platform: input.platform,
      token: input.token,
      status: "active",
      lastSeenAt: now,
      updatedAt: now
    };
    await this.deviceTokens.doc(device.id).set(cleanFirestoreData(device as unknown as Record<string, unknown>));
    return device;
  }

  async findPreferencesByUserId(userId: string): Promise<NotificationPreferenceRecord | null> {
    const snapshot = await this.preferences.where("userId", "==", userId).limit(1).get();
    return snapshot.docs[0] ? toFirestoreRecord<NotificationPreferenceRecord>(snapshot.docs[0]) : null;
  }

  async upsertPreferences(input: Omit<NotificationPreferenceRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationPreferenceRecord> {
    const now = new Date();
    const existing = await this.findPreferencesByUserId(input.userId);
    const preferences: NotificationPreferenceRecord = {
      ...(existing ?? { id: newFirestoreId(), createdAt: now }),
      userId: input.userId,
      enabled: input.enabled,
      categories: input.categories,
      reminderOffsets: [...new Set(input.reminderOffsets)].sort((left, right) => right - left),
      ...(input.reminderRules ? { reminderRules: input.reminderRules } : {}),
      ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      updatedAt: now
    };
    await this.preferences.doc(preferences.id).set(cleanFirestoreData(preferences as unknown as Record<string, unknown>));
    return preferences;
  }

  async createNotificationJobs(input: Array<Omit<NotificationJobRecord, "id" | "createdAt" | "updatedAt">>): Promise<NotificationJobRecord[]> {
    const existingJobs = await getAllFirestoreRecords<NotificationJobRecord>(this.jobs);
    const now = new Date();
    const created: NotificationJobRecord[] = [];
    const batch = this.firestore.getDb().batch();
    for (const jobInput of input) {
      const duplicate = existingJobs.find((job) => notificationJobIdentityKey(job) === notificationJobIdentityKey(jobInput) && notificationJobReminderKey(job) === notificationJobReminderKey(jobInput) && job.status !== "cancelled");
      if (duplicate) continue;
      const job: NotificationJobRecord = { ...jobInput, id: newFirestoreId(), createdAt: now, updatedAt: now };
      batch.set(this.jobs.doc(job.id), cleanFirestoreData(job as unknown as Record<string, unknown>));
      created.push(job);
    }
    await batch.commit();
    return created;
  }

  async createStudentAlarm(input: Omit<StudentAlarmRecord, "id" | "createdAt" | "updatedAt">): Promise<StudentAlarmRecord> {
    const now = new Date();
    const existing = (await getAllFirestoreRecords<StudentAlarmRecord>(this.studentAlarms.where("userId", "==", input.userId)))
      .find((alarm) =>
        alarm.targetId === input.targetId &&
        alarm.eventType === input.eventType &&
        alarm.trigger === input.trigger &&
        alarm.amount === input.amount &&
        alarm.unit === input.unit &&
        alarm.status !== "cancelled"
      );
    const alarm: StudentAlarmRecord = {
      ...(existing ?? { id: newFirestoreId(), createdAt: now }),
      ...input,
      updatedAt: now
    };
    await this.studentAlarms.doc(alarm.id).set(cleanFirestoreData(alarm as unknown as Record<string, unknown>), { merge: false });
    return alarm;
  }

  async listStudentAlarmsByUser(userId: string): Promise<StudentAlarmRecord[]> {
    return (await getAllFirestoreRecords<StudentAlarmRecord>(this.studentAlarms.where("userId", "==", userId)))
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  async cancelStudentAlarm(userId: string, alarmId: string): Promise<StudentAlarmRecord | null> {
    const alarm = toFirestoreRecord<StudentAlarmRecord>(await this.studentAlarms.doc(alarmId).get());
    if (!alarm || alarm.userId !== userId) return null;
    const updated: StudentAlarmRecord = { ...alarm, status: "cancelled", updatedAt: new Date() };
    await this.studentAlarms.doc(alarmId).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    const jobs = await getAllFirestoreRecords<NotificationJobRecord>(this.jobs.where("alarmId", "==", alarmId));
    const batch = this.firestore.getDb().batch();
    for (const job of jobs) batch.set(this.jobs.doc(job.id), cleanFirestoreData({ ...job, status: "cancelled", updatedAt: new Date() } as unknown as Record<string, unknown>), { merge: false });
    await batch.commit();
    return updated;
  }

  async listJobsByCalendar(calendarId: string): Promise<NotificationJobRecord[]> {
    return (await getAllFirestoreRecords<NotificationJobRecord>(this.jobs.where("calendarId", "==", calendarId)))
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  async listDueJobs(now: Date, limit: number): Promise<NotificationJobRecord[]> {
    return (await getAllFirestoreRecords<NotificationJobRecord>(this.jobs.where("status", "==", "scheduled")))
      .filter((job) => job.scheduledAt <= now)
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())
      .slice(0, limit);
  }

  async listFailedJobs(limit: number, offset: number): Promise<NotificationJobRecord[]> {
    return (await getAllFirestoreRecords<NotificationJobRecord>(this.jobs.where("status", "==", "failed")))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(offset, offset + limit);
  }

  async listActiveDeviceTokens(limit: number, offset: number): Promise<DeviceTokenRecord[]> {
    return (await getAllFirestoreRecords<DeviceTokenRecord>(this.deviceTokens.where("status", "==", "active")))
      .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
      .slice(offset, offset + limit);
  }

  async recordDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt" | "updatedAt">): Promise<NotificationDeliveryRecord> {
    const now = new Date();
    const delivery: NotificationDeliveryRecord = { ...input, id: newFirestoreId(), createdAt: now, updatedAt: now };
    await this.deliveries.doc(delivery.id).set(cleanFirestoreData(delivery as unknown as Record<string, unknown>));
    return delivery;
  }

  async listDeliveriesByJob(jobId: string, limit: number, offset: number): Promise<NotificationDeliveryRecord[]> {
    return (await getAllFirestoreRecords<NotificationDeliveryRecord>(this.deliveries.where("jobId", "==", jobId)))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  updateJobStatus(jobId: string, status: NotificationJobStatus): Promise<NotificationJobRecord | null> {
    return this.updateJob(jobId, { status });
  }

  rescheduleJob(jobId: string, scheduledAt: Date): Promise<NotificationJobRecord | null> {
    return this.updateJob(jobId, { status: "scheduled", scheduledAt });
  }

  async disableDeviceToken(token: string): Promise<DeviceTokenRecord | null> {
    const device = (await getAllFirestoreRecords<DeviceTokenRecord>(this.deviceTokens.where("token", "==", token)))[0];
    if (!device) return null;
    const updated: DeviceTokenRecord = { ...device, status: "disabled", updatedAt: new Date() };
    await this.deviceTokens.doc(device.id).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  async deleteUserData(userId: string): Promise<void> {
    const [devices, preferences, alarms, jobs, deliveries] = await Promise.all([
      getAllFirestoreRecords<DeviceTokenRecord>(this.deviceTokens.where("userId", "==", userId)),
      getAllFirestoreRecords<NotificationPreferenceRecord>(this.preferences.where("userId", "==", userId)),
      getAllFirestoreRecords<StudentAlarmRecord>(this.studentAlarms.where("userId", "==", userId)),
      getAllFirestoreRecords<NotificationJobRecord>(this.jobs.where("userId", "==", userId)),
      getAllFirestoreRecords<NotificationDeliveryRecord>(this.deliveries.where("userId", "==", userId))
    ]);
    const batch = this.firestore.getDb().batch();
    for (const item of devices) batch.delete(this.deviceTokens.doc(item.id));
    for (const item of preferences) batch.delete(this.preferences.doc(item.id));
    for (const item of alarms) batch.delete(this.studentAlarms.doc(item.id));
    for (const item of jobs) batch.delete(this.jobs.doc(item.id));
    for (const item of deliveries) batch.delete(this.deliveries.doc(item.id));
    await batch.commit();
  }

  private async updateJob(jobId: string, input: Partial<Omit<NotificationJobRecord, "id" | "createdAt" | "updatedAt">>): Promise<NotificationJobRecord | null> {
    const job = toFirestoreRecord<NotificationJobRecord>(await this.jobs.doc(jobId).get());
    if (!job) return null;
    const updated: NotificationJobRecord = { ...job, ...input, updatedAt: new Date() };
    await this.jobs.doc(jobId).set(cleanFirestoreData(updated as unknown as Record<string, unknown>), { merge: false });
    return updated;
  }

  private get deviceTokens(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("device_tokens");
  }

  private get preferences(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("notification_preferences");
  }

  private get jobs(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("notification_jobs");
  }

  private get studentAlarms(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("student_alarms");
  }

  private get deliveries(): CollectionReference<DocumentData> {
    return this.firestore.getDb().collection("notification_deliveries");
  }
}

function notificationJobReminderKey(job: Pick<NotificationJobRecord, "trigger" | "offsetDays" | "offsetHours">): string {
  return `${job.trigger}:${job.offsetDays}:${job.offsetHours ?? 0}`;
}

function notificationJobIdentityKey(job: Pick<NotificationJobRecord, "userId" | "alarmId" | "eventId">): string {
  return `${job.userId ?? "broadcast"}:${job.alarmId ?? "event"}:${job.eventId}`;
}
