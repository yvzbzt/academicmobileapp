import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AcademicUnitScheduleReviewResult,
  AcademicUnitScheduleRevokedPublication,
  AcademicUnitScheduleSourceFilters,
  AcademicUnitScheduleSourceRecord,
  AcademicUnitScheduleSourceRepository,
  NewAcademicUnitScheduleSource
} from "./academic-unit-schedule.types.js";

@Injectable()
export class InMemoryAcademicUnitScheduleRepository implements AcademicUnitScheduleSourceRepository {
  private readonly records = new Map<string, AcademicUnitScheduleSourceRecord>();

  async provisionSource(input: NewAcademicUnitScheduleSource): Promise<{
    record: AcademicUnitScheduleSourceRecord;
    disposition: "created" | "existing" | "refreshed";
  }> {
    const existing = [...this.records.values()].find((record) => record.key === input.key);
    if (!existing) {
      const now = new Date();
      const created: AcademicUnitScheduleSourceRecord = {
        ...clone(input),
        id: randomUUID(),
        lifecycle: "ready",
        revision: 0,
        createdAt: now,
        updatedAt: now
      };
      this.records.set(created.id, created);
      return { record: clone(created), disposition: "created" };
    }
    const sameDefinition = existing.definitionHash === input.definitionHash;
    if (sameDefinition && existing.lifecycle !== "disabled") {
      return { record: clone(existing), disposition: "existing" };
    }
    if (existing.lifecycle === "processing" && existing.processingLeaseUntil && existing.processingLeaseUntil > new Date()) {
      throw new Error("SCHEDULE_SOURCE_BUSY");
    }
    const { processingLeaseUntil: _lease, ...withoutLease } = existing;
    void _lease;
    const { reviewDecision: _decision, ...withoutDecision } = withoutLease;
    void _decision;
    const { reviewResult: _result, ...withoutReviewResult } = withoutDecision;
    void _result;
    const retained = sameDefinition ? withoutDecision : withoutReviewResult;
    const refreshed: AcademicUnitScheduleSourceRecord = {
      ...retained,
      ...clone(input),
      lifecycle: sameDefinition && existing.reviewResult ? "review_required" : "ready",
      revision: existing.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(existing.id, refreshed);
    return { record: clone(refreshed), disposition: "refreshed" };
  }

  async disableSourcesExcept(validDefinitions: ReadonlyArray<{ key: string; definitionHash: string }>): Promise<{
    disabled: number;
    revokedPublications: AcademicUnitScheduleRevokedPublication[];
  }> {
    const valid = new Set(validDefinitions.map((definition) => `${definition.key}\0${definition.definitionHash}`));
    let disabled = 0;
    for (const [id, record] of this.records) {
      if (valid.has(`${record.key}\0${record.definitionHash}`) || record.lifecycle === "disabled") continue;
      const { processingLeaseUntil: _lease, ...retained } = record;
      void _lease;
      this.records.set(id, {
        ...retained,
        lifecycle: "disabled",
        revision: record.revision + 1,
        updatedAt: new Date()
      });
      disabled += 1;
    }
    const revokedPublications = [...this.records.values()].flatMap((record) => (
      record.lifecycle === "disabled" && record.reviewDecision?.reviewKey
        ? [{ sourceId: record.id, universityId: record.universityId, reviewKey: record.reviewDecision.reviewKey }]
        : []
    ));
    return { disabled, revokedPublications };
  }

  async findSourceById(id: string): Promise<AcademicUnitScheduleSourceRecord | null> {
    const record = this.records.get(id);
    return record ? clone(record) : null;
  }

  async listSources(filters: AcademicUnitScheduleSourceFilters): Promise<AcademicUnitScheduleSourceRecord[]> {
    return [...this.records.values()]
      .filter((record) => !filters.universityId || record.universityId === filters.universityId)
      .filter((record) => !filters.facultyId || record.facultyId === filters.facultyId)
      .filter((record) => !filters.departmentId || record.departmentId === filters.departmentId)
      .filter((record) => !filters.scheduleType || record.scheduleType === filters.scheduleType)
      .filter((record) => !filters.lifecycle || record.lifecycle === filters.lifecycle)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id, "en-US"))
      .slice(filters.offset, filters.offset + filters.limit)
      .map(clone);
  }

  async claimSource(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (!current || current.revision !== input.expectedRevision || current.definitionHash !== input.definitionHash) return null;
    const reclaimableProcessing = current.lifecycle === "processing"
      && (!current.processingLeaseUntil || current.processingLeaseUntil <= input.now);
    if (!["ready", "review_required", "quarantined", "rejected"].includes(current.lifecycle) && !reclaimableProcessing) return null;
    const { reviewDecision: _decision, ...withoutDecision } = current;
    void _decision;
    const claimed: AcademicUnitScheduleSourceRecord = {
      ...withoutDecision,
      lifecycle: "processing",
      revision: current.revision + 1,
      processingLeaseUntil: input.leaseUntil,
      updatedAt: input.now
    };
    this.records.set(current.id, claimed);
    return clone(claimed);
  }

  async completeSource(input: {
    id: string;
    claimRevision: number;
    definitionHash: string;
    result: AcademicUnitScheduleReviewResult;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (
      !current
      || current.lifecycle !== "processing"
      || current.revision !== input.claimRevision
      || current.definitionHash !== input.definitionHash
    ) return null;
    const { processingLeaseUntil: _lease, ...retained } = current;
    void _lease;
    const completed: AcademicUnitScheduleSourceRecord = {
      ...retained,
      lifecycle: input.result.outcome === "definition_drift_review" ? "quarantined" : "review_required",
      revision: current.revision + 1,
      reviewResult: clone(input.result),
      updatedAt: new Date()
    };
    this.records.set(current.id, completed);
    return clone(completed);
  }

  async updateCandidate(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    rowNumber: number;
    candidate: AcademicUnitScheduleReviewResult["candidates"][number];
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (!current || current.lifecycle !== "review_required" || current.revision !== input.expectedRevision
      || current.definitionHash !== input.definitionHash || !current.reviewResult) return null;
    const index = current.reviewResult.candidates.findIndex((candidate) => candidate.rowNumber === input.rowNumber);
    if (index < 0) return null;
    const candidates = current.reviewResult.candidates.map((candidate, candidateIndex) => (
      candidateIndex === index ? clone(input.candidate) : candidate
    ));
    const updated: AcademicUnitScheduleSourceRecord = {
      ...current,
      reviewResult: { ...current.reviewResult, candidates, candidateCount: candidates.length },
      revision: current.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(current.id, updated);
    return clone(updated);
  }

  async beginReviewDecision(input: {
    id: string;
    expectedRevision: number;
    definitionHash: string;
    decision: NonNullable<AcademicUnitScheduleSourceRecord["reviewDecision"]>;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (!current || current.lifecycle !== "review_required" || current.revision !== input.expectedRevision
      || current.definitionHash !== input.definitionHash) return null;
    const updated: AcademicUnitScheduleSourceRecord = {
      ...current,
      lifecycle: input.decision.decision === "rejected" ? "rejected" : "materializing",
      reviewDecision: clone(input.decision),
      revision: current.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(current.id, updated);
    return clone(updated);
  }

  async completeMaterialization(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    calendarId: string;
    eventIds: string[];
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (current?.lifecycle !== "materializing" || current.revision !== input.expectedRevision
      || current.reviewDecision?.reviewKey !== input.reviewKey
      || current.reviewDecision.materializationStatus !== "materializing") return null;
    const updated: AcademicUnitScheduleSourceRecord = {
      ...current,
      lifecycle: "staged",
      reviewDecision: {
        ...current.reviewDecision,
        materializationStatus: "staged",
        calendarId: input.calendarId,
        eventIds: [...input.eventIds]
      },
      revision: current.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(current.id, updated);
    return clone(updated);
  }

  async claimReviewReopen(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (!current || current.revision !== input.expectedRevision
      || !["materializing", "staged"].includes(current.lifecycle)
      || current.reviewDecision?.reviewKey !== input.reviewKey
      || !["materializing", "staged"].includes(current.reviewDecision.materializationStatus ?? "")) return null;
    const claimed: AcademicUnitScheduleSourceRecord = {
      ...current,
      lifecycle: "materializing",
      reviewDecision: { ...current.reviewDecision, materializationStatus: "reopening" },
      revision: current.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(current.id, claimed);
    return clone(claimed);
  }

  async completeReviewReopen(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (!current || current.lifecycle !== "materializing" || current.revision !== input.expectedRevision
      || current.reviewDecision?.reviewKey !== input.reviewKey
      || current.reviewDecision.materializationStatus !== "reopening") return null;
    const { reviewDecision: _decision, ...withoutDecision } = current;
    void _decision;
    const reopened: AcademicUnitScheduleSourceRecord = {
      ...withoutDecision,
      lifecycle: "review_required",
      revision: current.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(current.id, reopened);
    return clone(reopened);
  }

  async claimPublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    const resumable = current?.lifecycle === "published"
      && current.reviewDecision?.materializationStatus === "publishing"
      && (!current.reviewDecision.publicationLeaseUntil || current.reviewDecision.publicationLeaseUntil <= input.now);
    if (!current || current.revision !== input.expectedRevision || current.reviewDecision?.reviewKey !== input.reviewKey
      || (current.lifecycle !== "staged" && !resumable)) return null;
    const claimed: AcademicUnitScheduleSourceRecord = {
      ...current,
      lifecycle: "published",
      reviewDecision: {
        ...current.reviewDecision,
        materializationStatus: "publishing",
        publicationLeaseUntil: input.leaseUntil
      },
      revision: current.revision + 1,
      updatedAt: input.now
    };
    this.records.set(current.id, claimed);
    return clone(claimed);
  }

  async completePublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
    publishedBy: string;
    publishedAt: Date;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (current?.lifecycle !== "published" || current.revision !== input.expectedRevision
      || current.reviewDecision?.reviewKey !== input.reviewKey
      || current.reviewDecision.materializationStatus !== "publishing") return null;
    const { publicationLeaseUntil: _lease, ...decision } = current.reviewDecision;
    void _lease;
    const updated: AcademicUnitScheduleSourceRecord = {
      ...current,
      lifecycle: "published",
      reviewDecision: {
        ...decision,
        materializationStatus: "published",
        publishedBy: input.publishedBy,
        publishedAt: input.publishedAt
      },
      revision: current.revision + 1,
      updatedAt: input.publishedAt
    };
    this.records.set(current.id, updated);
    return clone(updated);
  }

  async releasePublication(input: {
    id: string;
    expectedRevision: number;
    reviewKey: string;
  }): Promise<AcademicUnitScheduleSourceRecord | null> {
    const current = this.records.get(input.id);
    if (current?.lifecycle !== "published" || current.revision !== input.expectedRevision
      || current.reviewDecision?.reviewKey !== input.reviewKey
      || current.reviewDecision.materializationStatus !== "publishing") return null;
    const { publicationLeaseUntil: _lease, ...decision } = current.reviewDecision;
    void _lease;
    const released: AcademicUnitScheduleSourceRecord = {
      ...current,
      lifecycle: "staged",
      reviewDecision: { ...decision, materializationStatus: "staged" },
      revision: current.revision + 1,
      updatedAt: new Date()
    };
    this.records.set(current.id, released);
    return clone(released);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
