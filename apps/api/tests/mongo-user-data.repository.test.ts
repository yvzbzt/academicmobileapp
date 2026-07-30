import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import { academicUnitSuggestionSchema, followedAcademicScopeSchema } from "../src/database/mongoose-schemas.js";
import { getModel } from "../src/database/mongoose-utils.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { InMemoryNotificationRepository } from "../src/modules/notifications/in-memory-notification.repository.js";
import { MongoUserDataRepository } from "../src/modules/users/mongo-user-data.repository.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { createMongoUserDataModelFixture } from "./support/mongo-user-data-model.fixture.js";

const REAL_MONGO_TEST_DATABASE = `academic_user_data_r1b_test_${process.pid}`;
const REAL_MONGO_TEST_URI = `mongodb://127.0.0.1:27017/${REAL_MONGO_TEST_DATABASE}`;

async function createServiceContext() {
  const authRepository = new InMemoryAuthRepository();
  const catalogRepository = new InMemoryCatalogRepository();
  const notificationRepository = new InMemoryNotificationRepository();
  const mongoFixture = createMongoUserDataModelFixture();
  const userDataRepository = new MongoUserDataRepository(mongoFixture.mongo);
  const university = await catalogRepository.createUniversity({
    name: "R1B Test University",
    slug: "r1b-test-university",
    city: "Ankara",
    type: "state",
    status: "active"
  });
  const faculty = await catalogRepository.createFaculty({
    universityId: university.id,
    name: "R1B Existing Faculty",
    slug: "r1b-existing-faculty",
    status: "active"
  });
  const department = await catalogRepository.createDepartment({
    universityId: university.id,
    facultyId: faculty.id,
    name: "R1B Existing Department",
    slug: "r1b-existing-department",
    educationLevel: "bachelor",
    status: "active"
  });
  const firstUser = await authRepository.createUser({
    fullName: "R1B First User",
    email: "r1b.first@example.com",
    passwordHash: "unused",
    role: "student",
    universityId: university.id,
    facultyId: faculty.id,
    departmentId: department.id,
    classLevel: 2,
    status: "active"
  });
  const secondUser = await authRepository.createUser({
    fullName: "R1B Second User",
    email: "r1b.second@example.com",
    passwordHash: "unused",
    role: "student",
    universityId: university.id,
    facultyId: faculty.id,
    departmentId: department.id,
    classLevel: 3,
    status: "active"
  });
  const usersService = new UsersService(
    authRepository,
    catalogRepository,
    userDataRepository,
    notificationRepository
  );

  return {
    authRepository,
    catalogRepository,
    notificationRepository,
    mongoFixture,
    userDataRepository,
    usersService,
    university,
    faculty,
    department,
    firstUser,
    secondUser
  };
}

describe("MongoUserDataRepository real Mongo integration", () => {
  const mongo = new MongoConnectionService();

  beforeAll(async () => {
    const connection = await mongo.connect(REAL_MONGO_TEST_URI);
    if (!connection) throw new Error("R1B_TEST_MONGODB_NOT_CONFIGURED");
    if (connection.name !== REAL_MONGO_TEST_DATABASE) {
      throw new Error(`R1B_TEST_MONGODB_DATABASE_MISMATCH:${connection.name}`);
    }
    await connection.dropDatabase();
    await Promise.all([
      getModel(connection, "AcademicUnitSuggestion", academicUnitSuggestionSchema).init(),
      getModel(connection, "FollowedAcademicScope", followedAcademicScopeSchema).init()
    ]);
  }, 30_000);

  afterAll(async () => {
    const connection = mongo.getConnection();
    if (connection) {
      if (connection.name !== REAL_MONGO_TEST_DATABASE) {
        throw new Error(`R1B_TEST_MONGODB_CLEANUP_DATABASE_MISMATCH:${connection.name}`);
      }
      await connection.dropDatabase();
    }
    await mongo.onApplicationShutdown();
  }, 30_000);

  it("creates and reads suggestions and enforces idempotent scopes in isolated Mongo", async () => {
    const repository = new MongoUserDataRepository(mongo);
    const suggestion = await repository.createAcademicUnitSuggestion({
      userId: "real-mongo-user",
      userEmail: "real.mongo.user@example.com",
      universityId: "real-mongo-university",
      facultyName: "Real Mongo Faculty",
      departmentName: "Real Mongo Department",
      educationLevel: "master"
    });

    await expect(repository.findAcademicUnitSuggestionById(suggestion.id)).resolves.toEqual(
      expect.objectContaining({
        id: suggestion.id,
        userId: "real-mongo-user",
        userEmail: "real.mongo.user@example.com",
        universityId: "real-mongo-university",
        facultyName: "Real Mongo Faculty",
        departmentName: "Real Mongo Department",
        educationLevel: "master",
        status: "pending",
        createdAt: expect.any(Date)
      })
    );

    const followedScopes = await Promise.all(
      Array.from({ length: 8 }, () => repository.upsertFollowedAcademicScope({
        userId: "real-mongo-user",
        universityId: "real-mongo-university",
        facultyId: "real-mongo-faculty"
      }))
    );
    expect(new Set(followedScopes.map((scope) => scope.id))).toEqual(new Set([followedScopes[0]!.id]));
    expect(followedScopes[0]).not.toHaveProperty("normalizedScopeKey");

    const connection = mongo.getConnection();
    if (!connection) throw new Error("R1B_TEST_MONGODB_CONNECTION_LOST");
    expect((await connection.collection("academic_unit_suggestions").indexes()).map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "academic_unit_suggestions_status_created",
        "academic_unit_suggestions_user"
      ])
    );
    expect(await connection.collection("followed_academic_scopes").indexes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "followed_academic_scopes_user_scope_unique",
          unique: true
        }),
        expect.objectContaining({ name: "followed_academic_scopes_user_created" })
      ])
    );
    await expect(connection.collection<{ _id: string; userId: string }>("academic_unit_suggestions").countDocuments({
      _id: suggestion.id,
      userId: "real-mongo-user"
    })).resolves.toBe(1);
    await expect(connection.collection<{ userId: string; normalizedScopeKey: string }>("followed_academic_scopes").countDocuments({
      userId: "real-mongo-user"
    })).resolves.toBe(1);
    await expect(connection.collection<{ userId: string; normalizedScopeKey: string }>("followed_academic_scopes").findOne({
      userId: "real-mongo-user"
    })).resolves.toEqual(expect.objectContaining({ normalizedScopeKey: expect.any(String) }));

    await repository.deleteUserData("real-mongo-user");
    await expect(connection.collection<{ userId: string }>("academic_unit_suggestions").countDocuments({
      userId: "real-mongo-user"
    })).resolves.toBe(0);
    await expect(connection.collection<{ userId: string }>("followed_academic_scopes").countDocuments({
      userId: "real-mongo-user"
    })).resolves.toBe(0);
  }, 30_000);
});

