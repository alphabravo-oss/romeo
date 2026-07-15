import { createHash } from "node:crypto";

import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ensureSystemAuditActor } from "./system-audit-actor";

export interface PersistedSubjectActorOptions {
  kind: string;
  name: string;
}

export async function persistedSubjectActorId(
  repository: RomeoRepository,
  subject: AuthSubject,
  options: PersistedSubjectActorOptions,
): Promise<string> {
  if (subject.type === "user") return subject.id;
  const actor = await ensureSystemAuditActor(repository, {
    kind: `${options.kind}_${stableSubjectSuffix(subject.id)}`,
    name: options.name,
    orgId: subject.orgId,
  });
  return actor.id;
}

function stableSubjectSuffix(subjectId: string): string {
  return createHash("sha256").update(subjectId).digest("hex").slice(0, 12);
}
