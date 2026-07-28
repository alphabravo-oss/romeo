import type { Message } from "../domain/entities";

export function paginate<T>(
  items: T[],
  page: number | null | undefined,
  limit: number,
): T[] {
  if (page === undefined || page === null) return items;
  const boundedPage = Number.isInteger(page) && page > 0 ? page : 1;
  return items.slice((boundedPage - 1) * limit, boundedPage * limit);
}

export function toEpochSeconds(iso: string): number {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
}

export function timestampToIso(value: unknown): string {
  const seconds = numericTimestamp(value);
  if (seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

export function numericTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function messageRole(value: unknown): Message["role"] | undefined {
  if (
    value === "assistant" ||
    value === "system" ||
    value === "tool" ||
    value === "user"
  ) {
    return value;
  }
  return undefined;
}

export function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const record = asRecord(item);
        if (record === undefined) return "";
        if (record.type === "text") return trimmedString(record.text) ?? "";
        return "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return "";
}

export function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : [];
}
