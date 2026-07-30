import "reflect-metadata";
import { readFileSync } from "node:fs";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { BootstrapSeedService } from "../src/bootstrap/bootstrap-seed.service.js";
import type { TurkiyeCatalogSeed } from "../src/bootstrap/yok-atlas-catalog-importer.js";
import { MongoConnectionService } from "../src/database/mongo-connection.service.js";
import { FirestoreDatabaseService } from "../src/database/firestore.service.js";
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

const repositoryBindings = [
  { provide: "AuthRepository", useClass: MongoAuthRepository },
  { provide: "CatalogRepository", useClass: MongoCatalogRepository },
  { provide: "CalendarRepository", useClass: MongoCalendarRepository },
  { provide: "AnnouncementRepository", useClass: MongoAnnouncementRepository },
  { provide: "PdfRepository", useClass: MongoPdfRepository },
  { provide: "NotificationRepository", useClass: MongoNotificationRepository },
  { provide: "AuditRepository", useClass: MongoAuditRepository }
] as const;

@Module({
  providers: [
    { provide: MongoConnectionService, useValue: {} },
    ...repositoryBindings
  ]
})
class MongoRepositoryResolutionModule {}

function appProviders(): unknown[] {
  return (Reflect.getMetadata("providers", AppModule) as unknown[] | undefined) ?? [];
}

function isProviderFor(value: unknown, token: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "provide" in value && value.provide === token;
}

describe("MongoDB-only runtime repository wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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

    for (const binding of repositoryBindings) {
      const matches = providers.filter((provider) => isProviderFor(provider, binding.provide));
      expect(matches).toHaveLength(1);
      expect(matches[0]).toStrictEqual(binding);
      expect(matches[0]).not.toHaveProperty("useFactory");
      expect(matches[0]).not.toHaveProperty("inject");
    }

    expect(providers.some((provider) => provider === FirestoreDatabaseService || (typeof provider === "object" && provider !== null && "provide" in provider && provider.provide === FirestoreDatabaseService))).toBe(false);
  });

  it("resolves every repository token to its Mongo implementation in isolation", async () => {
    const context = await NestFactory.createApplicationContext(MongoRepositoryResolutionModule, { logger: false });
    try {
      for (const binding of repositoryBindings) {
        expect(context.get(binding.provide)).toBeInstanceOf(binding.useClass);
      }
    } finally {
      await context.close();
    }
  });

  it("contains no Firestore-specific catalog bootstrap branch", () => {
    const source = readFileSync(new URL("../src/bootstrap/bootstrap-seed.service.ts", import.meta.url), "utf8");

    expect(source).not.toContain("FirestoreCatalogRepository");
    expect(source).not.toContain("BOOTSTRAP_CATALOG_SEED_REFRESH");
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
    const second = await service.seedCatalog();

    expect(first).toEqual(expect.objectContaining({ created: true, createdUniversities: 1, createdFaculties: 1, createdDepartments: 1 }));
    expect(second).toEqual(expect.objectContaining({ created: false, createdUniversities: 0, createdFaculties: 0, createdDepartments: 0 }));
    expect(await catalogRepository.listUniversities({ limit: 10, offset: 0 })).toHaveLength(1);
  });
});
