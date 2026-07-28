import {
  workspaceContentCreateMemory,
  workspaceContentCreateNote,
  workspaceContentDeleteMemory,
  workspaceContentDeleteNote,
  workspaceContentUpdateMemory,
  workspaceContentUpdateNote,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { ContentKind, WorkspaceContentItem } from "./types";

type CreateInput = Parameters<typeof workspaceContentCreateMemory>[0]["body"];
type UpdateInput = Parameters<typeof workspaceContentUpdateMemory>[0]["body"];

export async function createWorkspaceContent(
  kind: ContentKind,
  input: CreateInput,
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
  input: UpdateInput,
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
