import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { BootstrapSeedService } from "../src/bootstrap/bootstrap-seed.service.js";
import type { TurkiyeCatalogSeed } from "../src/bootstrap/yok-atlas-catalog-importer.js";
import { MongoConnectionService, shouldAutoIndexMongo } from "../src/database/mongo-connection.service.js";
import { MongoAnnouncementRepository } from "../src/modules/announcements/mongo-announcement.repository.js";
import { MongoAuditRepository } from "../src/modules/audit/mongo-audit.repository.js";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";
import { PasswordHasher } from "../src/modules/auth/password-hasher.js";
import { MongoCalendarRepository } from "../src/modules/calendars/mongo-calendar.repository.js";
import { InMemoryCatalogRepository } from "../src/modules/catalog/in-memory-catalog.repository.js";
import { MongoCatalogRepository } from "../src/modules/catalog/mongo-catalog.repository.js";
import { MongoNotificationRepository } from "../src/modules/notifications/mongo-notification.repository.js";
import { MongoPdfRepository } from "../src/modules/pdf/mongo-pdf.repository.js";
import { MongoUserDataRepository } from "../src/modules/users/mongo-user-data.repository.js";

const repositoryBindings = [
  { provide: "AuthRepository", useClass: MongoAuthRepository },
  { provide: "CatalogRepository", useClass: MongoCatalogRepository },
  { provide: "CalendarRepository", useClass: MongoCalendarRepository },
  { provide: "AnnouncementRepository", useClass: MongoAnnouncementRepository },
  { provide: "PdfRepository", useClass: MongoPdfRepository },
  { provide: "NotificationRepository", useClass: MongoNotificationRepository },
  { provide: "AuditRepository", useClass: MongoAuditRepository }
] as const;

const userDataBinding = { provide: "UserDataRepository", useClass: MongoUserDataRepository } as const;

@Module({
  providers: [
    { provide: MongoConnectionService, useValue: {} },
    ...repositoryBindings,
    userDataBinding
  ]
})
class MongoRepositoryResolutionModule {}

function appProviders(): unknown[] {
  return (Reflect.getMetadata("providers", AppModule) as unknown[] | undefined) ?? [];
}

