import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Dedicated disposable Mongo container only; never fall back to MONGODB_URI.
const uri = process.env.STALE_APPROVAL_TEST_MONGODB_URI;
assert.equal(process.env.NODE_ENV, "test");
assert.ok(uri, "STALE_APPROVAL_TEST_MONGODB_URI required");
const target = new URL(uri);
assert.equal(target.protocol, "mongodb:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "27017");
assert.match(target.pathname, /^\/stale_approval_test_[a-z0-9_]+$/u);
assert.ok(!target.username && !target.password && !target.search && !target.hash);
const root = resolve(process.argv[2] ?? "/app");
const moduleAt = (path) => import(pathToFileURL(resolve(root, "dist", path)).href);
const { MongoConnectionService } = await moduleAt("apps/api/src/database/mongo-connection.service.js");
const { MongoAnnouncementRepository } = await moduleAt("apps/api/src/modules/announcements/mongo-announcement.repository.js");
const { AnnouncementIngestionService } = await moduleAt("apps/api/src/modules/announcements/announcement-ingestion.service.js");
const { setSafeOutboundRequestDependenciesForTesting } = await moduleAt("apps/api/src/common/network/safe-outbound-request.js");
const mongo = new MongoConnectionService();
const connection = await mongo.connect(uri);
assert.equal(connection.name, target.pathname.slice(1));
const repository = new MongoAnnouncementRepository(mongo);
const university = { id: "konya-teknik-universitesi", slug: "konya-teknik-universitesi", name: "Konya Teknik Üniversitesi",
  websiteUrl: "https://www.ktun.edu.tr/", status: "active", type: "state", city: "Konya", createdAt: new Date(), updatedAt: new Date() };
const catalog = { findUniversityById: async (id) => id === university.id ? university : null,
  listUniversities: async () => [university], listFaculties: async () => [], listDepartments: async () => [] };
const url = "https://www.ktun.edu.tr/tr/Birim/DuyuruDetay/bOlUmUmUzden_haberler_6877";
const parserConfig = { itemSelector: "main tr", titleSelector: "td:nth-child(2) p:not(:has(strong))",
  linkSelector: "td:nth-child(3) a[href]", dateSelector: "td:nth-child(2) strong" };
const html = (date) => `<main><table><tbody><tr><td>Fotoğraf</td><td><p><strong>${date}</strong></p><p>Kimya Mühendisliği öğrencilerinin teknik gezisi</p></td><td><a href="/tr/Birim/DuyuruDetay/teknIk_gezI_6883">Detay</a></td></tr></tbody></table></main>`;
let body = html("2000-01-01"), notifications = 0;
const service = new AnnouncementIngestionService(catalog, repository, {
  retireTrustedAnnouncementSource: async () => undefined,
  syncTrustedAnnouncementSource: async () => { notifications++; }
});
const fence = (source) => ({ expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
  expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl, expectedTrustStatus: source.trustStatus,
  expectedSourceStatus: source.status, expectedApprovalPending: source.approvalPending === true });
setSafeOutboundRequestDependenciesForTesting({
  resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
  requestHop: async (_url, pinned) => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(body), remoteAddress: pinned.address })
});
try {
  const source = await repository.upsertSource({ scopeType: "university", scopeId: university.id, ownerUniversityId: university.id,
    sourceName: "Isolated test news", sourceUrl: url, homepageUrl: university.websiteUrl, contentType: "news", parser: "html",
    parserConfig, priority: 40, status: "inactive", trustStatus: "quarantined" });
  const request = fence(source);
  const approved = await service.approveSourceForAdmin({ kind: "global" }, source.id, "isolated-test", request);
  assert.equal(approved.source.status, "active");
  assert.equal(approved.source.approvalPending, false);
  assert.equal(approved.ingestion.error, "SOURCE_LISTING_STALE");
  assert.deepEqual(await repository.listItemsForSource(source.id, 100), []);
  assert.equal(notifications, 0);
  assert.equal((await service.ingestSource(await repository.findSourceById(source.id))).error, "SOURCE_LISTING_STALE");
  assert.equal((await repository.findSourceById(source.id)).consecutiveFailures, 0);
  await assert.rejects(service.approveSourceForAdmin({ kind: "global" }, source.id, "duplicate", request), (error) => error.status === 409);
  body = html(new Date().toISOString().slice(0, 10));
  const fresh = await service.ingestSource(await repository.findSourceById(source.id));
  assert.equal(fresh.status, "healthy");
  assert.equal(fresh.itemCount, 1);
  assert.equal((await repository.listItemsForSource(source.id, 100)).length, 1);
  console.log(JSON.stringify({ status: "passed", realMongo: true, sourceWarningApproved: true,
    noOldItemsPublished: true, duplicateApprovalRejected: true, freshRecovery: true, productionDatabaseWrites: 0 }));
} finally {
  setSafeOutboundRequestDependenciesForTesting(undefined);
  // Only the uniquely named database inside the disposable namespace is removed.
  await connection.dropDatabase();
  await mongo.onApplicationShutdown();
}
