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
      "0002_message_run_error.sql",
      "0003_message_model_id.sql",
      "0004_base_model_default_parameters.sql",
      "0005_workspace_membership_backfill.sql",
      "0006_queued_turn_agentic_rag.sql",
      "0007_billing_event_receipts.sql",
      "0008_saml_auth_requests.sql",
      "0009_local_mfa_challenges.sql",
      "0010_queued_turn_routing_mode.sql",
      "0011_queued_turn_research_mode.sql",
      "0012_webhook_delivery_leases.sql",
      "0013_run_event_sequences.sql",
      "0014_run_event_retention.sql",
      "0015_capability_assignments.sql",
      "0016_audit_log_keyset_index.sql",
      "0017_audit_log_search_trigram.sql",
      "0018_workspace_folder_item_batch_index.sql",
      "0019_message_page_keyset_index.sql",
      "0020_chat_transcript_version.sql",
      "0021_exact_chat_branch_selection.sql",
      "0022_organization_capability_flags.sql",
      "0023_idempotency_receipts.sql",
      "0024_versioned_capability_assignment_scopes.sql",
      "0025_queued_turn_reasoning_policy.sql",
      "0026_typed_message_part_rollout.sql",
      "0027_secure_file_lifecycle.sql",
      "0028_eval_reasoning_policy_metrics.sql",
      "0029_message_file_references.sql",
      "0030_reasoning_summary_event_shape.sql",
      "0031_inventoried_table_sort_indexes.sql",
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
    const transcriptVersionSql = readFileSync(
      join(migrationsDir, "0020_chat_transcript_version.sql"),
      "utf8",
    );
    expect(transcriptVersionSql).toContain(
      'ADD COLUMN IF NOT EXISTS "transcript_version" bigint DEFAULT 0 NOT NULL',
    );
    expect(transcriptVersionSql).toContain(
      'BEFORE UPDATE OF "active_leaf_message_id" ON "chats"',
    );
    expect(transcriptVersionSql).toContain(
      "REFERENCING NEW TABLE AS new_message_rows",
    );
    expect(transcriptVersionSql).toContain(
      "new_rows IS DISTINCT FROM old_rows",
    );
    const exactBranchSql = readFileSync(
      join(migrationsDir, "0021_exact_chat_branch_selection.sql"),
      "utf8",
    );
    expect(exactBranchSql).toContain(
      'ADD COLUMN IF NOT EXISTS "parent_message_configured" boolean DEFAULT false NOT NULL',
    );
    expect(exactBranchSql).toContain(
      'ADD COLUMN IF NOT EXISTS "parent_message_id" text',
    );
    expect(exactBranchSql).toContain(
      'CREATE INDEX IF NOT EXISTS "messages_chat_parent_created_id_idx"',
    );
    const capabilityFlagsSql = readFileSync(
      join(migrationsDir, "0022_organization_capability_flags.sql"),
      "utf8",
    );
    expect(capabilityFlagsSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "organization_capability_flag_active_unique_idx"',
    );
    expect(capabilityFlagsSql).toContain(
      'CREATE INDEX IF NOT EXISTS "organization_capability_flag_history_idx"',
    );
    const idempotencySql = readFileSync(
      join(migrationsDir, "0023_idempotency_receipts.sql"),
      "utf8",
    );
    expect(idempotencySql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_receipt_scope_unique_idx"',
    );
    expect(idempotencySql).toContain(
      'CREATE INDEX IF NOT EXISTS "idempotency_receipt_expiry_idx"',
    );
    const assignmentScopesSql = readFileSync(
      join(migrationsDir, "0024_versioned_capability_assignment_scopes.sql"),
      "utf8",
    );
    expect(assignmentScopesSql).toContain(
      'ADD COLUMN IF NOT EXISTS "capability_defaults" jsonb',
    );
    expect(assignmentScopesSql).toContain(
      'CONSTRAINT "agent_versions_capability_defaults_size_check"',
    );
    expect(assignmentScopesSql).toContain(
      "'organization', 'workspace', 'agent', 'group', 'user'",
    );
    const queuedReasoningSql = readFileSync(
      join(migrationsDir, "0025_queued_turn_reasoning_policy.sql"),
      "utf8",
    );
    expect(queuedReasoningSql).toContain(
      'ADD COLUMN IF NOT EXISTS "reasoning_policy" jsonb',
    );
    expect(queuedReasoningSql).toContain(
      'CONSTRAINT "queued_chat_turn_reasoning_policy_size_check"',
    );
    const typedPartsSql = readFileSync(
      join(migrationsDir, "0026_typed_message_part_rollout.sql"),
      "utf8",
    );
    expect(typedPartsSql).toContain(
      'ADD COLUMN IF NOT EXISTS "parts_schema_version" integer DEFAULT 0 NOT NULL',
    );
    expect(typedPartsSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "message_parts_message_canonical_position_unique_idx"',
    );
    expect(typedPartsSql).toContain("pg_advisory_xact_lock");
    expect(typedPartsSql).toContain("romeo-message-text-v1:");
    expect(typedPartsSql).not.toMatch(
      /\bUPDATE\s+"?(?:messages|message_parts)"?\b/iu,
    );
    const fileLifecycleSql = readFileSync(
      join(migrationsDir, "0027_secure_file_lifecycle.sql"),
      "utf8",
    );
    expect(fileLifecycleSql).toContain(
      'ADD COLUMN IF NOT EXISTS "lifecycle_version" bigint DEFAULT 0 NOT NULL',
    );
    expect(fileLifecycleSql).toContain(
      'CREATE INDEX IF NOT EXISTS "object_records_lifecycle_claim_idx"',
    );
    expect(fileLifecycleSql).toContain("object_records_lifecycle_lease_check");
    expect(fileLifecycleSql).not.toMatch(/\bUPDATE\s+"?object_records"?\b/iu);
    const evalReasoningSql = readFileSync(
      join(migrationsDir, "0028_eval_reasoning_policy_metrics.sql"),
      "utf8",
    );
    expect(evalReasoningSql).toContain(
      'ADD COLUMN IF NOT EXISTS "reasoning_policy" jsonb',
    );
    expect(evalReasoningSql).toContain(
      'CONSTRAINT "eval_runs_reasoning_policy_shape_check"',
    );
    expect(evalReasoningSql).toContain(
      'CONSTRAINT "eval_runs_metrics_shape_check"',
    );
    const fileReferencesSql = readFileSync(
      join(migrationsDir, "0029_message_file_references.sql"),
      "utf8",
    );
    expect(fileReferencesSql).toContain(
      'CREATE TABLE IF NOT EXISTS "message_file_references"',
    );
    expect(fileReferencesSql).toContain(
      'CONSTRAINT "message_file_references_pk" PRIMARY KEY',
    );
    expect(fileReferencesSql).toContain(
      'CREATE INDEX IF NOT EXISTS "message_file_references_file_idx"',
    );
    expect(fileReferencesSql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM)\b/iu,
    );
    const reasoningSummarySql = readFileSync(
      join(migrationsDir, "0030_reasoning_summary_event_shape.sql"),
      "utf8",
    );
    expect(reasoningSummarySql).toContain(
      'CONSTRAINT "run_events_reasoning_summary_shape_check"',
    );
    expect(reasoningSummarySql).toContain("reasoning.summary.delta");
    expect(reasoningSummarySql).toContain("reasoning.summary.completed");
    expect(reasoningSummarySql).toContain("provider_safe_summary");
    expect(reasoningSummarySql).toContain("hidden_reasoning_omitted");
    expect(reasoningSummarySql).toContain("NOT VALID");
    expect(reasoningSummarySql).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM)\b/iu,
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

  it("backfills durable per-run event sequence allocation", () => {
    const sql = readFileSync(
      join(migrationsDir, "0013_run_event_sequences.sql"),
      "utf8",
    );

    expect(sql).toContain('ADD COLUMN "next_event_sequence" bigint');
    expect(sql).toContain(
      'ALTER TABLE "run_events" ALTER COLUMN "sequence" SET DATA TYPE bigint',
    );
    expect(sql).toContain('SELECT MAX("run_events"."sequence")');
    expect(sql).toContain('WHERE "run_events"."run_id" = "runs"."id"');
  });

  it("adds bounded run-event retention policy and query support", () => {
    const sql = readFileSync(
      join(migrationsDir, "0014_run_event_retention.sql"),
      "utf8",
    );

    expect(sql).toContain('ADD COLUMN "run_event_retention_days" integer');
    expect(sql).toContain('CREATE INDEX "runs_org_completed_idx"');
  });

  it("adds immutable, tenant-scoped capability assignment history", () => {
    const sql = readFileSync(
      join(migrationsDir, "0015_capability_assignments.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE "capability_assignments"');
    expect(sql).toContain('"supersedes_id" text');
    expect(sql).toContain('"version" bigint NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "capability_assignment_active_unique_idx"',
    );
    expect(sql).toContain('WHERE "revoked_at" is null');
    expect(sql).toContain(
      'CONSTRAINT "capability_assignment_config_size_check"',
    );
  });

  it("adds the stable tenant-scoped audit keyset index", () => {
    const sql = readFileSync(
      join(migrationsDir, "0016_audit_log_keyset_index.sql"),
      "utf8",
    );

    expect(sql).toContain(
      'CREATE INDEX "audit_logs_org_created_id_idx" ON "audit_logs" USING btree ("org_id", "created_at", "id")',
    );
  });

  it("adds an additive trigram expression index for audit search", () => {
    const baseline = readFileSync(
      join(migrationsDir, "0000_greenfield_baseline.sql"),
      "utf8",
    );
    const sql = readFileSync(
      join(migrationsDir, "0017_audit_log_search_trigram.sql"),
      "utf8",
    );

    expect(baseline).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    expect(sql).toContain('CREATE INDEX "audit_logs_search_trgm_idx"');
    expect(sql).toContain('lower("action" || chr(31)');
    expect(sql).toContain("gin_trgm_ops");
    expect(sql).not.toMatch(/\b(?:ALTER|DROP|UPDATE)\b/u);
  });

  it("adds the tenant-scoped workspace folder item batch index", () => {
    const sql = readFileSync(
      join(migrationsDir, "0018_workspace_folder_item_batch_index.sql"),
      "utf8",
    );

    expect(sql).toContain(
      'CREATE INDEX "workspace_folder_item_batch_idx" ON "workspace_folder_items" USING btree ("org_id", "workspace_id", "folder_id", "created_at", "id")',
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
