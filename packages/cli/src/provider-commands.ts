import {
  providersGetOperationalSummary,
  providersListModels,
  providersSyncModels,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import type { ParsedArgs } from "./args";
import { requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface ProviderCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeProviderCommand(
  area: string,
  action: string | undefined,
  context: ProviderCommandContext,
): Promise<number> | undefined {
  if (area === "providers" && action === "summary")
    return result(context, operationalSummary(context));
  if (area !== "models") return undefined;
  if (action === "list") return result(context, listModels(context));
  if (action === "sync")
    return result(
      context,
      syncModels(
        context,
        requiredFlag(context.parsed, "provider", "provider-id"),
      ),
    );
  return undefined;
}

async function operationalSummary(context: ProviderCommandContext) {
  return (
    await providersGetOperationalSummary({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function listModels(context: ProviderCommandContext) {
  return (
    await providersListModels({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function syncModels(context: ProviderCommandContext, providerId: string) {
  return (
    await providersSyncModels({
      client: generatedClient(context),
      path: { providerId },
      throwOnError: true,
    })
  ).data.data;
}

function generatedClient(context: ProviderCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

async function result(
  context: ProviderCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
