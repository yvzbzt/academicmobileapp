import type { PersonalExamSecureStoreAdapter } from "../../src/calendar/personal-exam-runtime";

export type PersonalExamStorageOperation = Readonly<{
  type: "set" | "delete";
  key: string;
  value?: string;
}>;

/** Deterministic test double with the same async method names as SecureStore. */
export class DeterministicSecureStoreAdapter implements PersonalExamSecureStoreAdapter {
  readonly operations: PersonalExamStorageOperation[] = [];
  private readonly values = new Map<string, string>();
  private readonly deferredReads = new Map<string, Promise<void>>();

  async getItemAsync(key: string): Promise<string | null> {
    const deferred = this.deferredReads.get(key);
    if (deferred) {
      this.deferredReads.delete(key);
      await deferred;
    }
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.operations.push({ type: "set", key, value });
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
    this.operations.push({ type: "delete", key });
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  read(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  clearOperations(): void {
    this.operations.splice(0, this.operations.length);
  }

  deferNextRead(key: string): () => void {
    let release: () => void = () => undefined;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.deferredReads.set(key, deferred);
    return release;
  }
}
