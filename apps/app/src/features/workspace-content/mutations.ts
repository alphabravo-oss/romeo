import {
  workspaceContentCreateMemory,
  workspaceContentCreateNote,
  workspaceContentDeleteMemory,
  workspaceContentDeleteNote,
  workspaceContentUpdateMemory,
  workspaceContentUpdateNote,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  ContentKind,
  CreateWorkspaceContentRequest,
  UpdateWorkspaceContentRequest,
  WorkspaceContentItem,
} from "./types";

export async function createWorkspaceContent(
  kind: ContentKind,
  input: CreateWorkspaceContentRequest,
): Promise<WorkspaceContentItem> {
  configureBrowserApiClients();
  const response = await (kind === "memories"
    ? workspaceContentCreateMemory({ body: input, throwOnError: true })
    : workspaceContentCreateNote({ body: input, throwOnError: true }));
  return response.data.data;
}

export async function updateWorkspaceContent(
  kind: ContentKind,
  id: string,
  input: UpdateWorkspaceContentRequest,
): Promise<WorkspaceContentItem> {
  configureBrowserApiClients();
  const options = {
    path: { contentId: id },
    body: input,
    throwOnError: true as const,
  };
  const response = await (kind === "memories"
    ? workspaceContentUpdateMemory(options)
    : workspaceContentUpdateNote(options));
  return response.data.data;
}

export async function deleteWorkspaceContent(
  kind: ContentKind,
  id: string,
): Promise<WorkspaceContentItem> {
  configureBrowserApiClients();
  const options = { path: { contentId: id }, throwOnError: true as const };
  const response = await (kind === "memories"
    ? workspaceContentDeleteMemory(options)
    : workspaceContentDeleteNote(options));
  return response.data.data;
}
