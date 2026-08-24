import { readFileSync } from "node:fs";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";

const livePostgresUrl = postgresConformanceDatabaseUrl();

describe("background-job Postgres query and claim path", () => {
  it("keeps claims atomic, skip-locked, and compound-indexed", () => {
    const repositorySource = readFileSync(
      new URL("./operational-repository.ts", import.meta.url),
      "utf8",
    );
    const schemaSource = readFileSync(
      new URL("./schema/system.ts", import.meta.url),
      "utf8",
    );
    expect(repositorySource).toContain('.for("update", { skipLocked: true })');
    expect(repositorySource).toContain("this.db.transaction");
    expect(schemaSource).toContain(
      "background_jobs_org_type_status_created_id_idx",
    );
    expect(schemaSource).toContain(
      "background_jobs_org_type_status_updated_id_idx",
    );
  });

  if (livePostgresUrl === undefined) {
    it.skip(`runs contention and planner proof when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
    return;
  }

  it("lets concurrent workers claim distinct jobs and uses the compound index", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl);
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    try {
      const now = "2026-08-23T12:00:00.000Z";
      await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          fixture.repository.createBackgroundJob({
            id: `job_claim_contention_${index.toString().padStart(2, "0")}`,
            orgId: "org_default",
            type: "claim.contention",
            status: "queued",
            payload: { partition: "shared" },
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );

      const claimed = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          fixture.repository.claimBackgroundJob({
            leaseSeconds: 60,
            now: "2026-08-23T12:01:00.000Z",
            orgId: "org_default",
            payloadEquals: { partition: "shared" },
            type: "claim.contention",
            workerId: `worker_${index}`,
          }),
        ),
      );
      expect(claimed.every((job) => job !== undefined)).toBe(true);
      expect(new Set(claimed.map((job) => job?.id)).size).toBe(12);

      await sql`set enable_seqscan to off`;
      const plan = await sql`
        explain (format json)
        select id from background_jobs
        where org_id = 'org_default'
          and type = 'claim.contention'
          and status = 'queued'
        order by created_at, id
        limit 1
      `;
      expect(JSON.stringify(plan[0]?.["QUERY PLAN"])).toContain(
        "background_jobs_org_type_status_created_id_idx",
      );
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  });
});
