import { assertScope, type AuthSubject } from "@romeo/auth";
import {
  UsageMetricCodes,
  type UsageMetricDefinition as PublicUsageMetricDefinition,
} from "@romeo/contracts";

import type {
  UsageAlert,
  UsageEvent,
  UsageSummary,
  UsageSummaryMetric,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { USAGE_METRIC_DEFINITIONS } from "../usage-taxonomy";
import { resetDueQuotaBuckets } from "./quota-resets";
import { createQuotaUsageAlerts } from "./usage-alerts";
import { formatUsageEventsCsv } from "./usage-export";
import {
  recordedUsageCostUsd,
  selectUsageCostEventIds,
} from "./usage-cost-reconciliation";
import { publicUsageEvent } from "./voice-artifact-metadata";

export class UsageService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<UsageEvent[]> {
    assertScope(subject, "usage:read");
    return (await this.repository.listUsageEvents(subject.orgId)).map(
      publicUsageEvent,
    );
  }

  taxonomy(subject: AuthSubject): PublicUsageMetricDefinition[] {
    assertScope(subject, "usage:read");
    return UsageMetricCodes.map((metric) => {
      const definition = USAGE_METRIC_DEFINITIONS[metric];
      return {
        metric,
        ...definition,
        sourceTypes: [...definition.sourceTypes],
      };
    });
  }

  async summary(subject: AuthSubject): Promise<UsageSummary> {
    assertScope(subject, "usage:read");
    const events = await this.repository.listUsageEvents(subject.orgId);
    const costEventIds = selectUsageCostEventIds(events);
    return {
      totals: rollup(
        events,
        (event) => ({
          metric: event.metric,
          unit: event.unit,
        }),
        costEventIds,
      ),
      byActor: rollup(
        events,
        (event) => ({
          actorId: event.actorId,
          metric: event.metric,
          unit: event.unit,
        }),
        costEventIds,
      ),
      byProvider: rollup(
        events.filter((event) => typeof event.metadata.providerId === "string"),
        (event) => ({
          providerId: String(event.metadata.providerId),
          metric: event.metric,
          unit: event.unit,
        }),
        costEventIds,
      ),
    };
  }

  async exportEventsCsv(subject: AuthSubject): Promise<string> {
    assertScope(subject, "usage:read");
    return formatUsageEventsCsv(
      (await this.repository.listUsageEvents(subject.orgId)).map(
        publicUsageEvent,
      ),
    );
  }

  async alerts(subject: AuthSubject): Promise<UsageAlert[]> {
    assertScope(subject, "usage:read");
    const buckets = await resetDueQuotaBuckets(
      this.repository,
      await this.repository.listQuotaBuckets(subject.orgId),
    );
    return createQuotaUsageAlerts(buckets);
  }
}

function rollup<T extends UsageSummaryMetric>(
  events: UsageEvent[],
  keyFor: (event: UsageEvent) => Omit<T, "quantity" | "estimatedCostUsd">,
  costEventIds: ReadonlySet<string>,
): T[] {
  const byKey = new Map<string, T>();
  for (const event of events) {
    const keyFields = keyFor(event);
    const key = JSON.stringify(keyFields);
    const current =
      byKey.get(key) ??
      ({ ...keyFields, quantity: 0, estimatedCostUsd: 0 } as T);
    current.quantity += event.quantity;
    current.estimatedCostUsd += costOf(event, costEventIds);
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((left, right) =>
    left.metric.localeCompare(right.metric),
  );
}

function costOf(event: UsageEvent, costEventIds: ReadonlySet<string>): number {
  if (!costEventIds.has(event.id)) return 0;
  return recordedUsageCostUsd(event) ?? 0;
}
