import { assertScope, type AuthSubject } from "@romeo/auth";

import type { AuditLog } from "../domain/entities";
import type {
  AuditLogQueryFilter,
  AuditLogQueryPosition,
} from "../domain/audit-query";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import {
  auditCategories,
  classifyAuditAction,
  isAuditNoise,
  type AuditCategory,
} from "./audit-classification";
import {
  createPageCursorCodec,
  InvalidPageCursorError,
  type PageCursorCodec,
} from "./page-cursor";

const defaultAuditCursorSecret = "romeo-development-audit-cursor-secret-v1";
const auditTableMaxLimit = 200;

export class AuditService {
  private readonly pageCursor: PageCursorCodec;

  constructor(
    private readonly repository: RomeoRepository,
    options: { cursorSecrets?: readonly [string, ...string[]] } = {},
  ) {
    this.pageCursor = createPageCursorCodec({
      secrets: options.cursorSecrets ?? [defaultAuditCursorSecret],
      resource: "audit_logs",
      maxAgeSeconds: 24 * 60 * 60,
    });
  }

  async list(
    subject: AuthSubject,
    filter: AuditLogFilter = {},
  ): Promise<AuditLog[]> {
    assertScope(subject, "audit:read");
    const logs = await this.repository.listAuditLogs(subject.orgId);
    return filterAuditLogs(logs, filter);
  }

  async listPage(
    subject: AuthSubject,
    options: AuditLogPageOptions = {},
  ): Promise<AuditLogPage> {
    const logs = await this.list(subject, options.filter ?? {});
    const limit = normalizeLimit(options.limit);
    const startIndex =
      options.cursor !== undefined ? indexAfterCursor(logs, options.cursor) : 0;
    const slice = logs.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < logs.length;
    const last = slice[slice.length - 1];
    if (hasMore && last !== undefined) {
      return { data: slice, nextCursor: encodeCursor(last) };
    }
    return { data: slice };
  }

  async exportCsv(
    subject: AuthSubject,
    filter: AuditLogFilter = {},
  ): Promise<string> {
    const logs = await this.list(subject, filter);
    const rows = [
      [
        "id",
        "createdAt",
        "actorId",
        "action",
        "category",
        "resourceType",
        "resourceId",
        "outcome",
        "metadataKeys",
      ],
    ];
    for (const log of logs) {
      rows.push([
        log.id,
        log.createdAt,
        log.actorId,
        log.action,
        classifyAuditAction(log.action),
        log.resourceType,
        log.resourceId,
        log.outcome,
        Object.keys(log.metadata).sort().join("|"),
      ]);
    }
    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
  }

  async queryTable(
    subject: AuthSubject,
    request: AuditTableQueryRequest,
  ): Promise<AuditTablePage> {
    assertScope(subject, "audit:read");
    const normalized = normalizeAuditTableQuery(request);
    const cursorContext = {
      filter: {
        orgId: subject.orgId,
        filter: normalized.filter,
        ...(normalized.search === undefined
          ? {}
          : { search: normalized.search }),
      },
      sort: normalized.sort,
    };
    let position: AuditLogQueryPosition | undefined;
    if (request.cursor !== undefined) {
      try {
        position = this.pageCursor.decode(
          request.cursor,
          cursorContext,
          auditCursorPosition,
        );
      } catch (error) {
        if (error instanceof InvalidPageCursorError)
          throw new ApiError(
            error.code,
            "Page cursor is invalid or expired.",
            400,
          );
        throw error;
      }
    }
    const result = await this.repository.queryAuditLogs({
      filter: normalized.filter,
      limit: normalized.limit,
      orgId: subject.orgId,
      ...(position === undefined ? {} : { position }),
      ...(normalized.search === undefined ? {} : { search: normalized.search }),
      sort: normalized.sort,
    });
    const last = result.items[result.items.length - 1];
    const nextCursor =
      result.hasMore && last !== undefined
        ? this.pageCursor.encode({
            ...cursorContext,
            position: { createdAt: last.createdAt, id: last.id },
          })
        : null;
    return {
      data: {
        items: result.items,
        page: {
          nextCursor,
          previousCursor: null,
          limit: normalized.limit,
        },
        applied: {
          filters: normalized.appliedFilters,
          sort: [normalized.sort],
        },
      },
    };
  }
}

