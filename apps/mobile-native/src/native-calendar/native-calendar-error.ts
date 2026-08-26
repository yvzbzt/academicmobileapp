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
