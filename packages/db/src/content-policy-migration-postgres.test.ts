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
const before0039 = "0038_native_table_page_indexes.sql";

describe("0039 normalized content-policy upgrade", () => {
  it("declares exact-role forced RLS, tenant-composite bindings, and fail-closed retirement", async () => {
    const migration = await migration0039();
    expect(migration).toContain(
      "ALTER TABLE content_policy_approvals FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("current_user = 'romeo_tenant_runtime'");
    expect(migration).toContain("current_user = 'romeo_system_coordinator'");
    expect(migration).not.toContain("pg_has_role(current_user");
    expect(migration).toContain(
      "FOREIGN KEY (org_id, run_id) REFERENCES runs(org_id, id)",
    );
    expect(migration).toContain("FOREIGN KEY (org_id, execution_job_id)");
    expect(migration).toContain("refused to retire %s unnormalized");
    expect(migration.indexOf("refused to retire")).toBeLessThan(
      migration.indexOf("DELETE FROM system_settings"),
    );
  });

  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
    return;
  }

  it("normalizes valid decisions, retires only their legacy setting, and installs forced RLS", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl, {
      throughMigration: before0039,
    });
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    try {
      await sql`
        insert into system_settings (key, scope_org_id, org_id, value)
        values (
          'content_policy.decisions.v1:org_default',
          'org_default',
          'org_default',
          ${sql.json({
            schema: "romeo.content-policy.decisions.v1",
            decisions: [
              {
                id: "decision_upgrade",
                versionId: "version_upgrade",
                surface: "run_output",
                action: "block",
                detectors: [
                  { action: "block", code: "email_address", count: 1 },
                ],
                decidedAt: "2026-08-23T12:00:00.000Z",
              },
            ],
          })}
        )
      `;

      await apply0039(sql);

      const decisions = await sql<
        { id: string; orgId: string; policyVersionId: string }[]
      >`
        select id, org_id as "orgId", policy_version_id as "policyVersionId"
        from content_policy_decisions
      `;
      expect(decisions).toEqual([
        {
          id: "decision_upgrade",
          orgId: "org_default",
          policyVersionId: "version_upgrade",
        },
      ]);
      expect(
        await sql`
          select key from system_settings
          where key = 'content_policy.decisions.v1:org_default'
        `,
      ).toHaveLength(0);
      const policies = await sql<{ force: boolean; rls: boolean }[]>`
        select relforcerowsecurity as force, relrowsecurity as rls
        from pg_class
        where relname in ('content_policy_decisions', 'content_policy_approvals')
      `;
      expect(policies).toHaveLength(2);
      expect(policies.every((policy) => policy.force && policy.rls)).toBe(true);
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 60_000);

  it("fails closed without deleting an orphan legacy approval or leaking its fields", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl, {
      throughMigration: before0039,
    });
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    const key = "content_policy.approvals.v1:org_default";
    const sensitiveRunId = "run_secret_customer_label";
    try {
      await sql`
        insert into system_settings (key, scope_org_id, org_id, value)
        values (
          ${key}, 'org_default', 'org_default',
          ${sql.json({
            schema: "romeo.content-policy.approvals.v1",
            approvals: [
              {
                id: "approval_orphan",
                runId: sensitiveRunId,
                decisionId: "decision_orphan",
                actorId: "user_dev_admin",
                state: "pending",
                expiresAt: "2026-08-24T12:00:00.000Z",
                createdAt: "2026-08-23T12:00:00.000Z",
              },
            ],
          })}
        )
      `;
      let message = "";
      try {
        await apply0039(sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain(md5(key));
      expect(message).not.toContain(key);
      expect(message).not.toContain(sensitiveRunId);
      expect(
        await sql`select key from system_settings where key = ${key}`,
      ).toHaveLength(1);
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 60_000);
});

async function apply0039(sql: ReturnType<typeof postgres>): Promise<void> {
  const migration = await migration0039();
  await sql.begin((transaction) => transaction.unsafe(migration));
}

function migration0039(): Promise<string> {
  return readFile(
    new URL(
      "../migrations/0039_normalized_content_policy_approvals.sql",
      import.meta.url,
    ),
    "utf8",
  );
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}
