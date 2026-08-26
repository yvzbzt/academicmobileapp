import type { NativeCalendarConflictReason } from "./types";

export class NativeCalendarSafetyError extends Error {
  readonly reason: NativeCalendarConflictReason;

  constructor(reason: NativeCalendarConflictReason, message: string) {
    super(message);
    this.name = "NativeCalendarSafetyError";
    this.reason = reason;
  }
}

export function isNativeCalendarSafetyError(error: unknown): error is NativeCalendarSafetyError {
  return error instanceof NativeCalendarSafetyError;
}

export type NativeCalendarStorageErrorCode =
  | "read_failed"
  | "corrupt"
  | "unsupported_version"
  | "write_failed"
  | "delete_failed"
  | "recovery_incomplete"
  | "recovery_not_required"
  | "quarantine_failed";

export class NativeCalendarStorageError extends Error {
  readonly code: NativeCalendarStorageErrorCode;

  constructor(code: NativeCalendarStorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NativeCalendarStorageError";
    this.code = code;
  }
}

export function isNativeCalendarStorageError(error: unknown): error is NativeCalendarStorageError {
  return error instanceof NativeCalendarStorageError;
}
