import { voicesList, voicesSyncCatalog } from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import type { ParsedArgs } from "./args";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface VoiceCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeVoiceCommand(
  area: string,
  action: string | undefined,
  context: VoiceCommandContext,
): Promise<number> | undefined {
  if (area !== "voices") return undefined;
  if (action === "list") return result(context, listVoices(context));
  if (action === "sync") return result(context, syncVoices(context));
  return undefined;
}

function listVoices(context: VoiceCommandContext) {
  return voicesList({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function syncVoices(context: VoiceCommandContext) {
  return voicesSyncCatalog({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: VoiceCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: VoiceCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
