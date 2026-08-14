import type { UsageEvent } from "../domain/entities";
import { USAGE_METRIC_DEFINITIONS } from "../usage-taxonomy";
import { isUsageMetricCode } from "../usage-taxonomy-validation";
import {
  recordedUsageCostUsd,
  selectUsageCostEventIds,
} from "./usage-cost-reconciliation";

const usageCsvColumns = [
  "id",
  "createdAt",
  "actorId",
  "workspaceId",
  "sourceType",
  "sourceId",
  "metric",
  "quantity",
  "unit",
  "providerId",
  "modelId",
  "agentId",
  "estimatedCostUsd",
  "measurement",
  "overlapPolicy",
  "billable",
  "costSelected",
  "reconciledCostUsd",
] as const;

export function formatUsageEventsCsv(events: UsageEvent[]): string {
  const costEventIds = selectUsageCostEventIds(events);
  const rows = events.map((event) => {
    const definition = isUsageMetricCode(event.metric)
      ? USAGE_METRIC_DEFINITIONS[event.metric]
      : undefined;
    return [
      event.id,
      event.createdAt,
      event.actorId,
      event.workspaceId ?? "",
      event.sourceType,
      event.sourceId,
      event.metric,
      event.quantity,
      event.unit,
      stringMetadata(event, "providerId"),
      stringMetadata(event, "modelId"),
      stringMetadata(event, "agentId"),
      numberMetadata(event, "estimatedCostUsd"),
      definition?.measurement ?? "",
      definition?.overlapPolicy ?? "",
      definition === undefined ? "" : String(definition.billable),
      String(costEventIds.has(event.id)),
      costEventIds.has(event.id) ? (recordedUsageCostUsd(event) ?? "") : "",
    ];
  });
  return [usageCsvColumns, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function stringMetadata(event: UsageEvent, key: string): string {
  const value = event.metadata[key];
  return typeof value === "string" ? value : "";
}

function numberMetadata(event: UsageEvent, key: string): number | "" {
  const value = event.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
