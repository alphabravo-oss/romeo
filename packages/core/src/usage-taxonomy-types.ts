import type { UsageEvent } from "./domain/entities";

export type UsageMetricCategory =
  | "activity"
  | "audio"
  | "compute"
  | "cost"
  | "image"
  | "latency"
  | "retrieval"
  | "storage"
  | "text_token"
  | "video";

export type UsageAggregation = "maximum" | "sum";
export type UsageMeasurement =
  | "activity"
  | "estimated"
  | "measured"
  | "reported";
export type UsageOverlapPolicy =
  | "component_of_total"
  | "exclusive"
  | "non_additive";

export interface UsageMetricDefinition {
  category: UsageMetricCategory;
  unit: string;
  sourceTypes: readonly UsageEvent["sourceType"][];
  aggregation: UsageAggregation;
  measurement: UsageMeasurement;
  overlapPolicy: UsageOverlapPolicy;
  billable: boolean;
}

export const defineUsageMetric = <const T extends UsageMetricDefinition>(
  definition: T,
): T => Object.freeze(definition);
