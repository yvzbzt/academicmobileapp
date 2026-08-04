import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIREBASE_WEB_ENV_KEYS,
  readFirebaseWebConfiguration
} from "../../apps/mobile/src/firebase-config";

describe("mobile web Firebase configuration", () => {
  it("uses only the complete VITE_FIREBASE environment contract", () => {
    const environment = {
      VITE_FIREBASE_API_KEY: "configured-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "configured.example.test",
      VITE_FIREBASE_PROJECT_ID: "configured-project",
      VITE_FIREBASE_STORAGE_BUCKET: "configured-bucket",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "configured-sender",
      VITE_FIREBASE_APP_ID: "configured-app"
    };

    expect(readFirebaseWebConfiguration(environment)).toEqual({
      configured: true,
      options: {
        apiKey: environment.VITE_FIREBASE_API_KEY,
        authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: environment.VITE_FIREBASE_PROJECT_ID,
        storageBucket: environment.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: environment.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: environment.VITE_FIREBASE_APP_ID
      }
    });
  });

  it("fails clearly on missing or blank configuration without disclosing configured values", () => {
    const result = readFirebaseWebConfiguration({
      VITE_FIREBASE_API_KEY: "sensitive-configured-value",
      VITE_FIREBASE_AUTH_DOMAIN: "   "
    });
    expect(result.configured).toBe(false);
    if (result.configured) throw new Error("Expected missing Firebase configuration.");
    expect(result.missing).toEqual(FIREBASE_WEB_ENV_KEYS.filter((key) => key !== "VITE_FIREBASE_API_KEY"));
    expect(result.message).toContain("VITE_FIREBASE_AUTH_DOMAIN");
    expect(result.message).not.toContain("sensitive-configured-value");
  });

  it("contains no hard-coded Firebase web configuration fallback", () => {
    const source = readFileSync(resolve("apps/mobile/src/firebase-auth.ts"), "utf8");
    expect(source).not.toContain(["AI", "za"].join(""));
    expect(source).not.toContain("firebaseapp.com");
    expect(source).not.toContain("firebasestorage.app");
    expect(source).toContain("readFirebaseWebConfiguration({");
    for (const key of FIREBASE_WEB_ENV_KEYS) expect(source).toContain(`import.meta.env.${key}`);
  });
});
