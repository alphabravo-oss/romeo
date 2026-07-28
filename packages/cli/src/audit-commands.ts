import {
  operationalGovernanceExportAuditLogs,
  operationalGovernanceListAuditLogs,
  type OperationalGovernanceListAuditLogsData,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import type { CliIo } from "./io";
import { writeJson } from "./io";

type AuditFilter = NonNullable<OperationalGovernanceListAuditLogsData["query"]>;

interface AuditCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeAuditCommand(
  area: string,
  action: string | undefined,
  context: AuditCommandContext,
): Promise<number> | undefined {
  if (area !== "audit") return undefined;
  if (action === "list") return listAuditLogs(context);
  if (action === "export") return exportAuditLogs(context);
  return undefined;
}

async function listAuditLogs(context: AuditCommandContext): Promise<number> {
  const query = auditFilter(context.parsed);
  const value = (
    await operationalGovernanceListAuditLogs({
      client: generatedClient(context),
      ...(Object.keys(query).length === 0 ? {} : { query }),
      throwOnError: true,
    })
  ).data.data;
  writeJson(context.io, value);
  return 0;
}

async function exportAuditLogs(context: AuditCommandContext): Promise<number> {
  const query = auditFilter(context.parsed);
  const value = (
    await operationalGovernanceExportAuditLogs({
      client: generatedClient(context),
      ...(Object.keys(query).length === 0 ? {} : { query }),
      throwOnError: true,
    })
  ).data;
  context.io.stdout.write(value);
  return 0;
}

function generatedClient(context: AuditCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function auditFilter(parsed: ParsedArgs): AuditFilter {
  const action = flagValue(parsed.flags, "action");
  const outcome = flagValue(parsed.flags, "outcome");
  const resourceType = flagValue(parsed.flags, "resource-type");
  return {
    ...(action === undefined ? {} : { action }),
    ...(outcome === "success" || outcome === "failure" ? { outcome } : {}),
    ...(resourceType === undefined ? {} : { resourceType }),
  };
}