describe("MongoUserDataRepository", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists suggestions in newest-first order and preserves existing review transitions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
    const context = await createServiceContext();

    const first = await context.usersService.suggestAcademicUnit(context.firstUser.id, {
      universityId: context.university.id,
      facultyName: "  New Faculty  ",
      departmentName: "  New Department  "
    });
    const second = await context.usersService.suggestAcademicUnit(context.firstUser.id, {
      universityId: context.university.id,
      facultyName: "Second Faculty",
      educationLevel: "master"
    });

    expect(first).toEqual(expect.objectContaining({
      userId: context.firstUser.id,
      userEmail: context.firstUser.email,
      universityId: context.university.id,
      facultyName: "New Faculty",
      departmentName: "New Department",
      educationLevel: "bachelor",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z"
    }));
    expect(first).not.toHaveProperty("updatedAt");
    expect(second).toEqual(expect.objectContaining({
      facultyName: "Second Faculty",
      educationLevel: "master",
      createdAt: "2026-01-01T00:00:00.001Z"
    }));

    const persistedFirst = await context.userDataRepository.findAcademicUnitSuggestionById(first.id);
    expect(persistedFirst).toEqual(expect.objectContaining({
      id: first.id,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    }));
    await expect(context.userDataRepository.findAcademicUnitSuggestionById("missing-suggestion")).resolves.toBeNull();
    expect((await context.usersService.listAcademicUnitSuggestions("pending")).map((item) => item.id)).toEqual([
      second.id,
      first.id
    ]);

    const rejected = await context.usersService.rejectAcademicUnitSuggestion(first.id);
    expect(rejected).toEqual(expect.objectContaining({
      id: first.id,
      status: "rejected",
      reviewedAt: "2026-05-01T10:00:00.000Z"
    }));
    expect((await context.usersService.listAcademicUnitSuggestions("rejected")).map((item) => item.id)).toEqual([first.id]);

    vi.setSystemTime(new Date("2026-05-01T11:00:00.000Z"));
    const approved = await context.usersService.approveAcademicUnitSuggestion(first.id);
    expect(approved).toEqual(expect.objectContaining({
      id: first.id,
      status: "approved",
      reviewedAt: "2026-05-01T11:00:00.000Z"
    }));
    expect((await context.usersService.listAcademicUnitSuggestions("approved")).map((item) => item.id)).toEqual([first.id]);
    expect((await context.usersService.listAcademicUnitSuggestions("pending")).map((item) => item.id)).toEqual([second.id]);
    await expect(context.userDataRepository.updateAcademicUnitSuggestionReview("missing-suggestion", {
      status: "rejected",
      reviewedAt: new Date("2026-05-01T12:00:00.000Z")
    })).resolves.toBeNull();
  });

  it("upserts normalized scopes idempotently under sequential and concurrent requests", async () => {
    const context = await createServiceContext();

    const universityScope = await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id
    });
    const equivalentEmptyScope = await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id,
      facultyId: "",
      departmentId: ""
    });
    expect(equivalentEmptyScope).toEqual(universityScope);
    expect(universityScope).not.toHaveProperty("facultyId");
    expect(universityScope).not.toHaveProperty("departmentId");
    expect(universityScope).not.toHaveProperty("normalizedScopeKey");

    const concurrentFacultyScopes = await Promise.all(
      Array.from({ length: 8 }, () => context.usersService.addFollowedScope(context.firstUser.id, {
        universityId: context.university.id,
        facultyId: context.faculty.id,
        departmentId: ""
      }))
    );
    expect(new Set(concurrentFacultyScopes.map((scope) => scope.id))).toEqual(new Set([concurrentFacultyScopes[0]!.id]));

    const departmentScope = await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id,
      facultyId: context.faculty.id,
      departmentId: context.department.id
    });
    const listed = await context.usersService.listFollowedScopes(context.firstUser.id);

    expect(listed.map(({ universityId, facultyId, departmentId }) => ({
      universityId,
      ...(facultyId ? { facultyId } : {}),
      ...(departmentId ? { departmentId } : {})
    }))).toEqual([
      { universityId: context.university.id },
      { universityId: context.university.id, facultyId: context.faculty.id },
      {
        universityId: context.university.id,
        facultyId: context.faculty.id,
        departmentId: context.department.id
      }
    ]);
    expect(listed.map((scope) => scope.id)).toEqual([
      universityScope.id,
      concurrentFacultyScopes[0]!.id,
      departmentScope.id
    ]);
    expect(context.mongoFixture.snapshot().followedAcademicScopes).toHaveLength(3);
  });

  it("keeps different users and different valid normalized scope levels distinct", async () => {
    const context = await createServiceContext();

    const firstUserScope = await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id,
      facultyId: context.faculty.id
    });
    const secondUserScope = await context.usersService.addFollowedScope(context.secondUser.id, {
      universityId: context.university.id,
      facultyId: context.faculty.id
    });
    const firstUserDepartmentScope = await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id,
      facultyId: context.faculty.id,
      departmentId: context.department.id
    });

    expect(firstUserScope.id).not.toBe(secondUserScope.id);
    expect(firstUserDepartmentScope.id).not.toBe(firstUserScope.id);
    await expect(context.userDataRepository.listFollowedAcademicScopesByUserId(context.firstUser.id)).resolves.toHaveLength(2);
    await expect(context.userDataRepository.listFollowedAcademicScopesByUserId(context.secondUser.id)).resolves.toHaveLength(1);
  });

  it("retains repository-backed user data when UsersService and its repository are reconstructed", async () => {
    const context = await createServiceContext();
    const suggestion = await context.usersService.suggestAcademicUnit(context.firstUser.id, {
      universityId: context.university.id,
      facultyName: "Reconstruction Faculty"
    });
    const scope = await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id,
      facultyId: context.faculty.id
    });

    const rebuiltRepository = new MongoUserDataRepository(context.mongoFixture.mongo);
    const rebuiltService = new UsersService(
      context.authRepository,
      context.catalogRepository,
      rebuiltRepository,
      context.notificationRepository
    );

    expect((await rebuiltService.listAcademicUnitSuggestions("pending")).map((item) => item.id)).toEqual([suggestion.id]);
    expect((await rebuiltService.listFollowedScopes(context.firstUser.id)).map((item) => item.id)).toEqual([scope.id]);
  });

  it.each([
    "deleteMyData",
    "deleteMe",
    "deleteUserByAdmin"
  ] as const)("removes only the target user's Mongo-backed records through %s", async (operation) => {
    const context = await createServiceContext();
    await context.usersService.suggestAcademicUnit(context.firstUser.id, {
      universityId: context.university.id,
      facultyName: "First User Private Faculty"
    });
    const otherSuggestion = await context.usersService.suggestAcademicUnit(context.secondUser.id, {
      universityId: context.university.id,
      facultyName: "Second User Preserved Faculty"
    });
    await context.usersService.addFollowedScope(context.firstUser.id, {
      universityId: context.university.id
    });
    const otherScope = await context.usersService.addFollowedScope(context.secondUser.id, {
      universityId: context.university.id
    });

    if (operation === "deleteMyData") {
      await context.usersService.deleteMyData(context.firstUser.id);
    } else if (operation === "deleteMe") {
      await context.usersService.deleteMe(context.firstUser.id, { deleteData: false });
    } else {
      await context.usersService.deleteUserByAdmin(context.firstUser.id);
    }

    await expect(context.userDataRepository.listFollowedAcademicScopesByUserId(context.firstUser.id)).resolves.toEqual([]);
    expect(await context.userDataRepository.listFollowedAcademicScopesByUserId(context.secondUser.id)).toEqual([
      expect.objectContaining({ id: otherScope.id, userId: context.secondUser.id })
    ]);
    expect(await context.userDataRepository.listAcademicUnitSuggestions("pending")).toEqual([
      expect.objectContaining({ id: otherSuggestion.id, userId: context.secondUser.id })
    ]);
    await expect(context.authRepository.findUserById(context.secondUser.id)).resolves.toEqual(
      expect.objectContaining({ id: context.secondUser.id })
    );

    if (operation === "deleteMyData") {
      await expect(context.authRepository.findUserById(context.firstUser.id)).resolves.toEqual(
        expect.objectContaining({ id: context.firstUser.id })
      );
    } else {
      await expect(context.authRepository.findUserById(context.firstUser.id)).resolves.toBeNull();
    }
  });
});
