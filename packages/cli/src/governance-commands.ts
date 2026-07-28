import {
  governanceEnforceRetention,
  governanceExecuteDataDeletion,
  governanceExportAccessReviewCsv,
  governanceExportComplianceReportCsv,
  governanceGetComplianceReport,
  governanceGetRetentionPolicy,
  governanceListAccessReviewGrants,
  governancePreviewDataDeletion,
  governanceUpdateRetentionPolicy,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface GovernanceCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeGovernanceCommand(
  area: string,
  action: string | undefined,
  context: GovernanceCommandContext,
): Promise<number> | undefined {
  if (area === "access-review" && action === "export")
    return exportAccessReview(context);
  if (area === "access-review") return accessReview(context);
  if (area !== "governance") return undefined;
  if (action === "retention") return retentionPolicy(context);
  if (action === "retention-enforce") return enforceRetention(context);
  if (action === "data-delete-preview") return previewDataDeletion(context);
  if (action === "data-delete") return executeDataDeletion(context);
  if (action === "compliance-report") return complianceReport(context);
  if (action === "compliance-report-export")
    return exportComplianceReport(context);
  return undefined;
}

function accessReview(context: GovernanceCommandContext) {
  const value = governanceListAccessReviewGrants({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
  return result(context, value);
}

async function exportAccessReview(
  context: GovernanceCommandContext,
): Promise<number> {
  const csv = (
    await governanceExportAccessReviewCsv({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data;
  context.io.stdout.write(csv);
  return 0;
}

function retentionPolicy(context: GovernanceCommandContext) {
  const days = flagValue(context.parsed.flags, "days");
  const client = generatedClient(context);
  const value =
    days === undefined
      ? governanceGetRetentionPolicy({ client, throwOnError: true }).then(
          dataEnvelope,
        )
      : governanceUpdateRetentionPolicy({
          body: { auditLogRetentionDays: Number(days) },
          client,
          throwOnError: true,
        }).then(dataEnvelope);
  return result(context, value);
}

function enforceRetention(context: GovernanceCommandContext) {
  const value = governanceEnforceRetention({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
  return result(context, value);
}

function previewDataDeletion(context: GovernanceCommandContext) {
  const body = {
    resourceType: "chat" as const,
    resourceId: requiredFlag(context.parsed, "chat", "chat-id"),
  };
  const value = governancePreviewDataDeletion({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
  return result(context, value);
}

function executeDataDeletion(context: GovernanceCommandContext) {
  const body = {
    resourceType: "chat" as const,
    resourceId: requiredFlag(context.parsed, "chat", "chat-id"),
    confirmResourceId: requiredFlag(context.parsed, "confirm"),
  };
  const value = governanceExecuteDataDeletion({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
  return result(context, value);
}

function complianceReport(context: GovernanceCommandContext) {
  const value = governanceGetComplianceReport({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
  return result(context, value);
}

async function exportComplianceReport(
  context: GovernanceCommandContext,
): Promise<number> {
  const csv = (
    await governanceExportComplianceReportCsv({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data;
  context.io.stdout.write(csv);
  return 0;
}

function generatedClient(
  context: GovernanceCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: GovernanceCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
