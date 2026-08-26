import {
  isNativeCalendarStorageError,
  NativeCalendarStorageError,
  type NativeCalendarStorageErrorCode
} from "./native-calendar-error";
import {
  createLegacyNativeCalendarStorageKey,
  createNativeCalendarMigrationKey,
  createNativeCalendarQuarantineKey,
  createNativeCalendarRecoveryKey,
  createNativeCalendarStorageKey
} from "./storage-key";
import {
  deserializeNativeCalendarStoredState,
  serializeNativeCalendarStoredState
} from "./storage-schema";
import type {
  NativeCalendarMetadataRecoveryResult,
  NativeCalendarMetadataSource,
  NativeCalendarRecoverableStorage,
  NativeCalendarStorageKey,
  NativeCalendarStoredState
} from "./types";

export type NativeCalendarAsyncStorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type NativeCalendarLegacySecureStoreAdapter = {
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
};

export type SecureNativeCalendarStorageOptions = {
  platform?: string;
  asyncStorage?: NativeCalendarAsyncStorageAdapter;
  secureStore?: NativeCalendarLegacySecureStoreAdapter | null;
  webStorage?: Storage | null;
  now?: () => Date;
};

type MigrationRecord = {
  version: 1;
  source: "secure_store_v3" | "secure_store_v2";
};

type RecoveryRecord = NativeCalendarMetadataRecoveryResult & {
  version: 1;
};

type RawMetadataSource = {
  source: NativeCalendarMetadataSource;
  key: string;
  value: string;
};

const RECOVERABLE_STORAGE_ERRORS = new Set<NativeCalendarStorageErrorCode>([
  "corrupt",
  "unsupported_version",
  "recovery_incomplete"
]);

declare const require: (moduleName: string) => unknown;

/**
 * AsyncStorage is the canonical store. SecureStore is read only as a source for
 * the former v3/v2 single-value format, then erased after a verified migration.
 */
