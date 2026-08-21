import { notificationReminderRulesForMutation } from "../../src/notifications/notification-preferences";

describe("notification preference mutations", () => {
  it("strips persistence metadata from server-provided reminder rules", () => {
    const rules = [{
      trigger: "before" as const,
      amount: 1,
      unit: "days" as const,
      enabled: true,
      _id: "mongo-subdocument-id"
    }];

    expect(notificationReminderRulesForMutation(rules, [])).toEqual([
      { trigger: "before", amount: 1, unit: "days", enabled: true }
    ]);
  });

  it("returns a sanitized copy of fallback rules", () => {
    const fallback = [{
      trigger: "at_time" as const,
      amount: 0,
      unit: "days" as const,
      enabled: true
    }];

    const normalized = notificationReminderRulesForMutation(undefined, fallback);

    expect(normalized).toEqual(fallback);
    expect(normalized).not.toBe(fallback);
    expect(normalized[0]).not.toBe(fallback[0]);
  });
});
