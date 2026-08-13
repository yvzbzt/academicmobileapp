import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  applicationDefault: vi.fn(() => ({ source: "adc" })),
  cert: vi.fn(() => ({ source: "service-account" })),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn((options: unknown) => ({ name: "test", options }))
}));

vi.mock("firebase-admin/app", () => firebaseMocks);

import { FirebaseAdminService } from "../src/database/firebase-admin.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
  vi.stubEnv("K_SERVICE", "");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
  vi.stubEnv("GCLOUD_PROJECT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FirebaseAdminService credential selection", () => {
  it("does not probe application default credentials for a project id alone", () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "academic-mobile-app-7629");

    expect(() => new FirebaseAdminService().getApp()).toThrow("FIREBASE_NOT_CONFIGURED");
    expect(firebaseMocks.applicationDefault).not.toHaveBeenCalled();
    expect(firebaseMocks.initializeApp).not.toHaveBeenCalled();
  });

  it("uses application default credentials when an explicit credential path exists", () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "academic-mobile-app-7629");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/run/secrets/firebase.json");

    expect(new FirebaseAdminService().getApp()).toEqual(expect.objectContaining({ name: "test" }));
    expect(firebaseMocks.applicationDefault).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.initializeApp).toHaveBeenCalledWith({
      credential: { source: "adc" },
      projectId: "academic-mobile-app-7629"
    });
  });
});
