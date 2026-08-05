import {
  type AccountGenerationSnapshot,
  AccountGenerationGuard,
} from "../auth/session-integrity";
import {
  LEGACY_MANUAL_EXAMS_STORAGE_KEY,
  createManualExamStorageKey,
  planLegacyManualExamMigration,
  readManualExamEnvelope,
  serializeManualExamEnvelope,
  type ManualExamRecord,
} from "../session-integrity/manual-exam-storage";

export interface PersonalExamMutationInput {
  title: string;
  examDate: string;
}

export type PersonalExamMutationResult =
  | { ok: true }
  | { ok: false; error: string };

export interface PersonalExamRuntimeState {
  ownerId: string | null;
  hydrated: boolean;
  exams: ManualExamRecord[];
}

/** Matches the async method shape used by expo-secure-store. */
export interface PersonalExamSecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface PersonalExamRuntimeOptions {
  storage: PersonalExamSecureStoreAdapter;
  ownerGuard: AccountGenerationGuard;
  createId: () => string;
  onStateChange?: (state: PersonalExamRuntimeState) => void;
  onPersistenceError?: (ownerId: string, error: unknown) => void;
  now?: () => string;
}

export interface PersonalExamHydrationResult {
  legacyDiscarded: boolean;
}

export class StalePersonalExamOperationError extends Error {
  constructor() {
    super("Stale personal-exam operation ignored.");
    this.name = "StalePersonalExamOperationError";
  }
}

const EMPTY_STATE: PersonalExamRuntimeState = {
  ownerId: null,
  hydrated: false,
  exams: [],
};

/**
 * Production owner/state/persistence boundary for personal exams.
 *
 * React owns presentation state, while this runtime owns every mutation,
 * hydration, SecureStore envelope, and late-owner rejection used by App.
 */
