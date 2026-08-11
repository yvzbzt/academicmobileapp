import {
  INVALIDATED_SESSION_STORAGE_VALUE,
  PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY,
  PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
  hasRestorableStoredSession,
  resolvePreloginWelcomeGate,
} from "../../src/auth/prelogin-welcome";

const restorableSession = JSON.stringify({
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 3600,
  user: {
    id: "student-1",
    email: "student@example.edu.tr",
    fullName: "Deniz Yilmaz",
    role: "student",
  },
});

describe("pre-login welcome persistence gate", () => {
  it("uses explicit versioned persistence constants", () => {
    expect(PRELOGIN_WELCOME_COMPLETION_STORAGE_KEY).toBe(
      "native_prelogin_welcome_completion_v1",
    );
    expect(PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE).toBe(
      "native_prelogin_welcome_completed_v1",
    );
  });

  it("is pending only when completion and a restorable session are both absent", () => {
    expect(resolvePreloginWelcomeGate({
      storedCompletion: null,
      storedSession: null,
    })).toBe("pending");

    expect(resolvePreloginWelcomeGate({
      storedCompletion: PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
      storedSession: null,
    })).toBe("completed");

    expect(resolvePreloginWelcomeGate({
      storedCompletion: null,
      storedSession: restorableSession,
    })).toBe("restorable_session");
  });

  it("treats the invalidated-session tombstone as no session", () => {
    expect(hasRestorableStoredSession(INVALIDATED_SESSION_STORAGE_VALUE)).toBe(false);
    expect(resolvePreloginWelcomeGate({
      storedCompletion: null,
      storedSession: INVALIDATED_SESSION_STORAGE_VALUE,
    })).toBe("pending");
  });

  it.each([
    ["empty", ""],
    ["malformed JSON", "{not-json"],
    ["JSON primitive", JSON.stringify("session")],
    ["missing access token", JSON.stringify({
      refreshToken: "refresh-token",
      expiresInSeconds: 3600,
      user: {
        id: "student-1",
        email: "student@example.edu.tr",
        fullName: "Deniz Yilmaz",
        role: "student",
      },
    })],
    ["missing user identity", JSON.stringify({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInSeconds: 3600,
      user: {
        id: "",
        email: "student@example.edu.tr",
        fullName: "Deniz Yilmaz",
        role: "student",
      },
    })],
  ])("does not treat a %s value as a restorable session", (_label, storedSession) => {
    expect(hasRestorableStoredSession(storedSession)).toBe(false);
    expect(resolvePreloginWelcomeGate({
      storedCompletion: null,
      storedSession,
    })).toBe("pending");
  });

  it("requires the current exact completion token", () => {
    expect(resolvePreloginWelcomeGate({
      storedCompletion: "native_prelogin_welcome_completed_v0",
      storedSession: null,
    })).toBe("pending");
  });

  it("lets an exact completion token take precedence over session state", () => {
    expect(resolvePreloginWelcomeGate({
      storedCompletion: PRELOGIN_WELCOME_COMPLETION_STORAGE_VALUE,
      storedSession: restorableSession,
    })).toBe("completed");
  });
});
