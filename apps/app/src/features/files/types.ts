import type { FileObject } from "@romeo/api-client/generated/sdk";

export type {
  FileExtraction,
  FileObject,
  FileResumableUploadSession,
  FileUploadSession,
} from "@romeo/api-client/generated/sdk";

export interface FilePage {
  items: import("@romeo/api-client/generated/sdk").FileObject[];
  hasMore: boolean;
  limit: number;
  offset: number;
  total: number;
}

export function isFileReady(file: FileObject): boolean {
  return ["available", "ready", "attached", "retained"].includes(file.status);
}
