import {
  chatExperienceGenerateTitle,
  chatExperienceGet,
  chatExperienceUpdate,
  type ChatExperience,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type {
  ChatExperience,
  ChatSuggestion,
} from "@romeo/api-client/generated/sdk";

export async function getChatExperience(): Promise<ChatExperience> {
  configureBrowserApiClients();
  const response = await chatExperienceGet({ throwOnError: true });
  return response.data.data;
}

export async function updateChatExperience(
  input: ChatExperience,
): Promise<ChatExperience> {
  configureBrowserApiClients();
  const response = await chatExperienceUpdate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function generateChatTitle(chatId: string, modelId: string) {
  configureBrowserApiClients();
  const response = await chatExperienceGenerateTitle({
    path: { chatId },
    body: { modelId },
    throwOnError: true,
  });
  return response.data.data;
}
