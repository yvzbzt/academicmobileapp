import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isValidObjectId, Types } from "mongoose";
import { announcementItemSchema, announcementSnapshotSchema, announcementSourceSchema, savedAnnouncementSchema } from "../../database/mongoose-schemas.js";
import { getModel, omitUndefined, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { canonicalAnnouncementSourceIdentityKey, canonicalizeContentUrl, createAnnouncementSourceCandidateId, isOfficialContentUrl, normalizeDisplayText, officialDomainForUrl } from "./announcement-content-trust.js";
import { emptyAnnouncementPersistenceDelta, planAnnouncementReplacement, toPersistenceReference } from "./announcement-persistence.js";
import type { AnnouncementItem, AnnouncementPersistenceDelta, AnnouncementPersistenceReference, AnnouncementReplacementOptions, AnnouncementRepository, AnnouncementSourceCandidateInput, AnnouncementSourceDefinitionFence, AnnouncementSourceRecord, AnnouncementSourceScope, AnnouncementSourceStatus, AnnouncementTrustReason, SavedAnnouncementRecord, SourceCheckInput, UpsertAnnouncementSourceInput } from "./announcements.types.js";

@Injectable()
export class MongoAnnouncementRepository implements AnnouncementRepository {
  constructor(@Inject(MongoConnectionService) private readonly mongo: MongoConnectionService) {}

  async listSourcesByScope(input: { universityId: string; facultyId?: string; departmentId?: string }): Promise<AnnouncementSourceRecord[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", $or: matchers })
      .sort({ priority: -1, updatedAt: -1 });

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listAllSources(input: { status?: AnnouncementSourceStatus; limit?: number; offset?: number } = {}): Promise<AnnouncementSourceRecord[]> {
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find(input.status === "active"
        ? { status: "active", trustStatus: "trusted" }
        : input.status ? { status: input.status } : {})
      .sort({ priority: -1, sourceName: 1 })
      .skip(input.offset ?? 0)
      .limit(input.limit ?? 500);

    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async listSourcesByScopeSet(input: {
    scopes: AnnouncementSourceScope[];
    status?: AnnouncementSourceStatus;
    limit: number;
    offset: number;
  }): Promise<AnnouncementSourceRecord[]> {
    if (input.scopes.length === 0) return [];
    const documents = await (await this.model("AnnouncementSource", announcementSourceSchema)).find({
      ...(input.status === "active"
        ? { status: "active", trustStatus: "trusted" }
        : input.status ? { status: input.status } : {}),
      $or: input.scopes.map((scope) => ({ scopeType: scope.scopeType, scopeId: scope.scopeId }))
    }).sort({ priority: -1, sourceName: 1 }).skip(input.offset).limit(input.limit);
    return documents.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
  }

  async findSourceById(id: string): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema)).findById(id);
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async upsertSource(input: UpsertAnnouncementSourceInput): Promise<AnnouncementSourceRecord> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    if (
      homepageUrl
      && (input.status === "active" || input.trustStatus === "trusted")
      && !isOfficialContentUrl(canonicalUrl, homepageUrl)
    ) throw new Error("ANNOUNCEMENT_SOURCE_DOMAIN_MISMATCH");
    const normalizedInput = {
      ...input,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      ...(input.trustStatus ? { trustStatus: input.trustStatus } : {})
    };
    let existing = input.id ? await model.findById(input.id) : null;
    if (!existing) existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, sourceUrl: canonicalUrl });
    if (!existing) existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, canonicalUrl });
    if (!existing && input.sourceUrl !== canonicalUrl) {
      existing = await model.findOne({ scopeType: input.scopeType, scopeId: input.scopeId, sourceUrl: input.sourceUrl });
    }
    if (!existing) {
      const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
      const scopedDocuments = await model.find({ scopeType: input.scopeType, scopeId: input.scopeId });
      existing = scopedDocuments.find((candidate) => {
        const record = toDomainRecord<AnnouncementSourceRecord>(candidate);
        return canonicalAnnouncementSourceIdentityKey(record.canonicalUrl ?? record.sourceUrl) === identityKey;
      }) ?? null;
    }
    let document;
    if (existing) {
      const existingRecord = toDomainRecord<AnnouncementSourceRecord>(existing);
      const definitionChanged = hasProcessingDefinitionChanged(existingRecord, {
        sourceUrl: canonicalUrl,
        parser: input.parser,
        contentType: input.contentType
      });
      const reactivated = isReactivatedTrustedSource(existingRecord, input);
      const set = omitUndefined(normalizedInput as unknown as Record<string, unknown>);
      delete set.id;
      // The snapshot pointer is repository-owned and may only change through
      // the CAS activation below. Generic source edits must never restore a
      // stale pointer copied from an earlier source read.
      delete set.activeSnapshotId;
      // Repository-owned generations cannot be restored from a stale source
      // read. Processing changes and notification reactivation intentionally
      // use separate fences.
      delete set.sourceDefinitionVersion;
      delete set.notificationProducerVersion;
      if (definitionChanged) {
        set.sourceDefinitionVersion = newSourceDefinitionVersion();
      }
      if (reactivated) set.notificationProducerVersion = newSourceDefinitionVersion();
      if (definitionChanged) {
        for (const field of sourceValidatorFields) delete set[field];
      }
      document = await model.findByIdAndUpdate(existing.id, {
        $set: set,
        ...(definitionChanged ? { $unset: sourceValidatorUnset } : {})
      }, { new: true });
    } else {
      const createValue = omitUndefined({
        ...normalizedInput,
        trustStatus: input.trustStatus ?? "quarantined",
        discoveredAt: input.discoveredAt ?? new Date()
      } as unknown as Record<string, unknown>);
      delete createValue.activeSnapshotId;
      delete createValue.sourceDefinitionVersion;
      delete createValue.notificationProducerVersion;
      createValue.sourceDefinitionVersion = newSourceDefinitionVersion();
      createValue.notificationProducerVersion = newSourceDefinitionVersion();
      document = await model.create(createValue);
    }
    if (!document) throw new Error("ANNOUNCEMENT_SOURCE_UPSERT_FAILED");
    return toDomainRecord<AnnouncementSourceRecord>(document);
  }

  async insertQuarantinedSourceCandidate(input: AnnouncementSourceCandidateInput): Promise<AnnouncementSourceRecord> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const canonicalUrl = canonicalizeContentUrl(input.sourceUrl);
    if (!canonicalUrl || !officialDomainForUrl(canonicalUrl)) throw new Error("ANNOUNCEMENT_SOURCE_URL_NOT_OFFICIAL");
    const homepageUrl = input.homepageUrl ? canonicalizeContentUrl(input.homepageUrl) : undefined;
    if (input.homepageUrl && !homepageUrl) throw new Error("ANNOUNCEMENT_SOURCE_HOMEPAGE_URL_INVALID");
    const identityKey = canonicalAnnouncementSourceIdentityKey(canonicalUrl);
    const candidateId = createAnnouncementSourceCandidateId({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      sourceUrl: canonicalUrl
    });
    if (!identityKey || !candidateId) throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_ID_INVALID");
    const scopedDocuments = await model.find({ scopeType: input.scopeType, scopeId: input.scopeId });
    const aliasMatch = scopedDocuments.find((candidate) => {
      const record = toDomainRecord<AnnouncementSourceRecord>(candidate);
      return canonicalAnnouncementSourceIdentityKey(record.canonicalUrl ?? record.sourceUrl) === identityKey;
    });
    if (aliasMatch) return toDomainRecord<AnnouncementSourceRecord>(aliasMatch);

    const now = new Date();
    const candidate = omitUndefined({
      ...input,
      sourceName: normalizeDisplayText(input.sourceName, 160) || "Resmî akademik kaynak",
      sourceUrl: canonicalUrl,
      canonicalUrl,
      ...(homepageUrl ? { homepageUrl } : {}),
      status: "inactive",
      trustStatus: "quarantined",
      sourceDefinitionVersion: newSourceDefinitionVersion(),
      notificationProducerVersion: newSourceDefinitionVersion(),
      discoveredAt: input.discoveredAt ?? now,
      createdAt: now,
      updatedAt: now
    } as unknown as Record<string, unknown>);
    const document = await model.findOneAndUpdate(
      { _id: candidateId },
      { $setOnInsert: candidate },
      { new: true, upsert: true, setDefaultsOnInsert: false, timestamps: false }
    );
    if (!document) throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_INSERT_FAILED");
    const persisted = toDomainRecord<AnnouncementSourceRecord>(document);
    if (
      persisted.scopeType !== input.scopeType
      || persisted.scopeId !== input.scopeId
      || canonicalAnnouncementSourceIdentityKey(persisted.canonicalUrl ?? persisted.sourceUrl) !== identityKey
    ) {
      throw new Error("ANNOUNCEMENT_SOURCE_CANDIDATE_ID_COLLISION");
    }
    return persisted;
  }

  async recordSourceCheck(
    id: string,
    input: SourceCheckInput,
    expectedDefinition?: AnnouncementSourceDefinitionFence,
    expectedActiveSnapshotId?: string | null
  ): Promise<AnnouncementSourceRecord | null> {
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const update = {
      $set: omitUndefined(input as unknown as Record<string, unknown>),
      ...(input.healthStatus === "healthy" ? { $unset: { lastError: 1 } } : {})
    };
    const document = expectedDefinition || expectedActiveSnapshotId !== undefined
      ? await model.findOneAndUpdate({
          _id: id,
          ...(expectedDefinition ? sourceDefinitionFenceFilter(expectedDefinition) : {}),
          ...(expectedActiveSnapshotId !== undefined ? snapshotPointerFenceFilter(expectedActiveSnapshotId) : {})
        }, update, { new: true })
      : await model.findByIdAndUpdate(id, update, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async quarantineSource(
    id: string,
    reasonCodes: AnnouncementTrustReason[],
    expectedDefinition?: AnnouncementSourceDefinitionFence
  ): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const model = await this.model("AnnouncementSource", announcementSourceSchema);
    const document = await model.findOneAndUpdate({
      _id: id,
      ...(expectedDefinition ? sourceDefinitionFenceFilter(expectedDefinition) : {})
    }, {
      $set: { status: "inactive", trustStatus: "quarantined" },
      $addToSet: { trustReasonCodes: { $each: [...new Set(reasonCodes)].sort() } }
    }, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async deactivateSource(id: string): Promise<AnnouncementSourceRecord | null> {
    if (!isValidObjectId(id)) return null;
    const document = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .findByIdAndUpdate(id, { status: "inactive" }, { new: true });
    return document ? toDomainRecord<AnnouncementSourceRecord>(document) : null;
  }

  async replaceItemsForSource(source: AnnouncementSourceRecord, items: AnnouncementItem[], options: AnnouncementReplacementOptions = {}): Promise<AnnouncementPersistenceDelta> {
    // Historical focused tests inject only an AnnouncementItem model. Keep
    // that narrow compatibility path; configured Mongo uses atomic snapshot
    // activation and does not require replica-set transactions.
    if (!this.supportsSnapshotPersistence()) return this.persistLegacyItemsForSource(source, items, options);
    return this.persistSnapshotItemsForSource(source, items, options);
  }

  private async persistSnapshotItemsForSource(
    requestedSource: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options: AnnouncementReplacementOptions
  ): Promise<AnnouncementPersistenceDelta> {
    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
    const legacyItemModel = await this.model("AnnouncementItem", announcementItemSchema);

    const sourceDocument = await sourceModel.findOne({
      _id: requestedSource.id,
      status: "active",
      trustStatus: "trusted"
    });
    if (!sourceDocument) throw new Error("ANNOUNCEMENT_SNAPSHOT_SOURCE_NOT_ACTIVE");
    const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
    if (!sameSourceDefinition(source, requestedSource)) {
      throw new Error("ANNOUNCEMENT_SOURCE_DEFINITION_CHANGED");
    }
    const expectedSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
    if (expectedSnapshotId !== normalizedSnapshotId(requestedSource.activeSnapshotId)) {
      throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
    }
    let existingItems: AnnouncementItem[];
    let activeSnapshotHash: string | undefined;

    if (expectedSnapshotId) {
      const activeSnapshot = await snapshotModel.findOne({
        _id: expectedSnapshotId,
        sourceId: source.id
      });
      if (!activeSnapshot) throw new Error("ANNOUNCEMENT_ACTIVE_SNAPSHOT_MISSING");
      activeSnapshotHash = toDomainRecord<AnnouncementSnapshotRecord>(activeSnapshot).snapshotHash;
      existingItems = itemsFromSnapshot(activeSnapshot, source.id, expectedSnapshotId);
    } else {
      const existingDocuments = await legacyItemModel.find({ sourceId: source.id });
      existingItems = existingDocuments.map((document) => toDomainRecord<AnnouncementItem>(document));
    }

    const plan = planAnnouncementReplacement(source, items, existingItems, options);
    if (plan.entries.length === 0 && plan.removed.length === 0) return emptyAnnouncementPersistenceDelta();

    const snapshotId = new Types.ObjectId().toHexString();
    const snapshotItems = plan.entries.map(({ item, previous }) => {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      return omitUndefined({
        ...item,
        id: previous?.id ?? new Types.ObjectId().toHexString(),
        sourceId: source.id,
        snapshotId,
        sourceName: source.sourceName,
        officialSourceUrl: source.canonicalUrl ?? source.sourceUrl,
        contentType: item.contentType ?? source.contentType ?? "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        ...(discoveredAt ? { discoveredAt } : {})
      } as unknown as Record<string, unknown>) as unknown as AnnouncementItem;
    });
    const snapshotHash = snapshotHashFor(snapshotItems);
    if (expectedSnapshotId && activeSnapshotHash === snapshotHash) {
      return {
        ...snapshotDelta(
          plan,
          snapshotItems.map((item) => ({ ...item, snapshotId: expectedSnapshotId }))
        ),
        snapshotId: expectedSnapshotId
      };
    }
    const delta: AnnouncementPersistenceDelta = {
      ...snapshotDelta(plan, snapshotItems),
      snapshotId,
      ...(expectedSnapshotId ? { previousSnapshotId: expectedSnapshotId } : {})
    };

    await snapshotModel.create({
      _id: snapshotId,
      sourceId: source.id,
      items: snapshotItems,
      snapshotHash
    });

    let activated;
    try {
      activated = await sourceModel.findOneAndUpdate({
        _id: source.id,
        status: "active",
        trustStatus: "trusted",
        ...sourceDefinitionFenceFilter(source),
        ...(expectedSnapshotId
          ? { activeSnapshotId: expectedSnapshotId }
          : { $or: [{ activeSnapshotId: { $exists: false } }, { activeSnapshotId: null }] })
      }, {
        $set: { activeSnapshotId: snapshotId }
      }, { new: true });
    } catch (error) {
      // A response failure makes activation indeterminate. Even when the
      // pointer has since advanced, this snapshot may have been visible to a
      // reader that already loaded it. Never delete an indeterminate stage.
      try {
        const activatedAfterError = await sourceModel.findOne({
          _id: source.id,
          activeSnapshotId: snapshotId
        });
        if (activatedAfterError) return delta;
      } catch {
        // Preserve the staged snapshot when verification is unavailable too.
      }
      throw error;
    }

    if (activated) return delta;
    // A definitive CAS miss means another writer or a definition edit won.
    // Do not replay stale fetched items over that newer state.
    await bestEffortDeleteSnapshot(snapshotModel, snapshotId);
    throw new Error("ANNOUNCEMENT_SNAPSHOT_ACTIVATION_CONFLICT");
  }

  private async persistLegacyItemsForSource(
    source: AnnouncementSourceRecord,
    items: AnnouncementItem[],
    options: AnnouncementReplacementOptions
  ): Promise<AnnouncementPersistenceDelta> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    const existingDocuments = await model.find({ sourceId: source.id });
    const existingItems = existingDocuments.map((document) => toDomainRecord<AnnouncementItem>(document));
    const plan = planAnnouncementReplacement(source, items, existingItems, options);
    if (plan.entries.length === 0 && plan.removed.length === 0) return emptyAnnouncementPersistenceDelta();
    const delta = emptyAnnouncementPersistenceDelta();
    const removedIds = plan.removed.map((item) => item.id);

    for (const { item, previous, materiallyUpdated } of plan.entries) {
      const discoveredAt = previous?.discoveredAt ?? item.discoveredAt ?? item.fetchedAt;
      const persisted: AnnouncementItem = {
        ...item,
        id: previous?.id ?? item.id,
        sourceId: source.id,
        sourceName: source.sourceName,
        officialSourceUrl: source.canonicalUrl ?? source.sourceUrl,
        contentType: item.contentType ?? source.contentType ?? "announcement",
        scopeType: source.scopeType,
        scopeId: source.scopeId,
        ...(discoveredAt ? { discoveredAt } : {})
      };
      const value = omitUndefined(persisted as unknown as Record<string, unknown>);
      delete value.id;
      let persistedId: string;
      if (previous) {
        const updated = await model.findByIdAndUpdate(previous.id, value, { new: true });
        if (!updated) throw new Error("ANNOUNCEMENT_ITEM_UPDATE_FAILED");
        persistedId = updated.id;
      } else {
        const created = await model.create(value);
        if (!created) throw new Error("ANNOUNCEMENT_ITEM_CREATE_FAILED");
        persistedId = created.id;
      }
      const reference = toPersistenceReference(persisted, persistedId);
      if (!reference) continue;
      if (!previous) delta.created.push(reference);
      else if (materiallyUpdated) delta.materiallyUpdated.push(reference);
      else delta.unchanged.push(reference);
    }
    // Retire the previous rows only after every replacement row is durable. A
    // failed write therefore leaves the last complete trusted snapshot intact.
    if (removedIds.length > 0) {
      await model.deleteMany({ _id: { $in: removedIds }, trustStatus: "trusted" });
    }
    for (const removed of plan.removed) {
      const reference = toPersistenceReference(removed);
      if (reference) delta.removed.push(reference);
    }
    return delta;
  }

  async acknowledgeNotificationProduction(references: readonly AnnouncementPersistenceReference[]): Promise<number> {
    if (!this.supportsSnapshotPersistence()) return this.acknowledgeLegacyNotificationProduction(references);

    const sourceModel = await this.model("AnnouncementSource", announcementSourceSchema);
    const snapshotModel = await this.model("AnnouncementSnapshot", announcementSnapshotSchema);
    const legacyItemModel = await this.model("AnnouncementItem", announcementItemSchema);
    let acknowledged = 0;
    const visited = new Set<string>();
    for (const reference of references) {
      const key = `${reference.sourceId}\u0000${reference.id}\u0000${reference.contentFingerprint}`;
      if (visited.has(key)) continue;
      visited.add(key);

      let didAcknowledge = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const sourceDocument = await sourceModel.findOne({
          _id: reference.sourceId,
          scopeType: reference.scopeType,
          scopeId: reference.scopeId,
          status: "active",
          trustStatus: "trusted"
        });
        if (!sourceDocument) break;
        const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
        const activeSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
        if (!activeSnapshotId) {
          const legacyDocument = await acknowledgeLegacyReference(legacyItemModel, reference);
          didAcknowledge = Boolean(legacyDocument);
          break;
        }

        const snapshotDocument = await snapshotModel.findOneAndUpdate({
          _id: activeSnapshotId,
          sourceId: reference.sourceId,
          items: {
            $elemMatch: {
              id: reference.id,
              sourceId: reference.sourceId,
              scopeType: reference.scopeType,
              scopeId: reference.scopeId,
              contentFingerprint: reference.contentFingerprint,
              notificationEligibleFingerprint: reference.contentFingerprint
            }
          }
        }, {
          $set: { "items.$[item].notificationProducedFingerprint": reference.contentFingerprint }
        }, {
          new: true,
          strict: false,
          arrayFilters: [{
            "item.id": reference.id,
            "item.sourceId": reference.sourceId,
            "item.scopeType": reference.scopeType,
            "item.scopeId": reference.scopeId,
            "item.contentFingerprint": reference.contentFingerprint,
            "item.notificationEligibleFingerprint": reference.contentFingerprint
          }]
        });
        if (!snapshotDocument) break;

        const pointerStillActive = await sourceModel.findOne({
          _id: reference.sourceId,
          scopeType: reference.scopeType,
          scopeId: reference.scopeId,
          status: "active",
          trustStatus: "trusted",
          activeSnapshotId
        });
        if (pointerStillActive) {
          didAcknowledge = true;
          break;
        }
      }
      if (didAcknowledge) acknowledged += 1;
    }
    return acknowledged;
  }

  private async acknowledgeLegacyNotificationProduction(
    references: readonly AnnouncementPersistenceReference[]
  ): Promise<number> {
    const model = await this.model("AnnouncementItem", announcementItemSchema);
    let acknowledged = 0;
    const visited = new Set<string>();
    for (const reference of references) {
      const key = `${reference.sourceId}\u0000${reference.id}\u0000${reference.contentFingerprint}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (await acknowledgeLegacyReference(model, reference)) acknowledged += 1;
    }
    return acknowledged;
  }

  async listItemsForSource(sourceId: string, limit = 1_000, offset = 0): Promise<AnnouncementItem[]> {
    const sourceDocument = await (await this.model("AnnouncementSource", announcementSourceSchema)).findOne({
      _id: sourceId,
      status: "active",
      trustStatus: "trusted"
    });
    if (!sourceDocument) return [];
    const source = toDomainRecord<AnnouncementSourceRecord>(sourceDocument);
    return (await this.loadVisibleItemsForSources([source], offset + limit))
      .sort(compareMongoAnnouncementItems)
      .slice(offset, offset + limit);
  }

  async listItemsByScope(input: { universityId: string; facultyId?: string; departmentId?: string; limit: number }): Promise<AnnouncementItem[]> {
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });
    const sourceDocuments = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", $or: matchers });
    const sources = sourceDocuments.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
    if (sources.length === 0) return [];
    return (await this.loadVisibleItemsForSources(sources, input.limit))
      .sort(compareMongoAnnouncementItems)
      .slice(0, input.limit);
  }

  async findTrustedItemByIdInScope(input: {
    announcementId: string;
    universityId: string;
    facultyId?: string;
    departmentId?: string;
  }): Promise<{ item: AnnouncementItem; source: AnnouncementSourceRecord } | null> {
    if (!isValidObjectId(input.announcementId)) return null;
    const matchers: Array<Record<string, string>> = [{ scopeType: "university", scopeId: input.universityId }];
    if (input.facultyId) matchers.push({ scopeType: "faculty", scopeId: input.facultyId });
    if (input.departmentId) matchers.push({ scopeType: "department", scopeId: input.departmentId });

    const sourceDocuments = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted", $or: matchers });
    if (sourceDocuments.length === 0) return null;
    const sourceById = new Map(sourceDocuments.map((document) => {
      const source = toDomainRecord<AnnouncementSourceRecord>(document);
      return [source.id, source] as const;
    }));
    const snapshotSources = [...sourceById.values()].filter((source) => normalizedSnapshotId(source.activeSnapshotId));
    if (snapshotSources.length > 0) {
      const snapshotDocuments = await (await this.model("AnnouncementSnapshot", announcementSnapshotSchema)).find({
        _id: { $in: snapshotSources.map((source) => source.activeSnapshotId) }
      });
      for (const snapshotDocument of snapshotDocuments) {
        const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(snapshotDocument);
        const source = sourceById.get(snapshot.sourceId);
        if (!source || source.activeSnapshotId !== snapshot.id) continue;
        const item = itemsFromSnapshot(snapshotDocument, source.id, snapshot.id)
          .find((candidate) => candidate.id === input.announcementId && isApiEligibleItem(candidate));
        if (item) return { item, source };
      }
    }

    const legacySourceIds = [...sourceById.values()]
      .filter((source) => !normalizedSnapshotId(source.activeSnapshotId))
      .map((source) => source.id);
    if (legacySourceIds.length === 0) return null;
    const document = await (await this.model("AnnouncementItem", announcementItemSchema)).findOne({
      _id: input.announcementId,
      sourceId: { $in: legacySourceIds },
      trustStatus: "trusted"
    });
    if (!document) return null;
    const item = toDomainRecord<AnnouncementItem>(document);
    const source = sourceById.get(item.sourceId);
    return source
      ? { item, source }
      : null;
  }

  async findSavedAnnouncement(userId: string, announcementId: string): Promise<SavedAnnouncementRecord | null> {
    const document = await (await this.model("SavedAnnouncement", savedAnnouncementSchema))
      .findOne({ userId, announcementId });
    return document ? toDomainRecord<SavedAnnouncementRecord>(document) : null;
  }

  async saveAnnouncement(userId: string, announcementId: string, savedAt: Date): Promise<SavedAnnouncementRecord> {
    const document = await (await this.model("SavedAnnouncement", savedAnnouncementSchema)).findOneAndUpdate(
      { userId, announcementId },
      {
        $setOnInsert: { userId, announcementId, savedAt },
        $set: { updatedAt: savedAt }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (!document) throw new Error("SAVED_ANNOUNCEMENT_UPSERT_FAILED");
    return toDomainRecord<SavedAnnouncementRecord>(document);
  }

  async deleteSavedAnnouncement(userId: string, announcementId: string): Promise<boolean> {
    const result = await (await this.model("SavedAnnouncement", savedAnnouncementSchema))
      .deleteOne({ userId, announcementId });
    return result.deletedCount > 0;
  }

  async deleteSavedAnnouncementsByUserId(userId: string): Promise<void> {
    await (await this.model("SavedAnnouncement", savedAnnouncementSchema)).deleteMany({ userId });
  }

  async listAllItems(input: { limit?: number; offset?: number } = {}): Promise<AnnouncementItem[]> {
    const sourceDocuments = await (await this.model("AnnouncementSource", announcementSourceSchema))
      .find({ status: "active", trustStatus: "trusted" });
    const sources = sourceDocuments.map((document) => toDomainRecord<AnnouncementSourceRecord>(document));
    if (sources.length === 0) return [];
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 1000;
    return (await this.loadVisibleItemsForSources(sources, offset + limit))
      .sort(compareMongoAnnouncementItems)
      .slice(offset, offset + limit);
  }

  private async loadVisibleItemsForSources(
    sources: readonly AnnouncementSourceRecord[],
    legacyLimit: number
  ): Promise<AnnouncementItem[]> {
    const visibleItems: AnnouncementItem[] = [];
    const snapshotSources = sources.filter((source) => normalizedSnapshotId(source.activeSnapshotId));
    if (snapshotSources.length > 0) {
      const snapshotDocuments = await (await this.model("AnnouncementSnapshot", announcementSnapshotSchema)).find({
        _id: { $in: snapshotSources.map((source) => source.activeSnapshotId) }
      });
      const snapshots = new Map(snapshotDocuments.map((document) => {
        const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(document);
        return [snapshot.id, { document, snapshot }] as const;
      }));
      for (const source of snapshotSources) {
        const activeSnapshotId = normalizedSnapshotId(source.activeSnapshotId);
        if (!activeSnapshotId) continue;
        const entry = snapshots.get(activeSnapshotId);
        if (!entry || entry.snapshot.sourceId !== source.id) continue;
        visibleItems.push(...itemsFromSnapshot(entry.document, source.id, activeSnapshotId));
      }
    }

    const legacySourceIds = sources
      .filter((source) => !normalizedSnapshotId(source.activeSnapshotId))
      .map((source) => source.id);
    if (legacySourceIds.length > 0 && legacyLimit > 0) {
      const documents = await (await this.model("AnnouncementItem", announcementItemSchema))
        .find({ sourceId: { $in: legacySourceIds }, trustStatus: "trusted" })
        .sort({ discoveredAt: -1, sourceUpdatedAt: -1, publishedAt: -1 })
        .limit(legacyLimit);
      visibleItems.push(...documents.map((document) => toDomainRecord<AnnouncementItem>(document)));
    }
    return visibleItems.filter(isApiEligibleItem);
  }

  private supportsSnapshotPersistence(): boolean {
    return typeof this.mongo.getConnection === "function" && typeof this.mongo.connect === "function";
  }

  private async model(name: string, schema: Parameters<typeof getModel>[2]) {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, name, schema);
  }
}

interface AnnouncementSnapshotRecord {
  id: string;
  sourceId: string;
  items: AnnouncementItem[];
  snapshotHash: string;
}

const sourceValidatorFields = [
  "etag",
  "lastModified",
  "contentHash",
  "processingVersion",
  "lastContentChangedAt"
] as const;

const sourceValidatorUnset = Object.fromEntries(
  sourceValidatorFields.map((field) => [field, 1] as const)
);

function hasProcessingDefinitionChanged(
  existing: AnnouncementSourceRecord,
  next: {
    sourceUrl: AnnouncementSourceRecord["sourceUrl"];
    parser: AnnouncementSourceRecord["parser"];
    contentType: AnnouncementSourceRecord["contentType"] | undefined;
  }
): boolean {
  return existing.sourceUrl !== next.sourceUrl
    || existing.parser !== next.parser
    || (existing.contentType ?? "announcement") !== (next.contentType ?? "announcement");
}

function isReactivatedTrustedSource(
  existing: AnnouncementSourceRecord,
  next: Pick<UpsertAnnouncementSourceInput, "status" | "trustStatus">
): boolean {
  return (existing.status !== "active" || existing.trustStatus !== "trusted")
    && next.status === "active"
    && (next.trustStatus ?? existing.trustStatus) === "trusted";
}

function newSourceDefinitionVersion(): string {
  return new Types.ObjectId().toHexString();
}

function sameSourceDefinition(
  current: AnnouncementSourceDefinitionFence,
  expected: AnnouncementSourceDefinitionFence
): boolean {
  return current.sourceUrl === expected.sourceUrl
    && current.parser === expected.parser
    && (current.contentType ?? "announcement") === (expected.contentType ?? "announcement")
    && current.sourceDefinitionVersion === expected.sourceDefinitionVersion
    && current.notificationProducerVersion === expected.notificationProducerVersion;
}

function sourceDefinitionFenceFilter(expected: AnnouncementSourceDefinitionFence): Record<string, unknown> {
  return {
    sourceUrl: expected.sourceUrl,
    parser: expected.parser,
    ...(expected.sourceDefinitionVersion
      ? { sourceDefinitionVersion: expected.sourceDefinitionVersion }
      : { sourceDefinitionVersion: { $exists: false } }),
    ...(expected.notificationProducerVersion
      ? { notificationProducerVersion: expected.notificationProducerVersion }
      : { notificationProducerVersion: { $exists: false } })
  };
}

function normalizedSnapshotId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function snapshotPointerFenceFilter(expectedSnapshotId: string | null): Record<string, unknown> {
  const normalized = normalizedSnapshotId(expectedSnapshotId ?? undefined);
  return normalized
    ? { activeSnapshotId: normalized }
    : { $or: [{ activeSnapshotId: { $exists: false } }, { activeSnapshotId: null }] };
}

function itemsFromSnapshot(
  document: { id: string; toObject: (options?: { flattenMaps?: boolean }) => Record<string, unknown> },
  sourceId: string,
  snapshotId: string
): AnnouncementItem[] {
  const snapshot = toDomainRecord<AnnouncementSnapshotRecord>(document);
  if (snapshot.sourceId !== sourceId || !Array.isArray(snapshot.items)) return [];
  return snapshot.items.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as AnnouncementItem;
    if (item.sourceId !== sourceId || typeof item.id !== "string") return [];
    return [{ ...item, snapshotId }];
  });
}

function snapshotHashFor(items: readonly AnnouncementItem[]): string {
  const hashInput = items.map(({
    snapshotId: _snapshotId,
    notificationProducedFingerprint: _notificationProducedFingerprint,
    ...item
  }) => item);
  return createHash("sha256").update(JSON.stringify(hashInput), "utf8").digest("hex");
}

function snapshotDelta(
  plan: ReturnType<typeof planAnnouncementReplacement>,
  persistedItems: readonly AnnouncementItem[]
): AnnouncementPersistenceDelta {
  const delta = emptyAnnouncementPersistenceDelta();
  for (const [index, entry] of plan.entries.entries()) {
    const persisted = persistedItems[index];
    if (!persisted) throw new Error("ANNOUNCEMENT_SNAPSHOT_ITEM_MISSING");
    const reference = toPersistenceReference(persisted);
    if (!reference) continue;
    if (!entry.previous) delta.created.push(reference);
    else if (entry.materiallyUpdated) delta.materiallyUpdated.push(reference);
    else delta.unchanged.push(reference);
  }
  for (const removed of plan.removed) {
    const reference = toPersistenceReference(removed);
    if (reference) delta.removed.push(reference);
  }
  return delta;
}

async function bestEffortDeleteSnapshot(
  model: ReturnType<typeof getModel>,
  snapshotId: string
): Promise<void> {
  try {
    await model.deleteOne({ _id: snapshotId });
  } catch {
    // An unreferenced staged snapshot is never student-visible. Cleanup can be
    // retried operationally without compromising the active pointer.
  }
}

function acknowledgeLegacyReference(
  model: ReturnType<typeof getModel>,
  reference: AnnouncementPersistenceReference
) {
  return model.findOneAndUpdate({
    _id: reference.id,
    sourceId: reference.sourceId,
    scopeType: reference.scopeType,
    scopeId: reference.scopeId,
    contentFingerprint: reference.contentFingerprint,
    notificationEligibleFingerprint: reference.contentFingerprint
  }, {
    $set: { notificationProducedFingerprint: reference.contentFingerprint }
  });
}

function compareMongoAnnouncementItems(left: AnnouncementItem, right: AnnouncementItem): number {
  for (const field of ["discoveredAt", "sourceUpdatedAt", "publishedAt"] as const) {
    const leftTime = parseTimestamp(left[field]);
    const rightTime = parseTimestamp(right[field]);
    if (leftTime !== rightTime) return rightTime - leftTime;
  }
  return left.id.localeCompare(right.id, "en-US");
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isApiEligibleItem(item: AnnouncementItem): boolean {
  return item.trustStatus === "trusted";
}
