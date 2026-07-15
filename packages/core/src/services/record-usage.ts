import type { AuthSubject } from "@romeo/auth";

import type { UsageEvent } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { persistedSubjectActorId } from "./subject-persisted-actor";

export function recordUsage(
  repository: RomeoRepository,
  event: Omit<UsageEvent, "id" | "createdAt">,
): Promise<UsageEvent> {
  return repository.createUsageEvent({
    id: createId("usage"),
    createdAt: new Date().toISOString(),
    ...event,
  });
}

export async function recordSubjectUsage(
  repository: RomeoRepository,
  subject: AuthSubject,
  event: Omit<UsageEvent, "id" | "createdAt" | "actorId">,
): Promise<UsageEvent> {
  return recordUsage(repository, {
    ...event,
    actorId: await persistedSubjectActorId(repository, subject, {
      kind: "service_account_usage",
      name: "Service Account Usage Actor",
    }),
  });
}
