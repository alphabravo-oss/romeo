import type {
  CapabilityAssignment,
  CapabilityAssignmentScopeType,
  CapabilityAssignmentState,
  ListActiveCapabilityAssignmentsInput,
  ListCapabilityAssignmentHistoryInput,
  ReplaceCapabilityAssignmentInput,
} from "@romeo/core";
import { CapabilityAssignmentVersionConflictError } from "@romeo/core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  agentModels,
  capabilityAssignments,
  groups,
  users,
  workspaces,
} from "./schema";

export class PgCapabilityAssignmentRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listActiveCapabilityAssignments(
    input: ListActiveCapabilityAssignmentsInput,
  ): Promise<CapabilityAssignment[]> {
    if (input.scopes.length === 0 || input.capabilityIds.length === 0)
      return [];
    const at = new Date(input.at);
    const scopeFilter = or(
      ...input.scopes.map((scope) =>
        and(
          eq(capabilityAssignments.scopeType, scope.scopeType),
          eq(capabilityAssignments.scopeId, scope.scopeId),
        ),
      ),
    );
    const rows = await this.db
      .select()
      .from(capabilityAssignments)
      .where(
        and(
          eq(capabilityAssignments.orgId, input.orgId),
          scopeFilter,
          inArray(capabilityAssignments.capabilityId, input.capabilityIds),
          isNull(capabilityAssignments.revokedAt),
          lte(capabilityAssignments.effectiveAt, at),
          or(
            isNull(capabilityAssignments.expiresAt),
            gt(capabilityAssignments.expiresAt, at),
          ),
        ),
      )
      .orderBy(
        asc(capabilityAssignments.scopeType),
        asc(capabilityAssignments.scopeId),
        asc(capabilityAssignments.capabilityId),
      );
    return rows.map(toCapabilityAssignment);
  }

  async listCapabilityAssignmentHistory(
    input: ListCapabilityAssignmentHistoryInput,
  ): Promise<CapabilityAssignment[]> {
    if (input.limit <= 0) return [];
    const rows = await this.db
      .select()
      .from(capabilityAssignments)
      .where(
        and(
          eq(capabilityAssignments.orgId, input.orgId),
          eq(capabilityAssignments.scopeType, input.scope.scopeType),
          eq(capabilityAssignments.scopeId, input.scope.scopeId),
          eq(capabilityAssignments.capabilityId, input.capabilityId),
        ),
      )
      .orderBy(desc(capabilityAssignments.version))
      .limit(input.limit);
    return rows.map(toCapabilityAssignment);
  }

  async replaceCapabilityAssignment(
    input: ReplaceCapabilityAssignmentInput,
  ): Promise<CapabilityAssignment> {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as RomeoDatabase;
      const candidate = input.assignment;
      await this.validateScope(db, candidate);
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${assignmentLockKey(candidate)}, 0))`,
      );

      const [currentRow] = await db
        .select()
        .from(capabilityAssignments)
        .where(
          and(
            eq(capabilityAssignments.orgId, candidate.orgId),
            eq(capabilityAssignments.scopeType, candidate.scopeType),
            eq(capabilityAssignments.scopeId, candidate.scopeId),
            eq(capabilityAssignments.capabilityId, candidate.capabilityId),
            isNull(capabilityAssignments.revokedAt),
          ),
        )
        .limit(1);
      const currentVersion = currentRow?.version;
      const currentExpired =
        currentRow?.expiresAt !== null &&
        currentRow?.expiresAt !== undefined &&
        currentRow.expiresAt <= new Date(candidate.createdAt);
      const expectsAbsent =
        input.expectedVersion === undefined || input.expectedVersion === 0;
      if (
        !(
          input.expectedVersion === currentVersion ||
          (expectsAbsent && (currentRow === undefined || currentExpired))
        )
      ) {
        throw new CapabilityAssignmentVersionConflictError(
          input.expectedVersion,
          currentVersion,
        );
      }

      if (currentRow !== undefined) {
        const [revoked] = await db
          .update(capabilityAssignments)
          .set({ revokedAt: new Date(candidate.createdAt) })
          .where(
            and(
              eq(capabilityAssignments.id, currentRow.id),
              isNull(capabilityAssignments.revokedAt),
            ),
          )
          .returning({ id: capabilityAssignments.id });
        if (revoked === undefined) {
          throw new CapabilityAssignmentVersionConflictError(
            input.expectedVersion,
            currentVersion,
          );
        }
      }

      const assignment: CapabilityAssignment = {
        ...candidate,
        version: (currentVersion ?? 0) + 1,
        ...(currentRow === undefined ? {} : { supersedesId: currentRow.id }),
      };
      const [inserted] = await db
        .insert(capabilityAssignments)
        .values(toCapabilityAssignmentInsert(assignment))
        .returning();
      if (inserted === undefined) {
        throw new Error("Capability assignment insert returned no record.");
      }
      return toCapabilityAssignment(inserted);
    });
  }

  private async validateScope(
    db: RomeoDatabase,
    assignment: ReplaceCapabilityAssignmentInput["assignment"],
  ): Promise<void> {
    if (assignment.scopeType === "organization") {
      if (assignment.scopeId !== assignment.orgId) {
        throw new Error(
          "Organization capability assignment scope must match its organization.",
        );
      }
      return;
    }
    const scopeTable =
      assignment.scopeType === "workspace"
        ? workspaces
        : assignment.scopeType === "agent"
          ? agentModels
          : assignment.scopeType === "group"
            ? groups
            : users;
    const [scope] = await db
      .select({ id: scopeTable.id })
      .from(scopeTable)
      .where(
        and(
          eq(scopeTable.id, assignment.scopeId),
          eq(scopeTable.orgId, assignment.orgId),
        ),
      )
      .limit(1);
    if (scope === undefined) {
      throw new Error(
        assignment.scopeType === "workspace"
          ? "Workspace capability assignment scope does not belong to its organization."
          : "Capability assignment scope does not belong to its organization.",
      );
    }
  }
}

function assignmentLockKey(
  assignment: ReplaceCapabilityAssignmentInput["assignment"],
): string {
  return [
    assignment.orgId,
    assignment.scopeType,
    assignment.scopeId,
    assignment.capabilityId,
  ].join("\u001f");
}

export function toCapabilityAssignment(
  row: typeof capabilityAssignments.$inferSelect,
): CapabilityAssignment {
  return {
    id: row.id,
    orgId: row.orgId,
    scopeType: asScopeType(row.scopeType),
    scopeId: row.scopeId,
    capabilityId: row.capabilityId,
    state: asAssignmentState(row.state),
    configuration: asConfiguration(row.configuration),
    version: row.version,
    ...(row.supersedesId === null ? {} : { supersedesId: row.supersedesId }),
    actorId: row.actorId,
    reason: row.reason,
    effectiveAt: row.effectiveAt.toISOString(),
    ...(row.expiresAt === null
      ? {}
      : { expiresAt: row.expiresAt.toISOString() }),
    ...(row.revokedAt === null
      ? {}
      : { revokedAt: row.revokedAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
  };
}

function toCapabilityAssignmentInsert(
  assignment: CapabilityAssignment,
): typeof capabilityAssignments.$inferInsert {
  return {
    id: assignment.id,
    orgId: assignment.orgId,
    scopeType: assignment.scopeType,
    scopeId: assignment.scopeId,
    capabilityId: assignment.capabilityId,
    state: assignment.state,
    configuration: assignment.configuration,
    version: assignment.version,
    supersedesId: assignment.supersedesId ?? null,
    actorId: assignment.actorId,
    reason: assignment.reason,
    effectiveAt: new Date(assignment.effectiveAt),
    expiresAt:
      assignment.expiresAt === undefined
        ? null
        : new Date(assignment.expiresAt),
    revokedAt:
      assignment.revokedAt === undefined
        ? null
        : new Date(assignment.revokedAt),
    createdAt: new Date(assignment.createdAt),
  };
}

function asScopeType(value: string): CapabilityAssignmentScopeType {
  if (
    value === "organization" ||
    value === "workspace" ||
    value === "agent" ||
    value === "group" ||
    value === "user"
  )
    return value;
  throw new Error(`Invalid stored capability assignment scope: ${value}`);
}

function asAssignmentState(value: string): CapabilityAssignmentState {
  if (
    value === "disabled" ||
    value === "enabled" ||
    value === "inherit" ||
    value === "required"
  )
    return value;
  throw new Error(`Invalid stored capability assignment state: ${value}`);
}

function asConfiguration(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Invalid stored capability assignment configuration.");
}
