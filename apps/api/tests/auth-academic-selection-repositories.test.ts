import { describe, expect, it, vi } from "vitest";
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

  it("uses Mongo field operators that preserve stored data and clear every omitted dependent", async () => {
    const findOneAndUpdate = vi.fn(async (_filter: unknown, _update: unknown, _options: unknown) => ({
      id: "user-1",
      toObject: () => ({
        fullName: "Selection Student",
        email: "selection-mongo@example.com",
        credentialGeneration: 8,
        passwordHash: "unused",
        role: "student",
        status: "active",
        universityId: "university-2",
        unrelatedPreference: "preserved",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      })
    }));
    const mongo = {
      getConnection: () => ({ models: { User: { findOneAndUpdate } } })
    };
    const repository = new MongoAuthRepository(mongo as never);

    const universityChanged = await repository.updateUserAcademicSelection("user-1", { universityId: "university-2" });
    const facultyChanged = await repository.updateUserAcademicSelection("user-1", {
      universityId: "university-2",
      facultyId: "faculty-2"
    });

    expect(findOneAndUpdate.mock.calls[0]?.[1]).toEqual({
      $set: { universityId: "university-2" },
      $unset: { facultyId: "", departmentId: "", classLevel: "" }
    });
    expect(findOneAndUpdate.mock.calls[1]?.[1]).toEqual({
      $set: { universityId: "university-2", facultyId: "faculty-2" },
      $unset: { departmentId: "", classLevel: "" }
    });
    expect(universityChanged).toEqual(expect.objectContaining({ credentialGeneration: 8, unrelatedPreference: "preserved" }));
    expect(facultyChanged).toEqual(expect.objectContaining({ credentialGeneration: 8, unrelatedPreference: "preserved" }));
  });
});
