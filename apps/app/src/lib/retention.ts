export type RetentionValidationCode =
  | "days_invalid"
  | "override_invalid_id"
  | "override_duplicate"
  | "override_days_invalid"
  | "override_limit";

export class RetentionValidationError extends Error {
  constructor(
    readonly code: RetentionValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "RetentionValidationError";
  }
}

export function formatRetentionOverrides(
  overrides: Record<string, number | null>,
): string {
  return Object.entries(overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, days]) => `${id}=${days === null ? "forever" : days}`)
    .join("\n");
}

export function parseOptionalRetentionDays(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const days = Number(trimmed);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new RetentionValidationError(
      "days_invalid",
      "File retention days must be blank or between 1 and 3650.",
    );
  return days;
}

export function parseRetentionOverrides(
  value: string,
): Record<string, number | null> {
  const overrides: Record<string, number | null> = {};
  for (const [index, rawLine] of value.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === "") continue;
    const separator = line.indexOf("=");
    const id = separator < 0 ? "" : line.slice(0, separator).trim();
    const rawDays = separator < 0 ? "" : line.slice(separator + 1).trim();
    if (id === "" || id.length > 200)
      throw new RetentionValidationError(
        "override_invalid_id",
        `Retention override line ${index + 1} needs a valid ID.`,
      );
    if (Object.prototype.hasOwnProperty.call(overrides, id))
      throw new RetentionValidationError(
        "override_duplicate",
        `Retention override ${id} is duplicated.`,
      );
    if (rawDays.toLowerCase() === "forever") {
      overrides[id] = null;
      continue;
    }
    const days = Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new RetentionValidationError(
        "override_days_invalid",
        `Retention override ${id} must be 1-3650 or forever.`,
      );
    overrides[id] = days;
  }
  if (Object.keys(overrides).length > 500)
    throw new RetentionValidationError(
      "override_limit",
      "At most 500 retention overrides are allowed.",
    );
  return overrides;
}
