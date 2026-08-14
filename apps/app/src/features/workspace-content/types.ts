export type {
  CreateWorkspaceContentRequest,
  UpdateWorkspaceContentRequest,
  WorkspaceContentItem,
} from "@romeo/api-client/generated/sdk";

export type ContentKind = "memories" | "notes";

export interface WorkspaceContentPage {
  items: import("@romeo/api-client/generated/sdk").WorkspaceContentItem[];
  hasMore: boolean;
  limit: number;
  offset: number;
  total: number;
}
