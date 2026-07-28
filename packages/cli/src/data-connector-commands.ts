import {
  dataConnectorsCreate,
  dataConnectorsList,
  dataConnectorsSync,
  type CreateDataConnectorRequest,
  type SyncDataConnectorRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";
import { basename } from "node:path";

import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import { optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface DataConnectorCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
  readFile: (path: string) => Promise<Uint8Array>;
}

export function executeDataConnectorCommand(
  area: string,
  action: string | undefined,
  context: DataConnectorCommandContext,
): Promise<number> | undefined {
  if (area !== "connectors") return undefined;
  const command = dataConnectorCommand(action, context);
  return command === undefined ? undefined : result(context, command);
}

function dataConnectorCommand(
  action: string | undefined,
  context: DataConnectorCommandContext,
): Promise<unknown> | undefined {
  if (action === "list") return listConnectors(context);
  if (action === "create-local") return createLocalConnector(context);
  if (action === "create-website") return createWebsiteConnector(context);
  if (action === "create-rss") return createRssConnector(context);
  if (action === "create-s3") return createS3Connector(context);
  if (action === "sync-local") return syncLocalConnector(context);
  if (action === "sync") return syncConnector(context, {});
  return undefined;
}

function listConnectors(context: DataConnectorCommandContext) {
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return dataConnectorsList({
    client: generatedClient(context),
    ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
    throwOnError: true,
  }).then(dataEnvelope);
}

function createLocalConnector(context: DataConnectorCommandContext) {
  const sourceAccessMode = sourceAccessModeConfig(context.parsed);
  return createConnector(context, {
    ...connectorIdentity(context, "local_import", "Local import"),
    ...(sourceAccessMode === undefined ? {} : { config: sourceAccessMode }),
  });
}

function createWebsiteConnector(context: DataConnectorCommandContext) {
  const maxPages = optionalIntegerFlag(context.parsed, "max-pages");
  return createConnector(context, {
    ...connectorIdentity(context, "website", "Website"),
    ...syncInterval(context.parsed),
    config: {
      url: requiredFlag(context.parsed, "url"),
      ...(maxPages === undefined ? {} : { maxPages }),
      ...(sourceAccessModeConfig(context.parsed) ?? {}),
    },
  });
}

function createRssConnector(context: DataConnectorCommandContext) {
  const maxItems = optionalIntegerFlag(context.parsed, "max-items");
  return createConnector(context, {
    ...connectorIdentity(context, "rss", "RSS feed"),
    ...syncInterval(context.parsed),
    config: {
      url: requiredFlag(context.parsed, "url"),
      ...(maxItems === undefined ? {} : { maxItems }),
      ...(sourceAccessModeConfig(context.parsed) ?? {}),
    },
  });
}

function createS3Connector(context: DataConnectorCommandContext) {
  const maxItems = optionalIntegerFlag(context.parsed, "max-items");
  const secretRef = flagValue(context.parsed.flags, "secret-ref", "secret");
  return createConnector(context, {
    ...connectorIdentity(context, "s3", "S3 bucket"),
    ...syncInterval(context.parsed),
    config: {
      bucket: requiredFlag(context.parsed, "bucket"),
      prefix: flagValue(context.parsed.flags, "prefix") ?? "",
      region: flagValue(context.parsed.flags, "region") ?? "us-east-1",
      ...(maxItems === undefined ? {} : { maxItems }),
      ...(secretRef === undefined ? {} : { secretRef }),
      ...(sourceAccessModeConfig(context.parsed) ?? {}),
    },
  });
}

async function syncLocalConnector(context: DataConnectorCommandContext) {
  const filePath = requiredFlag(context.parsed, "file");
  const content = new TextDecoder().decode(await context.readFile(filePath));
  const body: SyncDataConnectorRequest = {
    items: [
      {
        fileName: flagValue(context.parsed.flags, "name") ?? basename(filePath),
        mimeType:
          flagValue(context.parsed.flags, "mime-type", "mime") ?? "text/plain",
        content,
        sizeBytes: new TextEncoder().encode(content).length,
      },
    ],
  };
  return syncConnector(context, body);
}

function createConnector(
  context: DataConnectorCommandContext,
  body: CreateDataConnectorRequest,
) {
  return dataConnectorsCreate({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function syncConnector(
  context: DataConnectorCommandContext,
  body: SyncDataConnectorRequest,
) {
  const connectorId = requiredFlag(context.parsed, "connector", "connector-id");
  return dataConnectorsSync({
    body,
    client: generatedClient(context),
    path: { connectorId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(
  context: DataConnectorCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function connectorIdentity(
  context: DataConnectorCommandContext,
  type: CreateDataConnectorRequest["type"],
  defaultName: string,
) {
  return {
    workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
    knowledgeBaseId: requiredFlag(context.parsed, "kb", "knowledge-base"),
    type,
    name: flagValue(context.parsed.flags, "name") ?? defaultName,
  };
}

function syncInterval(parsed: ParsedArgs): { syncIntervalMinutes?: number } {
  const syncIntervalMinutes = optionalIntegerFlag(
    parsed,
    "sync-interval-minutes",
  );
  return syncIntervalMinutes === undefined ? {} : { syncIntervalMinutes };
}

function sourceAccessModeConfig(
  parsed: ParsedArgs,
): { sourceAccessMode: "connector_owner" | "knowledge_base" } | undefined {
  const value = flagValue(parsed.flags, "source-access-mode");
  if (value === undefined) return undefined;
  if (value === "connector_owner" || value === "knowledge_base")
    return { sourceAccessMode: value };
  throw new CliUsageError(
    "--source-access-mode must be knowledge_base or connector_owner.",
  );
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: DataConnectorCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
