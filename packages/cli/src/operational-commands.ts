import {
  jobsGetOperationalSummary,
  jobsList,
  readinessGetReport,
  systemGetHealth,
  tenancyArchiveWorkspace,
  tenancyExportWorkspace,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import type { ParsedArgs } from "./args";
import { requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface OperationalCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeOperationalCommand(
  area: string,
  action: string | undefined,
  context: OperationalCommandContext,
): Promise<number> | undefined {
  const value = operationalCommand(area, action, context);
  return value === undefined ? undefined : result(context, value);
}

function operationalCommand(
  area: string,
  action: string | undefined,
  context: OperationalCommandContext,
): Promise<unknown> | undefined {
  if (area === "health") return health(context);
  if (area === "workspaces" && action === "archive")
    return archiveWorkspace(context);
  if (area === "workspaces" && action === "export")
    return exportWorkspace(context);
  if (area === "readiness") return readiness(context);
  if (area === "jobs" && action === "list") return listJobs(context);
  if (area === "jobs" && action === "summary") return jobSummary(context);
  return undefined;
}

function health(context: OperationalCommandContext) {
  return systemGetHealth({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function archiveWorkspace(context: OperationalCommandContext) {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  return tenancyArchiveWorkspace({
    client: generatedClient(context),
    path: { workspaceId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function exportWorkspace(context: OperationalCommandContext) {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  return tenancyExportWorkspace({
    client: generatedClient(context),
    path: { workspaceId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function readiness(context: OperationalCommandContext) {
  return readinessGetReport({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listJobs(context: OperationalCommandContext) {
  return jobsList({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function jobSummary(context: OperationalCommandContext) {
  return jobsGetOperationalSummary({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(
  context: OperationalCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: OperationalCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
