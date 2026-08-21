import "reflect-metadata";
import { validate, type ValidationError } from "class-validator";
import { describe, expect, it } from "vitest";
import { AUTH_AFFILIATION_ID_MAX_LENGTH, AUTH_EMAIL_MAX_LENGTH, AUTH_FULL_NAME_MAX_LENGTH, AUTH_PASSWORD_MAX_LENGTH } from "../src/modules/auth/auth.constants.js";
import {
  CreateStudentAlarmDto,
  NOTIFICATION_CATEGORY_COUNT_MAX,
  NOTIFICATION_REMINDER_OFFSET_COUNT_MAX,
  NOTIFICATION_REMINDER_RULE_COUNT_MAX,
  NOTIFICATION_SCOPE_ID_MAX_LENGTH,
  NOTIFICATION_SOURCE_URL_MAX_LENGTH,
  NOTIFICATION_TARGET_ID_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  UpdateNotificationPreferencesDto
} from "../src/modules/notifications/notifications.dto.js";
import { AccountDeletionConfirmDto, AccountDeletionRequestCodeDto } from "../src/modules/public/account-deletion.dto.js";
import { AdminUpdateUserDto, FollowAcademicScopeDto, ListUsersQueryDto, SuggestAcademicUnitDto, UpdateMeDto, UpdateMyUniversityDto } from "../src/modules/users/users.dto.js";

type DtoConstructor = new () => object;

async function errorsFor(constructor: DtoConstructor, input: object): Promise<ValidationError[]> {
  return validate(Object.assign(new constructor(), input));
}

function expectConstraint(errors: ValidationError[], property: string, constraint: string): void {
  const error = errors.find((candidate) => candidate.property === property);
  expect(error?.constraints, `${property} should fail ${constraint}`).toHaveProperty(constraint);
}

const validPreferences = {
  enabled: true,
  categories: { exam: true },
  reminderOffsets: [1],
  reminderRules: []
};

describe("non-auth API input bounds", () => {
  it.each([
    ["nested category value", { exam: { enabled: true } }],
    ["blocked category key", JSON.parse('{"__proto__":true}')],
    ["too many categories", Object.fromEntries(Array.from({ length: NOTIFICATION_CATEGORY_COUNT_MAX + 1 }, (_, index) => [`category-${index}`, true]))]
  ])("rejects %s", async (_name, categories) => {
    const errors = await errorsFor(UpdateNotificationPreferencesDto, { ...validPreferences, categories });
    expectConstraint(errors, "categories", "isNotificationCategoryMap");
  });

  it("bounds and deduplicates reminder collections", async () => {
    const tooManyOffsets = await errorsFor(UpdateNotificationPreferencesDto, {
      ...validPreferences,
      reminderOffsets: Array.from({ length: NOTIFICATION_REMINDER_OFFSET_COUNT_MAX + 1 }, (_, index) => index)
    });
    const duplicateOffsets = await errorsFor(UpdateNotificationPreferencesDto, { ...validPreferences, reminderOffsets: [1, 1] });
    const tooManyRules = await errorsFor(UpdateNotificationPreferencesDto, {
      ...validPreferences,
      reminderRules: Array.from({ length: NOTIFICATION_REMINDER_RULE_COUNT_MAX + 1 }, () => ({
        trigger: "before",
        amount: 1,
        unit: "days",
        enabled: true
      }))
    });

    expectConstraint(tooManyOffsets, "reminderOffsets", "arrayMaxSize");
    expectConstraint(duplicateOffsets, "reminderOffsets", "arrayUnique");
    expectConstraint(tooManyRules, "reminderRules", "arrayMaxSize");
  });

  it.each([
    ["targetId", "x".repeat(NOTIFICATION_TARGET_ID_MAX_LENGTH + 1)],
    ["title", "x".repeat(NOTIFICATION_TITLE_MAX_LENGTH + 1)],
    ["universityId", "x".repeat(NOTIFICATION_SCOPE_ID_MAX_LENGTH + 1)],
    ["facultyId", "x".repeat(NOTIFICATION_SCOPE_ID_MAX_LENGTH + 1)],
    ["departmentId", "x".repeat(NOTIFICATION_SCOPE_ID_MAX_LENGTH + 1)],
    ["sourceUrl", `https://example.test/${"x".repeat(NOTIFICATION_SOURCE_URL_MAX_LENGTH)}`]
  ] as const)("rejects an overlong alarm %s", async (property, value) => {
    const errors = await errorsFor(CreateStudentAlarmDto, {
      eventType: "calendar_event",
      targetId: "event-1",
      scheduledFor: "2026-08-27T09:00:00+03:00",
      trigger: "at_time",
      amount: 0,
      unit: "days",
      [property]: value
    });
    expectConstraint(errors, property, "maxLength");
  });

  it.each([
    [AccountDeletionRequestCodeDto, { email: "x".repeat(AUTH_EMAIL_MAX_LENGTH + 1), password: "password" }, "email"],
    [AccountDeletionRequestCodeDto, { email: "student@example.test", password: "x".repeat(AUTH_PASSWORD_MAX_LENGTH + 1) }, "password"],
    [AccountDeletionConfirmDto, { email: "student@example.test", password: "x".repeat(AUTH_PASSWORD_MAX_LENGTH + 1), code: "123456", deletionType: "data" }, "password"]
  ] as const)("bounds public account deletion credentials", async (constructor, input, property) => {
    expectConstraint(await errorsFor(constructor, input), property, "maxLength");
  });

  it.each([
    [UpdateMeDto, { fullName: "x".repeat(AUTH_FULL_NAME_MAX_LENGTH + 1) }, "fullName"],
    [UpdateMyUniversityDto, { universityId: "x".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH + 1) }, "universityId"],
    [SuggestAcademicUnitDto, { universityId: "university", facultyName: "x".repeat(161) }, "facultyName"],
    [FollowAcademicScopeDto, { universityId: "x".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH + 1) }, "universityId"],
    [ListUsersQueryDto, { search: "x".repeat(161) }, "search"],
    [AdminUpdateUserDto, { departmentId: "x".repeat(AUTH_AFFILIATION_ID_MAX_LENGTH + 1) }, "departmentId"]
  ] as const)("bounds user/profile fields", async (constructor, input, property) => {
    expectConstraint(await errorsFor(constructor, input), property, "maxLength");
  });
});
