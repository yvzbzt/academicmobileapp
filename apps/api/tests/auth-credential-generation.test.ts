import { describe, expect, it, vi } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";
import { revealSensitiveValue } from "../src/security/data-protection.js";

const future = new Date("2099-01-01T00:00:00.000Z");
const past = new Date("2026-01-01T00:00:00.000Z");

function userInput(email: string) {
  return {
    fullName: "Generation Student",
    email,
    passwordHash: "unused",
    role: "student" as const,
    status: "active" as const,
    universityId: "university-1",
    facultyId: "faculty-1",
    departmentId: "department-1",
    classLevel: 2
  };
}

type InMemoryState = {
  users: Map<string, Record<string, unknown>>;
  refreshTokens: Map<string, Record<string, unknown>>;
  passwordRecoveryTokens: Map<string, Record<string, unknown>>;
};

function memoryState(repository: InMemoryAuthRepository): InMemoryState {
  return repository as unknown as InMemoryState;
}

describe("credential-generation repository contract", () => {
  it("reads legacy in-memory users, refresh tokens, and recovery records as generation zero", async () => {
    const repository = new InMemoryAuthRepository();
    const user = await repository.createUser(userInput("legacy-generation@example.com"));
    const refreshToken = await repository.createRefreshToken({
      userId: user.id,
      credentialGeneration: 7,
      tokenHash: "legacy-refresh",
      familyId: "family-1",
      deviceId: "device-1",
      expiresAt: future
    });
    const recoveryToken = await repository.createPasswordRecoveryToken({
      userId: user.id,
      credentialGeneration: 7,
      tokenHash: "legacy-recovery",
      expiresAt: future,
      resendAvailableAt: past
    });
    const state = memoryState(repository);

    const legacyUser = { ...state.users.get(user.id) };
    const legacyRefresh = { ...state.refreshTokens.get(refreshToken.id) };
    const legacyRecovery = { ...state.passwordRecoveryTokens.get(recoveryToken.id) };
    delete legacyUser.credentialGeneration;
    delete legacyRefresh.credentialGeneration;
    delete legacyRecovery.credentialGeneration;
    state.users.set(user.id, legacyUser);
    state.refreshTokens.set(refreshToken.id, legacyRefresh);
    state.passwordRecoveryTokens.set(recoveryToken.id, legacyRecovery);

    await expect(repository.findUserById(user.id)).resolves.toEqual(expect.objectContaining({ credentialGeneration: 0 }));
    await expect(repository.findRefreshTokenByHash("legacy-refresh")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );
    await expect(repository.findPasswordRecoveryTokenByHash("legacy-recovery")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );
  });

  it("forces a new user to generation zero and retains explicit token generations", async () => {
    const repository = new InMemoryAuthRepository();
    const user = await repository.createUser({ ...userInput("new-generation@example.com"), credentialGeneration: 99 } as never);
    const refreshToken = await repository.createRefreshToken({
      userId: user.id,
      credentialGeneration: 12,
      tokenHash: "new-refresh",
      familyId: "family-1",
      deviceId: "device-1",
      expiresAt: future
    });
    const recoveryToken = await repository.createPasswordRecoveryToken({
      userId: user.id,
      credentialGeneration: 12,
      tokenHash: "new-recovery",
      expiresAt: future,
      resendAvailableAt: past
    });

    expect(user.credentialGeneration).toBe(0);
    expect(refreshToken.credentialGeneration).toBe(12);
    expect(recoveryToken.credentialGeneration).toBe(12);
  });

  type Writer = (repository: InMemoryAuthRepository, userId: string) => Promise<unknown>;
  const writers: Array<[string, Writer]> = [
    ["email verification", (repository, userId) => repository.markUserEmailVerified(userId, past)],
    [
      "Google identity update",
      (repository, userId) =>
        repository.updateUserGoogleIdentity(userId, {
          fullName: "Google Name",
          firebaseAuthUid: "firebase-1",
          credentialGeneration: 1
        } as never)
    ],
    [
      "admin update",
      (repository, userId) => repository.updateUserByAdmin(userId, { role: "super_admin", credentialGeneration: 1 } as never)
    ],
    [
      "profile update",
      (repository, userId) => repository.updateUserProfile(userId, { fullName: "Profile Name", credentialGeneration: 1 } as never)
    ],
    ["password update", (repository, userId) => repository.updateUserPassword(userId, "new-hash")],
    [
      "academic update",
      (repository, userId) =>
        repository.updateUserAcademicSelection(userId, { universityId: "university-2", credentialGeneration: 1 } as never)
    ],
    ["personal-data clearing", (repository, userId) => repository.clearUserAppData(userId)],
    ["admin deletion", (repository, userId) => repository.deleteUserByAdmin(userId)],
    [
      "account deletion",
      (repository, userId) =>
        repository.deleteUserAccount(userId, {
          deletedAt: past,
          anonymizedEmail: `deleted-${userId}@example.invalid`,
          anonymizedFullName: "Deleted User",
          anonymizedPasswordHash: "deleted-hash"
        })
    ]
  ];

  it.each(writers)("keeps generation stable across the in-memory %s writer", async (_name, write) => {
    const repository = new InMemoryAuthRepository();
    const user = await repository.createUser(userInput(`${String(_name).replaceAll(" ", "-")}@example.com`));
    const state = memoryState(repository);
    state.users.set(user.id, { ...state.users.get(user.id), credentialGeneration: 8 });

    await write(repository, user.id);

    expect(state.users.get(user.id)).toEqual(expect.objectContaining({ credentialGeneration: 8 }));
  });

  it("does not let a delayed stale in-memory read overwrite a newer generation", async () => {
    const repository = new InMemoryAuthRepository();
    const user = await repository.createUser(userInput("delayed-writer@example.com"));
    const state = memoryState(repository);
    state.users.set(user.id, { ...state.users.get(user.id), credentialGeneration: 6 });

    let releaseStaleRead!: (value: AuthUserRecord | null) => void;
    const staleRead = new Promise<AuthUserRecord | null>((resolve) => {
      releaseStaleRead = resolve;
    });
    const findUserById = vi.spyOn(repository, "findUserById").mockReturnValue(staleRead);

    const pendingUpdate = repository.updateUserGoogleIdentity(user.id, {
      fullName: "Concurrent Name",
      credentialGeneration: 1
    } as never);
    state.users.set(user.id, { ...state.users.get(user.id), credentialGeneration: 9 });
    releaseStaleRead({ ...user, credentialGeneration: 6 });
    await pendingUpdate;

    expect(findUserById).not.toHaveBeenCalled();
    expect(state.users.get(user.id)).toEqual(expect.objectContaining({ credentialGeneration: 9 }));
  });

  type MongoWriter = (repository: MongoAuthRepository) => Promise<unknown>;
  const mongoWriters: Array<[string, MongoWriter]> = [
    ["email verification", (repository) => repository.markUserEmailVerified("user-1", past)],
    [
      "Google identity update",
      (repository) =>
        repository.updateUserGoogleIdentity("user-1", {
          fullName: "Google Name",
          firebaseAuthUid: "firebase-1",
          credentialGeneration: 1
        } as never)
    ],
    [
      "admin update",
      (repository) => repository.updateUserByAdmin("user-1", { role: "super_admin", credentialGeneration: 1 } as never)
    ],
    [
      "profile update",
      (repository) => repository.updateUserProfile("user-1", { fullName: "Profile Name", credentialGeneration: 1 } as never)
    ],
    ["password update", (repository) => repository.updateUserPassword("user-1", "new-hash")],
    [
      "academic update",
      (repository) =>
        repository.updateUserAcademicSelection("user-1", {
          universityId: "university-2",
          credentialGeneration: 1
        } as never)
    ],
    ["personal-data clearing", (repository) => repository.clearUserAppData("user-1")],
    ["admin deletion", (repository) => repository.deleteUserByAdmin("user-1")],
    [
      "account deletion",
      (repository) =>
        repository.deleteUserAccount("user-1", {
          deletedAt: past,
          anonymizedEmail: "deleted-user-1@example.invalid",
          anonymizedFullName: "Deleted User",
          anonymizedPasswordHash: "deleted-hash"
        })
    ]
  ];

  it.each(mongoWriters)("keeps a concurrently advanced Mongo generation across the %s writer", async (_name, write) => {
    let storedUser: Record<string, unknown> = {
      ...userInput(`mongo-${String(_name).replaceAll(" ", "-")}@example.com`),
      credentialGeneration: 8,
      authProvider: "google",
      emailVerifiedAt: past,
      firebaseAuthUid: "firebase-old",
      lastLoginAt: past,
      createdAt: past,
      updatedAt: past
    };
    let generationAdvanced = false;
    const updatePayloads: Record<string, unknown>[] = [];
    const document = (value: Record<string, unknown>) => ({
      id: "user-1",
      toObject: () => ({ ...value })
    });
    const advanceGeneration = () => {
      if (generationAdvanced) return;
      generationAdvanced = true;
      storedUser = { ...storedUser, credentialGeneration: 21 };
    };
    const applyUpdate = (update: Record<string, unknown>) => {
      updatePayloads.push(update);
      expect(update).not.toHaveProperty("credentialGeneration");

      const hasOperators = Object.keys(update).some((field) => field.startsWith("$"));
      const fieldsToSet = hasOperators ? ((update.$set as Record<string, unknown> | undefined) ?? {}) : update;
      const fieldsToUnset = (update.$unset as Record<string, unknown> | undefined) ?? {};
      expect(fieldsToSet).not.toHaveProperty("credentialGeneration");

      storedUser = { ...storedUser, ...fieldsToSet };
      for (const field of Object.keys(fieldsToUnset)) delete storedUser[field];
    };
    const updateUser = vi.fn(async (_filter: unknown, update: Record<string, unknown>) => {
      advanceGeneration();
      applyUpdate(update);
      return document(storedUser);
    });
    const findUser = vi.fn(async () => {
      const valueAtRead = { ...storedUser };
      advanceGeneration();
      return document(valueAtRead);
    });
    const models = {
      User: {
        findOne: findUser,
        findByIdAndUpdate: updateUser,
        findOneAndUpdate: updateUser
      }
    };
    const repository = new MongoAuthRepository({ getConnection: () => ({ models }) } as never);

    const result = await write(repository);

    expect(updatePayloads).toHaveLength(1);
    expect(storedUser).toEqual(expect.objectContaining({ credentialGeneration: 21 }));
    if (result && typeof result === "object") {
      expect(result).toEqual(expect.objectContaining({ credentialGeneration: 21 }));
    }
  });

  it("normalizes legacy Mongo records and excludes generation from partial user updates", async () => {
    const document = (id: string, value: Record<string, unknown>) => ({ id, toObject: () => value });
    const findByIdAndUpdate = vi.fn(async (_id: string, update: Record<string, unknown>) =>
      document("user-1", {
        ...userInput("mongo-generation@example.com"),
        credentialGeneration: 14,
        createdAt: past,
        updatedAt: past,
        ...(update.$set as Record<string, unknown>)
      })
    );
    const models = {
      User: {
        findOne: vi.fn(async () =>
          document("legacy-user", {
            ...userInput("mongo-legacy@example.com"),
            createdAt: past,
            updatedAt: past
          })
        ),
        findByIdAndUpdate
      },
      RefreshToken: {
        findOne: vi.fn(async () =>
          document("refresh-1", {
            userId: "legacy-user",
            tokenHash: "mongo-refresh",
            familyId: "family-1",
            deviceId: "device-1",
            expiresAt: future,
            createdAt: past
          })
        )
      },
      PasswordRecoveryToken: {
        findOne: vi.fn(async () =>
          document("recovery-1", {
            userId: "legacy-user",
            tokenHash: "mongo-recovery",
            expiresAt: future,
            resendAvailableAt: past,
            createdAt: past
          })
        )
      }
    };
    const repository = new MongoAuthRepository({ getConnection: () => ({ models }) } as never);

    await expect(repository.findUserByEmail("mongo-legacy@example.com")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );
    await expect(repository.findRefreshTokenByHash("mongo-refresh")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );
    await expect(repository.findPasswordRecoveryTokenByHash("mongo-recovery")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );

    const updated = await repository.updateUserByAdmin("user-1", { fullName: "Mongo Name", credentialGeneration: 1 } as never);

    const persistedUpdate = findByIdAndUpdate.mock.calls[0]?.[1] as { $set: { fullName: string } };
    expect(persistedUpdate.$set.fullName).toMatch(/^enc:v1:/u);
    expect(revealSensitiveValue(persistedUpdate.$set.fullName, "user.fullName")).toBe("Mongo Name");
    expect(persistedUpdate.$set).not.toHaveProperty("credentialGeneration");
    expect(updated).toEqual(expect.objectContaining({ credentialGeneration: 14, fullName: "Mongo Name" }));
  });
});
