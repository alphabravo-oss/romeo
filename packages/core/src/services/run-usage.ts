import type { BaseModel, ProviderTokenUsage } from "@romeo/providers";
import type { RunEvent } from "@romeo/ai-runtime";

import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { UsageMetricCode, UsageUnit } from "../usage-taxonomy";
import type { ModelRoutingDecision } from "./model-routing";
import { recordUsage } from "./record-usage";
import { estimateTokens } from "./token-estimate";
import { providerUsageSegmentsFromEvents } from "./run-provider-usage";

export async function recordRunStartedUsage(
  repository: RomeoRepository,
  input: {
    run: RunRecord;
    inputTokens: number;
    model: BaseModel;
    historyMessages?: number;
    historyTruncated?: boolean;
    imageInputCount?: number;
    knowledgeHitsDropped?: number;
    routing?: ModelRoutingDecision;
  },
): Promise<void> {
  const metadata = {
    ...runMetadata(input.run),
    ...(input.routing === undefined
      ? {}
      : {
          routingMode: input.routing.mode,
          routingRequestedModelId: input.routing.requestedModelId,
          routingSelectedModelId: input.routing.selectedModelId,
          routingCandidateCount: input.routing.candidateCount,
        }),
  };
  // The assembler's estimate is billed verbatim so the number that gated the context budget and the
  // number that bills cannot drift.
  const inputTokens = input.inputTokens;
  const writes: Array<Promise<unknown>> = [
    recordUsage(repository, {
      orgId: input.run.orgId,
      workspaceId: input.run.workspaceId,
      actorId: input.run.createdBy,
      sourceType: "run",
      sourceId: input.run.id,
      metric: "run.started",
      quantity: 1,
      unit: "run",
      metadata,
    }),
    recordUsage(repository, {
      orgId: input.run.orgId,
      workspaceId: input.run.workspaceId,
      actorId: input.run.createdBy,
      sourceType: "run",
      sourceId: input.run.id,
      metric: "llm.input_token.estimated",
      quantity: inputTokens,
      unit: "token",
      // Counts only, never message text: usage metadata is a read-wide surface and must not leak chat content.
      metadata: withCost(
        {
          ...metadata,
          ...(input.historyMessages === undefined
            ? {}
            : { historyMessages: input.historyMessages }),
          ...(input.historyTruncated === undefined
            ? {}
            : { historyTruncated: input.historyTruncated }),
          ...(input.knowledgeHitsDropped === undefined
            ? {}
            : { knowledgeHitsDropped: input.knowledgeHitsDropped }),
        },
        costFor(input.model, "input", inputTokens),
      ),
    }),
  ];
  const imageInputCount = input.imageInputCount ?? 0;
  if (imageInputCount > 0)
    writes.push(
      recordUsage(repository, {
        orgId: input.run.orgId,
        workspaceId: input.run.workspaceId,
        actorId: input.run.createdBy,
        sourceType: "run",
        sourceId: input.run.id,
        metric: "image.input",
        quantity: imageInputCount,
        unit: "image",
        metadata,
      }),
    );
  await Promise.all(writes);
}

export async function recordRunTerminalUsage(
  repository: RomeoRepository,
  input: {
    run: RunRecord;
    status: RunRecord["status"];
    assistantContent: string;
    model?: BaseModel;
    providerUsage?: ProviderTokenUsage;
    runEvents?: RunEvent[];
  },
): Promise<void> {
  const metadata = runMetadata(input.run);
  const writes: Array<Promise<unknown>> = [
    recordUsage(repository, {
      orgId: input.run.orgId,
      workspaceId: input.run.workspaceId,
      actorId: input.run.createdBy,
      sourceType: "run" as const,
      sourceId: input.run.id,
      metric: terminalUsageMetric(input.status),
      quantity: 1,
      unit: "run",
      metadata,
    }),
  ];

  if (input.assistantContent.length > 0 && input.model !== undefined) {
    const outputTokens = estimateTokens(input.assistantContent);
    writes.push(
      recordUsage(repository, {
        orgId: input.run.orgId,
        workspaceId: input.run.workspaceId,
        actorId: input.run.createdBy,
        sourceType: "run",
        sourceId: input.run.id,
        metric: "llm.output_token.estimated",
        quantity: outputTokens,
        unit: "token",
        metadata: withCost(
          metadata,
          costFor(input.model, "output", outputTokens),
        ),
      }),
    );
  }

  const usageSegments = providerUsageSegmentsFromEvents(input.runEvents ?? []);
  for (const [usageSegmentIndex, segment] of usageSegments.entries()) {
    const model = await repository.getModel(segment.modelId);
    if (model === undefined) continue;
    const segmentRun = {
      ...input.run,
      modelId: segment.modelId,
      providerId: segment.providerId,
    };
    writes.push(
      ...reportedUsageEvents(
        repository,
        segmentRun,
        model,
        { ...runMetadata(segmentRun), usageSegmentIndex },
        segment.usage,
      ),
    );
  }
  if (
    usageSegments.length === 0 &&
    input.providerUsage !== undefined &&
    input.model !== undefined
  )
    writes.push(
      ...reportedUsageEvents(
        repository,
        input.run,
        input.model,
        metadata,
        input.providerUsage,
      ),
    );

  writes.push(...observabilityUsageEvents(repository, input, metadata));

  await Promise.all(writes);
}

