import { flagValue, hasFlag } from "./args";
import { numberFlag, optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CommandContext } from "./commands";
import { CliUsageError } from "./cli-errors";
import {
  runBillingEntitlementReconciliationWorker,
  runBillingLifecycleEnforcementWorker,
} from "./billing-worker";
import { runBrowserAutomationWorker } from "./browser-automation-worker";
import { runDataConnectorSyncWorker } from "./data-connector-worker";
import {
  billingEntitlementWorkerClient,
  billingLifecycleWorkerClient,
  browserWorkerClient,
  dataConnectorWorkerClient,
  retentionWorkerClient,
  toolWorkerClient,
  voiceWorkerClient,
  workflowWorkerClient,
} from "./generated-worker-clients";
import { runRetentionEnforcementWorker } from "./retention-worker";
import {
  createSecretValueResolver,
  type SecretValueResolverDriver,
} from "./secret-resolver";
import { runToolDispatchWorker } from "./tool-dispatch-worker";
import { parseToolDispatchPayloadFile } from "./tool-dispatch-payload";
import { runVoiceCatalogSyncWorker } from "./voice-worker";
import { runWorkflowResumeWorker } from "./workflow-worker";

export function executeWorkerCommand(
  area: string,
  action: string | undefined,
  context: CommandContext,
): Promise<number> | undefined {
  if (area !== "workers") return undefined;
  if (action === "data-connector-sync") return dataConnectorSyncWorker(context);
  if (action === "tool-dispatch") return toolDispatchWorker(context);
  if (action === "browser-automation") return browserAutomationWorker(context);
  if (action === "voice-catalog-sync") return voiceCatalogSyncWorker(context);
  if (action === "workflow-resume") return workflowResumeWorker(context);
  if (action === "retention-enforce")
    return retentionEnforcementWorker(context);
  if (action === "billing-entitlement-reconcile")
    return billingEntitlementReconciliationWorker(context);
  if (action === "billing-lifecycle-enforce")
    return billingLifecycleEnforcementWorker(context);
  return undefined;
}

function dataConnectorSyncWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxConnectorsPerIteration = optionalIntegerFlag(
    context.parsed,
    "max-connectors",
  );
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return runDataConnectorSyncWorker({
    client: dataConnectorWorkerClient(context),
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxConnectorsPerIteration === undefined
      ? {}
      : { maxConnectorsPerIteration }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
}

async function toolDispatchWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 10_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxJobsPerIteration = optionalIntegerFlag(context.parsed, "max-jobs");
  const leaseSeconds =
    optionalIntegerFlag(context.parsed, "lease-seconds") ?? 300;
  const timeoutMs = optionalIntegerFlag(context.parsed, "timeout-ms") ?? 10_000;
  const maxBytes =
    optionalIntegerFlag(context.parsed, "max-bytes") ?? 1_000_000;
  const payloadFile = flagValue(context.parsed.flags, "payload-file");
  const payloads =
    payloadFile === undefined
      ? undefined
      : parseToolDispatchPayloadFile(
          new TextDecoder().decode(await context.readFile(payloadFile)),
        );
  const secretResolverDriver = toolDispatchSecretResolverDriver(context);
  return runToolDispatchWorker({
    client: toolWorkerClient(context),
    ...(context.dnsLookup === undefined
      ? {}
      : { dnsLookup: context.dnsLookup }),
    fetchImpl: context.fetchImpl,
    intervalMs,
    io: context.io,
    leaseSeconds,
    maxBytes,
    timeoutMs,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxJobsPerIteration === undefined ? {} : { maxJobsPerIteration }),
    ...(payloads === undefined ? {} : { payloads }),
    secretResolver: createSecretValueResolver(secretResolverDriver, {
      fetchImpl: context.fetchImpl,
    }),
    ...(hasFlag(context.parsed.flags, "allow-private-network")
      ? { allowPrivateNetwork: true }
      : {}),
  });
}

function browserAutomationWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 10_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxJobsPerIteration = optionalIntegerFlag(context.parsed, "max-jobs");
  const leaseSeconds =
    optionalIntegerFlag(context.parsed, "lease-seconds") ?? 300;
  const timeoutMs = optionalIntegerFlag(context.parsed, "timeout-ms") ?? 30_000;
  const maxBytes = optionalIntegerFlag(context.parsed, "max-bytes") ?? 20_000;
  return runBrowserAutomationWorker({
    client: browserWorkerClient(context),
    fetchImpl: context.fetchImpl,
    intervalMs,
    io: context.io,
    leaseSeconds,
    maxBytes,
    runnerUrl: requiredFlag(context.parsed, "runner-url"),
    timeoutMs,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxJobsPerIteration === undefined ? {} : { maxJobsPerIteration }),
  });
}

function retentionEnforcementWorker(context: CommandContext): Promise<number> {
  return intervalWorker(
    context,
    retentionWorkerClient(context),
    86_400_000,
    runRetentionEnforcementWorker,
  );
}

function billingEntitlementReconciliationWorker(
  context: CommandContext,
): Promise<number> {
  return intervalWorker(
    context,
    billingEntitlementWorkerClient(context),
    300_000,
    runBillingEntitlementReconciliationWorker,
  );
}

function billingLifecycleEnforcementWorker(
  context: CommandContext,
): Promise<number> {
  return intervalWorker(
    context,
    billingLifecycleWorkerClient(context),
    900_000,
    runBillingLifecycleEnforcementWorker,
  );
}

function voiceCatalogSyncWorker(context: CommandContext): Promise<number> {
  return intervalWorker(
    context,
    voiceWorkerClient(context),
    86_400_000,
    runVoiceCatalogSyncWorker,
  );
}

function intervalWorker<TClient>(
  context: CommandContext,
  client: TClient,
  defaultIntervalMs: number,
  run: (input: {
    client: TClient;
    intervalMs: number;
    io: CommandContext["io"];
    maxIterations?: number;
  }) => Promise<number>,
): Promise<number> {
  const intervalMs = numberFlag(
    context.parsed,
    defaultIntervalMs,
    "interval-ms",
  );
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  return run({
    client,
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
  });
}

function workflowResumeWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxRunsPerIteration = optionalIntegerFlag(context.parsed, "max-runs");
  const maxWorkflowsPerIteration = optionalIntegerFlag(
    context.parsed,
    "max-workflows",
  );
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return runWorkflowResumeWorker({
    client: workflowWorkerClient(context),
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxRunsPerIteration === undefined ? {} : { maxRunsPerIteration }),
    ...(maxWorkflowsPerIteration === undefined
      ? {}
      : { maxWorkflowsPerIteration }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
}

function toolDispatchSecretResolverDriver(
  context: CommandContext,
): SecretValueResolverDriver {
  const value =
    flagValue(context.parsed.flags, "secret-resolver") ??
    process.env.TOOL_DISPATCH_SECRET_RESOLVER_DRIVER ??
    "disabled";
  if (
    value === "disabled" ||
    value === "env" ||
    value === "vault" ||
    value === "aws-sm" ||
    value === "gcp-sm" ||
    value === "azure-kv" ||
    value === "cloud"
  )
    return value;
  throw new CliUsageError(
    "--secret-resolver must be disabled, env, vault, aws-sm, gcp-sm, azure-kv, or cloud.",
  );
}
