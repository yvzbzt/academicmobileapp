import { describe, expect, it, vi } from "vitest";
import { InMemoryAuthRepository } from "../src/modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "../src/modules/auth/mongo-auth.repository.js";

const expiresAt = new Date("2099-01-01T00:00:00.000Z");

describe("refresh-token rotation repository contract", () => {
  it("atomically consumes an in-memory token only once", async () => {
    const repository = new InMemoryAuthRepository();
    const token = await repository.createRefreshToken({
      userId: "user-1",
      credentialGeneration: 0,
      tokenHash: "refresh-hash",
      familyId: "family-1",
      deviceId: "device-1",
      expiresAt
    });
    const consumedAt = new Date("2026-08-20T12:00:00.000Z");

    const outcomes = await Promise.all([
      repository.consumeRefreshTokenForRotation(token.id, consumedAt),
      repository.consumeRefreshTokenForRotation(token.id, consumedAt)
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    await expect(repository.findRefreshTokenByHash(token.tokenHash)).resolves.toEqual(
      expect.objectContaining({ revokedAt: consumedAt })
    );
  });

  it("uses a Mongo compare-and-set update so only one caller wins", async () => {
    let active = true;
    const updateOne = vi.fn(async () => {
      if (!active) return { modifiedCount: 0 };
      active = false;
      return { modifiedCount: 1 };
    });
    const repository = new MongoAuthRepository({
      getConnection: () => ({ models: { RefreshToken: { updateOne } } })
    } as never);
    const consumedAt = new Date("2026-08-20T12:00:00.000Z");

    const outcomes = await Promise.all([
      repository.consumeRefreshTokenForRotation("refresh-1", consumedAt),
      repository.consumeRefreshTokenForRotation("refresh-1", consumedAt)
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: "refresh-1", revokedAt: { $exists: false } },
      { $set: { revokedAt: consumedAt } }
    );
  });
});