function observabilityUsageEvents(
  repository: RomeoRepository,
  input: Parameters<typeof recordRunTerminalUsage>[1],
  metadata: Record<string, unknown>,
): Array<Promise<unknown>> {
  const events = input.runEvents ?? [];
  const writes: Array<Promise<unknown>> = [];
  const firstDelta = events.find((event) => event.type === "message.delta");
  const deltaEvents = events.filter((event) => event.type === "message.delta");
  const lastDelta = deltaEvents.at(-1);
  if (firstDelta !== undefined) {
    writes.push(
      observabilityUsage(
        repository,
        input.run,
        "run.time_to_first_token",
        millisecondsBetween(input.run.createdAt, firstDelta.createdAt),
        "millisecond",
        metadata,
      ),
    );
  }
  const terminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled",
    );
  if (terminal !== undefined) {
    writes.push(
      observabilityUsage(
        repository,
        input.run,
        "run.duration",
        millisecondsBetween(input.run.createdAt, terminal.createdAt),
        "millisecond",
        metadata,
      ),
    );
  }
  if (
    firstDelta !== undefined &&
    lastDelta !== undefined &&
    input.assistantContent.length > 0
  ) {
    const streamingSeconds = Math.max(
      millisecondsBetween(firstDelta.createdAt, lastDelta.createdAt) / 1000,
      0.001,
    );
    writes.push(
      observabilityUsage(
        repository,
        input.run,
        "run.output_throughput",
        estimateTokens(input.assistantContent) / streamingSeconds,
        "token_per_second",
        metadata,
      ),
    );
  }
  const recoveryCount = events.filter(
    (event) => event.type === "run.continuing",
  ).length;
  if (recoveryCount > 0) {
    writes.push(
      observabilityUsage(
        repository,
        input.run,
        "run.recovery",
        recoveryCount,
        "recovery",
        metadata,
      ),
    );
  }
  if (input.status === "failed") {
    const failed = terminal?.type === "run.failed" ? terminal : undefined;
    const errorCode =
      typeof (failed?.data as { errorCode?: unknown } | undefined)
        ?.errorCode === "string"
        ? (failed!.data as { errorCode: string }).errorCode.slice(0, 100)
        : "provider_run_failed";
    writes.push(
      observabilityUsage(repository, input.run, "provider.error", 1, "error", {
        ...metadata,
        errorCode,
      }),
    );
  }
  return writes;
}

function observabilityUsage<M extends RunObservabilityMetric>(
  repository: RomeoRepository,
  run: RunRecord,
  metric: M,
  quantity: number,
  unit: UsageUnit<M>,
  metadata: Record<string, unknown>,
): Promise<unknown> {
  return recordUsage(repository, {
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    actorId: run.createdBy,
    sourceType: "run",
    sourceId: run.id,
    metric,
    quantity: Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
    unit,
    metadata,
  });
}

type RunObservabilityMetric = Extract<
  UsageMetricCode,
  | "provider.error"
  | "run.duration"
  | "run.output_throughput"
  | "run.recovery"
  | "run.time_to_first_token"
>;

function terminalUsageMetric(
  status: RunRecord["status"],
): "run.cancelled" | "run.completed" | "run.failed" {
  switch (status) {
    case "cancelled":
      return "run.cancelled";
    case "completed":
      return "run.completed";
    case "failed":
      return "run.failed";
    default:
      throw new Error(`Cannot record terminal usage for run status ${status}.`);
  }
}

