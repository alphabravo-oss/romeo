import {
  promptsGetTemplate,
  promptsListMarketplace,
  promptsListShares,
  promptsListTemplates,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (workspaceId === undefined || workspaceId.trim() === "")
    throw new Error("A workspace is required to load prompts.");
  return workspaceId;
}
export async function listPromptTemplates(workspaceId?: string) {
  configureBrowserApiClients();
  const response = await promptsListTemplates({
    query: { workspaceId: requireWorkspaceId(workspaceId) },
    throwOnError: true,
  });
  return response.data.data;
}
export async function listPromptTemplatesPage(input: {
  workspaceId: string;
  limit: number;
  offset: number;
  query?: string;
}) {
  configureBrowserApiClients();
  const query = {
    workspaceId: input.workspaceId,
    limit: input.limit,
    offset: input.offset,
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
  };
  const response = await promptsListTemplates({ query, throwOnError: true });
  const meta = response.data.meta;
  return {
    items: response.data.data,
    limit: meta?.limit ?? input.limit,
    offset: meta?.offset ?? input.offset,
    total: meta?.total ?? response.data.data.length,
    hasMore: meta?.hasMore ?? false,
  };
}
export async function listPromptMarketplace(workspaceId?: string) {
  configureBrowserApiClients();
  const response = await promptsListMarketplace({
    query: { workspaceId: requireWorkspaceId(workspaceId) },
    throwOnError: true,
  });
  return response.data.data;
}
export async function getPromptTemplate(promptTemplateId: string) {
  configureBrowserApiClients();
  const response = await promptsGetTemplate({
    path: { promptTemplateId },
    throwOnError: true,
  });
  return response.data.data;
}
export async function listPromptTemplateShares(promptTemplateId: string) {
  configureBrowserApiClients();
  const response = await promptsListShares({
    path: { promptTemplateId },
    throwOnError: true,
  });
  return response.data.data;
}
