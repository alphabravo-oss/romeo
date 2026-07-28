import {
  managedModelsExport,
  managedModelsImport,
  managedModelsList,
  type ImportManagedModelRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface ManagedModelCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
  readFile: (path: string) => Promise<Uint8Array>;
}

export function executeManagedModelCommand(
  area: string,
  action: string | undefined,
  context: ManagedModelCommandContext,
): Promise<number> | undefined {
  if (area === "agents" && action === "list")
    return result(context, listManagedModels(context));
  if (area === "agent" && action === "export")
    return result(
      context,
      exportManagedModel(
        context,
        requiredFlag(context.parsed, "agent", "agent-id"),
      ),
    );
  if (area === "agent" && action === "import")
    return importManagedModel(context);
  return undefined;
}

async function listManagedModels(context: ManagedModelCommandContext) {
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return (
    await managedModelsList({
      client: generatedClient(context),
      ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
      throwOnError: true,
    })
  ).data.data;
}

async function exportManagedModel(
  context: ManagedModelCommandContext,
  agentId: string,
) {
  return (
    await managedModelsExport({
      client: generatedClient(context),
      path: { agentId },
      throwOnError: true,
    })
  ).data.data;
}

async function importManagedModel(
  context: ManagedModelCommandContext,
): Promise<number> {
  const body: ImportManagedModelRequest = {
    workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
    document: JSON.parse(
      new TextDecoder().decode(
        await context.readFile(requiredFlag(context.parsed, "file")),
      ),
    ) as ImportManagedModelRequest["document"],
  };
  const value = managedModelsImport({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then((response) => response.data.data);
  return result(context, value);
}

function generatedClient(
  context: ManagedModelCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

async function result(
  context: ManagedModelCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
