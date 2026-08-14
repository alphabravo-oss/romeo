import type {
  AuthorizedChatMessageSearchQuery,
  ChatMessageSearchQueryResult,
} from "@romeo/core";
import { sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";

interface SearchRow extends Record<string, unknown> {
  activeBranch: boolean | null;
  createdAt: Date | string | null;
  messageId: string | null;
  role: "assistant" | "system" | "tool" | "user" | null;
  snippet: string | null;
  total: number | string | null;
  transcriptVersion: bigint;
}

export async function searchAuthorizedChatMessages(
  db: RomeoDatabase,
  input: AuthorizedChatMessageSearchQuery,
): Promise<ChatMessageSearchQueryResult> {
  return db.transaction(
    async (transaction) => {
      await transaction.execute(sql`set local statement_timeout = '2000ms'`);
      return querySearch(transaction as unknown as RomeoDatabase, input);
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}

async function querySearch(
  db: RomeoDatabase,
  input: AuthorizedChatMessageSearchQuery,
): Promise<ChatMessageSearchQueryResult> {
  const escaped = `%${input.normalizedQuery.replace(
    /[\\%_]/gu,
    (value) => `\\${value}`,
  )}%`;
  const cursorCreatedAt = input.cursor?.createdAt;
  const cursorId = input.cursor?.id;
  const rows = await db.execute<SearchRow>(sql`
    with recursive chat_scope as (
      select
        c.id,
        c.active_leaf_message_id as "activeLeafMessageId",
        c.transcript_version as "transcriptVersion"
      from chats c
      where c.id = ${input.chatId}
        and c.org_id = ${input.orgId}
        and c.workspace_id = ${input.workspaceId}
    ), active_branch as (
      select m.id, m.parent_id, array[m.id]::text[] as visited, 0 as depth
      from messages m
      join chat_scope scope on scope.id = m.chat_id
      where m.id = scope."activeLeafMessageId"
      union all
      select parent.id, parent.parent_id, child.visited || parent.id, child.depth + 1
      from active_branch child
      join messages parent on parent.id = child.parent_id
      where parent.chat_id = ${input.chatId}
        and not parent.id = any(child.visited)
        and child.depth < 100000
    ), matched as (
      select
        m.id as "messageId",
        m.role,
        m.created_at as "createdAt",
        scope."activeLeafMessageId" is null
          or exists (select 1 from active_branch branch where branch.id = m.id)
          as "activeBranch",
        case
          when greatest(strpos(lower(m.content), ${input.normalizedQuery}) - 80, 1) > 1
            then '…'
          else ''
        end || substring(
          m.content
          from greatest(strpos(lower(m.content), ${input.normalizedQuery}) - 80, 1)
          for 240
        ) || case
          when greatest(strpos(lower(m.content), ${input.normalizedQuery}) - 80, 1) + 240
            <= char_length(m.content)
            then '…'
          else ''
        end as snippet,
        count(*) over () as total
      from messages m
      join chat_scope scope on scope.id = m.chat_id
      where scope."transcriptVersion" = ${BigInt(input.transcriptVersion)}
        and m.chat_id = ${input.chatId}
        and m.content ilike ${escaped} escape '\\'
    ), page as (
      select *
      from matched
      where ${cursorCreatedAt ?? null}::timestamptz is null
        or "createdAt" > ${cursorCreatedAt ?? null}::timestamptz
        or (
          "createdAt" = ${cursorCreatedAt ?? null}::timestamptz
          and "messageId" > ${cursorId ?? ""}
        )
      order by "createdAt" asc, "messageId" asc
      limit ${input.limit + 1}
    )
    select
      scope."transcriptVersion",
      page."messageId",
      page.role,
      page."createdAt",
      page."activeBranch",
      page.snippet,
      page.total
    from chat_scope scope
    left join page on true
    order by page."createdAt" asc nulls last, page."messageId" asc nulls last
  `);
  const first = rows[0];
  const transcriptVersion = first?.transcriptVersion.toString();
  if (
    transcriptVersion === undefined ||
    transcriptVersion !== input.transcriptVersion
  ) {
    return {
      hasMore: false,
      invalidTranscriptVersion: true,
      items: [],
      total: 0,
      transcriptVersion: transcriptVersion ?? input.transcriptVersion,
    };
  }
  const hits = rows.filter(
    (
      row,
    ): row is SearchRow & {
      activeBranch: boolean;
      createdAt: Date;
      messageId: string;
      role: NonNullable<SearchRow["role"]>;
      snippet: string;
    } =>
      row.messageId !== null &&
      row.createdAt !== null &&
      row.role !== null &&
      row.snippet !== null &&
      row.activeBranch !== null,
  );
  const hasMore = hits.length > input.limit;
  const selected = hits.slice(0, input.limit);
  const last = selected.at(-1);
  return {
    hasMore,
    items: selected.map((row) => ({
      activeBranch: row.activeBranch,
      createdAt: timestamp(row.createdAt),
      messageId: row.messageId,
      role: row.role,
      snippet: row.snippet,
    })),
    total: Number(first?.total ?? 0),
    transcriptVersion,
    ...(hasMore && last !== undefined
      ? {
          nextPosition: {
            createdAt: timestamp(last.createdAt),
            id: last.messageId,
          },
        }
      : {}),
  };
}

function timestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
