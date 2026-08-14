import type { UsageEvent } from "../domain/entities";

interface CostCandidate {
  event: UsageEvent;
  group: string;
  priority: number;
}

/**
 * Selects one cost-bearing observation per run/input-output side or image.
 * Provider-reported token counts supersede estimates; an explicit micro-USD
 * image event supersedes legacy cost metadata on the image-count event.
 */
export function selectUsageCostEventIds(
  events: readonly UsageEvent[],
): ReadonlySet<string> {
  const candidateIds = new Set<string>();
  const preferred = new Map<string, CostCandidate>();
  for (const event of events) {
    const candidate = costCandidate(event);
    if (candidate === undefined) continue;
    candidateIds.add(event.id);
    const current = preferred.get(candidate.group);
    if (current === undefined || compareCandidate(candidate, current) > 0)
      preferred.set(candidate.group, candidate);
  }
  const selected = new Set(
    events
      .filter(
        (event) =>
          !candidateIds.has(event.id) &&
          recordedUsageCostUsd(event) !== undefined,
      )
      .map((event) => event.id),
  );
  for (const candidate of preferred.values()) selected.add(candidate.event.id);
  return selected;
}

export function recordedUsageCostUsd(event: UsageEvent): number | undefined {
  if (event.metric === "image.cost.micro_usd")
    return event.quantity / 1_000_000;
  const value = event.metadata.estimatedCostUsd;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function isPriceableTokenUsageMetric(metric: string): boolean {
  return (
    metric === "llm.input_token.estimated" ||
    metric === "llm.input_token.reported" ||
    metric === "llm.output_token.estimated" ||
    metric === "llm.output_token.reported"
  );
}

function costCandidate(event: UsageEvent): CostCandidate | undefined {
  const prefix = `${event.orgId}:${event.sourceType}:${event.sourceId}`;
  const tokenSegment = usageSegmentIndex(event);
  switch (event.metric) {
    case "llm.input_token.estimated":
      return { event, group: `${prefix}:token:input:0`, priority: 1 };
    case "llm.input_token.reported":
      return {
        event,
        group: `${prefix}:token:input:${tokenSegment}`,
        priority: 2,
      };
    case "llm.output_token.estimated":
      return { event, group: `${prefix}:token:output:0`, priority: 1 };
    case "llm.output_token.reported":
      return {
        event,
        group: `${prefix}:token:output:${tokenSegment}`,
        priority: 2,
      };
    case "image.generated":
      return hasRecordedCost(event)
        ? { event, group: `${prefix}:image`, priority: 1 }
        : undefined;
    case "image.cost.micro_usd":
      return { event, group: `${prefix}:image`, priority: 2 };
    default:
      return undefined;
  }
}

function usageSegmentIndex(event: UsageEvent): number {
  const value = event.metadata.usageSegmentIndex;
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : 0;
}

function compareCandidate(left: CostCandidate, right: CostCandidate): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return `${left.event.createdAt}:${left.event.id}`.localeCompare(
    `${right.event.createdAt}:${right.event.id}`,
  );
}

function hasRecordedCost(event: UsageEvent): boolean {
  return recordedUsageCostUsd(event) !== undefined;
}