export function createSecureNativeCalendarStorage(
  options: SecureNativeCalendarStorageOptions = {}
): NativeCalendarRecoverableStorage {
  const platform = options.platform ?? loadReactNativePlatform();
  const asyncStorage = options.asyncStorage ?? loadAsyncStorage();
  const legacyStorage = resolveLegacyStorage(platform, options);
  const now = options.now ?? (() => new Date());
  let operationTail: Promise<void> = Promise.resolve();

  const runExclusively = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const readAsyncValue = async (key: string): Promise<string | null> => {
    try {
      return await asyncStorage.getItem(key);
    } catch (cause) {
      throw new NativeCalendarStorageError("read_failed", "Native calendar metadata could not be read.", { cause });
    }
  };

  const writeAsyncValue = async (key: string, value: string): Promise<void> => {
    try {
      await asyncStorage.setItem(key, value);
    } catch (cause) {
      throw new NativeCalendarStorageError("write_failed", "Native calendar metadata could not be saved.", { cause });
    }
  };

  const deleteAsyncValue = async (key: string): Promise<void> => {
    try {
      await asyncStorage.removeItem(key);
    } catch (cause) {
      throw new NativeCalendarStorageError("delete_failed", "Native calendar metadata could not be deleted.", { cause });
    }
  };

  const readLegacyValue = async (key: string): Promise<string | null> => {
    if (!legacyStorage) return null;
    try {
      return await legacyStorage.getItemAsync(key);
    } catch (cause) {
      throw new NativeCalendarStorageError("read_failed", "Legacy native calendar metadata could not be read.", { cause });
    }
  };

  const deleteLegacyValue = async (key: string): Promise<void> => {
    if (!legacyStorage) return;
    try {
      await legacyStorage.deleteItemAsync(key);
    } catch (cause) {
      throw new NativeCalendarStorageError("delete_failed", "Legacy native calendar metadata could not be deleted.", { cause });
    }
  };

  const writeAndVerifyAsyncValue = async (
    key: string,
    value: string,
    mismatchCode: NativeCalendarStorageErrorCode = "write_failed"
  ): Promise<void> => {
    await writeAsyncValue(key, value);
    const persisted = await readAsyncValue(key);
    if (persisted !== value) {
      throw new NativeCalendarStorageError(mismatchCode, "Native calendar metadata write could not be verified.");
    }
  };

  const deleteLegacyState = async (key: NativeCalendarStorageKey): Promise<void> => {
    await deleteLegacyValue(createNativeCalendarStorageKey(key));
    await deleteLegacyValue(createLegacyNativeCalendarStorageKey(key));
  };

  const assertNoRecoveryPending = async (key: NativeCalendarStorageKey): Promise<void> => {
    if (await readAsyncValue(createNativeCalendarRecoveryKey(key)) !== null) {
      throw new NativeCalendarStorageError(
        "recovery_incomplete",
        "Native calendar metadata recovery must be completed explicitly."
      );
    }
  };

  const resumeMigration = async (
    key: NativeCalendarStorageKey,
    rawRecord: string
  ): Promise<NativeCalendarStoredState> => {
    const record = parseMigrationRecord(rawRecord);
    const storageKey = createNativeCalendarStorageKey(key);
    const stored = await readAsyncValue(storageKey);
    let state: NativeCalendarStoredState;

    if (stored !== null) {
      state = deserializeNativeCalendarStoredState(stored);
    } else {
      const sourceKey = record.source === "secure_store_v3"
        ? storageKey
        : createLegacyNativeCalendarStorageKey(key);
      const legacy = await readLegacyValue(sourceKey);
      if (legacy === null) {
        throw new NativeCalendarStorageError(
          "recovery_incomplete",
          "Native calendar migration source disappeared before it was committed."
        );
      }
      state = deserializeNativeCalendarStoredState(legacy);
      await writeAndVerifyAsyncValue(storageKey, serializeNativeCalendarStoredState(state));
    }

    await deleteLegacyState(key);
    await deleteAsyncValue(createNativeCalendarMigrationKey(key));
    return state;
  };

  const migrateLegacyState = async (key: NativeCalendarStorageKey): Promise<NativeCalendarStoredState> => {
    const storageKey = createNativeCalendarStorageKey(key);
    const current = await readLegacyValue(storageKey);
    const source = current !== null ? "secure_store_v3" as const : "secure_store_v2" as const;
    const legacy = current ?? await readLegacyValue(createLegacyNativeCalendarStorageKey(key));
    if (legacy === null) return { mappings: {} };

    deserializeNativeCalendarStoredState(legacy);
    const migrationRecord: MigrationRecord = { version: 1, source };
    const serializedMigration = JSON.stringify(migrationRecord);
    await writeAndVerifyAsyncValue(createNativeCalendarMigrationKey(key), serializedMigration);
    return resumeMigration(key, serializedMigration);
  };

  const loadState = async (key: NativeCalendarStorageKey): Promise<NativeCalendarStoredState> => {
    await assertNoRecoveryPending(key);
    const pendingMigration = await readAsyncValue(createNativeCalendarMigrationKey(key));
    if (pendingMigration !== null) return resumeMigration(key, pendingMigration);

    const stored = await readAsyncValue(createNativeCalendarStorageKey(key));
    if (stored !== null) return deserializeNativeCalendarStoredState(stored);
    return migrateLegacyState(key);
  };

  const finishRecovery = async (
    key: NativeCalendarStorageKey,
    record: RecoveryRecord,
    resumed: boolean
  ): Promise<NativeCalendarMetadataRecoveryResult> => {
    if (await readAsyncValue(record.quarantineKey) === null) {
      throw new NativeCalendarStorageError(
        "recovery_incomplete",
        "Quarantined native calendar metadata is unavailable."
      );
    }

    await writeAndVerifyAsyncValue(
      createNativeCalendarStorageKey(key),
      serializeNativeCalendarStoredState({ mappings: {} })
    );
    await deleteLegacyState(key);
    await deleteAsyncValue(createNativeCalendarMigrationKey(key));
    await deleteAsyncValue(createNativeCalendarRecoveryKey(key));
    return {
      quarantineKey: record.quarantineKey,
      quarantinedAt: record.quarantinedAt,
      quarantinedSources: record.quarantinedSources,
      resumed
    };
  };

  const collectRawMetadata = async (key: NativeCalendarStorageKey): Promise<RawMetadataSource[]> => {
    const candidates: Array<{
      source: NativeCalendarMetadataSource;
      key: string;
      read: (storageKey: string) => Promise<string | null>;
    }> = [
      { source: "async_storage", key: createNativeCalendarStorageKey(key), read: readAsyncValue },
      { source: "secure_store_v3", key: createNativeCalendarStorageKey(key), read: readLegacyValue },
      { source: "secure_store_v2", key: createLegacyNativeCalendarStorageKey(key), read: readLegacyValue },
      { source: "migration_pending", key: createNativeCalendarMigrationKey(key), read: readAsyncValue },
      { source: "recovery_pending", key: createNativeCalendarRecoveryKey(key), read: readAsyncValue }
    ];
    const sources: RawMetadataSource[] = [];
    for (const candidate of candidates) {
      const value = await candidate.read(candidate.key);
      if (value !== null) sources.push({ source: candidate.source, key: candidate.key, value });
    }
    return sources;
  };

  const startRecovery = async (
    key: NativeCalendarStorageKey,
    sources: RawMetadataSource[]
  ): Promise<NativeCalendarMetadataRecoveryResult> => {
    if (sources.length === 0) {
      throw new NativeCalendarStorageError(
        "recovery_not_required",
        "No native calendar metadata is available to recover."
      );
    }
    const quarantineDate = now();
    const quarantinedAt = quarantineDate.toISOString();
    const quarantineKey = createNativeCalendarQuarantineKey(key, quarantineDate);
    const quarantineRecord = JSON.stringify({
      version: 1,
      quarantinedAt,
      sources
    });
    try {
      await writeAndVerifyAsyncValue(quarantineKey, quarantineRecord, "quarantine_failed");
    } catch (error) {
      if (isNativeCalendarStorageError(error) && error.code === "write_failed") {
        throw new NativeCalendarStorageError(
          "quarantine_failed",
          "Native calendar metadata could not be quarantined.",
          { cause: error }
        );
      }
      throw error;
    }

    const record: RecoveryRecord = {
      version: 1,
      quarantineKey,
      quarantinedAt,
      quarantinedSources: sources.map(({ source }) => source),
      resumed: false
    };
    await writeAndVerifyAsyncValue(createNativeCalendarRecoveryKey(key), JSON.stringify(record));
    return finishRecovery(key, record, false);
  };

  return {
    loadState: (key) => runExclusively(() => loadState(key)),
    saveState: (key, state) => runExclusively(async () => {
      await assertNoRecoveryPending(key);
      const pendingMigration = await readAsyncValue(createNativeCalendarMigrationKey(key));
      if (pendingMigration !== null) await resumeMigration(key, pendingMigration);
      await writeAndVerifyAsyncValue(
        createNativeCalendarStorageKey(key),
        serializeNativeCalendarStoredState(state)
      );
    }),
    clearState: (key) => runExclusively(async () => {
      await assertNoRecoveryPending(key);
      const pendingMigration = await readAsyncValue(createNativeCalendarMigrationKey(key));
      if (pendingMigration !== null) await resumeMigration(key, pendingMigration);
      // Keep the AsyncStorage ledger until stale SecureStore copies can no longer resurrect it.
      await deleteLegacyState(key);
      await deleteAsyncValue(createNativeCalendarStorageKey(key));
    }),
    quarantineAndResetCorruptState: (key) => runExclusively(async () => {
      const recoveryKey = createNativeCalendarRecoveryKey(key);
      const pendingRecovery = await readAsyncValue(recoveryKey);
      if (pendingRecovery !== null) {
        const parsedPending = parseRecoveryRecord(pendingRecovery);
        if (parsedPending && await readAsyncValue(parsedPending.quarantineKey) !== null) {
          return finishRecovery(key, parsedPending, true);
        }
      }

      if (pendingRecovery === null) {
        try {
          await loadState(key);
        } catch (error) {
          if (!isRecoverableStorageError(error)) throw error;
          return startRecovery(key, await collectRawMetadata(key));
        }
        throw new NativeCalendarStorageError(
          "recovery_not_required",
          "Native calendar metadata is valid; recovery refused to reset it."
        );
      }

      return startRecovery(key, await collectRawMetadata(key));
    })
  };
}

