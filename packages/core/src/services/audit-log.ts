import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { persistedSubjectActorId } from "./subject-persisted-actor";

export interface WriteAuditLogInput {
  subject: AuthSubject;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome?: "failure" | "success";
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(
  repository: RomeoRepository,
  input: WriteAuditLogInput,
): Promise<void> {
  await repository.createAuditLog({
    id: createId("audit"),
    orgId: input.subject.orgId,
    actorId: await persistedSubjectActorId(repository, input.subject, {
      kind: "service_account_audit",
      name: "Service Account Audit Actor",
    }),
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? "success",
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}
