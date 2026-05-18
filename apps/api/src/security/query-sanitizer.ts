const forbiddenMongoKeys = new Set(["$where", "$expr", "$function", "$accumulator"]);

export function sanitizeQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeQueryValue(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((safe, [key, nestedValue]) => {
      if (key.startsWith("$") || key.includes(".")) {
        if (forbiddenMongoKeys.has(key)) return safe;
        return safe;
      }
      const sanitizedNestedValue = sanitizeQueryValue(nestedValue);
      if (
        sanitizedNestedValue &&
        typeof sanitizedNestedValue === "object" &&
        !Array.isArray(sanitizedNestedValue) &&
        Object.keys(sanitizedNestedValue).length === 0
      ) {
        return safe;
      }
      safe[key] = sanitizedNestedValue;
      return safe;
    }, {});
  }

  return value;
}
