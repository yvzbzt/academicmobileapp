import { describe, expect, it } from "vitest";
import {
  protectSensitiveValue,
  revealSensitiveValue,
  sensitiveLookupHash,
  validateDataProtectionEnvironment
} from "../src/security/data-protection.js";

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "unit-access-secret-that-is-long-and-independent",
  EMAIL_VERIFICATION_TOKEN_PEPPER: "unit-email-pepper-that-is-long-and-independent",
  PASSWORD_RECOVERY_TOKEN_PEPPER: "unit-recovery-pepper-that-is-long-and-independent",
  DATA_ENCRYPTION_KEY_ID: "unit-v1",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
  DATA_LOOKUP_HMAC_SECRET: Buffer.alloc(32, 22).toString("base64")
};

describe("sensitive data protection", () => {
  it("encrypts values with randomized authenticated encryption", () => {
    const first = protectSensitiveValue("student@example.edu", "user.email", productionEnvironment);
    const second = protectSensitiveValue("student@example.edu", "user.email", productionEnvironment);

    expect(first).toMatch(/^enc:v1:unit-v1:/u);
    expect(second).not.toBe(first);
    expect(first).not.toContain("student@example.edu");
    expect(revealSensitiveValue(first, "user.email", productionEnvironment)).toBe("student@example.edu");
    expect(() => revealSensitiveValue(first, "user.fullName", productionEnvironment)).toThrow(
      "SENSITIVE_DATA_DECRYPTION_FAILED:user.fullName"
    );
  });

  it("rejects modified ciphertext", () => {
    const protectedValue = protectSensitiveValue("Ada Lovelace", "user.fullName", productionEnvironment);
    const parts = protectedValue.split(":");
    const ciphertext = parts[5] ?? "";
    parts[5] = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;

    expect(() => revealSensitiveValue(parts.join(":"), "user.fullName", productionEnvironment)).toThrow(
      "SENSITIVE_DATA_DECRYPTION_FAILED:user.fullName"
    );
  });

  it("uses stable purpose-bound blind indexes", () => {
    const first = sensitiveLookupHash("student@example.edu", "user.email", productionEnvironment);
    const second = sensitiveLookupHash("student@example.edu", "user.email", productionEnvironment);

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(second).toBe(first);
    expect(sensitiveLookupHash("student@example.edu", "device.token", productionEnvironment)).not.toBe(first);
  });

  it("supports key rotation and rejects coupled production secrets", () => {
    const oldKey = Buffer.alloc(32, 33).toString("base64");
    const encryptedWithOldKey = protectSensitiveValue("old value", "rotation.test", {
      ...productionEnvironment,
      DATA_ENCRYPTION_KEY_ID: "unit-old",
      DATA_ENCRYPTION_KEY: oldKey
    });
    const rotatedEnvironment = {
      ...productionEnvironment,
      DATA_ENCRYPTION_KEY_ID: "unit-new",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 44).toString("base64"),
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ "unit-old": oldKey })
    };

    expect(revealSensitiveValue(encryptedWithOldKey, "rotation.test", rotatedEnvironment)).toBe("old value");
    expect(validateDataProtectionEnvironment(rotatedEnvironment).errors).toEqual([]);
    expect(validateDataProtectionEnvironment({
      ...rotatedEnvironment,
      DATA_LOOKUP_HMAC_SECRET: rotatedEnvironment.DATA_ENCRYPTION_KEY,
      EMAIL_VERIFICATION_TOKEN_PEPPER: productionEnvironment.JWT_ACCESS_SECRET
    }).errors).toEqual(expect.arrayContaining([
      "DATA_ENCRYPTION_KEY and DATA_LOOKUP_HMAC_SECRET must be independent.",
      "Authentication peppers and signing secrets must all be independent in production."
    ]));
  });
});
