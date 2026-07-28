import {
  tenancyArchiveWorkspace,
  tenancyCreateWorkspace,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function createWorkspace(input: { name: string; slug?: string }) {
  configureBrowserApiClients();
  const body = {
    name: input.name,
    ...(input.slug?.trim() ? { slug: input.slug.trim() } : {}),
  };
  const response = await tenancyCreateWorkspace({
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function archiveWorkspace(workspaceId: string) {
  configureBrowserApiClients();
  const response = await tenancyArchiveWorkspace({
    path: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}
