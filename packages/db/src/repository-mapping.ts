export function optionalDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

export function optionalIsoString(
  value: Date | string | null,
): string | undefined {
  if (value === null) return undefined;
  return toIsoString(value);
}

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
