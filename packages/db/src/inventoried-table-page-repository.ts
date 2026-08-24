import { createHash } from "node:crypto";

import type {
  QueryInventoriedTableRowsInput,
  QueryInventoriedTableRowsResult,
} from "@romeo/core";
import { ApiError } from "@romeo/core";
import { sql, type SQL } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  nativeTableConfigs,
  type NativeField,
  type NativeTableConfig,
} from "./inventoried-table-page-config";
import { userNotifications } from "./schema";

export class PgInventoriedTablePageRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async queryInventoriedTableRows(
    input: QueryInventoriedTableRowsInput,
  ): Promise<QueryInventoriedTableRowsResult> {
    const config = nativeTableConfigs[input.resource];
    const base = basePredicates(config, input);
    const filtered = [...base, ...filterPredicates(config, input)];
    const positioned = [
      ...filtered,
      ...(input.position === undefined
        ? []
        : [positionPredicate(config, input)]),
    ];
    const sortField = requiredField(config, input.sort.field);
    const projection = sql.join(
      Object.entries(config.selection).map(
        ([name, column]) => sql`${column} as ${sql.identifier(name)}`,
      ),
      sql`, `,
    );
    const direction = input.sort.direction === "asc" ? sql`asc` : sql`desc`;
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      select ${projection}
      from ${config.table}
      where ${joinedAnd(positioned)}
      order by ${sortField.column} ${direction}, ${config.selection.id} ${direction}
      limit ${input.limit}
    `);
    const items = rows.map((row) => publicDatabaseRow(row, input.resource));
    if (!input.includeTotals) return { items };
    const totals = await this.db.execute<{ total: number | string }>(sql`
      select count(*)::bigint as total
      from ${config.table}
      where ${joinedAnd(filtered)}
    `);
    const total = safeCount(totals[0]?.total);
    if (input.resource === "governance_export_packages") {
      const request = config.selection.request;
      if (request === undefined) throw invalidQuery();
      const summaryRows = await this.db.execute<{
        orgScopeTotal: number | string;
        total: number | string;
        withContentTotal: number | string;
        workspaceScopeTotal: number | string;
      }>(sql`
        select count(*)::bigint as total,
          count(*) filter (
            where ${request} ->> 'scope' = 'org'
          )::bigint as "orgScopeTotal",
          count(*) filter (
            where ${request} ->> 'scope' = 'workspace'
          )::bigint as "workspaceScopeTotal",
          count(*) filter (
            where (${request} ->> 'includeContent')::boolean is true
          )::bigint as "withContentTotal"
        from ${config.table}
        where ${joinedAnd(base)}
      `);
      return {
        items,
        total,
        summary: {
          orgScopeTotal: safeCount(summaryRows[0]?.orgScopeTotal),
          total: safeCount(summaryRows[0]?.total),
          withContentTotal: safeCount(summaryRows[0]?.withContentTotal),
          workspaceScopeTotal: safeCount(summaryRows[0]?.workspaceScopeTotal),
        },
      };
    }
    if (input.resource !== "notifications") return { items, total };
    const summaryRows = await this.db.execute<{
      total: number | string;
      unreadTotal: number | string;
    }>(sql`
      select count(*)::bigint as total,
        count(*) filter (where ${userNotifications.readAt} is null)::bigint as "unreadTotal"
      from ${config.table}
      where ${joinedAnd(base)}
    `);
    return {
      items,
      total,
      summary: {
        total: safeCount(summaryRows[0]?.total),
        unreadTotal: safeCount(summaryRows[0]?.unreadTotal),
      },
    };
  }
}

function basePredicates(
  config: NativeTableConfig,
  input: QueryInventoriedTableRowsInput,
): SQL[] {
  const conditions = [sql`${config.orgColumn} = ${input.orgId}`];
  if (config.actorColumn !== undefined) {
    if (input.actorType !== "user") return [sql`false`];
    conditions.push(sql`${config.actorColumn} = ${input.actorId}`);
  }
  if (config.parentColumn !== undefined) {
    if (input.parentId === undefined) return [sql`false`];
    conditions.push(sql`${config.parentColumn} = ${input.parentId}`);
  }
  if (
    input.workspaceId !== undefined &&
    config.selection.workspaceId !== undefined
  )
    conditions.push(
      sql`${config.selection.workspaceId} = ${input.workspaceId}`,
    );
  if (input.snapshotAt !== undefined)
    conditions.push(
      sql`${config.createdColumn} <= ${new Date(input.snapshotAt)}`,
    );
  return conditions;
}

function filterPredicates(
  config: NativeTableConfig,
  input: QueryInventoriedTableRowsInput,
): SQL[] {
  const filters = input.filters.map((filter) => {
    const field = requiredField(config, filter.field);
    const value = databaseValue(field, filter.value);
    if (filter.operator === "eq") return sql`${field.column} = ${value}`;
    if (filter.operator === "neq") return sql`${field.column} <> ${value}`;
    if (filter.operator === "gte") return sql`${field.column} >= ${value}`;
    if (filter.operator === "gt") return sql`${field.column} > ${value}`;
    if (filter.operator === "lte") return sql`${field.column} <= ${value}`;
    if (filter.operator === "lt") return sql`${field.column} < ${value}`;
    throw invalidQuery();
  });
  if (input.search === undefined) return filters;
  const pattern = `%${input.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  for (const name of input.searchFields) requiredField(config, name);
  return [
    ...filters,
    sql`${config.searchExpression} like ${pattern.toLocaleLowerCase()} escape '\\'`,
  ];
}

function positionPredicate(
  config: NativeTableConfig,
  input: QueryInventoriedTableRowsInput,
): SQL {
  const position = input.position;
  if (position === undefined) throw invalidQuery();
  const field = requiredField(config, input.sort.field);
  const id = config.selection.id;
  if (position.value === null) {
    return input.sort.direction === "asc"
      ? sql`${field.column} is null and ${id} > ${position.id}`
      : sql`(${field.column} is null and ${id} < ${position.id}) or ${field.column} is not null`;
  }
  const value = databaseValue(field, position.value);
  return input.sort.direction === "asc"
    ? sql`${field.column} > ${value} or (${field.column} = ${value} and ${id} > ${position.id}) or ${field.column} is null`
    : sql`${field.column} < ${value} or (${field.column} = ${value} and ${id} < ${position.id})`;
}

function requiredField(config: NativeTableConfig, name: string): NativeField {
  const field = config.fields[name];
  if (field === undefined) throw invalidQuery();
  return field;
}

function databaseValue(field: NativeField, value: unknown) {
  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw invalidQuery();
    return value;
  }
  if (typeof value !== "string" || value.length === 0) throw invalidQuery();
  if (field.kind === "date") {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw invalidQuery();
    return parsed;
  }
  return value;
}

