import { createHash } from "node:crypto";

export interface LocalImportCursorEntry {
  fileName: string;
  contentHash: string;
  sourceId: string;
}

export function localImportCursor(
  config: Record<string, unknown>,
): LocalImportCursorEntry[] {
  const cursor = config.lastCursor;
  if (!Array.isArray(cursor)) return [];
  return cursor.filter(isLocalImportCursorEntry);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isLocalImportCursorEntry(
  value: unknown,
): value is LocalImportCursorEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LocalImportCursorEntry>;
  return (
    typeof candidate.fileName === "string" &&
    typeof candidate.contentHash === "string" &&
    typeof candidate.sourceId === "string"
  );
}
