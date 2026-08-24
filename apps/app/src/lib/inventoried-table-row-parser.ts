type ValueKind = "array" | "boolean" | "number" | "object" | "string";

export function rowShape<Row extends { id: string }>(
  required: Partial<Record<keyof Row & string, ValueKind>>,
): (value: unknown) => Row {
  return (value) => {
    if (!isRecord(value)) throw new Error("row must be an object");
    requireKind(value, "id", "string");
    for (const [field, kind] of Object.entries(required)) {
      if (kind !== undefined) requireKind(value, field, kind);
    }
    return value as Row;
  };
}

function requireKind(
  value: Record<string, unknown>,
  field: string,
  kind: ValueKind,
): void {
  const fieldValue = value[field];
  const valid =
    kind === "array"
      ? Array.isArray(fieldValue)
      : kind === "object"
        ? isRecord(fieldValue)
        : typeof fieldValue === kind;
  if (!valid) throw new Error(`${field} must be ${kind}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
