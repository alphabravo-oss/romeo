import type { RunEvent } from "@romeo/ai-runtime";
import type { BaseModel, ProviderTokenUsage } from "@romeo/providers";

import type { RunRecord } from "../domain/entities";
import type { RunKnowledgeCitation } from "./run-knowledge";
import type { ProviderRoutePlan } from "./provider-routing";

export function routeServingModel(
  routePlan: ProviderRoutePlan,
  model: BaseModel,
): BaseModel {
  return routePlan.primaryDisabled && routePlan.fallback !== undefined
    ? routePlan.fallback.model
    : model;
}

export function assistantContentFromRunEvents(events: RunEvent[]): string {
  let content = "";
  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (event.type === "message.started") content = "";
    if (event.type === "message.delta") {
      const text = (event.data as { text?: unknown }).text;
      if (typeof text === "string") content += text;
    }
  }
  return content;
}

export function citationsFromRunEvents(
  events: RunEvent[],
): RunKnowledgeCitation[] {
  return events.flatMap((event) => {
    if (event.type !== "retrieval.completed") return [];
    const citations = (event.data as { citations?: unknown }).citations;
    if (!Array.isArray(citations)) return [];
    return citations.flatMap((citation) => {
      const item = citation as Partial<RunKnowledgeCitation>;
      return typeof item.chunkId === "string" &&
        typeof item.documentId === "string" &&
        typeof item.title === "string"
        ? [
            {
              chunkId: item.chunkId,
              documentId: item.documentId,
              title: item.title,
              ...(typeof item.sourceUri === "string"
                ? { sourceUri: item.sourceUri }
                : {}),
              ...optionalCitationField(item, "sourceType"),
              ...optionalCitationField(item, "provider"),
              ...optionalCitationField(item, "retrievedAt"),
              ...optionalCitationField(item, "accessedAt"),
              ...optionalCitationField(item, "publishedAt"),
            },
          ]
        : [];
    });
  });
}

function optionalCitationField(
  citation: Partial<RunKnowledgeCitation>,
  key: keyof RunKnowledgeCitation,
): Record<string, string> {
  const value = citation[key];
  return typeof value === "string" ? { [key]: value } : {};
}

export function providerUsageFromEvent(
  event: RunEvent,
): ProviderTokenUsage | undefined {
  if (event.type !== "run.completed") return undefined;
  return (event.data as { usage?: ProviderTokenUsage }).usage;
}

export function routedRunTarget(
  run: RunRecord,
  model: BaseModel,
  routePlan: ProviderRoutePlan,
  event: RunEvent,
): { model: BaseModel; run: RunRecord } {
  const fallback = (
    event.data as {
      providerFallback?: { toModelId: string; toProviderId: string };
    }
  ).providerFallback;
  if (
    fallback === undefined ||
    routePlan.fallback === undefined ||
    fallback.toModelId !== routePlan.fallback.model.id ||
    fallback.toProviderId !== routePlan.fallback.provider.id
  ) {
    return { model, run };
  }
  return {
    model: routePlan.fallback.model,
    run: {
      ...run,
      modelId: routePlan.fallback.model.id,
      providerId: routePlan.fallback.provider.id,
    },
  };
}
