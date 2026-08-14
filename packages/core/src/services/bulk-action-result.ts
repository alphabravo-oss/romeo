import { publicErrorMessage } from "./public-error";

export interface BulkActionItemResult {
  id: string;
  status: "success" | "failure";
  error?: string;
}

export interface BulkActionResult {
  results: BulkActionItemResult[];
}

export function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function bulkErrorMessage(error: unknown): string {
  return publicErrorMessage(error, "The item could not be updated.");
}
