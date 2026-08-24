import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";

const livePostgresUrl = postgresConformanceDatabaseUrl();
const before0041 = "0040_support_table_projection_indexes.sql";

describe("0041 normalized governance-export authority", () => {
  it("declares normalized shape, tenant-composite ownership, exact-role RLS, and one artifact per job", async () => {
    const migration = await migration0041();

    expect(migration).toContain(
      "FOREIGN KEY (org_id, workspace_id)\n    REFERENCES workspaces(org_id, id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (org_id, job_id)\n    REFERENCES governance_export_jobs(org_id, id)",
    );
    expect(migration).toContain(
      "ALTER TABLE governance_export_jobs FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "ALTER TABLE governance_export_artifacts FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("current_user = 'romeo_tenant_runtime'");
    expect(migration).toContain("current_user = 'romeo_system_coordinator'");
    expect(migration).not.toContain("pg_has_role(current_user");
    expect(migration).toContain(
      "ON governance_export_artifacts (org_id, job_id);",
    );
    expect(migration).toContain("governance_export_jobs_payload_shape_valid");
    expect(migration).toContain("governance_export_jobs_terminal_shape_valid");
  });

  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
    return;
  }

  it("rejects guessed cross-tenant workspace/job bindings and isolates runtime reads", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl, {
      throughMigration: before0041,
    });
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    try {
      await sql`
        insert into organizations (id, name, slug)
        values ('org_export_other', 'Export other', 'export-other')
      `;
      await sql`
        insert into workspaces (id, org_id, name, slug)
        values (
          'workspace_export_other', 'org_export_other',
          'Export other', 'export-other'
        )
      `;
      await apply0041(sql);

      await insertJob(sql, "org_default", "export_pkg_default00000000", null);
      await insertJob(
        sql,
        "org_export_other",
        "export_pkg_other000000000",
        null,
      );

      await expect(
        insertJob(
          sql,
          "org_default",
          "export_pkg_crossworkspace00",
          "workspace_export_other",
        ),
      ).rejects.toThrow(/governance_export_jobs_org_workspace_fk/iu);

      await expect(sql`
        insert into governance_export_artifacts (
          id, job_id, org_id, object_key, content_type, file_name,
          size_bytes, sha256, part_count, created_at, expires_at
        ) values (
          'artifact_cross_job', 'export_pkg_other000000000', 'org_default',
          'governance/data-exports/org_default/cross.manifest',
          'application/x-ndjson', 'cross.ndjson', 1, ${"a".repeat(64)}, 1,
          now(), now() + interval '1 hour'
        )
      `).rejects.toThrow(/governance_export_artifacts_org_job_fk/iu);

      const isolated = await sql.begin(async (transaction) => {
        await transaction.unsafe("set local role romeo_tenant_runtime");
        await transaction`
          select set_config('romeo.tenant_id', 'org_default', true)
        `;
        const visible = await transaction<{ id: string }[]>`
          select id from governance_export_jobs order by id
        `;
        await expect(
          transaction`
            insert into governance_export_jobs (
              id, org_id, created_by, request, snapshot_at, state,
              percent, checkpoint, counts, limits, warnings, exclusions,
              lease_attempt, version, created_at, updated_at
            ) values (
              'export_pkg_runtimeescape00', 'org_export_other',
              'user_dev_admin', '{"scope":"org"}'::jsonb, now(), 'queued', 0,
              '{"datasetIndex":0,"partCount":0,"processedRows":0,"sizeBytes":0}'::jsonb,
              '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
              0, 1, now(), now()
            )
          `,
        ).rejects.toThrow("new row violates row-level security policy");
        return visible;
      });
      expect(isolated).toEqual([{ id: "export_pkg_default00000000" }]);
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 60_000);
});

async function insertJob(
  sql: ReturnType<typeof postgres>,
  orgId: string,
  jobId: string,
  workspaceId: string | null,
): Promise<void> {
  const request =
    workspaceId === null
      ? { scope: "org" }
      : { scope: "workspace", workspaceId };
  await sql`
    insert into governance_export_jobs (
      id, org_id, workspace_id, created_by, request, snapshot_at, state,
      percent, checkpoint, counts, limits, warnings, exclusions,
      lease_attempt, version, created_at, updated_at
    ) values (
      ${jobId}, ${orgId}, ${workspaceId}, 'user_dev_admin', ${sql.json(request)},
      now(), 'queued', 0,
      ${sql.json({
        datasetIndex: 0,
        partCount: 0,
        processedRows: 0,
        sizeBytes: 0,
      })},
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
      0, 1, now(), now()
    )
  `;
}

async function apply0041(sql: ReturnType<typeof postgres>): Promise<void> {
  const migration = await migration0041();
  await sql.begin((transaction) => transaction.unsafe(migration));
}

function migration0041(): Promise<string> {
  return readFile(
    new URL(
      "../migrations/0041_normalized_governance_export_jobs.sql",
      import.meta.url,
    ),
    "utf8",
  );
}
