import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";

const livePostgresUrl = postgresConformanceDatabaseUrl();
const before0036 = "0035_versioned_webhook_signatures.sql";

describe("0036 system-settings scope upgrade", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
    return;
  }

  it("classifies every legacy producer family without promoting tenant rows", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl, {
      throughMigration: before0036,
    });
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    try {
      const tenantPrefixKeys = [
        "abuse_controls.org.v1:org_default",
        "auth_provider_settings.org.v1:org_default",
        "chat_experience.v1:org_default",
        "content_policy.v1:org_default",
        "content_policy.versions.v1:org_default",
        "content_policy.decisions.v1:org_default",
        "content_policy.approvals.v1:org_default",
        "image_job.v1:org_default:job_1",
        "interface_preferences.v1:org_default:user:user_1",
        "model.capability.override.v1:org_default:model_1",
        "model.capability.probe.v1:org_default:model_1",
        "notification_policy.org.v1:org_default",
        "policy_bundle.v1:org_default:bundle_1",
        "rag_policy.org.v1:org_default",
        "rag_policy.change_request.org.v1:org_default",
        "reasoning_policy.org.v1:org_default",
        "retention-progress:org_default:files",
        "table_view.v2:org_default:workspace_default:user_1:providers",
        "tenant_lifecycle.deletion_request.v1:org_default",
        "tenant_lifecycle.deletion_finalization_evidence.v1:org_default",
        "web_search.org.v1:org_default",
        "web_search.health.v1:org_default",
      ];
      const valueScopedKeys = [
        "governance.data_export_packages.org_default",
        "provider.catalog-sync-job.v1:job_1",
        "provider.connection-extras.v1:provider_1",
        "table_export.v1:org_default:job_1",
      ];
      for (const key of tenantPrefixKeys) {
        await sql`
          insert into system_settings (key, value)
          values (${key}, '{}'::jsonb)
        `;
      }
      for (const key of valueScopedKeys) {
        await sql`
          insert into system_settings (key, value)
          values (${key}, '{"orgId":"org_default"}'::jsonb)
        `;
      }
      await sql`
        insert into system_settings (key, value) values
          ('auth_provider_settings.global.v1', '{}'::jsonb),
          ('temporary-chat-cleanup.v1', '{}'::jsonb),
          ('scheduled-work.notification_retry.v1', '{}'::jsonb),
          ('tenant_lifecycle.deletion_purge_result.v1:deleted_org', '{}'::jsonb),
          ('managed_secret.v1:secret_global', '{"scope":"global"}'::jsonb),
          ('managed_secret.v1:secret_org', '{"scope":"org"}'::jsonb)
      `;
      await sql`
        insert into audit_logs (
          id, org_id, actor_id, action, resource_type, resource_id,
          outcome, metadata, created_at
        ) values (
          'audit_managed_secret_scope', 'org_default', 'user_dev_admin',
          'admin.managed_secret.create', 'managed_secret', 'secret_org',
          'success', '{"scope":"org"}'::jsonb, now()
        )
      `;

      await apply0036(sql);
      const rows = await sql<
        { key: string; orgId: string | null; scopeOrgId: string }[]
      >`
        select key, org_id as "orgId", scope_org_id as "scopeOrgId"
        from system_settings order by key
      `;
      const byKey = new Map(rows.map((row) => [row.key, row]));
      for (const key of [...tenantPrefixKeys, ...valueScopedKeys]) {
        expect(byKey.get(key)).toMatchObject({
          orgId: "org_default",
          scopeOrgId: "org_default",
        });
      }
      expect(byKey.get("managed_secret.v1:secret_org")).toMatchObject({
        orgId: "org_default",
        scopeOrgId: "org_default",
      });
      for (const key of [
        "auth_provider_settings.global.v1",
        "temporary-chat-cleanup.v1",
        "scheduled-work.notification_retry.v1",
        "tenant_lifecycle.deletion_purge_result.v1:deleted_org",
        "managed_secret.v1:secret_global",
      ]) {
        expect(byKey.get(key)).toMatchObject({
          orgId: null,
          scopeOrgId: "__global__",
        });
      }
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 60_000);

  it("fails closed on an unknown legacy key and reports only its digest", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl, {
      throughMigration: before0036,
    });
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    const unknownKey = "unknown-sensitive-family:tenant-secret-label";
    try {
      await sql`
        insert into system_settings (key, value)
        values (${unknownKey}, '{"credential":"must-not-leak"}'::jsonb)
      `;
      let message = "";
      try {
        await apply0036(sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain(md5(unknownKey));
      expect(message).not.toContain(unknownKey);
      expect(message).not.toContain("must-not-leak");
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 60_000);
});

async function apply0036(sql: ReturnType<typeof postgres>): Promise<void> {
  const migration = await readFile(
    new URL(
      "../migrations/0036_exact_role_system_settings_rls.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await sql.begin((transaction) => transaction.unsafe(migration));
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}
