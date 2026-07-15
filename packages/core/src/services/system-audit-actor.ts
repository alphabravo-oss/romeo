import { createHash } from "node:crypto";

import type { Scope } from "@romeo/auth";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

export interface SystemAuditActorInput {
  kind: string;
  name: string;
  orgId: string;
  scopes?: Scope[];
}

export async function ensureSystemAuditActor(
  repository: RomeoRepository,
  input: SystemAuditActorInput,
): Promise<User> {
  const organizations = await repository.listOrganizations(input.orgId);
  if (!organizations.some((organization) => organization.id === input.orgId)) {
    throw new Error("System audit actor organization does not exist.");
  }

  const id = systemAuditActorId(input.kind, input.orgId);
  const existing = await repository.getCurrentUser(id);
  if (existing !== undefined) {
    if (existing.orgId === input.orgId) return existing;
    throw new Error("System audit actor belongs to a different organization.");
  }

  const now = new Date().toISOString();
  const user: User = {
    id,
    orgId: input.orgId,
    email: `${id}@system.romeo.local`,
    name: input.name,
    role: "user",
    disabledAt: now,
  };

  try {
    return await repository.createUser(user);
  } catch (error) {
    const raced = await repository.getCurrentUser(id);
    if (raced !== undefined && raced.orgId === input.orgId) return raced;
    throw error;
  }
}

export function systemAuditActorId(kind: string, orgId: string): string {
  const normalizedKind = kind
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  const prefix = `system_${normalizedKind || "audit"}`;
  if (orgId === "org_default") return prefix;
  return `${prefix}_${createHash("sha256").update(orgId).digest("hex").slice(0, 12)}`;
}
