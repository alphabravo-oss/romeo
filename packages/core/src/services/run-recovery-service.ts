import { scopeValues, type Scope } from "@romeo/auth";
import type {
  ChatMessage,
  ProviderReasoningParameters,
  ProviderReasoningPolicyLayers,
  ProviderSampling,
  ProviderStructuredOutput,
  ProviderToolDefinition,
} from "@romeo/providers";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import type { RunKnowledgeCitation } from "./run-knowledge";
import { reasoningPolicyFromUnknown } from "./run-reasoning-policy";

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
  reasoning?: ProviderReasoningParameters;
  reasoningPolicy?: ProviderReasoningPolicyLayers;
  sampling?: ProviderSampling;
  structuredOutput?: ProviderStructuredOutput;
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
  const sampling = providerSampling(checkpoint.sampling);
  const reasoning = providerReasoning(checkpoint.reasoning);
  const reasoningPolicy = providerReasoningPolicyLayers(
    checkpoint.reasoningPolicy,
  );
  const structuredOutput = providerStructuredOutput(
    checkpoint.structuredOutput,
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
    ...(sampling === undefined ? {} : { sampling }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
  };
}

function providerSampling(value: unknown): ProviderSampling | undefined {
  const record = objectRecord(value);
  if (record === undefined) return undefined;
  const sampling: ProviderSampling = {
    ...(finiteNumber(record.temperature)
      ? { temperature: record.temperature }
      : {}),
    ...(finiteNumber(record.topP) ? { topP: record.topP } : {}),
    ...(finiteNumber(record.maxTokens) ? { maxTokens: record.maxTokens } : {}),
  };
  return Object.keys(sampling).length === 0 ? undefined : sampling;
}

function providerReasoning(
  value: unknown,
): ProviderReasoningParameters | undefined {
  const record = objectRecord(value);
  if (record === undefined) return undefined;
  const reasoning: ProviderReasoningParameters = {
    ...(record.effort === "low" ||
    record.effort === "medium" ||
    record.effort === "high"
      ? { effort: record.effort }
      : {}),
    ...(record.summary === "auto" ||
    record.summary === "concise" ||
    record.summary === "detailed"
      ? { summary: record.summary }
      : {}),
  };
  return Object.keys(reasoning).length === 0 ? undefined : reasoning;
}

function providerReasoningPolicyLayers(
  value: unknown,
): ProviderReasoningPolicyLayers | undefined {
  const layers = objectRecord(value);
  if (layers === undefined) return undefined;
  const organizationMaximum = reasoningPolicyFromUnknown(
    layers.organizationMaximum,
  );
  const agentDefault = reasoningPolicyFromUnknown(layers.agentDefault);
  const runRequest = reasoningPolicyFromUnknown(layers.runRequest);
  const parsed: ProviderReasoningPolicyLayers = {
    ...(organizationMaximum === undefined ? {} : { organizationMaximum }),
    ...(agentDefault === undefined ? {} : { agentDefault }),
    ...(runRequest === undefined ? {} : { runRequest }),
  };
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

function providerStructuredOutput(
  value: unknown,
): ProviderStructuredOutput | undefined {
  const record = objectRecord(value);
  if (record?.type === "json_object") return { type: "json_object" };
  const schema = objectRecord(record?.schema);
  if (
    record?.type !== "json_schema" ||
    typeof record.name !== "string" ||
    schema === undefined ||
    (record.strict !== undefined && typeof record.strict !== "boolean")
  ) {
    return undefined;
  }
  return {
    type: "json_schema",
    name: record.name,
    schema,
    ...(record.strict === undefined ? {} : { strict: record.strict }),
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
