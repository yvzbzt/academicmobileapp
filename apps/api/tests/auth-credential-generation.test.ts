import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import type { AuthUserRecord } from "../src/modules/auth/auth.types.js";
import { FirestoreAuthRepository } from "../src/modules/auth/firestore-auth.repository.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";

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

  it("normalizes legacy Firestore records and excludes generation from field-level user updates", async () => {
    const collections: Record<string, Map<string, Record<string, unknown>>> = {
      users: new Map([
        [
          "user-1",
          {
            ...userInput("firestore-generation@example.com"),
            credentialGeneration: 13,
            createdAt: past,
            updatedAt: past
          }
        ],
        [
          "legacy-user",
          {
            ...userInput("firestore-legacy@example.com"),
            createdAt: past,
            updatedAt: past
          }
        ]
      ]),
      refresh_tokens: new Map([
        [
          "refresh-1",
          {
            userId: "legacy-user",
            tokenHash: "firestore-refresh",
            familyId: "family-1",
            deviceId: "device-1",
            expiresAt: future,
            createdAt: past
          }
        ]
      ]),
      password_recovery_tokens: new Map([
        [
          "recovery-1",
          {
            userId: "legacy-user",
            tokenHash: "firestore-recovery",
            expiresAt: future,
            resendAvailableAt: past,
            createdAt: past
          }
        ]
      ])
    };
    const updates: Record<string, unknown>[] = [];
    const snapshot = (id: string, value: Record<string, unknown> | undefined) => ({
      exists: Boolean(value),
      id,
      data: () => value
    });
    const firestore = {
      getDb: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => snapshot(id, collections[name]?.get(id)),
            update: async (value: Record<string, unknown>) => {
              updates.push(value);
              collections[name]?.set(id, { ...collections[name]?.get(id), ...value });
            }
          }),
          where: (field: string, _operator: string, expected: unknown) => ({
            limit: () => ({
              get: async () => ({
                docs: [...(collections[name]?.entries() ?? [])]
                  .filter(([, value]) => value[field] === expected)
                  .map(([id, value]) => snapshot(id, value))
              })
            })
          })
        })
      })
    };
    const repository = new FirestoreAuthRepository(firestore as never);

    await expect(repository.findUserById("legacy-user")).resolves.toEqual(expect.objectContaining({ credentialGeneration: 0 }));
    await expect(repository.findRefreshTokenByHash("firestore-refresh")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );
    await expect(repository.findPasswordRecoveryTokenByHash("firestore-recovery")).resolves.toEqual(
      expect.objectContaining({ credentialGeneration: 0 })
    );

    const updated = await repository.updateUserByAdmin("user-1", { fullName: "Firestore Name", credentialGeneration: 1 } as never);

    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty("credentialGeneration");
    expect(updated).toEqual(expect.objectContaining({ credentialGeneration: 13, fullName: "Firestore Name" }));
  });

  type FirestoreWriter = (repository: FirestoreAuthRepository) => Promise<unknown>;
  const firestoreWriters: Array<[string, FirestoreWriter]> = [
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
      (repository) => repository.updateUserAcademicSelection("user-1", { universityId: "university-2" })
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

  it.each(firestoreWriters)("keeps a concurrently advanced Firestore generation across the %s writer", async (_name, write) => {
    let storedUser: Record<string, unknown> = {
      ...userInput(`firestore-${String(_name).replaceAll(" ", "-")}@example.com`),
      credentialGeneration: 8,
      emailVerifiedAt: past,
      firebaseAuthUid: "firebase-old",
      lastLoginAt: past,
      createdAt: past,
      updatedAt: past
    };
    let firstRead = true;
    const deleteField = FieldValue.delete();
    const userDocument = {
      get: vi.fn(async () => {
        const valueAtRead = { ...storedUser };
        if (firstRead) {
          firstRead = false;
          storedUser = { ...storedUser, credentialGeneration: 21 };
        }
        return { exists: true, id: "user-1", data: () => valueAtRead };
      }),
      update: vi.fn(async (value: Record<string, unknown>) => {
        expect(value).not.toHaveProperty("credentialGeneration");
        for (const [field, fieldValue] of Object.entries(value)) {
          if (fieldValue instanceof FieldValue && fieldValue.isEqual(deleteField)) {
            delete storedUser[field];
          } else {
            storedUser[field] = fieldValue;
          }
        }
      })
    };
    const repository = new FirestoreAuthRepository({
      getDb: () => ({ collection: () => ({ doc: () => userDocument }) })
    } as never);

    const result = await write(repository);

    expect(userDocument.update).toHaveBeenCalled();
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

    expect(findByIdAndUpdate).toHaveBeenCalledWith("user-1", { $set: { fullName: "Mongo Name" } }, { new: true });
    expect(updated).toEqual(expect.objectContaining({ credentialGeneration: 14, fullName: "Mongo Name" }));
  });
});
