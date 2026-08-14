import type {
  AuthorizedMessagePageQuery,
  MessageBranchVariantNavigation,
  MessagePageQueryResult,
} from "@romeo/core";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { toMessageRecord } from "./chat-repository-records";
import { chats, messages } from "./schema";

interface BranchRow extends Record<string, unknown> {
  cycle: boolean;
  depth: number;
  id: string;
  parentId: string | null;
}

interface LeafRow extends Record<string, unknown> {
  leafId: string;
  rootId: string;
}

export async function queryAuthorizedMessagePage(
  db: RomeoDatabase,
  input: AuthorizedMessagePageQuery,
): Promise<MessagePageQueryResult> {
  const [chat] = await db
    .select({ transcriptVersion: chats.transcriptVersion })
    .from(chats)
    .where(
      and(
        eq(chats.id, input.chatId),
        eq(chats.orgId, input.orgId),
        eq(chats.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const transcriptVersion = chat?.transcriptVersion.toString();
  if (
    transcriptVersion === undefined ||
    transcriptVersion !== input.transcriptVersion
  ) {
    return {
      branchVariants: [],
      hasMore: false,
      invalidTranscriptVersion: true,
      items: [],
      transcriptVersion: transcriptVersion ?? input.transcriptVersion,
    };
  }
  if (input.mode === "linear")
    return queryLinearPage(db, input, transcriptVersion);
  return queryBranchPage(db, input, transcriptVersion);
}

async function queryLinearPage(
  db: RomeoDatabase,
  input: AuthorizedMessagePageQuery,
  transcriptVersion: string,
): Promise<MessagePageQueryResult> {
  const cursorPredicate =
    input.linearCursor === undefined
      ? undefined
      : or(
          lt(messages.createdAt, new Date(input.linearCursor.createdAt)),
          and(
            eq(messages.createdAt, new Date(input.linearCursor.createdAt)),
            lt(messages.id, input.linearCursor.id),
          ),
        );
  const rows = await db
    .select({ message: messages })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(
      and(
        eq(messages.chatId, input.chatId),
        eq(chats.orgId, input.orgId),
        eq(chats.workspaceId, input.workspaceId),
        cursorPredicate,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const selected = rows
    .slice(0, input.limit)
    .map((row) => toMessageRecord(row.message));
  const oldest = selected.at(-1);
  selected.reverse();
  return {
    branchVariants: [],
    hasMore,
    items: selected,
    transcriptVersion,
    ...(hasMore && oldest !== undefined
      ? {
          nextPosition: {
            createdAt: oldest.createdAt,
            id: oldest.id,
            mode: "linear" as const,
          },
        }
      : {}),
  };
}

async function queryBranchPage(
  db: RomeoDatabase,
  input: AuthorizedMessagePageQuery,
  transcriptVersion: string,
): Promise<MessagePageQueryResult> {
  if ((input.branchTraversalOffset ?? 0) + input.limit > 100_000)
    return {
      branchVariants: [],
      hasMore: false,
      invalidBranch: true,
      items: [],
      transcriptVersion,
    };
  const requestedStart =
    input.branchStartMessageId ?? input.branchLeafMessageId ?? "";
  if (input.branchExpectedChildId !== undefined) {
    const continuityRows = await db.execute<{ valid: boolean }>(sql`
      select exists (
        select 1
        from messages ancestor
        join messages child
          on child.id = ${input.branchExpectedChildId}
         and child.chat_id = ancestor.chat_id
        join chats c on c.id = ancestor.chat_id
        where ancestor.id = ${requestedStart}
          and ancestor.chat_id = ${input.chatId}
          and child.parent_id = ancestor.id
          and ancestor.parent_id is not distinct from ${input.branchExpectedParentId ?? null}
          and c.org_id = ${input.orgId}
          and c.workspace_id = ${input.workspaceId}
      ) as valid
    `);
    const [continuity] = continuityRows;
    if (continuity?.valid !== true)
      return {
        branchVariants: [],
        hasMore: false,
        invalidBranch: true,
        items: [],
        transcriptVersion,
      };
  }
  const path = await db.execute<BranchRow>(sql`
    with recursive branch as (
      select
        m.id,
        m.parent_id as "parentId",
        0 as depth,
        array[m.id]::text[] as visited,
        false as cycle
      from messages m
      join chats c on c.id = m.chat_id
      where m.id = ${requestedStart}
        and m.chat_id = ${input.chatId}
        and c.org_id = ${input.orgId}
        and c.workspace_id = ${input.workspaceId}
      union all
      select
        parent.id,
        parent.parent_id as "parentId",
        child.depth + 1,
        child.visited || parent.id,
        parent.id = any(child.visited)
      from branch child
      join messages parent on parent.id = child."parentId"
      where parent.chat_id = ${input.chatId}
        and child.cycle = false
        and child.depth < ${input.limit + 1}
    )
    select id, "parentId", depth, cycle
    from branch
    order by depth asc
    limit ${input.limit + 1}
  `);
  const last = path.at(-1);
  if (
    path.length === 0 ||
    path.some((row) => row.cycle) ||
    (path.length <= input.limit && last?.parentId !== null)
  ) {
    return {
      branchVariants: [],
      hasMore: false,
      invalidBranch: true,
      items: [],
      transcriptVersion,
    };
  }
  const hasMore = path.length > input.limit;
  const visiblePath = path.slice(0, input.limit);
  const visibleIds = visiblePath.map((row) => row.id);
  const rows =
    visibleIds.length === 0
      ? []
      : await db
          .select({ message: messages })
          .from(messages)
          .innerJoin(chats, eq(chats.id, messages.chatId))
          .where(
            and(
              inArray(messages.id, visibleIds),
              eq(messages.chatId, input.chatId),
              eq(chats.orgId, input.orgId),
              eq(chats.workspaceId, input.workspaceId),
            ),
          );
  const byId = new Map(
    rows.map((row) => {
      const message = toMessageRecord(row.message);
      return [message.id, message] as const;
    }),
  );
  if (
    byId.size !== visibleIds.length ||
    visiblePath.some(
      (pathRow) =>
        (byId.get(pathRow.id)?.parentId ?? null) !== pathRow.parentId,
    )
  ) {
    return {
      branchVariants: [],
      hasMore: false,
      invalidBranch: true,
      items: [],
      transcriptVersion,
    };
  }
  const items = visibleIds
    .map((id) => byId.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .reverse();
  const next = path.at(input.limit);
  return {
    branchVariants: await queryBranchVariants(db, input, items),
    hasMore,
    items,
    transcriptVersion,
    ...(hasMore && next !== undefined
      ? {
          nextPosition: {
            expectedChildId: visiblePath.at(-1)?.id ?? next.id,
            expectedParentId: next.parentId,
            messageId: next.id,
            mode: "branch" as const,
            traversed: (input.branchTraversalOffset ?? 0) + input.limit,
          },
        }
      : {}),
  };
}

async function queryBranchVariants(
  db: RomeoDatabase,
  input: AuthorizedMessagePageQuery,
  selectedPath: MessagePageQueryResult["items"],
): Promise<MessageBranchVariantNavigation[]> {
  if (selectedPath.length === 0) return [];
  const parentIds = [
    ...new Set(
      selectedPath.flatMap((message) =>
        message.parentId === undefined ? [] : [message.parentId],
      ),
    ),
  ];
  const includesRoots = selectedPath.some(
    (message) => message.parentId === undefined,
  );
  const parentPredicate =
    parentIds.length === 0
      ? isNull(messages.parentId)
      : includesRoots
        ? or(inArray(messages.parentId, parentIds), isNull(messages.parentId))
        : inArray(messages.parentId, parentIds);
  const siblings = await db
    .select({
      createdAt: messages.createdAt,
      id: messages.id,
      parentId: messages.parentId,
      role: messages.role,
    })
    .from(messages)
    .where(and(eq(messages.chatId, input.chatId), parentPredicate))
    .orderBy(
      asc(messages.createdAt),
      sql`case when ${messages.role} = 'user' then 0 else 1 end asc`,
      asc(messages.id),
    );
  const byParent = new Map<string, typeof siblings>();
  for (const sibling of siblings) {
    const key = sibling.parentId ?? "";
    const group = byParent.get(key);
    if (group === undefined) byParent.set(key, [sibling]);
    else group.push(sibling);
  }
  const pending = selectedPath.flatMap((message) => {
    const group = byParent.get(message.parentId ?? "") ?? [];
    if (group.length <= 1) return [];
    const index = group.findIndex((candidate) => candidate.id === message.id);
    if (index < 0) return [];
    return [
      {
        index,
        messageId: message.id,
        nextRootId: group[index + 1]?.id,
        previousRootId: group[index - 1]?.id,
        total: group.length,
      },
    ];
  });
  const rootIds = [
    ...new Set(
      pending.flatMap((item) =>
        [item.previousRootId, item.nextRootId].filter(
          (id): id is string => id !== undefined,
        ),
      ),
    ),
  ];
  const leaves = await queryDescendantLeaves(db, input.chatId, rootIds);
  return pending.map((item) => ({
    index: item.index,
    messageId: item.messageId,
    ...(item.nextRootId === undefined
      ? {}
      : { nextLeafMessageId: leaves.get(item.nextRootId) ?? item.nextRootId }),
    ...(item.previousRootId === undefined
      ? {}
      : {
          previousLeafMessageId:
            leaves.get(item.previousRootId) ?? item.previousRootId,
        }),
    total: item.total,
  }));
}

async function queryDescendantLeaves(
  db: RomeoDatabase,
  chatId: string,
  rootIds: string[],
): Promise<Map<string, string>> {
  if (rootIds.length === 0) return new Map();
  const rootParameters = sql.join(
    rootIds.map((rootId) => sql`${rootId}`),
    sql`, `,
  );
  const rows = await db.execute<LeafRow>(sql`
    with recursive descent as (
      select
        roots.id as "rootId",
        roots.id as "leafId",
        0 as depth,
        array[roots.id]::text[] as visited
      from messages roots
      where roots.chat_id = ${chatId}
        and roots.id in (${rootParameters})
      union all
      select
        descent."rootId",
        child.id,
        descent.depth + 1,
        descent.visited || child.id
      from descent
      join lateral (
        select candidate.id
        from messages candidate
        where candidate.chat_id = ${chatId}
          and candidate.parent_id = descent."leafId"
          and not candidate.id = any(descent.visited)
        order by
          candidate.created_at desc,
          case when candidate.role = 'user' then 0 else 1 end desc,
          candidate.id desc
        limit 1
      ) child on true
      where descent.depth < 100000
    )
    select distinct on ("rootId") "rootId", "leafId"
    from descent
    order by "rootId", depth desc
  `);
  return new Map(rows.map((row) => [row.rootId, row.leafId]));
}
