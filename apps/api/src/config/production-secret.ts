const obviousPlaceholderPattern = /(?:change[-_ ]?(?:me|this)|replace[-_ ]?with|(?:development|example|placeholder)[-_ ].*secret)/iu;

export function isProductionSecret(value: string | undefined): value is string {
  if (!value || value.replace(/\s/gu, "").length < 32) return false;
  return !obviousPlaceholderPattern.test(value);
}
