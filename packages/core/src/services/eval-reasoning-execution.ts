import type { AuthSubject } from "@romeo/auth";
import {
  getProviderAdapter,
  translateProviderChatParameters,
  type BaseModel,
  type ProviderInstance,
  type ProviderReasoningPolicy,
  type ProviderReasoningPolicyLayers,
  type ProviderTokenUsage,
} from "@romeo/providers";

import type {
  EvalCase,
  EvalReasoningPolicyEvidence,
  EvalRunMetrics,
  EvalRunResult,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { enforceContentPolicyStrings } from "./content-policy-service";
import { scoreEvalCase } from "./eval-case-scoring";
import { providerApiError } from "./provider-api-error";
import type { SecretResolver } from "./secret-resolver";

interface ExecutionOptions {
  providerFetch?: typeof fetch;
  secretResolver?: SecretResolver;
}

export async function executeReasoningAwareEval(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  provider: ProviderInstance;
  model: BaseModel;
  systemPrompt: string;
  cases: EvalCase[];
  reasoningPolicy?: ProviderReasoningPolicyLayers;
  options: ExecutionOptions;
}): Promise<{
  evidence?: EvalReasoningPolicyEvidence;
  metrics: EvalRunMetrics;
  results: Array<Omit<EvalRunResult, "createdAt" | "runId">>;
}> {
  // Translation is deliberately performed before credentials, quota, or adapter calls.
  const translation = translateProviderChatParameters({
    kind: input.provider.type,
    model: input.model,
    provider: input.provider,
    ...(input.reasoningPolicy === undefined
      ? {}
      : { reasoningPolicy: input.reasoningPolicy }),
  });
  const policyResolution = translation.summary.reasoningPolicy;
  const evidence =
    policyResolution === undefined
      ? undefined
      : {
          requested: policyResolution.requested,
          effective: policyResolution.effective,
        };
  const adapter = getProviderAdapter(input.provider.type);
  const apiKey = await resolveProviderApiKey(
    input.provider,
    input.options.secretResolver,
  );
  const startedAt = performance.now();
  const usages: ProviderTokenUsage[] = [];
  const results: Array<Omit<EvalRunResult, "createdAt" | "runId">> = [];
  for (const testCase of input.cases) {
    let output = "";
    let usage: ProviderTokenUsage | undefined;
    try {
      for await (const chunk of adapter.streamChat({
        provider: input.provider,
        model: input.model,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(input.options.providerFetch === undefined
          ? {}
          : { fetchImpl: input.options.providerFetch }),
        ...(input.reasoningPolicy === undefined
          ? {}
          : { reasoningPolicy: input.reasoningPolicy }),
        messages: [
          ...(input.systemPrompt.trim().length === 0
            ? []
            : [{ role: "system" as const, content: input.systemPrompt }]),
          { role: "user", content: testCase.input },
        ],
      })) {
        if (typeof chunk === "string") output += chunk;
        else if (chunk.type === "usage") usage = mergeUsage(usage, chunk.usage);
        // Both raw reasoning and provider-safe summaries are intentionally excluded from
        // persisted output and rubric input.
      }
    } catch (error) {
      throw providerApiError(error, {
        kind: input.provider.type,
        operation: "chat",
      });
    }
    const governed = await enforceContentPolicyStrings(
      input.repository,
      input.subject,
      [output],
    );
    results.push(
      scoreEvalCase(testCase, governed.contents[0]!, input.subject.orgId),
    );
    if (usage !== undefined) usages.push(usage);
  }
  const latencyMs = Math.min(
    86_400_000,
    Math.max(0, Math.round(performance.now() - startedAt)),
  );
  return {
    ...(evidence === undefined ? {} : { evidence }),
    metrics: metricsFor(
      input.model,
      input.provider,
      input.cases.length,
      usages,
      latencyMs,
    ),
    results,
  };
}

function mergeUsage(
  current: ProviderTokenUsage | undefined,
  next: ProviderTokenUsage,
): ProviderTokenUsage {
  const merged = { ...current, ...next };
  if (
    merged.reasoningTokens !== undefined &&
    merged.outputTokens !== undefined &&
    merged.reasoningTokens > merged.outputTokens
  )
    delete merged.reasoningTokens;
  return merged;
}

function metricsFor(
  model: BaseModel,
  provider: ProviderInstance,
  caseCount: number,
  usages: ProviderTokenUsage[],
  latencyMs: number,
): EvalRunMetrics {
  const complete =
    usages.length === caseCount &&
    usages.every(
      (usage) =>
        usage.inputTokens !== undefined && usage.outputTokens !== undefined,
    );
  const coverage = complete
    ? "complete"
    : usages.length > 0
      ? "partial"
      : "none";
  const inputTokens = complete ? sumDefined(usages, "inputTokens") : undefined;
  const outputTokens = complete
    ? sumDefined(usages, "outputTokens")
    : undefined;
  const reasoningTokens =
    complete && usages.every((usage) => usage.reasoningTokens !== undefined)
      ? sumDefined(usages, "reasoningTokens")
      : undefined;
  const estimatedCostUsd =
    inputTokens === undefined ||
    outputTokens === undefined ||
    model.pricing === undefined
      ? undefined
      : model.pricing.inputTokenUsd * inputTokens +
        model.pricing.outputTokenUsd * outputTokens;
  const boundedCost =
    estimatedCostUsd !== undefined &&
    Number.isFinite(estimatedCostUsd) &&
    estimatedCostUsd >= 0 &&
    estimatedCostUsd <= 1_000_000
      ? estimatedCostUsd
      : undefined;
  return {
    latencyMs,
    usage: {
      coverage,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
      ...(usages.length === 0 ? {} : { source: provider.type }),
    },
    costBasis: boundedCost === undefined ? "unavailable" : "reported_tokens",
    ...(boundedCost === undefined ? {} : { estimatedCostUsd: boundedCost }),
  };
}

function sumDefined(
  usages: ProviderTokenUsage[],
  field: "inputTokens" | "outputTokens" | "reasoningTokens",
): number {
  return Math.min(
    2_000_000_000,
    usages.reduce((total, usage) => total + (usage[field] ?? 0), 0),
  );
}

async function resolveProviderApiKey(
  provider: ProviderInstance,
  resolver: SecretResolver | undefined,
): Promise<string | undefined> {
  if (provider.credentialRef === undefined) return undefined;
  const resolution = await resolver?.resolveValue?.(provider.credentialRef);
  return resolution?.available === true ? resolution.value : undefined;
}

export type { ProviderReasoningPolicy };
