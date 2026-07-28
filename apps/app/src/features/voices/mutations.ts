import {
  voicesGenerateMessageSpeech,
  voicesPreview,
  voicesSyncCatalog,
  voicesTranscribe,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";
import type { TranscribeVoiceInput } from "./types";
export async function syncVoices() {
  configureBrowserApiClients();
  const response = await voicesSyncCatalog({ throwOnError: true });
  return response.data.data;
}
export async function previewVoice(input: {
  voiceProfileId: string;
  text: string;
}) {
  configureBrowserApiClients();
  const response = await voicesPreview({
    path: { voiceProfileId: input.voiceProfileId },
    body: { text: input.text },
    throwOnError: true,
  });
  return response.data.data;
}
export async function generateMessageSpeech(input: {
  messageId: string;
  voiceProfileId: string;
}) {
  configureBrowserApiClients();
  const response = await voicesGenerateMessageSpeech({
    path: { messageId: input.messageId },
    body: { voiceProfileId: input.voiceProfileId },
    throwOnError: true,
  });
  return response.data.data;
}
export async function transcribeVoice(input: TranscribeVoiceInput) {
  configureBrowserApiClients();
  const response = await voicesTranscribe({ body: input, throwOnError: true });
  return response.data.data;
}