export interface AuditTableFilterClause {
  field: string;
  operator: string;
  value?: unknown;
}

export interface AuditTableQueryRequest {
  cursor?: string | undefined;
  filters: AuditTableFilterClause[];
  limit: number;
  search?: string | undefined;
  sort: Array<{
    direction: "asc" | "desc";
    field: string;
    nulls?: "first" | "last" | undefined;
  }>;
}

export interface AuditTablePage {
  data: {
    applied: {
      filters: AuditTableAppliedFilterClause[];
      sort: Array<{ direction: "asc" | "desc"; field: "createdAt" }>;
    };
    items: AuditLog[];
    page: {
      limit: number;
      nextCursor: string | null;
      previousCursor: null;
    };
  };
}

export interface AuditTableAppliedFilterClause {
  field: string;
  operator: "eq" | "gte" | "lte";
  value: boolean | string;
}

function normalizeAuditTableQuery(request: AuditTableQueryRequest): {
  appliedFilters: AuditTableAppliedFilterClause[];
  filter: AuditLogQueryFilter;
  limit: number;
  search?: string;
  sort: { direction: "asc" | "desc"; field: "createdAt" };
} {
  if (
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > auditTableMaxLimit ||
    request.sort.length !== 1 ||
    request.sort[0]?.field !== "createdAt" ||
    request.filters.length > 8
  )
    throw invalidAuditTableQuery();
  const sort = {
    direction: request.sort[0].direction,
    field: "createdAt" as const,
  };
  const filter: AuditLogQueryFilter = {};
  const seen = new Set<string>();
  for (const clause of request.filters) {
    const key = `${clause.field}:${clause.operator}`;
    if (seen.has(key)) throw invalidAuditTableQuery();
    seen.add(key);
    if (clause.field === "createdAt") {
      if (clause.operator !== "gte" && clause.operator !== "lte")
        throw invalidAuditTableQuery();
      const timestamp = normalizedTimestamp(clause.value);
      if (clause.operator === "gte") filter.from = timestamp;
      else filter.to = timestamp;
      continue;
    }
    if (clause.operator !== "eq") throw invalidAuditTableQuery();
    if (clause.field === "includeNoise") {
      if (typeof clause.value !== "boolean") throw invalidAuditTableQuery();
      filter.includeNoise = clause.value;
      continue;
    }
    if (typeof clause.value !== "string") throw invalidAuditTableQuery();
    if (clause.field === "action") filter.action = boundedText(clause.value);
    else if (clause.field === "actorId")
      filter.actorId = boundedText(clause.value);
    else if (clause.field === "category") {
      if (!auditCategories.includes(clause.value as AuditCategory))
        throw invalidAuditTableQuery();
      filter.category = clause.value as AuditCategory;
    } else if (clause.field === "outcome") {
      if (clause.value !== "failure" && clause.value !== "success")
        throw invalidAuditTableQuery();
      filter.outcome = clause.value;
    } else if (clause.field === "resourceId")
      filter.resourceId = boundedText(clause.value);
    else if (clause.field === "resourceType")
      filter.resourceType = boundedText(clause.value);
    else throw invalidAuditTableQuery();
  }
  if (
    filter.from !== undefined &&
    filter.to !== undefined &&
    filter.from > filter.to
  )
    throw invalidAuditTableQuery();
  const search = request.search?.trim();
  if (search !== undefined && (search.length < 3 || search.length > 300))
    throw invalidAuditTableQuery();
  return {
    appliedFilters: request.filters.map((clause) => ({
      field: clause.field,
      operator: clause.operator as AuditTableAppliedFilterClause["operator"],
      value: clause.value as boolean | string,
    })),
    filter,
    limit: request.limit,
    ...(search === undefined ? {} : { search }),
    sort,
  };
}

