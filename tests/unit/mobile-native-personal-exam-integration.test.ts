import { describe, expect, it } from "vitest";
import {
  AccountGenerationGuard,
  type AccountGenerationSnapshot,
} from "../../apps/mobile-native/src/auth/session-integrity";
import {
  PersonalExamRuntime,
  StalePersonalExamOperationError,
} from "../../apps/mobile-native/src/calendar/personal-exam-runtime";
import {
  createManualExamStorageKey,
  readManualExamEnvelope,
} from "../../apps/mobile-native/src/session-integrity/manual-exam-storage";
import { DeterministicSecureStoreAdapter } from "../../apps/mobile-native/tests/calendar/personal-exam-test-adapter";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";
const OWNER_A_KEY = createManualExamStorageKey(OWNER_A);
const OWNER_B_KEY = createManualExamStorageKey(OWNER_B);

describe("Phase 9 production personal-exam integration", () => {
  it("executes owner A CRUD/relaunch, A/B/A restore, and late-A rejection through the App runtime", async () => {
    const storage = new DeterministicSecureStoreAdapter();
    let nextId = 0;
    const createRuntime = (guard: AccountGenerationGuard) => new PersonalExamRuntime({
      storage,
      ownerGuard: guard,
      createId: () => `personal-${++nextId}`,
      now: () => "2026-08-05T09:00:00.000Z",
    });
    let guard = new AccountGenerationGuard();
    let runtime = createRuntime(guard);
    let snapshot: AccountGenerationSnapshot = guard.activate(OWNER_A);
    await runtime.hydrate(OWNER_A, snapshot);

    // 1. User A creates through the production mutation.
    expect(runtime.create({
      title: "  Lineer   Cebir finali  ",
      examDate: "2028-02-29T06:30:00.000Z",
    }, snapshot)).toEqual({ ok: true });
    expect(runtime.getSnapshot().exams).toEqual([{
      id: "personal-1",
      title: "Lineer Cebir finali",
      examDate: "2028-02-29T06:30:00.000Z",
    }]);

    // 2. The real owner envelope is persisted to the SecureStore-compatible key.
    await runtime.waitForIdle();
    expect(readManualExamEnvelope(storage.read(OWNER_A_KEY), OWNER_A)).toMatchObject({
      status: "loaded",
      exams: runtime.getSnapshot().exams,
      updatedAt: "2026-08-05T09:00:00.000Z",
    });

    // 3. A fresh runtime (relaunch) hydrates User A's exact record.
    guard = new AccountGenerationGuard();
    runtime = createRuntime(guard);
    snapshot = guard.activate(OWNER_A);
    await runtime.hydrate(OWNER_A, snapshot);
    expect(runtime.getSnapshot().exams[0]).toMatchObject({
      id: "personal-1",
      title: "Lineer Cebir finali",
    });

    // 4. User A edits through the production update mutation and persists it.
    expect(runtime.update("personal-1", {
      title: "Lineer Cebir bütünleme",
      examDate: "2028-03-01T08:45:00.000Z",
    }, snapshot)).toEqual({ ok: true });
    await runtime.waitForIdle();
    expect(readManualExamEnvelope(storage.read(OWNER_A_KEY), OWNER_A).exams[0]).toMatchObject({
      id: "personal-1",
      title: "Lineer Cebir bütünleme",
      examDate: "2028-03-01T08:45:00.000Z",
    });

    // 5. A second relaunch restores the edited record.
    guard = new AccountGenerationGuard();
    runtime = createRuntime(guard);
    snapshot = guard.activate(OWNER_A);
    await runtime.hydrate(OWNER_A, snapshot);
    expect(runtime.getSnapshot().exams.map((exam) => exam.title)).toEqual([
      "Lineer Cebir bütünleme",
    ]);

    // 6. User A deletes through the production delete mutation and persists empty state.
    expect(runtime.delete("personal-1", snapshot)).toEqual({ ok: true });
    await runtime.waitForIdle();
    expect(readManualExamEnvelope(storage.read(OWNER_A_KEY), OWNER_A).exams).toEqual([]);

    // 7. A third relaunch hydrates the persisted deletion.
    guard = new AccountGenerationGuard();
    runtime = createRuntime(guard);
    snapshot = guard.activate(OWNER_A);
    await runtime.hydrate(OWNER_A, snapshot);
    expect(runtime.getSnapshot()).toEqual({ ownerId: OWNER_A, hydrated: true, exams: [] });

    // 8. Switching to User B exposes no User A data.
    const ownerBSnapshot = guard.activate(OWNER_B);
    await runtime.hydrate(OWNER_B, ownerBSnapshot);
    expect(runtime.getSnapshot()).toEqual({ ownerId: OWNER_B, hydrated: true, exams: [] });
    expect(storage.read(OWNER_B_KEY)).toBeNull();

    // 9. User B creates and persists an independent record.
    expect(runtime.create({
      title: "Fizik finali",
      examDate: "2028-03-02T07:00:00.000Z",
    }, ownerBSnapshot)).toEqual({ ok: true });
    await runtime.waitForIdle();
    expect(readManualExamEnvelope(storage.read(OWNER_B_KEY), OWNER_B).exams).toEqual([{
      id: "personal-2",
      title: "Fizik finali",
      examDate: "2028-03-02T07:00:00.000Z",
    }]);
    expect(readManualExamEnvelope(storage.read(OWNER_A_KEY), OWNER_A).exams).toEqual([]);

    // 10. Returning to User A restores A's empty state, never B's exam.
    const returnedOwnerASnapshot = guard.activate(OWNER_A);
    await runtime.hydrate(OWNER_A, returnedOwnerASnapshot);
    expect(runtime.getSnapshot()).toEqual({ ownerId: OWNER_A, hydrated: true, exams: [] });

    // 11. A delayed User A restore is rejected after B activates and cannot alter B state/storage.
    const releaseLateARead = storage.deferNextRead(OWNER_A_KEY);
    const lateOwnerARestore = runtime.hydrate(OWNER_A, returnedOwnerASnapshot);
    const finalOwnerBSnapshot = guard.activate(OWNER_B);
    await runtime.hydrate(OWNER_B, finalOwnerBSnapshot);
    const ownerBEnvelopeBeforeLateSettlement = storage.read(OWNER_B_KEY);
    releaseLateARead();
    await expect(lateOwnerARestore).rejects.toBeInstanceOf(StalePersonalExamOperationError);
    expect(runtime.getSnapshot()).toMatchObject({
      ownerId: OWNER_B,
      hydrated: true,
      exams: [{ id: "personal-2", title: "Fizik finali" }],
    });
    expect(storage.read(OWNER_B_KEY)).toBe(ownerBEnvelopeBeforeLateSettlement);
    expect(runtime.create({
      title: "Gecikmiş A sınavı",
      examDate: "2028-03-03T08:00:00.000Z",
    }, returnedOwnerASnapshot)).toEqual({
      ok: false,
      error: "Hesaba ait sınav alanı henüz hazır değil.",
    });
    await runtime.waitForIdle();
    expect(storage.read(OWNER_B_KEY)).toBe(ownerBEnvelopeBeforeLateSettlement);
  });
});
