import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeAccountAuthProvider,
  readRecentAuthenticationResponse,
  recentAuthenticationHeader,
  recentAuthenticationMethods,
  recentAuthenticationPurpose
} from "../../apps/mobile-native/src/auth/recent-authentication";

describe("mobile native recent authentication", () => {
  it("offers only authentication methods supported by the account and build", () => {
    expect(recentAuthenticationMethods("password", true)).toEqual(["password"]);
    expect(recentAuthenticationMethods("google", true)).toEqual(["google"]);
    expect(recentAuthenticationMethods("google", false)).toEqual([]);
    expect(recentAuthenticationMethods("password_google", true)).toEqual(["password", "google"]);
    expect(recentAuthenticationMethods("password_google", false)).toEqual(["password"]);
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

  it("requests a fresh action-specific proof before each destructive call and never persists it", () => {
    const source = readFileSync(resolve("apps/mobile-native/App.tsx"), "utf8");
    expect(source).toContain('"/auth/recent-authentication"');
    expect(source).toContain("const purpose = recentAuthenticationPurpose(action);");
    expect(source).toMatch(/const proof = await requestRecentAuthenticationProof\(\s*action,/u);
    expect(source).toContain('headers: recentAuthenticationHeader(recentAuthenticationProof)');
    expect(source.match(/headers: recentAuthenticationHeader\(recentAuthenticationProof\)/gu)).toHaveLength(2);
    expect(source).toContain('if (action === "data") await deleteMyData(proof)');
    expect(source).toContain('else await deleteAccount(proof)');
    expect(source).not.toMatch(/(?:SecureStore|setStoredValue|persistSession)\([^\n]*proof/iu);
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
