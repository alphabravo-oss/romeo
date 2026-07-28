import {
  promptsCreateTemplate,
  promptsDeleteTemplate,
  promptsShareTemplate,
  promptsUpdateTemplate,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";
import type {
  CreatePromptTemplateInput,
  SharePromptTemplateInput,
  UpdatePromptTemplateInput,
} from "./types";
export async function createPromptTemplate(input: CreatePromptTemplateInput) {
  configureBrowserApiClients();
  const response = await promptsCreateTemplate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
export async function updatePromptTemplate(
  promptTemplateId: string,
  input: UpdatePromptTemplateInput,
) {
  configureBrowserApiClients();
  const response = await promptsUpdateTemplate({
    path: { promptTemplateId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
export async function deletePromptTemplate(promptTemplateId: string) {
  configureBrowserApiClients();
  const response = await promptsDeleteTemplate({
    path: { promptTemplateId },
    throwOnError: true,
  });
  return response.data.data;
}
export async function sharePromptTemplate(
  promptTemplateId: string,
  input: SharePromptTemplateInput,
) {
  configureBrowserApiClients();
  const response = await promptsShareTemplate({
    path: { promptTemplateId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
