import { describe, expect, it, vi } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { FirestoreAuthRepository } from "../src/modules/auth/firestore-auth.repository.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";

describe("auth repository academic-selection integrity", () => {
  it("removes stale children in the in-memory repository", async () => {
    const repository = new InMemoryAuthRepository();
    const user = await repository.createUser({
      fullName: "Selection Student",
      email: "selection-memory@example.com",
      passwordHash: "unused",
      role: "student",
      status: "active",
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      classLevel: 2
    });

    const universityChanged = await repository.updateUserAcademicSelection(user.id, { universityId: "university-2" });
    expect(universityChanged).not.toHaveProperty("facultyId");
    expect(universityChanged).not.toHaveProperty("departmentId");
    expect(universityChanged).not.toHaveProperty("classLevel");

    await repository.updateUserAcademicSelection(user.id, {
      universityId: "university-2",
      facultyId: "faculty-2",
      departmentId: "department-2",
      classLevel: 3
    });
    const facultyChanged = await repository.updateUserAcademicSelection(user.id, {
      universityId: "university-2",
      facultyId: "faculty-3"
    });
    expect(facultyChanged).toEqual(expect.objectContaining({ facultyId: "faculty-3" }));
    expect(facultyChanged).not.toHaveProperty("departmentId");
    expect(facultyChanged).not.toHaveProperty("classLevel");
  });

  it("uses field-level Firestore updates that preserve generation while clearing stale descendants", async () => {
    let storedUser: Record<string, unknown> = {
      fullName: "Selection Student",
      email: "selection-firestore@example.com",
      credentialGeneration: 8,
      passwordHash: "unused",
      role: "student",
      status: "active",
      universityId: "university-1",
      facultyId: "faculty-1",
      departmentId: "department-1",
      classLevel: 2,
      unrelatedPreference: "preserved",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z")
    };
    const deleteField = FieldValue.delete();
    const updateUser = vi.fn(async (value: Record<string, unknown>) => {
      for (const [field, fieldValue] of Object.entries(value)) {
        if (fieldValue instanceof FieldValue && fieldValue.isEqual(deleteField)) {
          delete storedUser[field];
        } else {
          storedUser[field] = fieldValue;
        }
      }
    });
    const userDocument = {
      get: vi.fn(async () => ({ exists: true, id: "user-1", data: () => storedUser })),
      update: updateUser
    };
    const firestore = {
      getDb: () => ({
        collection: () => ({ doc: () => userDocument })
      })
    };
    const repository = new FirestoreAuthRepository(firestore as never);

    const universityChanged = await repository.updateUserAcademicSelection("user-1", { universityId: "university-2" });

    expect(universityChanged).toEqual(expect.objectContaining({
      universityId: "university-2",
      credentialGeneration: 8,
      unrelatedPreference: "preserved"
    }));
    expect(universityChanged).not.toHaveProperty("facultyId");
    expect(universityChanged).not.toHaveProperty("departmentId");
    expect(universityChanged).not.toHaveProperty("classLevel");
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser.mock.calls[0]?.[0]).not.toHaveProperty("credentialGeneration");
    expect(updateUser.mock.calls[0]?.[0]).not.toHaveProperty("unrelatedPreference");
    expect(storedUser).toEqual(expect.objectContaining({
      credentialGeneration: 8,
      unrelatedPreference: "preserved",
      universityId: "university-2"
    }));
    expect(storedUser).not.toHaveProperty("facultyId");
    expect(storedUser).not.toHaveProperty("departmentId");
    expect(storedUser).not.toHaveProperty("classLevel");

    storedUser = {
      ...storedUser,
      facultyId: "faculty-2",
      departmentId: "department-2",
      classLevel: 3
    };
    const facultyChanged = await repository.updateUserAcademicSelection("user-1", {
      universityId: "university-2",
      facultyId: "faculty-3"
    });

    expect(facultyChanged).toEqual(expect.objectContaining({
      universityId: "university-2",
      facultyId: "faculty-3",
      credentialGeneration: 8,
      unrelatedPreference: "preserved"
    }));
    expect(facultyChanged).not.toHaveProperty("departmentId");
    expect(facultyChanged).not.toHaveProperty("classLevel");
    expect(updateUser).toHaveBeenCalledTimes(2);
    expect(storedUser).toEqual(expect.objectContaining({
      credentialGeneration: 8,
      unrelatedPreference: "preserved",
      universityId: "university-2",
      facultyId: "faculty-3"
    }));
    expect(storedUser).not.toHaveProperty("departmentId");
    expect(storedUser).not.toHaveProperty("classLevel");
  });

  it("uses Mongo unsets for every omitted dependent field", async () => {
    const findOneAndUpdate = vi.fn(async (_filter: unknown, _update: unknown, _options: unknown) => ({
      id: "user-1",
      toObject: () => ({
        fullName: "Selection Student",
        email: "selection-mongo@example.com",
        passwordHash: "unused",
        role: "student",
        status: "active",
        universityId: "university-2",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      })
    }));
    const mongo = {
      getConnection: () => ({ models: { User: { findOneAndUpdate } } })
    };
    const repository = new MongoAuthRepository(mongo as never);

    await repository.updateUserAcademicSelection("user-1", { universityId: "university-2" });
    await repository.updateUserAcademicSelection("user-1", { universityId: "university-2", facultyId: "faculty-2" });

    expect(findOneAndUpdate.mock.calls[0]?.[1]).toEqual({
      $set: { universityId: "university-2" },
      $unset: { facultyId: "", departmentId: "", classLevel: "" }
    });
    expect(findOneAndUpdate.mock.calls[1]?.[1]).toEqual({
      $set: { universityId: "university-2", facultyId: "faculty-2" },
      $unset: { departmentId: "", classLevel: "" }
    });
  });
});
