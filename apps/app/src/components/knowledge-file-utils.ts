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
  if (reportedType.length > 0) return reportedType;
  if (fileName.endsWith(".md") || fileName.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (fileName.endsWith(".json")) return "application/json";
  if (fileName.endsWith(".jsonl") || fileName.endsWith(".ndjson")) {
    return "application/x-ndjson";
  }
  if (fileName.endsWith(".csv")) return "text/csv";
  if (fileName.endsWith(".html") || fileName.endsWith(".htm")) {
    return "text/html";
  }
  if (fileName.endsWith(".pdf")) return "application/pdf";
  return "text/plain";
}

export function canInlineUpload(mimeType: string): boolean {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/x-ndjson"
  );
}
