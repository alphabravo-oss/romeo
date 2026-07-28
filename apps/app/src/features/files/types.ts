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
