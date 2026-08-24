import type { AuthSubject } from "@romeo/auth";
import type { BaseModel, ProviderTokenUsage } from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { recordSubjectUsage } from "./record-usage";

export interface CompatibilityInferenceMeter {
  fail(): Promise<void>;
  succeed(input?: CompatibilityInferenceSuccess): Promise<void>;
}

export interface CompatibilityInferenceSuccess {
  estimatedOutputTokens?: number;
  model?: BaseModel;
  providerId?: string;
  usage?: ProviderTokenUsage;
}

export async function startCompatibilityInferenceUsage(input: {
  estimatedInputTokens: number;
  model: BaseModel;
  operation: "chat_completions" | "embeddings";
  providerId: string;
  repository: RomeoRepository;
  subject: AuthSubject;
}): Promise<CompatibilityInferenceMeter> {
  const sourceId = createId("compat_run");
  const startedAt = new Date();
  const metadata = {
    compatibilityProtocol: "openai",
    modelId: input.model.id,
    operation: input.operation,
    providerId: input.providerId,
  };
  await input.repository.transaction((repository) =>
    Promise.all([
      recordSubjectUsage(repository, input.subject, {
        orgId: input.subject.orgId,
        sourceType: "run",
        sourceId,
        metric: "run.started",
        quantity: 1,
        unit: "run",
        metadata,
      }),
      recordSubjectUsage(repository, input.subject, {
        orgId: input.subject.orgId,
        sourceType: "run",
        sourceId,
        metric: "llm.input_token.estimated",
        quantity: input.estimatedInputTokens,
        unit: "token",
        metadata: withCost(
          metadata,
          costFor(input.model, "input", input.estimatedInputTokens),
        ),
      }),
    ]),
  );
  let terminalPromise: Promise<void> | undefined;
  const finish = async (
    status: "completed" | "failed",
    success?: CompatibilityInferenceSuccess,
  ) => {
    if (terminalPromise !== undefined) return terminalPromise;
    const effectiveModel = success?.model ?? input.model;
    const effectiveProviderId = success?.providerId ?? input.providerId;
    const terminalMetadata = {
      ...metadata,
      effectiveModelId: effectiveModel.id,
      effectiveProviderId,
    };
    const persist = (repository: RomeoRepository) => {
      const writes: Array<Promise<unknown>> = [
        recordSubjectUsage(repository, input.subject, {
          orgId: input.subject.orgId,
          sourceType: "run",
          sourceId,
          metric: status === "completed" ? "run.completed" : "run.failed",
          quantity: 1,
          unit: "run",
          metadata: terminalMetadata,
        }),
        recordSubjectUsage(repository, input.subject, {
          orgId: input.subject.orgId,
          sourceType: "run",
          sourceId,
          metric: "run.duration",
          quantity: Math.max(0, Date.now() - startedAt.getTime()),
          unit: "millisecond",
          metadata: terminalMetadata,
        }),
        writeAuditLog(repository, {
          action: "model.request",
          metadata: {
            compatibilityProtocol: "openai",
            operation: input.operation,
            providerId: effectiveProviderId,
            sourceId,
          },
          outcome: status === "completed" ? "success" : "failure",
          resourceId: effectiveModel.id,
          resourceType: "model",
          subject: input.subject,
        }),
      ];
      if (
        status === "completed" &&
        success?.estimatedOutputTokens !== undefined &&
        success.estimatedOutputTokens > 0
      )
        writes.push(
          recordSubjectUsage(repository, input.subject, {
            orgId: input.subject.orgId,
            sourceType: "run",
            sourceId,
            metric: "llm.output_token.estimated",
            quantity: success.estimatedOutputTokens,
            unit: "token",
            metadata: withCost(
              terminalMetadata,
              costFor(effectiveModel, "output", success.estimatedOutputTokens),
            ),
          }),
        );
      if (status === "completed" && success?.usage !== undefined)
        writes.push(
          ...providerUsageWrites(
            {
              ...input,
              model: effectiveModel,
              providerId: effectiveProviderId,
              repository,
            },
            sourceId,
            terminalMetadata,
            success.usage,
          ),
        );
      return Promise.all(writes).then(() => undefined);
    };
    const pending = input.repository.transaction(persist);
    terminalPromise = pending;
    try {
      await pending;
    } catch (error) {
      if (terminalPromise === pending) terminalPromise = undefined;
      throw error;
    }
  };
  return {
    fail: () => finish("failed"),
    succeed: (success) => finish("completed", success),
  };
}

function providerUsageWrites(
  input: Parameters<typeof startCompatibilityInferenceUsage>[0],
  sourceId: string,
  metadata: Record<string, unknown>,
  usage: ProviderTokenUsage,
): Array<Promise<unknown>> {
  const usageMetadata = {
    ...metadata,
    usageSource: safeUsageSource(usage.source),
  };
  const writes: Array<Promise<unknown>> = [];
  const tokenInput = (
    quantity: number | undefined,
    costSide?: "input" | "output",
  ) => {
    if (quantity === undefined) return undefined;
    return {
      orgId: input.subject.orgId,
      sourceType: "run" as const,
      sourceId,
      quantity,
      unit: "token" as const,
      metadata:
        costSide === undefined
          ? usageMetadata
          : withCost(usageMetadata, costFor(input.model, costSide, quantity)),
    };
  };
  const inputTokens = tokenInput(usage.inputTokens, "input");
  if (inputTokens !== undefined)
    writes.push(
      recordSubjectUsage(input.repository, input.subject, {
        ...inputTokens,
        metric: "llm.input_token.reported",
      }),
    );
  const cachedInputTokens = tokenInput(usage.cachedInputTokens);
  if (cachedInputTokens !== undefined)
    writes.push(
      recordSubjectUsage(input.repository, input.subject, {
        ...cachedInputTokens,
        metric: "llm.cached_input_token.reported",
      }),
    );
  const outputTokens = tokenInput(usage.outputTokens, "output");
  if (outputTokens !== undefined)
    writes.push(
      recordSubjectUsage(input.repository, input.subject, {
        ...outputTokens,
        metric: "llm.output_token.reported",
      }),
    );
  if (
    usage.reasoningTokens !== undefined &&
    usage.outputTokens !== undefined &&
    usage.reasoningTokens <= usage.outputTokens
  ) {
    const reasoningTokens = tokenInput(usage.reasoningTokens);
    if (reasoningTokens !== undefined)
      writes.push(
        recordSubjectUsage(input.repository, input.subject, {
          ...reasoningTokens,
          metric: "llm.reasoning_token.reported",
        }),
      );
  }
  const totalTokens = tokenInput(usage.totalTokens);
  if (totalTokens !== undefined)
    writes.push(
      recordSubjectUsage(input.repository, input.subject, {
        ...totalTokens,
        metric: "llm.total_token.reported",
      }),
    );
  return writes;
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
  return unitCost === undefined ? undefined : unitCost * tokens;
}

function withCost(
  metadata: Record<string, unknown>,
  estimatedCostUsd: number | undefined,
): Record<string, unknown> {
  return estimatedCostUsd === undefined
    ? metadata
    : { ...metadata, estimatedCostUsd };
}

function safeUsageSource(source: string | undefined): string {
  return [
    "anthropic",
    "ollama",
    "openai-compatible",
    "openai-responses-compatible",
  ].includes(source ?? "")
    ? source!
    : "provider";
}