function parseMigrationRecord(value: string): MigrationRecord {
  try {
    const parsed = JSON.parse(value) as Partial<MigrationRecord>;
    if (
      parsed
      && parsed.version === 1
      && (parsed.source === "secure_store_v3" || parsed.source === "secure_store_v2")
    ) return parsed as MigrationRecord;
  } catch {
    // Converted to a typed corruption error below.
  }
  throw new NativeCalendarStorageError("corrupt", "Native calendar migration metadata is malformed.");
}

function parseRecoveryRecord(value: string): RecoveryRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<RecoveryRecord>;
    if (
      !parsed
      || parsed.version !== 1
      || typeof parsed.quarantineKey !== "string"
      || typeof parsed.quarantinedAt !== "string"
      || Number.isNaN(Date.parse(parsed.quarantinedAt))
      || !Array.isArray(parsed.quarantinedSources)
      || !parsed.quarantinedSources.every(isMetadataSource)
    ) return null;
    return {
      version: 1,
      quarantineKey: parsed.quarantineKey,
      quarantinedAt: parsed.quarantinedAt,
      quarantinedSources: parsed.quarantinedSources,
      resumed: Boolean(parsed.resumed)
    };
  } catch {
    return null;
  }
}

function isRecoverableStorageError(error: unknown): boolean {
  return isNativeCalendarStorageError(error) && RECOVERABLE_STORAGE_ERRORS.has(error.code);
}

