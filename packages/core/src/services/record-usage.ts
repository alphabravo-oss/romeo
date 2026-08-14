import type { AuthSubject } from "@romeo/auth";

import type { UsageEvent } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import {
  type RecordedUsageEventInput,
  type UsageMetricCode,
} from "../usage-taxonomy";
import { assertUsageEventTaxonomy } from "../usage-taxonomy-validation";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { currentTelemetryMetadata } from "./telemetry-context";

export function recordUsage<M extends UsageMetricCode>(
  repository: RomeoRepository,
  event: RecordedUsageEventInput<M>,
  options: { createdAt?: string; id?: string } = {},
): Promise<UsageEvent> {
  const created: UsageEvent = {
    id: options.id ?? createId("usage"),
    createdAt: options.createdAt ?? new Date().toISOString(),
    ...event,
    metadata: { ...event.metadata, ...currentTelemetryMetadata() },
  };
  assertUsageEventTaxonomy(created);
  return repository.createUsageEvent(created);
}

export async function recordSubjectUsage<M extends UsageMetricCode>(
  repository: RomeoRepository,
  subject: AuthSubject,
  event: Omit<RecordedUsageEventInput<M>, "actorId">,
  options: { createdAt?: string; id?: string } = {},
): Promise<UsageEvent> {
  return recordUsage(
    repository,
    {
      ...event,
      actorId: await persistedSubjectActorId(repository, subject, {
        kind: "service_account_usage",
        name: "Service Account Usage Actor",
      }),
    },
    options,
  );
}

export function updateRecordedUsage(
  repository: RomeoRepository,
  event: UsageEvent,
): Promise<UsageEvent> {
  return repository.updateUsageEvent(event);
}
