/** User-owned persistence contract for locally created manual exams. */
export const LEGACY_MANUAL_EXAMS_STORAGE_KEY = "native_manual_exams";

const MANUAL_EXAMS_STORAGE_PREFIX = "native_manual_exams_v2";
const MANUAL_EXAM_ENVELOPE_VERSION = 2;
const MAX_MANUAL_EXAMS = 500;

export type ManualExamRecord = {
  id: string;
  title: string;
  examDate: string;
};

export type ManualExamEnvelope = {
  schemaVersion: typeof MANUAL_EXAM_ENVELOPE_VERSION;
  ownerId: string;
  exams: ManualExamRecord[];
  updatedAt: string;
};

export type ManualExamEnvelopeReadResult =
  | { status: "missing"; exams: []; shouldDelete: false }
  | { status: "loaded"; exams: ManualExamRecord[]; updatedAt: string; shouldDelete: false }
  | { status: "invalid" | "owner_mismatch"; exams: []; shouldDelete: true };

export type LegacyManualExamMigrationPlan =
  | { status: "no_data" }
  | { status: "discard_unowned" | "discard_owner_mismatch" | "discard_invalid" }
  | { status: "migrate"; serializedEnvelope: string; examCount: number };

export type LegacyManualExamMigrationInput = {
  legacyValue: string | null | undefined;
  currentOwnerId: string;
  /**
   * Ownership proof recorded when the legacy value was written. The account
   * that happens to be signed in now is not ownership proof.
   */
  verifiedLegacyOwnerId?: string;
  updatedAt?: string;
};

export function createManualExamStorageKey(ownerId: string): string {
  return `${MANUAL_EXAMS_STORAGE_PREFIX}_${encodeStorageKeyPart(requireOwnerId(ownerId))}`;
}

export function createManualExamEnvelope(
  ownerId: string,
  exams: readonly ManualExamRecord[],
  updatedAt = new Date().toISOString()
): ManualExamEnvelope {
  const normalizedExams = normalizeManualExamList(exams);
  if (!normalizedExams) throw new Error("Manual exam data is invalid.");

  return {
    schemaVersion: MANUAL_EXAM_ENVELOPE_VERSION,
    ownerId: requireOwnerId(ownerId),
    exams: normalizedExams,
    updatedAt: normalizeTimestamp(updatedAt)
  };
}

export function serializeManualExamEnvelope(
  ownerId: string,
  exams: readonly ManualExamRecord[],
  updatedAt?: string
): string {
  return JSON.stringify(createManualExamEnvelope(ownerId, exams, updatedAt));
}

export function readManualExamEnvelope(
  rawValue: string | null | undefined,
  expectedOwnerId: string
): ManualExamEnvelopeReadResult {
  if (rawValue === null || rawValue === undefined) {
    return { status: "missing", exams: [], shouldDelete: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return { status: "invalid", exams: [], shouldDelete: true };
  }

  if (!isPlainRecord(parsed) || parsed.schemaVersion !== MANUAL_EXAM_ENVELOPE_VERSION) {
    return { status: "invalid", exams: [], shouldDelete: true };
  }

  const storedOwnerId = readNonEmptyString(parsed.ownerId);
  if (!storedOwnerId) return { status: "invalid", exams: [], shouldDelete: true };
  if (storedOwnerId !== requireOwnerId(expectedOwnerId)) {
    return { status: "owner_mismatch", exams: [], shouldDelete: true };
  }

  const exams = normalizeManualExamList(parsed.exams);
  const updatedAt = readTimestamp(parsed.updatedAt);
  if (!exams || !updatedAt) return { status: "invalid", exams: [], shouldDelete: true };

  return { status: "loaded", exams, updatedAt, shouldDelete: false };
}

/**
 * Plans the one-time transition away from the old global storage key.
 *
 * Existing production legacy values have no owner metadata. They must be
 * discarded, not assigned to whichever account signs in first. Migration is
 * allowed only when the caller has separate, trusted ownership proof.
 */
export function planLegacyManualExamMigration(
  input: LegacyManualExamMigrationInput
): LegacyManualExamMigrationPlan {
  if (input.legacyValue === null || input.legacyValue === undefined) return { status: "no_data" };

  const currentOwnerId = requireOwnerId(input.currentOwnerId);
  if (!input.verifiedLegacyOwnerId?.trim()) return { status: "discard_unowned" };
  if (requireOwnerId(input.verifiedLegacyOwnerId) !== currentOwnerId) {
    return { status: "discard_owner_mismatch" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.legacyValue);
  } catch {
    return { status: "discard_invalid" };
  }

  const exams = normalizeManualExamList(parsed);
  if (!exams) return { status: "discard_invalid" };

  return {
    status: "migrate",
    serializedEnvelope: serializeManualExamEnvelope(currentOwnerId, exams, input.updatedAt),
    examCount: exams.length
  };
}

function normalizeManualExamList(value: unknown): ManualExamRecord[] | null {
  if (!Array.isArray(value) || value.length > MAX_MANUAL_EXAMS) return null;

  const normalized: ManualExamRecord[] = [];
  for (const candidate of value) {
    if (!isPlainRecord(candidate)) return null;

    const id = readNonEmptyString(candidate.id);
    const title = readNonEmptyString(candidate.title);
    const examDate = readTimestamp(candidate.examDate);
    if (!id || !title || !examDate) return null;

    // Pick only the persistence contract fields. Runtime-added credentials or
    // other properties must never hitchhike into the stored envelope.
    normalized.push({ id, title, examDate });
  }

  return normalized;
}

function requireOwnerId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("A manual-exam owner is required.");
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const normalized = readTimestamp(value);
  if (!normalized) throw new Error("A valid timestamp is required.");
  return normalized;
}

function readTimestamp(value: unknown): string | null {
  const normalized = readNonEmptyString(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) return null;
  return normalized;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeStorageKeyPart(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("_");
}
