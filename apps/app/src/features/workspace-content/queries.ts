import {
  workspaceContentListMemories,
  workspaceContentListNotes,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  ContentKind,
  WorkspaceContentItem,
  WorkspaceContentPage,
} from "./types";

export async function listWorkspaceContent(
  kind: ContentKind,
  workspaceId: string,
): Promise<WorkspaceContentItem[]> {
  configureBrowserApiClients();
  const call =
    kind === "memories"
      ? workspaceContentListMemories
      : workspaceContentListNotes;
  const response = await call({ query: { workspaceId }, throwOnError: true });
  return response.data.data;
}

export async function listWorkspaceContentPage(
  kind: ContentKind,
  workspaceId: string,
  options: { limit?: number; offset?: number; query?: string } = {},
): Promise<WorkspaceContentPage> {
  configureBrowserApiClients();
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const query = {
    workspaceId,
    limit,
    offset,
    ...(options.query?.trim() ? { q: options.query.trim() } : {}),
  };
  const response = await (kind === "memories"
    ? workspaceContentListMemories({ query, throwOnError: true })
    : workspaceContentListNotes({ query, throwOnError: true }));
  const meta = response.data.meta;
  if (meta === undefined) {
    return {
      items: response.data.data,
      limit,
      offset,
      total: response.data.data.length,
      hasMore: false,
    };
  }
  return { items: response.data.data, ...meta };
}
