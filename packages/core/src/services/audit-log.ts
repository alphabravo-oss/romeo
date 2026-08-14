import type { AuthSubject } from "@romeo/auth";

import {
  assertValidAuditLog,
  type AuditAction,
  type AuditMetadata,
} from "../audit-taxonomy";
import type { AuditLog } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { currentTelemetryMetadata } from "./telemetry-context";

export type { AuditAction, AuditMetadata } from "../audit-taxonomy";

export interface WriteAuditLogInput<A extends AuditAction = AuditAction> {
  subject: AuthSubject;
  action: A;
  resourceType: string;
  resourceId: string;
  outcome?: "failure" | "success";
  metadata?: AuditMetadata<A>;
}

export type PersistedAuditLogInput<A extends AuditAction = AuditAction> = Omit<
  AuditLog,
  "action" | "metadata"
> & {
  action: A;
  metadata: AuditMetadata<A>;
};

export function writeAuditLog<A extends AuditAction>(
  repository: RomeoRepository,
  input: WriteAuditLogInput<A>,
): Promise<void>;
export function writeAuditLog<A extends AuditAction>(
  repository: RomeoRepository,
  input: PersistedAuditLogInput<A>,
): Promise<void>;
export async function writeAuditLog(
  repository: RomeoRepository,
  input: WriteAuditLogInput | PersistedAuditLogInput,
): Promise<void> {
  const log: AuditLog =
    "subject" in input
      ? {
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
          metadata: {
            ...input.metadata,
            ...currentTelemetryMetadata(),
          },
          createdAt: new Date().toISOString(),
        }
      : input;
  assertValidAuditLog(log);
  await repository.createAuditLog(log);
}
