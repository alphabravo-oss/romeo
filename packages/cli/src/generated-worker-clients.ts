import {
  billingEnforceLifecycle,
  billingReconcileEntitlements,
  browserAutomationClaimTask,
  browserAutomationCompleteTask,
  browserAutomationFailTask,
  dataConnectorsList,
  dataConnectorsSync,
  governanceEnforceRetention,
  toolDispatchRequestsClaim,
  toolDispatchRequestsComplete,
  toolDispatchRequestsFail,
  toolDispatchRequestsReadPayload,
  voicesSyncCatalog,
  workflowsList,
  workflowsListRuns,
  workflowsResumeRun,
  type CompleteBrowserAutomationTaskRequest,
} from "@romeo/api-client/generated/sdk";

import type {
  BillingEntitlementReconciliationWorkerClient,
  BillingLifecycleEnforcementWorkerClient,
} from "./billing-worker";
import type {
  BrowserAutomationCompletionResult,
  BrowserAutomationWorkerClient,
} from "./browser-automation-worker";
import type { CommandContext } from "./commands";
import type { DataConnectorSyncWorkerClient } from "./data-connector-worker";
import type {
  RetentionEnforcementWorkerClient,
  RetentionEnforcementWorkerResult,
} from "./retention-worker";
import type { VoiceCatalogSyncWorkerClient } from "./voice-worker";
import type { ToolDispatchWorkerClient } from "./tool-dispatch-worker";
import type {
  WorkerWorkflowRun,
  WorkflowResumeWorkerClient,
} from "./workflow-worker";

export function dataConnectorWorkerClient(
  context: CommandContext,
): DataConnectorSyncWorkerClient {
  const client = context.generatedClient;
  return {
    dataConnectors: {
      list: (workspaceId) =>
        dataConnectorsList({
          client,
          ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
          throwOnError: true,
        }).then(dataEnvelope),
      sync: ({ connectorId }) =>
        dataConnectorsSync({
          body: {},
          client,
          path: { connectorId },
          throwOnError: true,
        }).then(dataEnvelope),
    },
  };
}

export function browserWorkerClient(
  context: CommandContext,
): BrowserAutomationWorkerClient {
  const client = context.generatedClient;
  return {
    workflows: {
      claimBrowserTask: (body = {}) =>
        browserAutomationClaimTask({
          body,
          client,
          throwOnError: true,
        }).then(dataEnvelope),
      completeBrowserTask: ({ jobId, result }) =>
        browserAutomationCompleteTask({
          body: { result: generatedBrowserResult(result) },
          client,
          path: { jobId },
          throwOnError: true,
        }).then(dataEnvelope),
      failBrowserTask: ({ errorCode, jobId }) =>
        browserAutomationFailTask({
          body: { errorCode },
          client,
          path: { jobId },
          throwOnError: true,
        }).then(dataEnvelope),
    },
  };
}

export function retentionWorkerClient(
  context: CommandContext,
): RetentionEnforcementWorkerClient {
  const client = context.generatedClient;
  return {
    governance: {
      enforceRetention: () =>
        governanceEnforceRetention({ client, throwOnError: true })
          .then(dataEnvelope)
          .then(normalizeRetentionResult),
    },
  };
}

export function billingEntitlementWorkerClient(
  context: CommandContext,
): BillingEntitlementReconciliationWorkerClient {
  const client = context.generatedClient;
  return {
    admin: {
      reconcileBillingEntitlements: () =>
        billingReconcileEntitlements({ client, throwOnError: true }).then(
          dataEnvelope,
        ),
    },
  };
}

export function billingLifecycleWorkerClient(
  context: CommandContext,
): BillingLifecycleEnforcementWorkerClient {
  const client = context.generatedClient;
  return {
    admin: {
      enforceBillingLifecycle: () =>
        billingEnforceLifecycle({ client, throwOnError: true }).then(
          dataEnvelope,
        ),
    },
  };
}

export function voiceWorkerClient(
  context: CommandContext,
): VoiceCatalogSyncWorkerClient {
  const client = context.generatedClient;
  return {
    voice: {
      sync: () =>
        voicesSyncCatalog({ client, throwOnError: true }).then(dataEnvelope),
    },
  };
}

export function workflowWorkerClient(
  context: CommandContext,
): WorkflowResumeWorkerClient {
  const client = context.generatedClient;
  return {
    workflows: {
      list: (workspaceId) =>
        workflowsList({
          client,
          ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
          throwOnError: true,
        }).then(dataEnvelope),
      runs: (workflowId) =>
        workflowsListRuns({
          client,
          path: { workflowId },
          throwOnError: true,
        })
          .then(dataEnvelope)
          .then((runs) => runs.map(normalizeWorkflowRun)),
      resumeRun: (workflowRunId) =>
        workflowsResumeRun({
          client,
          path: { workflowRunId },
          throwOnError: true,
        })
          .then(dataEnvelope)
          .then(normalizeWorkflowRun),
    },
  };
}

export function toolWorkerClient(
  context: CommandContext,
): ToolDispatchWorkerClient {
  const client = context.generatedClient;
  return {
    tool: {
      claimDispatchRequest: (body = {}) =>
        toolDispatchRequestsClaim({
          body,
          client,
          throwOnError: true,
        }).then(dataEnvelope),
      readDispatchRequestPayload: ({ jobId }) =>
        toolDispatchRequestsReadPayload({
          client,
          path: { jobId },
          throwOnError: true,
        }).then(dataEnvelope),
      completeDispatchRequest: ({ jobId, response }) =>
        toolDispatchRequestsComplete({
          body: { response },
          client,
          path: { jobId },
          throwOnError: true,
        }).then(dataEnvelope),
      failDispatchRequest: ({ errorCode, jobId }) =>
        toolDispatchRequestsFail({
          body: { errorCode },
          client,
          path: { jobId },
          throwOnError: true,
        }).then(dataEnvelope),
    },
  };
}

function generatedBrowserResult(
  result: BrowserAutomationCompletionResult,
): CompleteBrowserAutomationTaskRequest["result"] {
  return {
    ...(result.artifactCount === undefined
      ? {}
      : { artifactCount: result.artifactCount }),
    ...(result.capturedBytes === undefined
      ? {}
      : { capturedBytes: result.capturedBytes }),
    ...(result.durationMs === undefined
      ? {}
      : { durationMs: result.durationMs }),
    ...(result.finalOrigin === undefined
      ? {}
      : { finalOrigin: result.finalOrigin }),
    ...(result.navigationCount === undefined
      ? {}
      : { navigationCount: result.navigationCount }),
    ...(result.networkDeniedCount === undefined
      ? {}
      : { networkDeniedCount: result.networkDeniedCount }),
    ...(result.outputKeys === undefined
      ? {}
      : { outputKeys: result.outputKeys }),
    ...(result.redactionApplied === undefined
      ? {}
      : { redactionApplied: result.redactionApplied }),
  };
}

function normalizeRetentionResult(input: {
  deletedAuditLogCount: number;
  deletedBrowserAutomationArtifactCount?: number | undefined;
}): RetentionEnforcementWorkerResult {
  return {
    ...input,
    deletedBrowserAutomationArtifactCount:
      input.deletedBrowserAutomationArtifactCount,
  };
}

function normalizeWorkflowRun(input: {
  currentStepId?: string | undefined;
  id: string;
  status: string;
  steps?: WorkerWorkflowRun["steps"] | undefined;
  workflowId: string;
}): WorkerWorkflowRun {
  return {
    ...input,
    currentStepId: input.currentStepId,
    steps: input.steps ?? [],
  };
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}
