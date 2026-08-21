export interface NotificationReminderRule {
  trigger: "before" | "at_time" | "approaching";
  amount: number;
  unit: "days" | "hours";
  enabled: boolean;
}

export function notificationReminderRulesForMutation(
  rules: readonly NotificationReminderRule[] | null | undefined,
  fallback: readonly NotificationReminderRule[]
): NotificationReminderRule[] {
  const source = rules?.length ? rules : fallback;
  return source.map((rule) => ({
    trigger: rule.trigger,
    amount: rule.amount,
    unit: rule.unit,
    enabled: rule.enabled
  }));
}