function auditCursorPosition(
  value: unknown,
): AuditLogQueryPosition | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("createdAt" in value) ||
    !("id" in value) ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 300
  )
    return undefined;
  const createdAt = Date.parse(value.createdAt);
  if (!Number.isFinite(createdAt)) return undefined;
  return { createdAt: new Date(createdAt).toISOString(), id: value.id };
}

function normalizedTimestamp(value: unknown): string {
  if (typeof value !== "string") throw invalidAuditTableQuery();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw invalidAuditTableQuery();
  return new Date(timestamp).toISOString();
}

function boundedText(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 300)
    throw invalidAuditTableQuery();
  return normalized;
}

function invalidAuditTableQuery(): ApiError {
  return new ApiError(
    "invalid_audit_table_query",
    "Audit table query is invalid.",
    400,
  );
}

export interface AuditLogFilter {
  action?: string;
  actorId?: string;
  category?: AuditCategory;
  from?: string;
  includeNoise?: boolean;
  outcome?: "failure" | "success";
  q?: string;
  resourceId?: string;
  resourceType?: string;
  to?: string;
}

export const AUDIT_LOG_PAGE_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_PAGE_MAX_LIMIT = 1000;

export interface AuditLogPageOptions {
  filter?: AuditLogFilter;
  limit?: number;
  cursor?: string;
}

export interface AuditLogPage {
  data: AuditLog[];
  nextCursor?: string;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit))
    return AUDIT_LOG_PAGE_DEFAULT_LIMIT;
  const truncated = Math.floor(limit);
  if (truncated < 1) return 1;
  if (truncated > AUDIT_LOG_PAGE_MAX_LIMIT) return AUDIT_LOG_PAGE_MAX_LIMIT;
  return truncated;
}

// Cursor is an opaque token identifying the last row of the previous page.
// The list is already sorted newest-first; we page by (createdAt, id) so
// rows sharing a createdAt still paginate deterministically.
function encodeCursor(log: AuditLog): string {
  return Buffer.from(`${log.createdAt}|${log.id}`, "utf8").toString(
    "base64url",
  );
}

function indexAfterCursor(logs: AuditLog[], cursor: string): number {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return logs.length;
  }
  const separator = decoded.lastIndexOf("|");
  if (separator === -1) return logs.length;
  const id = decoded.slice(separator + 1);
  const position = logs.findIndex((log) => log.id === id);
  return position === -1 ? logs.length : position + 1;
}

function filterAuditLogs(logs: AuditLog[], filter: AuditLogFilter): AuditLog[] {
  const hideNoise =
    filter.includeNoise === false &&
    filter.action === undefined &&
    filter.category !== "system";
  const query = filter.q?.trim().toLocaleLowerCase();
  return logs.filter((log) => {
    if (filter.action !== undefined && log.action !== filter.action)
      return false;
    if (filter.actorId !== undefined && log.actorId !== filter.actorId)
      return false;
    if (filter.outcome !== undefined && log.outcome !== filter.outcome)
      return false;
    if (filter.resourceId !== undefined && log.resourceId !== filter.resourceId)
      return false;
    if (
      filter.resourceType !== undefined &&
      log.resourceType !== filter.resourceType
    )
      return false;
    if (filter.from !== undefined && log.createdAt < filter.from) return false;
    if (filter.to !== undefined && log.createdAt > filter.to) return false;
    if (hideNoise && isAuditNoise(log)) return false;
    if (
      filter.category !== undefined &&
      classifyAuditAction(log.action) !== filter.category
    ) {
      return false;
    }
    if (query !== undefined && query.length > 0) {
      const haystack =
        `${log.action} ${log.actorId} ${log.resourceType} ${log.resourceId}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