function millisecondsBetween(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function reportedUsageEvents(
  repository: RomeoRepository,
  run: RunRecord,
  model: BaseModel,
  metadata: Record<string, unknown>,
  usage: ProviderTokenUsage,
): Array<Promise<unknown>> {
  const usageMetadata = {
    ...metadata,
    usageSource: safeUsageSource(usage.source),
  };
  const writes: Array<Promise<unknown>> = [];
  if (usage.inputTokens !== undefined)
    writes.push(
      recordTokenUsage(
        repository,
        run,
        model,
        usageMetadata,
        "input",
        usage.inputTokens,
        "llm.input_token.reported",
      ),
    );
  if (usage.cachedInputTokens !== undefined)
    writes.push(
      recordUsage(repository, {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        actorId: run.createdBy,
        sourceType: "run",
        sourceId: run.id,
        metric: "llm.cached_input_token.reported",
        quantity: usage.cachedInputTokens,
        unit: "token",
        metadata: usageMetadata,
      }),
    );
  if (usage.outputTokens !== undefined)
    writes.push(
      recordTokenUsage(
        repository,
        run,
        model,
        usageMetadata,
        "output",
        usage.outputTokens,
        "llm.output_token.reported",
      ),
    );
  if (
    usage.reasoningTokens !== undefined &&
    usage.outputTokens !== undefined &&
    usage.reasoningTokens <= usage.outputTokens
  )
    writes.push(
      recordUsage(repository, {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        actorId: run.createdBy,
        sourceType: "run",
        sourceId: run.id,
        metric: "llm.reasoning_token.reported",
        quantity: usage.reasoningTokens,
        unit: "token",
        metadata: {
          ...usageMetadata,
          // Current reporting dialects include reasoning in outputTokens. This
          // component cost is useful reconciliation evidence but deliberately
          // does not participate in additive cost rollups.
          costIncludedIn: "llm.output_token.reported",
          ...optionalReasoningComponentCost(model, usage.reasoningTokens),
        },
      }),
    );
  if (usage.totalTokens !== undefined) {
    writes.push(
      recordUsage(repository, {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        actorId: run.createdBy,
        sourceType: "run",
        sourceId: run.id,
        metric: "llm.total_token.reported",
        quantity: usage.totalTokens,
        unit: "token",
        metadata: usageMetadata,
      }),
    );
  }
  return writes;
}

const trustedUsageSources = new Set([
  "anthropic",
  "ollama",
  "openai-compatible",
  "openai-responses-compatible",
]);

function safeUsageSource(source: string | undefined): string {
  return source !== undefined && trustedUsageSources.has(source)
    ? source
    : "provider";
}

function optionalReasoningComponentCost(
  model: BaseModel,
  reasoningTokens: number,
): { estimatedComponentCostUsd: number } | Record<string, never> {
  const estimatedComponentCostUsd = costFor(model, "output", reasoningTokens);
  return estimatedComponentCostUsd === undefined
    ? {}
    : { estimatedComponentCostUsd };
}

function recordTokenUsage(
  repository: RomeoRepository,
  run: RunRecord,
  model: BaseModel,
  metadata: Record<string, unknown>,
  side: "input" | "output",
  tokens: number,
  metric: "llm.input_token.reported" | "llm.output_token.reported",
): Promise<unknown> {
  return recordUsage(repository, {
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    actorId: run.createdBy,
    sourceType: "run",
    sourceId: run.id,
    metric,
    quantity: tokens,
    unit: "token",
    metadata: withCost(metadata, costFor(model, side, tokens)),
  });
}

function runMetadata(run: RunRecord): Record<string, unknown> {
  return {
    providerId: run.providerId,
    modelId: run.modelId,
    agentId: run.agentId,
    agentVersionId: run.agentVersionId,
  };
}

function costFor(
  model: BaseModel,
  side: "input" | "output",
  tokens: number,
): number | undefined {
  const unitCost =
    side === "input"
      ? model.pricing?.inputTokenUsd
      : model.pricing?.outputTokenUsd;
  if (unitCost === undefined) return undefined;
  return unitCost * tokens;
}

function withCost(
  metadata: Record<string, unknown>,
  estimatedCostUsd: number | undefined,
): Record<string, unknown> {
  if (estimatedCostUsd === undefined) return metadata;
  return { ...metadata, estimatedCostUsd };
}
