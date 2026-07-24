import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { NativeCalendarStorage, NativeCalendarStorageKey, NativeCalendarStoredState } from "./types";
import { createNativeCalendarStorageKey } from "./storage-key";

export function createSecureNativeCalendarStorage(): NativeCalendarStorage {
  return {
    async loadState(key) {
      const stored = await readStorageValue(createStorageKey(key));
      if (!stored) return { mappings: {} };

      try {
        const parsed = JSON.parse(stored) as NativeCalendarStoredState;
        return {
          integration: parsed.integration,
          mappings: parsed.mappings ?? {}
        };
      } catch {
        return { mappings: {} };
      }
    },
    async saveState(key, state) {
      await writeStorageValue(createStorageKey(key), JSON.stringify({ integration: state.integration, mappings: state.mappings }));
    },
    async clearState(key) {
      await deleteStorageValue(createStorageKey(key));
    }
  };
}

function createStorageKey(key: NativeCalendarStorageKey): string {
  return createNativeCalendarStorageKey(key);
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
