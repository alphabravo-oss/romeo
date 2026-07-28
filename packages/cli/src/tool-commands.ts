import {
  toolConnectorsCheckAuth,
  toolConnectorsDispatchOperation,
  toolConnectorsUpdate,
  toolConnectorsUpdateOperation,
  toolDispatchRequestsCancel,
  toolDispatchRequestsClaim,
  toolDispatchRequestsComplete,
  toolDispatchRequestsEnqueue,
  toolDispatchRequestsExpire,
  toolDispatchRequestsFail,
  toolDispatchRequestsRenewLease,
  type CompleteToolDispatchRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import {
  optionalIntegerFlag,
  optionalMappingFlag,
  optionalNonNegativeIntegerFlag,
  requiredFlag,
} from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface ToolCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeToolCommand(
  area: string,
  action: string | undefined,
  context: ToolCommandContext,
): Promise<number> | undefined {
  if (area !== "tools") return undefined;
  const command = toolCommand(action, context);
  return command === undefined ? undefined : result(context, command);
}

function toolCommand(
  action: string | undefined,
  context: ToolCommandContext,
): Promise<unknown> | undefined {
  if (action === "auth-check") return checkConnectorAuth(context);
  if (action === "connector-enable") return updateConnector(context, true);
  if (action === "connector-disable") return updateConnector(context, false);
  if (action === "operation-enable") return updateOperation(context, true);
  if (action === "operation-disable") return updateOperation(context, false);
  if (action === "operation-dispatch") return dispatchOperation(context);
  if (action === "operation-enqueue") return enqueueOperation(context);
  if (action === "dispatch-request-claim") return claimDispatchRequest(context);
  if (action === "dispatch-request-renew") return renewDispatchRequest(context);
  if (action === "dispatch-requests-expire")
    return expireDispatchRequests(context);
  if (action === "dispatch-request-complete")
    return completeDispatchRequest(context);
  if (action === "dispatch-request-fail") return failDispatchRequest(context);
  if (action === "dispatch-request-cancel")
    return cancelDispatchRequest(context);
  return undefined;
}

function checkConnectorAuth(context: ToolCommandContext) {
  const connectorId = requiredFlag(context.parsed, "connector", "connector-id");
  return toolConnectorsCheckAuth({
    client: generatedClient(context),
    path: { connectorId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function updateConnector(context: ToolCommandContext, enabled: boolean) {
  const connectorId = requiredFlag(context.parsed, "connector", "connector-id");
  return toolConnectorsUpdate({
    body: { enabled },
    client: generatedClient(context),
    path: { connectorId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function updateOperation(context: ToolCommandContext, enabled: boolean) {
  const { connectorId, operationId } = connectorOperationIds(context.parsed);
  return toolConnectorsUpdateOperation({
    body: { enabled },
    client: generatedClient(context),
    path: { connectorId, operationId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function dispatchOperation(context: ToolCommandContext) {
  const { connectorId, operationId } = connectorOperationIds(context.parsed);
  const parameters = optionalMappingFlag(context.parsed, "param", "parameter");
  const approvalRequestId = flagValue(
    context.parsed.flags,
    "approval-request",
    "approval-request-id",
  );
  const body = {
    ...(hasFlag(context.parsed.flags, "approved") ? { approved: true } : {}),
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    ...(parameters === undefined ? {} : { parameters }),
  };
  return toolConnectorsDispatchOperation({
    body,
    client: generatedClient(context),
    path: { connectorId, operationId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function enqueueOperation(context: ToolCommandContext) {
  const { connectorId, operationId } = connectorOperationIds(context.parsed);
  const parameters = optionalMappingFlag(context.parsed, "param", "parameter");
  const approvalRequestId = flagValue(
    context.parsed.flags,
    "approval-request",
    "approval-request-id",
  );
  const idempotencyKey = flagValue(
    context.parsed.flags,
    "idempotency-key",
    "idempotency",
  );
  const body = {
    ...(hasFlag(context.parsed.flags, "approved") ? { approved: true } : {}),
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(parameters === undefined ? {} : { parameters }),
  };
  return toolDispatchRequestsEnqueue({
    body,
    client: generatedClient(context),
    path: { connectorId, operationId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function claimDispatchRequest(context: ToolCommandContext) {
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  const body = leaseSeconds === undefined ? {} : { leaseSeconds };
  return toolDispatchRequestsClaim({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function renewDispatchRequest(context: ToolCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  const body = leaseSeconds === undefined ? {} : { leaseSeconds };
  return toolDispatchRequestsRenewLease({
    body,
    client: generatedClient(context),
    path: { jobId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function expireDispatchRequests(context: ToolCommandContext) {
  const queuedTimeoutSeconds = optionalIntegerFlag(
    context.parsed,
    "queued-timeout-seconds",
  );
  const runningTimeoutSeconds = optionalIntegerFlag(
    context.parsed,
    "running-timeout-seconds",
  );
  const limit = optionalIntegerFlag(context.parsed, "limit");
  const body = {
    ...(queuedTimeoutSeconds === undefined ? {} : { queuedTimeoutSeconds }),
    ...(runningTimeoutSeconds === undefined ? {} : { runningTimeoutSeconds }),
    ...(limit === undefined ? {} : { limit }),
  };
  return toolDispatchRequestsExpire({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function completeDispatchRequest(context: ToolCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const status = requiredHttpStatusFlag(context.parsed, "status");
  const contentType = flagValue(context.parsed.flags, "content-type");
  const schemaErrorCode = flagValue(context.parsed.flags, "schema-error-code");
  const body: CompleteToolDispatchRequest = {
    response: {
      ok: status >= 200 && status < 300,
      status,
      ...(contentType === undefined ? {} : { contentType }),
      bodyBytes:
        optionalNonNegativeIntegerFlag(context.parsed, "body-bytes") ?? 0,
      truncated: hasFlag(context.parsed.flags, "truncated"),
      schemaValidation: {
        status: toolResponseValidationStatus(
          flagValue(context.parsed.flags, "schema-validation") ??
            "not_applicable",
        ),
        ...(schemaErrorCode === undefined
          ? {}
          : { errorCode: schemaErrorCode }),
      },
    },
  };
  return toolDispatchRequestsComplete({
    body,
    client: generatedClient(context),
    path: { jobId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function failDispatchRequest(context: ToolCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const body = { errorCode: requiredFlag(context.parsed, "error-code") };
  return toolDispatchRequestsFail({
    body,
    client: generatedClient(context),
    path: { jobId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function cancelDispatchRequest(context: ToolCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const reasonCode = flagValue(context.parsed.flags, "reason-code", "reason");
  const body = reasonCode === undefined ? {} : { reasonCode };
  return toolDispatchRequestsCancel({
    body,
    client: generatedClient(context),
    path: { jobId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: ToolCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function connectorOperationIds(parsed: ParsedArgs) {
  return {
    connectorId: requiredFlag(parsed, "connector", "connector-id"),
    operationId: requiredFlag(parsed, "operation", "operation-id"),
  };
}

function toolResponseValidationStatus(
  value: string,
): CompleteToolDispatchRequest["response"]["schemaValidation"]["status"] {
  if (
    value === "failed" ||
    value === "not_applicable" ||
    value === "passed" ||
    value === "skipped"
  )
    return value;
  throw new CliUsageError(
    "--schema-validation must be failed, not_applicable, passed, or skipped.",
  );
}

function requiredHttpStatusFlag(parsed: ParsedArgs, name: string): number {
  const value = Number(requiredFlag(parsed, name));
  if (!Number.isInteger(value) || value < 100 || value > 599)
    throw new CliUsageError(`--${name} must be an HTTP status code.`);
  return value;
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: ToolCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