function isProviderFor(value: unknown, token: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "provide" in value && value.provide === token;
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

describe("MongoDB-only runtime repository wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["production default", { NODE_ENV: "production" }, false],
    ["production opt-in", { NODE_ENV: "production", MONGODB_AUTO_INDEX: "true" }, true],
    ["test default", { NODE_ENV: "test" }, true],
    ["test opt-out", { NODE_ENV: "test", MONGODB_AUTO_INDEX: "false" }, false]
  ] as const)("sets controlled Mongo index creation for %s", (_label, environment, expected) => {
    expect(shouldAutoIndexMongo(environment)).toBe(expected);
  });

  it.each([
    ["missing", undefined],
    ["memory", "memory"],
    ["mongo", "mongo"],
    ["firestore", "firestore"],
    ["invalid", "invalid"]
  ] as const)("keeps all seven direct Mongo bindings for legacy selector %s", (_label, repositoryMode) => {
    if (repositoryMode === undefined) vi.stubEnv("REPOSITORY_MODE", undefined);
    else vi.stubEnv("REPOSITORY_MODE", repositoryMode);
    const providers = appProviders();
    const r1aTokens = new Set(repositoryBindings.map((binding) => binding.provide));
    const r1aProviders = providers.filter(
      (provider) =>
        typeof provider === "object" &&
        provider !== null &&
        "provide" in provider &&
        typeof provider.provide === "string" &&
        r1aTokens.has(provider.provide as typeof repositoryBindings[number]["provide"])
    );

    expect(repositoryBindings).toHaveLength(7);
    expect(r1aProviders).toHaveLength(7);

    for (const binding of repositoryBindings) {
      const matches = providers.filter((provider) => isProviderFor(provider, binding.provide));
      expect(matches).toHaveLength(1);
      expect(matches[0]).toStrictEqual(binding);
      expect(matches[0]).not.toHaveProperty("useFactory");
      expect(matches[0]).not.toHaveProperty("inject");
    }

    const userDataMatches = providers.filter((provider) => isProviderFor(provider, userDataBinding.provide));
    expect(userDataMatches).toHaveLength(1);
    expect(userDataMatches[0]).toStrictEqual(userDataBinding);
    expect(userDataMatches[0]).not.toHaveProperty("useFactory");
    expect(userDataMatches[0]).not.toHaveProperty("inject");
  });

  it("resolves every repository token to its Mongo implementation in isolation", async () => {
    const context = await NestFactory.createApplicationContext(MongoRepositoryResolutionModule, { logger: false });
    try {
      for (const binding of repositoryBindings) {
        expect(context.get(binding.provide)).toBeInstanceOf(binding.useClass);
      }
      expect(context.get(userDataBinding.provide)).toBeInstanceOf(userDataBinding.useClass);
    } finally {
      await context.close();
    }
  });

  it("contains no retired database persistence source or imports", () => {
    const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
    const retiredDatabaseWord = ["fire", "store"].join("");
    const offenders = collectTypeScriptFiles(sourceRoot).filter((file) => {
      const pathAndSource = `${file}\n${readFileSync(file, "utf8")}`.toLowerCase();
      return pathAndSource.includes(retiredDatabaseWord);
    });
    const bootstrapSource = readFileSync(new URL("../src/bootstrap/bootstrap-seed.service.ts", import.meta.url), "utf8");

    expect(offenders).toEqual([]);
    expect(bootstrapSource).not.toContain("BOOTSTRAP_CATALOG_SEED_REFRESH");
  });

  it("resolves the retained Firebase Authentication verifier", async () => {
    const module = await import("../src/modules/auth/firebase-google-identity.verifier.js");

    expect(module.FirebaseGoogleIdentityVerifier).toBeTypeOf("function");
    expect(appProviders()).toContain(module.FirebaseGoogleIdentityVerifier);
  });

  it("resolves the retained FCM sender", async () => {
    const module = await import("../src/modules/notifications/push-sender.service.js");

    expect(module.FirebasePushSender).toBeTypeOf("function");
    expect(appProviders()).toContain(module.FirebasePushSender);
  });

  it("keeps user suggestions and followed scopes out of UsersService process memory", () => {
    const source = readFileSync(new URL("../src/modules/users/users.service.ts", import.meta.url), "utf8");

    expect(source).not.toContain("private readonly academicUnitSuggestions");
    expect(source).not.toContain("private readonly followedScopes");
    expect(source).not.toContain("deleteInMemoryUserData");
    expect(source).not.toContain("academicUnitSuggestions.push");
    expect(source).not.toContain("followedScopes.push");
  });

  it("keeps catalog bootstrap generic and idempotent", async () => {
    vi.stubEnv("BOOTSTRAP_CATALOG_SEED_ENABLED", "true");
    const catalogRepository = new InMemoryCatalogRepository();
    const service = new BootstrapSeedService(new InMemoryAuthRepository(), catalogRepository, new PasswordHasher());
    const source: TurkiyeCatalogSeed = {
      source: "yok_atlas",
      sourceUrl: "https://example.test/catalog",
      sourceRowCount: 1,
      includedRowCount: 1,
      universities: [
        {
          name: "Test University",
          slug: "test-university",
          city: "Ankara",
          type: "state",
          websiteUrl: "https://www.test-university.edu.tr/",
          faculties: [
            {
              name: "Engineering Faculty",
              slug: "engineering-faculty",
              departments: [{ name: "Computer Engineering", slug: "computer-engineering", educationLevel: "bachelor" }]
            }
          ]
        }
      ]
    };
    const loader = service as unknown as { loadCatalogSeedSource(): Promise<{ source: TurkiyeCatalogSeed }> };
    vi.spyOn(loader, "loadCatalogSeedSource").mockResolvedValue({ source });

    const first = await service.seedCatalog();
    await catalogRepository.updateUniversity("test-university", { websiteUrl: "https://stale.example/" });
    const second = await service.seedCatalog();

    expect(first).toEqual(expect.objectContaining({ created: true, createdUniversities: 1, createdFaculties: 1, createdDepartments: 1 }));
    expect(second).toEqual(expect.objectContaining({ created: false, createdUniversities: 0, createdFaculties: 0, createdDepartments: 0 }));
    expect(await catalogRepository.listUniversities({ limit: 10, offset: 0 })).toEqual([
      expect.objectContaining({ websiteUrl: "https://www.test-university.edu.tr/" })
    ]);
  });

  it("updates the renamed İzmir Konak record without changing its stable ID", async () => {
    vi.stubEnv("BOOTSTRAP_CATALOG_SEED_ENABLED", "true");
    const catalogRepository = new InMemoryCatalogRepository();
    await catalogRepository.createUniversity({
      name: "İZMİR KAVRAM MESLEK YÜKSEKOKULU",
      slug: "izmir-kavram-meslek-yuksekokulu",
      city: "İZMİR",
      type: "foundation",
      status: "active"
    });
    const service = new BootstrapSeedService(new InMemoryAuthRepository(), catalogRepository, new PasswordHasher());
    const source: TurkiyeCatalogSeed = {
      source: "yok_atlas",
      sourceUrl: "https://example.test/catalog",
      sourceRowCount: 1,
      includedRowCount: 1,
      universities: [{
        name: "İZMİR KONAK MESLEK YÜKSEKOKULU",
        slug: "izmir-kavram-meslek-yuksekokulu",
        city: "İZMİR",
        type: "foundation",
        websiteUrl: "https://www.konak.edu.tr/",
        faculties: []
      }]
    };
    const loader = service as unknown as { loadCatalogSeedSource(): Promise<{ source: TurkiyeCatalogSeed }> };
    vi.spyOn(loader, "loadCatalogSeedSource").mockResolvedValue({ source });

    await service.seedCatalog();

    expect(await catalogRepository.listUniversities({ limit: 10, offset: 0 })).toEqual([
      expect.objectContaining({
        id: "izmir-kavram-meslek-yuksekokulu",
        slug: "izmir-kavram-meslek-yuksekokulu",
        name: "İZMİR KONAK MESLEK YÜKSEKOKULU",
        websiteUrl: "https://www.konak.edu.tr/"
      })
    ]);
  });
});
