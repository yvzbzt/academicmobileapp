import { describe, expect, it } from "vitest";
import { toDomainRecord } from "../src/database/mongoose-utils.js";

describe("mongoose domain conversion", () => {
  it("flattens Mongoose maps before exposing a domain record", () => {
    const categories = new Map([
      ["announcement", false],
      ["final_exam", true],
    ]);
    const document = {
      id: "preference-1",
      toObject(options?: { flattenMaps?: boolean }) {
        return {
          _id: "mongo-id",
          __v: 0,
          categories: options?.flattenMaps ? Object.fromEntries(categories) : categories,
        };
      },
    };

    expect(toDomainRecord(document)).toEqual({
      id: "preference-1",
      categories: { announcement: false, final_exam: true },
    });
  });
});
