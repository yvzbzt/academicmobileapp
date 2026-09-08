import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { functionSource } from "../../apps/mobile-native/tests/helpers/source-inspection";
import {
  normalizeAccountAuthProvider,
  readRecentAuthenticationResponse,
  recentAuthenticationFailureMessage,
  recentAuthenticationHeader,
  recentAuthenticationMethods,
  recentAuthenticationPurpose,
  shouldRefreshSessionAfterRecentAuthenticationFailure
} from "../../apps/mobile-native/src/auth/recent-authentication";

describe("mobile native recent authentication", () => {
  it("offers only authentication methods supported by the account and build", () => {
    expect(recentAuthenticationMethods("password", true, true)).toEqual(["password"]);
    expect(recentAuthenticationMethods("google", true, true)).toEqual(["google"]);
    expect(recentAuthenticationMethods("google", false, true)).toEqual([]);
    expect(recentAuthenticationMethods("apple", true, true)).toEqual(["apple"]);
    expect(recentAuthenticationMethods("apple", true, false)).toEqual([]);
    expect(recentAuthenticationMethods("password_google_apple", true, true)).toEqual(["password", "google", "apple"]);
    expect(recentAuthenticationMethods("password_google", true, false)).toEqual(["password", "google"]);
    expect(normalizeAccountAuthProvider("unsupported")).toBeUndefined();
  });

  it("accepts only a non-empty, expiring server proof and builds its exact header", () => {
    expect(readRecentAuthenticationResponse({ proof: " signed-proof ", expiresInSeconds: 120 }))
      .toEqual({ proof: "signed-proof", expiresInSeconds: 120 });
    expect(recentAuthenticationHeader(" signed-proof "))
      .toEqual({ "x-recent-authentication": "signed-proof" });
    expect(() => readRecentAuthenticationResponse({ proof: "", expiresInSeconds: 120 })).toThrow(
      "RECENT_AUTHENTICATION_RESPONSE_INVALID"
    );
    expect(() => readRecentAuthenticationResponse({ proof: "signed-proof", expiresInSeconds: 0 })).toThrow(
      "RECENT_AUTHENTICATION_RESPONSE_INVALID"
    );
    expect(() => recentAuthenticationHeader(" ")).toThrow("RECENT_AUTHENTICATION_PROOF_REQUIRED");
  });

  it("binds data deletion and account deletion to separate proof purposes", () => {
    expect(recentAuthenticationPurpose("data")).toBe("delete_personal_data");
    expect(recentAuthenticationPurpose("account")).toBe("delete_account");
    expect(recentAuthenticationPurpose("data")).not.toBe(recentAuthenticationPurpose("account"));
  });

  it("keeps invalid recent-auth credentials distinct from an expired bearer session", () => {
    expect(shouldRefreshSessionAfterRecentAuthenticationFailure(401, "AUTH_INVALID_CREDENTIALS")).toBe(false);
    expect(shouldRefreshSessionAfterRecentAuthenticationFailure(401, "AUTH_SESSION_INVALID")).toBe(true);
    expect(shouldRefreshSessionAfterRecentAuthenticationFailure(403, undefined)).toBe(false);
    expect(recentAuthenticationFailureMessage("password", "AUTH_INVALID_CREDENTIALS"))
      .toBe("Hesap şifren yanlış. Kontrol edip tekrar dene.");
    expect(recentAuthenticationFailureMessage("google", "AUTH_INVALID_CREDENTIALS"))
      .toBe("Google hesabın doğrulanamadı. Hesabı yeniden seçip tekrar dene.");
    expect(recentAuthenticationFailureMessage("apple", "AUTH_INVALID_CREDENTIALS"))
      .toBe("Apple hesabın doğrulanamadı. Tekrar deneyebilirsin.");
    expect(recentAuthenticationFailureMessage("password", "AUTH_SESSION_INVALID")).toBeUndefined();
  });

  it("requests a fresh action-specific proof before each destructive call and never persists it", () => {
    const source = readFileSync(resolve("apps/mobile-native/src/app/actions/recent-auth-actions.ts"), "utf8");
    const cleanup = readFileSync(resolve("apps/mobile-native/src/app/actions/account-cleanup-actions.ts"), "utf8");
    expect(source).toContain('"/auth/recent-authentication"');
    expect(source).toContain("const purpose = recentAuthenticationPurpose(action);");
    expect(source).toMatch(/const proof = await requestRecentAuthenticationProof\(\s*action,/u);
    for (const action of ["deleteMyData", "deleteAccount"]) {
      const destructiveCall = functionSource(source, action);
      expect(destructiveCall.match(/headers: recentAuthenticationHeader\(recentAuthenticationProof\)/gu)).toHaveLength(1);
    }
    expect(source).toContain('if (action === "data") await deleteMyData(proof)');
    expect(source).toContain('else await deleteAccount(proof)');
    for (const implementation of [
      source,
      cleanup,
      readFileSync(resolve("apps/mobile-native/src/app/actions/session-actions.ts"), "utf8"),
      readFileSync(resolve("apps/mobile-native/src/app/app-storage.ts"), "utf8")
    ]) {
      expect(implementation).not.toMatch(/(?:SecureStore|setStoredValue|persistSession)\([^\n]*proof/iu);
    }
  });

  it("uses the native semantic design system without defining a local color palette", () => {
    const source = readFileSync(
      resolve("apps/mobile-native/src/auth/RecentAuthenticationPanel.tsx"),
      "utf8"
    );
    expect(source).toContain("PasswordField");
    expect(source).toContain("useTheme");
    expect(source).not.toMatch(/#[\da-f]{3,8}/iu);
  });
});
