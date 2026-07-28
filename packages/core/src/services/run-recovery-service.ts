import { scopeValues, type Scope } from "@romeo/auth";
import type { ChatMessage, ProviderToolDefinition } from "@romeo/providers";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import type { RunKnowledgeCitation } from "./run-knowledge";

export interface RunExecutionJobPayload {
  runId: string;
  checkpointKey: string;
  assistantOutputStarted: boolean;
  lastEventSequence: number;
  requestId?: string;
  traceId?: string;
  outcome?:
    | "completed"
    | "failed"
    | "waiting_tool_approval"
    | "waiting_tool_dispatch"
    | "output_interrupted";
  workerLease?: unknown;
}

export interface RunExecutionCheckpoint {
  messages: ChatMessage[];
  citations: RunKnowledgeCitation[];
  providerTools: ProviderToolDefinition[];
  principalId: string;
  principalType: "user" | "service_account";
  scopeSnapshot: Scope[];
  assistantContent: string;
  emitRunStarted: boolean;
}

export function runWithStatus(
  run: RunRecord,
  status: RunRecord["status"],
): RunRecord {
  const { completedAt: _completedAt, ...withoutCompletedAt } = run;
  return { ...withoutCompletedAt, status };
}

export function isTerminalRunStatus(status: RunRecord["status"]): boolean {
  return (
    status === "cancelled" || status === "completed" || status === "failed"
  );
}

export function runExecutionJobType(runId: string): string {
  return `run.execution:${runId}`;
}

export function runExecutionCheckpointKey(run: RunRecord): string {
  return `run-execution-checkpoints/${run.orgId}/${run.workspaceId}/${run.id}.0.json`;
}

export function executionJobPayload(
  job: BackgroundJob,
): RunExecutionJobPayload | undefined {
  const payload = job.payload;
  if (
    typeof payload.runId !== "string" ||
    typeof payload.checkpointKey !== "string" ||
    typeof payload.assistantOutputStarted !== "boolean" ||
    typeof payload.lastEventSequence !== "number"
  )
    return undefined;
  return {
    runId: payload.runId,
    checkpointKey: payload.checkpointKey,
    assistantOutputStarted: payload.assistantOutputStarted,
    lastEventSequence: payload.lastEventSequence,
    ...(typeof payload.requestId === "string"
      ? { requestId: payload.requestId }
      : {}),
    ...(typeof payload.traceId === "string"
      ? { traceId: payload.traceId }
      : {}),
    ...(payload.outcome === "completed" ||
    payload.outcome === "failed" ||
    payload.outcome === "waiting_tool_approval" ||
    payload.outcome === "waiting_tool_dispatch" ||
    payload.outcome === "output_interrupted"
      ? { outcome: payload.outcome }
      : {}),
    ...(payload.workerLease === undefined
      ? {}
      : { workerLease: payload.workerLease }),
  };
}

export function runExecutionCheckpoint(
  value: unknown,
): RunExecutionCheckpoint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const checkpoint = value as Record<string, unknown>;
  if (
    !Array.isArray(checkpoint.messages) ||
    !Array.isArray(checkpoint.citations) ||
    !Array.isArray(checkpoint.providerTools) ||
    typeof checkpoint.principalId !== "string" ||
    (checkpoint.principalType !== "user" &&
      checkpoint.principalType !== "service_account") ||
    !Array.isArray(checkpoint.scopeSnapshot) ||
    typeof checkpoint.assistantContent !== "string" ||
    typeof checkpoint.emitRunStarted !== "boolean"
  )
    return undefined;
  const scopeSnapshot = checkpoint.scopeSnapshot.filter(
    (scope): scope is Scope =>
      typeof scope === "string" && scopeValues.includes(scope as Scope),
  );
  return {
    messages: checkpoint.messages as ChatMessage[],
    citations: checkpoint.citations as RunKnowledgeCitation[],
    providerTools: checkpoint.providerTools as ProviderToolDefinition[],
    principalId: checkpoint.principalId,
    principalType: checkpoint.principalType,
    scopeSnapshot,
    assistantContent: checkpoint.assistantContent,
    emitRunStarted: checkpoint.emitRunStarted,
  };
}
