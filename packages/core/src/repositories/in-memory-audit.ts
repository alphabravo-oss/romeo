import type {
  AuditLogQueryFilter,
  AuditLogQueryResult,
  QueryAuditLogsInput,
} from "../domain/audit-query";
import type { AuditLog } from "../domain/entities";
import { assertValidAuditLog } from "../audit-taxonomy";
import {
  classifyAuditAction,
  isAuditNoise,
} from "../services/audit-classification";
import { append } from "./collection-helpers";
import { InMemoryContentRepository } from "./in-memory-content";

export abstract class InMemoryAuditRepository extends InMemoryContentRepository {
  async listAuditLogs(orgId: string): Promise<AuditLog[]> {
    return this.data.auditLogs
      .filter((log) => log.orgId === orgId)
      .sort((left, right) => {
        const createdAt = right.createdAt.localeCompare(left.createdAt);
        return createdAt === 0 ? left.id.localeCompare(right.id) : createdAt;
      });
  }

  async queryAuditLogs(
    input: QueryAuditLogsInput,
  ): Promise<AuditLogQueryResult> {
    const limit = normalizedAuditQueryLimit(input.limit);
    const matching = this.data.auditLogs
      .filter((log) => log.orgId === input.orgId)
      .filter((log) => matchesAuditFilter(log, input.filter, input.search))
      .filter((log) => afterPosition(log, input))
      .sort(compareAuditLogs(input.sort.direction));
    return {
      hasMore: matching.length > limit,
      items: matching.slice(0, limit),
    };
  }

  async createAuditLog(log: AuditLog): Promise<AuditLog> {
    assertValidAuditLog(log);
    return append(this.data.auditLogs, log);
  }

  async deleteAuditLogsBefore(orgId: string, before: string): Promise<number> {
    const initialCount = this.data.auditLogs.length;
    this.data.auditLogs = this.data.auditLogs.filter(
      (log) => log.orgId !== orgId || log.createdAt >= before,
    );
    return initialCount - this.data.auditLogs.length;
  }
}

function normalizedAuditQueryLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, 200);
}

function matchesAuditFilter(
  log: AuditLog,
  filter: AuditLogQueryFilter,
  search: string | undefined,
): boolean {
  if (filter.action !== undefined && log.action !== filter.action) return false;
  if (filter.actorId !== undefined && log.actorId !== filter.actorId)
    return false;
  if (
    filter.category !== undefined &&
    classifyAuditAction(log.action) !== filter.category
  )
    return false;
  if (filter.from !== undefined && log.createdAt < filter.from) return false;
  if (filter.outcome !== undefined && log.outcome !== filter.outcome)
    return false;
  if (filter.resourceId !== undefined && log.resourceId !== filter.resourceId)
    return false;
  if (
    filter.resourceType !== undefined &&
    log.resourceType !== filter.resourceType
  )
    return false;
  if (filter.to !== undefined && log.createdAt > filter.to) return false;
  if (
    filter.includeNoise !== true &&
    filter.action === undefined &&
    filter.category !== "system" &&
    isAuditNoise(log)
  )
    return false;
  if (search !== undefined) {
    const query = search.toLocaleLowerCase();
    const haystack =
      `${log.action} ${log.actorId} ${log.resourceType} ${log.resourceId}`.toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function afterPosition(log: AuditLog, input: QueryAuditLogsInput): boolean {
  if (input.position === undefined) return true;
  const createdAtComparison = log.createdAt.localeCompare(
    input.position.createdAt,
  );
  if (input.sort.direction === "asc")
    return (
      createdAtComparison > 0 ||
      (createdAtComparison === 0 && log.id > input.position.id)
    );
  return (
    createdAtComparison < 0 ||
    (createdAtComparison === 0 && log.id < input.position.id)
  );
}

function compareAuditLogs(direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  return (left: AuditLog, right: AuditLog): number => {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    if (createdAt !== 0) return createdAt * multiplier;
    return left.id.localeCompare(right.id) * multiplier;
  };
}
