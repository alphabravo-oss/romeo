import {
  browserAutomationClaimTask,
  browserAutomationCompleteTask,
  browserAutomationCreateArtifactUpload,
  browserAutomationExpireTasks,
  browserAutomationFailTask,
  browserAutomationRenewTaskLease,
  type CompleteBrowserAutomationTaskRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import {
  optionalBooleanFlag,
  optionalCsvFlag,
  optionalIntegerFlag,
  optionalNonNegativeIntegerFlag,
  requiredFlag,
} from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface BrowserTaskCommandContext {
  fetchImpl: typeof fetch;
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
  readFile: (path: string) => Promise<Uint8Array>;
}

export function executeBrowserTaskCommand(
  area: string,
  action: string | undefined,
  context: BrowserTaskCommandContext,
): Promise<number> | undefined {
  if (area !== "workflows") return undefined;
  if (action === "browser-task-claim") return claimTask(context);
  if (action === "browser-task-renew") return renewTask(context);
  if (action === "browser-artifact-upload") return uploadArtifact(context);
  if (action === "browser-tasks-expire") return expireTasks(context);
  if (action === "browser-task-complete") return completeTask(context);
  if (action === "browser-task-fail") return failTask(context);
  return undefined;
}

function claimTask(context: BrowserTaskCommandContext) {
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  const body = leaseSeconds === undefined ? {} : { leaseSeconds };
  return result(
    context,
    browserAutomationClaimTask({
      body,
      client: generatedClient(context),
      throwOnError: true,
    }).then(dataEnvelope),
  );
}

function renewTask(context: BrowserTaskCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  const body = leaseSeconds === undefined ? {} : { leaseSeconds };
  return result(
    context,
    browserAutomationRenewTaskLease({
      body,
      client: generatedClient(context),
      path: { jobId },
      throwOnError: true,
    }).then(dataEnvelope),
  );
}

async function uploadArtifact(
  context: BrowserTaskCommandContext,
): Promise<number> {
  const jobId = requiredFlag(context.parsed, "job");
  const file = await context.readFile(requiredFlag(context.parsed, "file"));
  const body = {
    type: browserArtifactType(
      requiredFlag(context.parsed, "type", "artifact-type"),
    ),
    contentType:
      flagValue(context.parsed.flags, "content-type", "mime-type", "mime") ??
      "application/octet-stream",
    sizeBytes: file.byteLength,
  };
  const registration = dataEnvelope(
    await browserAutomationCreateArtifactUpload({
      body,
      client: generatedClient(context),
      path: { jobId },
      throwOnError: true,
    }),
  );
  const uploadResponse = await context.fetchImpl(registration.upload.url, {
    method: registration.upload.method,
    headers: registration.upload.headers,
    body: new Uint8Array(file).buffer,
  });
  if (!uploadResponse.ok)
    throw new Error(
      `Browser automation artifact upload failed with ${uploadResponse.status}.`,
    );
  writeJson(context.io, registration.artifact);
  return 0;
}

function expireTasks(context: BrowserTaskCommandContext) {
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
  return result(
    context,
    browserAutomationExpireTasks({
      body,
      client: generatedClient(context),
      throwOnError: true,
    }).then(dataEnvelope),
  );
}

function completeTask(context: BrowserTaskCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const resultBody: CompleteBrowserAutomationTaskRequest["result"] = {};
  assignOptionalNumber(resultBody, "artifactCount", context, "artifact-count");
  assignOptionalNumber(resultBody, "capturedBytes", context, "captured-bytes");
  assignOptionalNumber(resultBody, "durationMs", context, "duration-ms");
  assignOptionalNumber(
    resultBody,
    "navigationCount",
    context,
    "navigation-count",
  );
  assignOptionalNumber(
    resultBody,
    "networkDeniedCount",
    context,
    "network-denied-count",
  );
  const finalOrigin = flagValue(
    context.parsed.flags,
    "final-url",
    "final-origin",
  );
  const outputKeys = optionalCsvFlag(context.parsed, "output-keys");
  const redactionApplied = optionalBooleanFlag(
    context.parsed,
    "redaction-applied",
  );
  const body: CompleteBrowserAutomationTaskRequest = {
    result: {
      ...resultBody,
      ...(finalOrigin === undefined ? {} : { finalOrigin }),
      ...(outputKeys === undefined ? {} : { outputKeys }),
      ...(redactionApplied === undefined ? {} : { redactionApplied }),
    },
  };
  return result(
    context,
    browserAutomationCompleteTask({
      body,
      client: generatedClient(context),
      path: { jobId },
      throwOnError: true,
    }).then(dataEnvelope),
  );
}

function failTask(context: BrowserTaskCommandContext) {
  const jobId = requiredFlag(context.parsed, "job");
  const body = { errorCode: requiredFlag(context.parsed, "error-code") };
  return result(
    context,
    browserAutomationFailTask({
      body,
      client: generatedClient(context),
      path: { jobId },
      throwOnError: true,
    }).then(dataEnvelope),
  );
}

function generatedClient(
  context: BrowserTaskCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function assignOptionalNumber(
  target: CompleteBrowserAutomationTaskRequest["result"],
  key:
    | "artifactCount"
    | "capturedBytes"
    | "durationMs"
    | "navigationCount"
    | "networkDeniedCount",
  context: BrowserTaskCommandContext,
  flag: string,
) {
  const value = optionalNonNegativeIntegerFlag(context.parsed, flag);
  if (value !== undefined) target[key] = value;
}

function browserArtifactType(value: string): "screenshot" | "trace" {
  if (value === "screenshot" || value === "trace") return value;
  throw new CliUsageError("Browser artifact type must be screenshot or trace.");
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: BrowserTaskCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
