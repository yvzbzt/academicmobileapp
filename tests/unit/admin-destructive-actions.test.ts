import { describe, expect, it, vi } from "vitest";
import {
  adminDestructiveActionPrompts,
  confirmAdminDestructiveAction,
  type AdminDestructiveAction
} from "../../apps/admin/src/destructive-actions.js";

const destructiveActions = Object.keys(adminDestructiveActionPrompts) as AdminDestructiveAction[];

describe("admin destructive-action confirmations", () => {
  it("keeps every persistent destructive action in the confirmation inventory", () => {
    expect(destructiveActions).toEqual([
      "archiveUniversity",
      "deactivateAnnouncementSource",
      "removeCourseScheduleSeries",
      "rejectAcademicUnitSuggestion",
      "rejectExtractedEvent",
      "rollbackPublishedCalendar",
      "deleteUser"
    ]);

    for (const prompt of Object.values(adminDestructiveActionPrompts)) {
      expect(prompt).toContain("istiyor musunuz?");
      expect(prompt).toMatch(/[.?]$/u);
    }
  });

  it.each(destructiveActions)("runs one confirmation and preserves cancellation for %s", (action) => {
    const confirmAction = vi.fn(() => false);

    expect(confirmAdminDestructiveAction(action, confirmAction)).toBe(false);
    expect(confirmAction).toHaveBeenCalledOnce();
    expect(confirmAction).toHaveBeenCalledWith(adminDestructiveActionPrompts[action]);
  });

  it.each(destructiveActions)("runs one confirmation and preserves approval for %s", (action) => {
    const confirmAction = vi.fn(() => true);

    expect(confirmAdminDestructiveAction(action, confirmAction)).toBe(true);
    expect(confirmAction).toHaveBeenCalledOnce();
    expect(confirmAction).toHaveBeenCalledWith(adminDestructiveActionPrompts[action]);
  });
});
