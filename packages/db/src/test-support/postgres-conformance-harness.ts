import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RomeoRepository } from "@romeo/core";
import postgres from "postgres";

import { createDatabaseConnection, type RomeoDatabase } from "../client";
import { createPostgresRomeoRepositoryFromDatabase } from "../romeo-repository";
import {
  chats,
  groups,
  knowledgeBases,
  organizations,
  users,
  workspaces,
} from "../schema";

export const POSTGRES_CONFORMANCE_DATABASE_URL_ENV =
  "ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL";

export interface LivePostgresRepositoryFixture {
  databaseName: string;
  databaseUrl: string;
  repository: RomeoRepository;
  close: () => Promise<void>;
}

export async function seedRunEventHistory(
  databaseUrl: string,
  runId: string,
  eventCount: number,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      INSERT INTO run_events (id, run_id, sequence, type, data, created_at)
      SELECT
        'evt_' || ${runId} || '_' || sequence_value::text,
        ${runId},
        sequence_value::bigint,
        CASE WHEN sequence_value = ${eventCount}
          THEN 'run.completed'
          ELSE 'message.delta'
        END,
        '{}'::jsonb,
        '2026-08-14T00:00:00.000Z'::timestamptz
      FROM generate_series(1, ${eventCount}) AS series(sequence_value)
    `;
    await sql`
      UPDATE runs
      SET next_event_sequence = ${eventCount}
      WHERE id = ${runId}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedMessagePageHistory(
  databaseUrl: string,
  rowCount = 100_000,
): Promise<{ chatId: string; leafId: string }> {
  const sql = postgres(databaseUrl, { max: 1 });
  const chatId = "chat_message_page_plan";
  try {
    await sql`
      insert into chats (
        id, org_id, workspace_id, title, created_by, updated_at
      ) values (
        ${chatId}, 'org_default', 'workspace_default', 'Message page plan',
        'user_dev_admin', '2026-08-14T00:00:00.000Z'::timestamptz
      )
    `;
    await sql`
      insert into messages (
        id, chat_id, role, content, parent_id, created_at
      )
      select
        'message_page_plan_' || series::text,
        ${chatId},
        case when series % 2 = 0 then 'assistant'::message_role else 'user'::message_role end,
        case when series = ${rowCount}
          then 'indexed current chat search marker'
          else 'representative message'
        end,
        case when series = 1 then null
          else 'message_page_plan_' || (series - 1)::text end,
        '2026-08-14T00:00:00.000Z'::timestamptz
      from generate_series(1, ${rowCount}) as rows(series)
    `;
    const leafId = `message_page_plan_${rowCount}`;
    await sql`
      update chats set active_leaf_message_id = ${leafId} where id = ${chatId}
    `;
    await sql`analyze messages`;
    return { chatId, leafId };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function explainChatMessageSearch(
  databaseUrl: string,
  chatId: string,
): Promise<unknown> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`set enable_seqscan to off`;
    await sql`set enable_indexscan to off`;
    const rows = await sql`
      explain (format json)
      select id
      from messages
      where chat_id = ${chatId}
        and content ilike '%indexed current chat search marker%'
      order by created_at asc, id asc
      limit 26
    `;
    return rows[0]?.["QUERY PLAN"];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function explainMessagePageQueries(
  databaseUrl: string,
  input: { chatId: string; leafId: string },
): Promise<{ branch: unknown; linear: unknown }> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`set enable_seqscan to off`;
    const linear = await sql`
      explain (format json)
      select id
      from messages
      where chat_id = ${input.chatId}
      order by created_at desc, id desc
      limit 100
    `;
    const branch = await sql`
      explain (format json)
      with recursive branch as (
        select id, parent_id, 0 as depth
        from messages
        where id = ${input.leafId} and chat_id = ${input.chatId}
        union all
        select parent.id, parent.parent_id, child.depth + 1
        from branch child
        join messages parent on parent.id = child.parent_id
        where parent.chat_id = ${input.chatId} and child.depth < 100
      )
      select id from branch order by depth limit 101
    `;
    return {
      branch: branch[0]?.["QUERY PLAN"],
      linear: linear[0]?.["QUERY PLAN"],
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function explainRunEventTail(
  databaseUrl: string,
  runId: string,
  afterSequence: number,
  limit: number,
): Promise<unknown> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql`
      EXPLAIN (FORMAT JSON)
      SELECT id, run_id, sequence, type, data, created_at
      FROM run_events
      WHERE run_id = ${runId}
        AND sequence > ${afterSequence}
      ORDER BY sequence
      LIMIT ${limit}
    `;
    return rows[0]?.["QUERY PLAN"];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function explainAuditLogSearch(
  databaseUrl: string,
  orgId: string,
  search: string,
): Promise<unknown> {
  const sql = postgres(databaseUrl, { max: 1 });
  const escaped = search
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
  try {
    await sql`SET enable_seqscan TO off`;
    await sql`SET enable_indexscan TO off`;
    const rows = await sql`
      EXPLAIN (FORMAT JSON)
      SELECT id
      FROM audit_logs
      WHERE org_id = ${orgId}
        AND lower(action || chr(31) || actor_id || chr(31) || resource_type || chr(31) || resource_id)
          LIKE ('%' || lower(${escaped}) || '%')
        AND (
          position(lower(${search}) in lower(action)) > 0
          OR position(lower(${search}) in lower(actor_id)) > 0
          OR position(lower(${search}) in lower(resource_type)) > 0
          OR position(lower(${search}) in lower(resource_id)) > 0
        )
    `;
    return rows[0]?.["QUERY PLAN"];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedAuditSearchHistory(
  databaseUrl: string,
  rowCount = 10_000,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      INSERT INTO audit_logs (
        id, org_id, actor_id, action, resource_type, resource_id, outcome,
        metadata, created_at
      )
      SELECT
        'audit_search_plan_' || series::text,
        'org_default',
        'user_dev_admin',
        CASE WHEN series = ${rowCount}
          THEN 'admin.audit.indexed-marker'
          ELSE 'admin.audit.representative'
        END,
        'session',
        'audit_search_plan_resource_' || series::text,
        'success',
        '{}'::jsonb,
        '2026-08-14T00:00:00.000Z'::timestamptz
          + series * interval '1 second'
      FROM generate_series(1, ${rowCount}) AS series
    `;
    await sql`ANALYZE audit_logs`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedLegacyMessagePartFixture(
  databaseUrl: string,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      INSERT INTO messages (
        id, chat_id, role, content, parts_schema_version, created_at
      ) VALUES (
        'message_parts_legacy', 'chat_welcome', 'user', 'legacy body', 0,
        '2026-08-14T12:00:00.000Z'
      )
    `;
    await sql`
      INSERT INTO message_parts (
        id, message_id, position, canonical_position, schema_version,
        type, content, metadata, created_at
      ) VALUES
        ('legacy_part_b', 'message_parts_legacy', 7, NULL, 0, 'attachment',
          'object-b', '{"fileName":"b.txt"}'::jsonb, now()),
        ('legacy_part_a', 'message_parts_legacy', 7, NULL, 0,
          'collaboration_channel_metadata', '', '{"channelId":"channel_a"}'::jsonb, now())
    `;
    await sql`
      UPDATE message_parts
      SET canonical_position = NULL, position = 7
      WHERE message_id = 'message_parts_legacy'
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function postgresConformanceDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[POSTGRES_CONFORMANCE_DATABASE_URL_ENV];
  return value === undefined || value.length === 0 ? undefined : value;
}

export async function createLivePostgresRepositoryFixture(
  adminDatabaseUrl: string,
): Promise<LivePostgresRepositoryFixture> {
  const databaseName = `romeo_conformance_${randomUUID().replaceAll("-", "")}`;
  const targetUrl = databaseUrlWithDatabase(adminDatabaseUrl, databaseName);
  const admin = postgres(adminDatabaseUrl, { max: 1 });
  let connection: ReturnType<typeof createDatabaseConnection> | undefined;

  await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

  try {
    await applyGreenfieldBaseline(targetUrl);
    connection = createDatabaseConnection(targetUrl);
    await seedConformanceFixtures(connection.db);
  } catch (error) {
    await dropDatabase(admin, databaseName);
    await admin.end({ timeout: 5 });
    throw error;
  }

  return {
    databaseName,
    databaseUrl: targetUrl,
    repository: createPostgresRomeoRepositoryFromDatabase(connection.db),
    close: async () => {
      await connection?.close();
      await dropDatabase(admin, databaseName);
      await admin.end({ timeout: 5 });
    },
  };
}

async function applyGreenfieldBaseline(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const statement of greenfieldMigrationStatements()) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function greenfieldMigrationStatements(): string[] {
  const migrationsDir = fileURLToPath(
    new URL("../../migrations/", import.meta.url),
  );
  return readdirSync(migrationsDir)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()
    .flatMap((fileName) => {
      const migration = readFileSync(
        new URL(`../../migrations/${fileName}`, import.meta.url),
        { encoding: "utf8" },
      );
      return migration
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    });
}

async function seedConformanceFixtures(db: RomeoDatabase): Promise<void> {
  await db.insert(organizations).values({
    id: "org_default",
    name: "Romeo Local",
    slug: "romeo-local",
  });
  await db.insert(workspaces).values({
    id: "workspace_default",
    orgId: "org_default",
    name: "Default",
    slug: "default",
  });
  await db.insert(users).values({
    id: "user_dev_admin",
    orgId: "org_default",
    email: "admin@romeo.local",
    name: "Romeo Admin",
    role: "global_admin",
  });
  await db.insert(groups).values({
    id: "group_admins",
    orgId: "org_default",
    name: "Admins",
    slug: "admins",
  });
  await db.insert(chats).values({
    id: "chat_welcome",
    orgId: "org_default",
    workspaceId: "workspace_default",
    title: "Welcome",
    createdBy: "user_dev_admin",
  });
  await db.insert(knowledgeBases).values({
    id: "kb_default",
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: "Default knowledge",
    description: "PostgreSQL conformance fixture",
    createdBy: "user_dev_admin",
  });
}

async function dropDatabase(
  admin: ReturnType<typeof postgres>,
  databaseName: string,
): Promise<void> {
  await admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(databaseName)} AND pid <> pg_backend_pid()`,
  );
  await admin.unsafe(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
  );
}

function databaseUrlWithDatabase(
  databaseUrl: string,
  databaseName: string,
): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error(`Unsafe Postgres identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
