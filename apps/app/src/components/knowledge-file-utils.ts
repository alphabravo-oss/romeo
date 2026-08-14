export function knowledgeJobStatusKey(
  status: string,
):
  | "knowledgeStatusCompleted"
  | "knowledgeStatusFailed"
  | "knowledgeStatusPending"
  | "knowledgeStatusRunning" {
  if (status === "completed") return "knowledgeStatusCompleted";
  if (status === "failed") return "knowledgeStatusFailed";
  if (status === "running") return "knowledgeStatusRunning";
  return "knowledgeStatusPending";
}

export function mimeTypeFor(fileName: string, reportedType = ""): string {
  const ext = extensionOf(fileName);
  const fromName = EXT_TO_MIME[ext];
  if (fromName !== undefined) return fromName;
  const reported = reportedType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (reported.length > 0 && reported !== "application/octet-stream") {
    return reported;
  }
  return "text/plain";
}

export function canInlineUpload(mimeType: string): boolean {
  const normalized = normalizeMime(mimeType);
  return normalized.startsWith("text/") || INLINE_MIME.has(normalized);
}

export function isDeferredKnowledgeMime(mimeType: string): boolean {
  return DEFERRED_MIME.has(normalizeMime(mimeType));
}

export function isSupportedKnowledgeMime(mimeType: string): boolean {
  return canInlineUpload(mimeType) || isDeferredKnowledgeMime(mimeType);
}

export const KNOWLEDGE_FILE_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".ndjson",
  ".csv",
  ".html",
  ".htm",
  ".xml",
  ".yaml",
  ".yml",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  "text/*",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/json",
  "application/pdf",
  "application/xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

const INLINE_LIMIT_BYTES = 200_000;

export function shouldInlineKnowledgeFile(
  file: File,
  mimeType: string,
): boolean {
  return canInlineUpload(mimeType) && file.size <= INLINE_LIMIT_BYTES;
}

const INLINE_MIME = new Set([
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
]);

const DEFERRED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const EXT_TO_MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".ndjson": "application/x-ndjson",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
}

function normalizeMime(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
