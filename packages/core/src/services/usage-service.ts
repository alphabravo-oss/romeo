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

  async list(
    subject: AuthSubject,
    interval?: UsageInterval,
  ): Promise<UsageEvent[]> {
    assertScope(subject, "usage:read");
    return usageEventsWithinInterval(
      await this.repository.listUsageEvents(subject.orgId),
      interval,
    ).map(publicUsageEvent);
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

  async summary(
    subject: AuthSubject,
    interval?: UsageInterval,
  ): Promise<UsageSummary> {
    assertScope(subject, "usage:read");
    const events = usageEventsWithinInterval(
      await this.repository.listUsageEvents(subject.orgId),
      interval,
    );
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

  async exportEventsCsv(
    subject: AuthSubject,
    interval?: UsageInterval,
  ): Promise<string> {
    assertScope(subject, "usage:read");
    return formatUsageEventsCsv(
      usageEventsWithinInterval(
        await this.repository.listUsageEvents(subject.orgId),
        interval,
      ).map(publicUsageEvent),
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

export interface UsageInterval {
  /** Inclusive ISO-8601 instant. */
  from?: string | undefined;
  /** Exclusive ISO-8601 instant. */
  to?: string | undefined;
}

export function usageEventsWithinInterval(
  events: readonly UsageEvent[],
  interval: UsageInterval | undefined,
): UsageEvent[] {
  if (interval === undefined) return [...events];
  const from =
    interval.from === undefined ? undefined : Date.parse(interval.from);
  const to = interval.to === undefined ? undefined : Date.parse(interval.to);
  if (
    (to !== undefined && !Number.isFinite(to)) ||
    (from !== undefined && !Number.isFinite(from)) ||
    (from !== undefined && to !== undefined && from >= to)
  ) {
    throw new Error(
      "Usage interval must have valid instants with from before to.",
    );
  }
  return events.filter((event) => {
    const createdAt = Date.parse(event.createdAt);
    return (
      Number.isFinite(createdAt) &&
      (from === undefined || createdAt >= from) &&
      (to === undefined || createdAt < to)
    );
  });
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
