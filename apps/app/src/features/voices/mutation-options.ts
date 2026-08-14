import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  generateMessageSpeech,
  previewVoice,
  syncVoices,
  transcribeVoice,
} from "./mutations";
import type { TranscribeVoiceInput } from "./types";

export function syncVoicesMutationOptions() {
  return serverMutationOptions({
    resource: "voices.catalog.sync",
    mutationFn: syncVoices,
    reconcile: (client, result) => {
      client.setQueryData(appQueryKeys.voices(), result.profiles);
    },
    invalidations: () => [{ exact: true, queryKey: appQueryKeys.voices() }],
  });
}

export function previewVoiceMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "voices.preview",
    mutationFn: previewVoice,
  });
}

export function generateMessageSpeechMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "voices.message.generate",
    mutationFn: generateMessageSpeech,
  });
}

export function transcribeVoiceMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "voices.transcribe",
    mutationFn: (input: TranscribeVoiceInput) => transcribeVoice(input),
  });
}