function joinedAnd(values: SQL[]): SQL {
  return sql`(${sql.join(values, sql` and `)})`;
}

function publicDatabaseRow(
  row: Record<string, unknown>,
  resource: QueryInventoriedTableRowsInput["resource"],
) {
  const converted = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
  if (resource !== "governance_export_packages")
    return converted as { id: string; [key: string]: unknown };
  const result = Object.fromEntries(
    Object.entries(converted).filter(([key]) => !key.startsWith("__")),
  ) as { id: string; [key: string]: unknown };
  if (
    converted.state === "artifact_ready" &&
    typeof converted.packageId === "string" &&
    typeof converted.__objectKey === "string" &&
    typeof converted.__contentType === "string" &&
    typeof converted.__sizeBytes === "number" &&
    typeof converted.__sha256 === "string"
  ) {
    result.artifact = {
      contentType: converted.__contentType,
      sizeBytes: converted.__sizeBytes,
      sha256: converted.__sha256,
      downloadUrl: `/api/v1/governance/data-exports/packages/${encodeURIComponent(converted.packageId)}/content`,
      storage: {
        driver: "object_store",
        objectKeyHash: createHash("sha256")
          .update(converted.__objectKey)
          .digest("hex"),
        rawObjectKeyReturned: false,
      },
    };
  }
  return result;
}

function safeCount(value: number | string | undefined): number {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("invalid_table_count");
  return count;
}

function invalidQuery(): ApiError {
  return new ApiError("invalid_request", "Table page query is invalid.", 400);
}
