import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(packageRoot, "migrations");

describe("database migrations", () => {
  it("keeps the reviewed greenfield baseline with pgvector enabled", () => {
    const sqlFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(sqlFiles).toEqual([
      "0000_greenfield_baseline.sql",
      "0001_message_tree.sql",
    ]);

    const sql = readFileSync(join(migrationsDir, sqlFiles[0] ?? ""), "utf8");
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "vector"');
    expect(sql).toContain('CREATE TABLE "knowledge_chunk_embeddings"');
    expect(sql).toMatch(/PARTITION BY HASH \("org_id"\);\s*-->/u);
    expect(sql).toContain(
      'CREATE TABLE "knowledge_chunk_embeddings_p00" PARTITION OF "knowledge_chunk_embeddings"',
    );
    expect(sql).toContain(
      'CONSTRAINT "knowledge_chunk_embeddings_org_id_id_pk" PRIMARY KEY("org_id","id")',
    );
    expect(sql).toContain('CREATE TABLE "object_records"');
    expect(sql).toContain('CREATE TABLE "retention_policies"');
    expect(sql).toContain('"quantity" double precision NOT NULL');
    expect(sql).toContain('CREATE TABLE "delegated_oauth_connections"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "delegated_oauth_connections_provider_account_idx"',
    );
    expect(sql).toContain(
      'CREATE INDEX "knowledge_chunk_embeddings_vector_hnsw_idx"',
    );
    expect(sql).toContain('"file_retention_days" integer');
    expect(sql).toContain('"workspace_file_retention_days" jsonb');
    expect(sql).toContain('"user_file_retention_days" jsonb');
    expect(sql).toContain(
      'CREATE TABLE "managed_model_customization_policies"',
    );
    expect(sql).toContain('CREATE TABLE "managed_model_preferences"');
    expect(sql).toContain('"encrypted_custom_instructions" text');
    expect(sql).toContain("ON DELETE cascade");
    expect(sql).toContain(
      'CREATE FUNCTION "cleanup_managed_model_preferences_for_principal"()',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "managed_model_preferences_user_cleanup"',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "managed_model_preferences_group_cleanup"',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "managed_model_preferences_service_account_cleanup"',
    );
  });

  it("backfills the message tree so existing chats render unchanged", () => {
    const sql = readFileSync(
      join(migrationsDir, "0001_message_tree.sql"),
      "utf8",
    );

    expect(sql).toContain('ADD COLUMN "parent_id"');
    expect(sql).toContain('ADD COLUMN "active_leaf_message_id"');

    // The backfill is what makes every pre-existing chat keep rendering, and
    // nothing else covers it: the conformance suite applies migrations to an
    // empty database and only then inserts fixtures, so a migration that adds
    // the columns and populates neither passes every other test in this repo.
    // Asserted as "these columns get written", not as the SQL that writes them,
    // so a recursive-CTE rewrite producing the same rows still passes.
    expect(sql).toMatch(/UPDATE\s+"messages"[\s\S]*"parent_id"\s*=/u);
    expect(sql).toMatch(/UPDATE\s+"chats"[\s\S]*"active_leaf_message_id"\s*=/u);
  });

  it("keeps generated baseline identifiers within PostgreSQL limits", () => {
    const sql = readFileSync(
      join(migrationsDir, "0000_greenfield_baseline.sql"),
      "utf8",
    );
    const foreignKeyNames = [...sql.matchAll(/ADD CONSTRAINT "([^"]+)"/gu)].map(
      (match) => match[1] ?? "",
    );

    expect(foreignKeyNames).not.toHaveLength(0);
    expect(
      foreignKeyNames.filter((name) => Buffer.byteLength(name) > 63),
    ).toEqual([]);
  });
});
