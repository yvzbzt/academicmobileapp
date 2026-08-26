import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { NativeCalendarStorage } from "./types";
import { createLegacyNativeCalendarStorageKey, createNativeCalendarStorageKey } from "./storage-key";
import {
  deserializeNativeCalendarStoredState,
  serializeNativeCalendarStoredState
} from "./storage-schema";

export function createSecureNativeCalendarStorage(): NativeCalendarStorage {
  return {
    async loadState(key) {
      const storageKey = createNativeCalendarStorageKey(key);
      const stored = await readStorageValue(storageKey);
      if (stored) return deserializeNativeCalendarStoredState(stored);

      const legacyKey = createLegacyNativeCalendarStorageKey(key);
      const legacy = await readStorageValue(legacyKey);
      if (!legacy) return { mappings: {} };
      const migrated = deserializeNativeCalendarStoredState(legacy);
      try {
        await writeStorageValue(storageKey, serializeNativeCalendarStoredState(migrated));
        await deleteStorageValue(legacyKey);
      } catch {
        // Keep the validated v2 value available for a later migration attempt.
      }
      return migrated;
    },
    async saveState(key, state) {
      await writeStorageValue(createNativeCalendarStorageKey(key), serializeNativeCalendarStoredState(state));
    },
    async clearState(key) {
      await deleteStorageValue(createNativeCalendarStorageKey(key));
      await deleteStorageValue(createLegacyNativeCalendarStorageKey(key));
    }
  };
}

function getWebStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
}

async function readStorageValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return getWebStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeStorageValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const storage = getWebStorage();
    if (!storage) throw new Error("Calendar connection could not be saved.");
    storage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function deleteStorageValue(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      getWebStorage()?.removeItem(key);
    } catch {
      // Ignore browser storage failures.
    }
    return;
  }

  await SecureStore.deleteItemAsync(key);
}