export class PersonalExamRuntime {
  private state: PersonalExamRuntimeState = cloneState(EMPTY_STATE);
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PersonalExamRuntimeOptions) {}

  getSnapshot(): PersonalExamRuntimeState {
    return cloneState(this.state);
  }

  reset(): void {
    this.replaceState(EMPTY_STATE);
  }

  replaceAfterOwnerCleanup(ownerId: string, hydrated: boolean): void {
    this.replaceState({ ownerId: requireOwnerId(ownerId), hydrated, exams: [] });
  }

  async hydrate(
    ownerId: string,
    ownerSnapshot: AccountGenerationSnapshot,
  ): Promise<PersonalExamHydrationResult> {
    const normalizedOwnerId = requireOwnerId(ownerId);
    this.assertCurrentOwner(ownerSnapshot, normalizedOwnerId);
    this.replaceState({ ownerId: normalizedOwnerId, hydrated: false, exams: [] });

    const storageKey = createManualExamStorageKey(normalizedOwnerId);
    const stored = await this.options.storage.getItemAsync(storageKey);
    this.assertCurrentOwner(ownerSnapshot, normalizedOwnerId);
    const result = readManualExamEnvelope(stored, normalizedOwnerId);
    if (result.shouldDelete) {
      await this.options.storage.deleteItemAsync(storageKey);
      this.assertCurrentOwner(ownerSnapshot, normalizedOwnerId);
    }

    const legacyValue = await this.options.storage.getItemAsync(LEGACY_MANUAL_EXAMS_STORAGE_KEY);
    this.assertCurrentOwner(ownerSnapshot, normalizedOwnerId);
    const migration = planLegacyManualExamMigration({
      legacyValue,
      currentOwnerId: normalizedOwnerId,
    });
    if (migration.status !== "no_data") {
      await this.options.storage.deleteItemAsync(LEGACY_MANUAL_EXAMS_STORAGE_KEY);
      this.assertCurrentOwner(ownerSnapshot, normalizedOwnerId);
    }

    this.replaceState({
      ownerId: normalizedOwnerId,
      hydrated: true,
      exams: result.status === "loaded" ? result.exams : [],
    });
    return { legacyDiscarded: migration.status !== "no_data" };
  }

  create(
    input: PersonalExamMutationInput,
    expectedOwnerSnapshot = this.options.ownerGuard.capture(),
  ): PersonalExamMutationResult {
    const context = this.mutationContext(expectedOwnerSnapshot);
    const normalized = normalizeMutationInput(input);
    if (!context) return ownerUnavailableResult();
    if (!normalized) return invalidMutationResult();

    this.replaceState({
      ...this.state,
      exams: [...this.state.exams, {
        id: this.options.createId(),
        ...normalized,
      }],
    });
    this.schedulePersistence(context);
    return { ok: true };
  }

  update(
    id: string,
    input: PersonalExamMutationInput,
    expectedOwnerSnapshot = this.options.ownerGuard.capture(),
  ): PersonalExamMutationResult {
    const context = this.mutationContext(expectedOwnerSnapshot);
    const normalized = normalizeMutationInput(input);
    if (!context) return ownerUnavailableResult();
    if (!normalized) return invalidMutationResult();
    if (!this.state.exams.some((exam) => exam.id === id)) return missingExamResult();

    this.replaceState({
      ...this.state,
      exams: this.state.exams.map((exam) => (
        exam.id === id ? { id: exam.id, ...normalized } : exam
      )),
    });
    this.schedulePersistence(context);
    return { ok: true };
  }

  delete(
    id: string,
    expectedOwnerSnapshot = this.options.ownerGuard.capture(),
  ): PersonalExamMutationResult {
    const context = this.mutationContext(expectedOwnerSnapshot);
    if (!context) return ownerUnavailableResult();
    if (!this.state.exams.some((exam) => exam.id === id)) return missingExamResult();

    this.replaceState({
      ...this.state,
      exams: this.state.exams.filter((exam) => exam.id !== id),
    });
    this.schedulePersistence(context);
    return { ok: true };
  }

  async persistCurrent(
    expectedOwnerSnapshot = this.options.ownerGuard.capture(),
  ): Promise<boolean> {
    const context = this.mutationContext(expectedOwnerSnapshot);
    if (!context) return false;
    return this.enqueuePersistence(context);
  }

  async waitForIdle(): Promise<void> {
    await this.writeQueue;
  }

  private mutationContext(
    expectedOwnerSnapshot: AccountGenerationSnapshot | null | undefined,
  ): AccountGenerationSnapshot | null {
    if (!expectedOwnerSnapshot
      || !this.options.ownerGuard.isCurrent(expectedOwnerSnapshot)
      || !this.state.hydrated
      || this.state.ownerId !== expectedOwnerSnapshot.ownerId) return null;
    return expectedOwnerSnapshot;
  }

  private schedulePersistence(ownerSnapshot: AccountGenerationSnapshot): void {
    void this.enqueuePersistence(ownerSnapshot).catch((error: unknown) => {
      if (this.options.ownerGuard.isCurrent(ownerSnapshot)) {
        this.options.onPersistenceError?.(ownerSnapshot.ownerId, error);
      }
    });
  }

  private enqueuePersistence(ownerSnapshot: AccountGenerationSnapshot): Promise<boolean> {
    const state = this.getSnapshot();
    if (!state.hydrated || state.ownerId !== ownerSnapshot.ownerId) return Promise.resolve(false);
    const storageKey = createManualExamStorageKey(ownerSnapshot.ownerId);
    const serialized = serializeManualExamEnvelope(
      ownerSnapshot.ownerId,
      state.exams,
      this.options.now?.(),
    );
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      if (!this.options.ownerGuard.isCurrent(ownerSnapshot)) return false;
      await this.options.storage.setItemAsync(storageKey, serialized);
      return true;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private assertCurrentOwner(
    ownerSnapshot: AccountGenerationSnapshot,
    ownerId: string,
  ): void {
    if (ownerSnapshot.ownerId !== ownerId || !this.options.ownerGuard.isCurrent(ownerSnapshot)) {
      throw new StalePersonalExamOperationError();
    }
  }

  private replaceState(next: PersonalExamRuntimeState): void {
    this.state = cloneState(next);
    this.options.onStateChange?.(this.getSnapshot());
  }
}

function normalizeMutationInput(
  input: PersonalExamMutationInput,
): { title: string; examDate: string } | null {
  const title = input.title.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const examDate = new Date(input.examDate);
  if (!title || title.length > 160 || Number.isNaN(examDate.getTime())) return null;
  return { title, examDate: examDate.toISOString() };
}

function cloneState(state: PersonalExamRuntimeState): PersonalExamRuntimeState {
  return {
    ownerId: state.ownerId,
    hydrated: state.hydrated,
    exams: state.exams.map((exam) => ({ ...exam })),
  };
}

function requireOwnerId(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) throw new Error("A personal-exam owner is required.");
  return normalized;
}

function ownerUnavailableResult(): PersonalExamMutationResult {
  return { ok: false, error: "Hesaba ait sınav alanı henüz hazır değil." };
}

function invalidMutationResult(): PersonalExamMutationResult {
  return { ok: false, error: "Sınav adı, tarih veya saat doğrulanamadı." };
}

function missingExamResult(): PersonalExamMutationResult {
  return { ok: false, error: "Bu kişisel sınav açık hesapta bulunamadı." };
}
