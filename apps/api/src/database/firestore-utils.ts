import { randomUUID } from "node:crypto";
import type { DocumentData, DocumentSnapshot, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";

export function newFirestoreId(): string {
  return randomUUID();
}

export function toFirestoreRecord<TRecord extends { id: string }>(document: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>): TRecord | null {
  if (!document.exists) return null;
  return { id: document.id, ...(normalizeFirestoreValue(document.data() ?? {}) as Record<string, unknown>) } as TRecord;
}

export async function getAllFirestoreRecords<TRecord extends { id: string }>(query: Query<DocumentData>): Promise<TRecord[]> {
  const snapshot = await query.get();
  return snapshot.docs.map((document) => toFirestoreRecord<TRecord>(document)).filter((record): record is TRecord => Boolean(record));
}

export function cleanFirestoreData(value: Record<string, unknown>): Record<string, unknown> {
  return removeUndefined(value) as Record<string, unknown>;
}

function normalizeFirestoreValue(value: unknown): unknown {
  if (isTimestampLike(value)) return value.toDate();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeFirestoreValue(item)]));
  }
  return value;
}

function removeUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(removeUndefined).filter((item) => item !== undefined);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, removeUndefined(item)] as const)
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

function isTimestampLike(value: unknown): value is { toDate: () => Date } {
  return isRecord(value) && typeof value.toDate === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