function isMetadataSource(value: unknown): value is NativeCalendarMetadataSource {
  return value === "async_storage"
    || value === "secure_store_v3"
    || value === "secure_store_v2"
    || value === "migration_pending"
    || value === "recovery_pending";
}

function resolveLegacyStorage(
  platform: string,
  options: SecureNativeCalendarStorageOptions
): NativeCalendarLegacySecureStoreAdapter | null {
  if ("secureStore" in options) return options.secureStore ?? null;
  if (platform !== "web") return loadSecureStore();
  const webStorage = "webStorage" in options ? options.webStorage ?? null : getWebStorage();
  if (!webStorage) return null;
  return {
    getItemAsync: async (key) => webStorage.getItem(key),
    deleteItemAsync: async (key) => webStorage.removeItem(key)
  };
}

function getWebStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
}

function loadReactNativePlatform(): string {
  return (require("react-native") as { Platform: { OS: string } }).Platform.OS;
}

function loadAsyncStorage(): NativeCalendarAsyncStorageAdapter {
  const loaded = require("@react-native-async-storage/async-storage") as {
    default?: NativeCalendarAsyncStorageAdapter;
    getItem?: NativeCalendarAsyncStorageAdapter["getItem"];
    setItem?: NativeCalendarAsyncStorageAdapter["setItem"];
    removeItem?: NativeCalendarAsyncStorageAdapter["removeItem"];
  };
  const storage = loaded.default ?? (loaded as NativeCalendarAsyncStorageAdapter);
  if (
    typeof storage.getItem !== "function"
    || typeof storage.setItem !== "function"
    || typeof storage.removeItem !== "function"
  ) throw new Error("AsyncStorage is unavailable.");
  return storage;
}

function loadSecureStore(): NativeCalendarLegacySecureStoreAdapter {
  return require("expo-secure-store") as NativeCalendarLegacySecureStoreAdapter;
}
