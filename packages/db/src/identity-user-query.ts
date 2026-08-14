import type { QueryUsersInput, UserTableQueryResult } from "@romeo/core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { optionalIsoString } from "./repository-mapping";
import { users } from "./schema";

const userTableSortColumns = {
  email: users.email,
  name: users.name,
} as const;

export async function queryIdentityUsers(
  db: RomeoDatabase,
  orgId: string,
  input: QueryUsersInput,
): Promise<UserTableQueryResult> {
  const search = input.search?.trim().toLocaleLowerCase();
  const column = userTableSortColumns[input.sort];
  const filteredPredicate = and(
    eq(users.orgId, orgId),
    input.filter.roles === undefined
      ? undefined
      : inArray(users.role, input.filter.roles),
    input.filter.status === "active"
      ? isNull(users.disabledAt)
      : input.filter.status === "disabled"
        ? isNotNull(users.disabledAt)
        : undefined,
    search === undefined || search === ""
      ? undefined
      : like(userSearchDocument(), `%${search}%`),
  );
  const position = input.position;
  const positionPredicate =
    position === undefined
      ? undefined
      : input.direction === "asc"
        ? or(
            gt(column, position.value),
            and(eq(column, position.value), gt(users.id, position.id)),
          )
        : or(
            lt(column, position.value),
            and(eq(column, position.value), lt(users.id, position.id)),
          );
  const order = input.direction === "asc" ? asc : desc;
  const [rows, totals, stats] = await Promise.all([
    db
      .select()
      .from(users)
      .where(and(filteredPredicate, positionPredicate))
      .orderBy(order(column), order(users.id))
      .limit(input.limit + 1),
    db.select({ value: count() }).from(users).where(filteredPredicate),
    db
      .select({
        activeGlobalAdminTotal:
          sql<number>`count(*) filter (where ${users.role} = 'global_admin' and ${users.disabledAt} is null)`.mapWith(
            Number,
          ),
        adminTotal:
          sql<number>`count(*) filter (where ${users.role} <> 'user')`.mapWith(
            Number,
          ),
        disabledTotal:
          sql<number>`count(*) filter (where ${users.disabledAt} is not null)`.mapWith(
            Number,
          ),
        userTotal: count(),
      })
      .from(users)
      .where(eq(users.orgId, orgId)),
  ]);
  return {
    activeGlobalAdminTotal: stats[0]?.activeGlobalAdminTotal ?? 0,
    adminTotal: stats[0]?.adminTotal ?? 0,
    disabledTotal: stats[0]?.disabledTotal ?? 0,
    hasMore: rows.length > input.limit,
    items: rows.slice(0, input.limit).map(toUserRecord),
    total: totals[0]?.value ?? 0,
    userTotal: stats[0]?.userTotal ?? 0,
  };
}

function userSearchDocument() {
  return sql<string>`lower(${users.name} || chr(31) || ${users.email})`;
}

function toUserRecord(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    name: row.name,
    role:
      row.role === "org_admin" || row.role === "global_admin"
        ? row.role
        : ("user" as const),
    ...(optionalIsoString(row.disabledAt) === undefined
      ? {}
      : { disabledAt: optionalIsoString(row.disabledAt) }),
  };
}
