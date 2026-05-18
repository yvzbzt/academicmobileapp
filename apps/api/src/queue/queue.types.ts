export interface QueueJobRecord<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  payload: TPayload;
  status: "queued" | "processing" | "completed" | "failed";
  runAt: Date;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueService {
  enqueue<TPayload extends Record<string, unknown>>(name: string, payload: TPayload, input?: { runAt?: Date }): Promise<QueueJobRecord<TPayload>>;
  listQueued(name?: string): Promise<QueueJobRecord[]>;
}
