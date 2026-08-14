import {
  CapabilityFlagVersionConflictError,
  type ListOrganizationCapabilityFlagHistoryInput,
  type ListOrganizationCapabilityFlagsInput,
  type OrganizationCapabilityFlag,
  type ReplaceOrganizationCapabilityFlagInput,
} from "@romeo/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { organizationCapabilityFlags } from "./schema";

export class PgCapabilityFlagRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listActiveOrganizationCapabilityFlags(
    input: ListOrganizationCapabilityFlagsInput,
  ): Promise<OrganizationCapabilityFlag[]> {
    if (input.flagIds?.length === 0) return [];
    const rows = await this.db
      .select()
      .from(organizationCapabilityFlags)
      .where(
        and(
          eq(organizationCapabilityFlags.orgId, input.orgId),
          isNull(organizationCapabilityFlags.revokedAt),
          ...(input.flagIds === undefined
            ? []
            : [inArray(organizationCapabilityFlags.flagId, input.flagIds)]),
        ),
      )
      .orderBy(asc(organizationCapabilityFlags.flagId));
    return rows.map(toFlag);
  }

  async listOrganizationCapabilityFlagHistory(
    input: ListOrganizationCapabilityFlagHistoryInput,
  ): Promise<OrganizationCapabilityFlag[]> {
    if (input.limit <= 0) return [];
    const rows = await this.db
      .select()
      .from(organizationCapabilityFlags)
      .where(
        and(
          eq(organizationCapabilityFlags.orgId, input.orgId),
          eq(organizationCapabilityFlags.flagId, input.flagId),
        ),
      )
      .orderBy(desc(organizationCapabilityFlags.version))
      .limit(input.limit);
    return rows.map(toFlag);
  }

  async replaceOrganizationCapabilityFlag(
    input: ReplaceOrganizationCapabilityFlagInput,
  ): Promise<OrganizationCapabilityFlag> {
    return this.db.transaction(async (transaction) => {
      const db = transaction as unknown as RomeoDatabase;
      const candidate = input.flag;
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${candidate.orgId}\u001f${candidate.flagId}`}, 0))`,
      );
      const [currentRow] = await db
        .select()
        .from(organizationCapabilityFlags)
        .where(
          and(
            eq(organizationCapabilityFlags.orgId, candidate.orgId),
            eq(organizationCapabilityFlags.flagId, candidate.flagId),
            isNull(organizationCapabilityFlags.revokedAt),
          ),
        )
        .limit(1);
      const current = currentRow === undefined ? undefined : toFlag(currentRow);
      if (current !== undefined && equivalentFlag(current, candidate))
        return current;
      const expectsAbsent =
        input.expectedVersion === undefined || input.expectedVersion === 0;
      if (
        !(
          input.expectedVersion === current?.version ||
          (expectsAbsent && current === undefined)
        )
      )
        throw new CapabilityFlagVersionConflictError(
          input.expectedVersion,
          current?.version,
        );
      if (currentRow !== undefined)
        await db
          .update(organizationCapabilityFlags)
          .set({ revokedAt: new Date(candidate.createdAt) })
          .where(
            and(
              eq(organizationCapabilityFlags.id, currentRow.id),
              isNull(organizationCapabilityFlags.revokedAt),
            ),
          );
      const flag: OrganizationCapabilityFlag = {
        ...candidate,
        version: (current?.version ?? 0) + 1,
        ...(current === undefined ? {} : { supersedesId: current.id }),
      };
      const [inserted] = await db
        .insert(organizationCapabilityFlags)
        .values({
          ...flag,
          createdAt: new Date(flag.createdAt),
          revokedAt: null,
        })
        .returning();
      if (inserted === undefined)
        throw new Error("Capability flag insert returned no record.");
      return toFlag(inserted);
    });
  }
}

function equivalentFlag(
  current: OrganizationCapabilityFlag,
  candidate: ReplaceOrganizationCapabilityFlagInput["flag"],
): boolean {
  return (
    current.state === candidate.state &&
    JSON.stringify(current.allowlistedSubjects) ===
      JSON.stringify(candidate.allowlistedSubjects)
  );
}

function toFlag(
  row: typeof organizationCapabilityFlags.$inferSelect,
): OrganizationCapabilityFlag {
  return {
    id: row.id,
    orgId: row.orgId,
    flagId: row.flagId as OrganizationCapabilityFlag["flagId"],
    state: row.state as OrganizationCapabilityFlag["state"],
    allowlistedSubjects: row.allowlistedSubjects,
    version: row.version,
    ...(row.supersedesId === null ? {} : { supersedesId: row.supersedesId }),
    actorId: row.actorId,
    reason: row.reason,
    ...(row.revokedAt === null
      ? {}
      : { revokedAt: row.revokedAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
  };
}
