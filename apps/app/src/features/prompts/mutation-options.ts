import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  createPromptTemplate,
  deletePromptTemplate,
  updatePromptTemplate,
} from "./mutations";
import type { UpdatePromptTemplateInput } from "./types";

export function createPromptTemplateMutationOptions() {
  return serverMutationOptions({
    resource: "promptTemplate.create",
    mutationFn: createPromptTemplate,
    reconcile: (client, _template, variables) =>
      refreshPromptViews(client, variables.workspaceId),
  });
}

export function deletePromptTemplateMutationOptions() {
  return serverMutationOptions({
    resource: "promptTemplate.delete",
    mutationFn: (input: { promptTemplateId: string; workspaceId: string }) =>
      deletePromptTemplate(input.promptTemplateId),
    reconcile: (client, _template, variables) =>
      refreshPromptViews(client, variables.workspaceId),
  });
}

export function updatePromptTemplateMutationOptions() {
  return serverMutationOptions({
    resource: "promptTemplate.update",
    mutationFn: (input: {
      promptTemplateId: string;
      update: UpdatePromptTemplateInput;
      workspaceId: string;
    }) => updatePromptTemplate(input.promptTemplateId, input.update),
    reconcile: (client, _template, variables) =>
      refreshPromptViews(client, variables.workspaceId),
  });
}

async function refreshPromptViews(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  workspaceId: string,
) {
  await Promise.all([
    invalidateCachedResourceExactly(
      client,
      appQueryKeys.promptTemplates(workspaceId),
    ),
    invalidateCachedResourceExactly(client, appQueryKeys.promptMarketplace()),
  ]);
}
