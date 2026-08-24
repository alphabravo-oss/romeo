import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";

const livePostgresUrl = postgresConformanceDatabaseUrl();

describe("native inventoried-table Postgres paging", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
    return;
  }

  it("bounds a 100k-row keyset page and uses the tenant sort index", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl);
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    try {
      await sql`
        insert into usage_events (
          id, org_id, workspace_id, actor_id, source_type, source_id,
          metric, quantity, unit, metadata, created_at
        )
        select
          'usage_native_scale_' || series::text,
          'org_default', 'workspace_default', 'user_dev_admin', 'run',
          'run_native_scale_' || series::text,
          case when series % 2 = 0 then 'tokens' else 'cost' end,
          series::double precision, 'count', '{}'::jsonb,
          '2026-08-23T00:00:00.000Z'::timestamptz
            + (series::text || ' milliseconds')::interval
        from generate_series(1, 100000) rows(series)
      `;
      await sql`analyze usage_events`;
      const plan = await sql`
        explain (format json)
        select id, created_at
        from usage_events
        where org_id = 'org_default'
        order by created_at desc, id desc
        limit 101
      `;
      const serializedPlan = JSON.stringify(plan[0]?.["QUERY PLAN"]);
      expect(serializedPlan).not.toContain("Seq Scan");
      expect(serializedPlan).toContain("usage_events_org_created_id_idx");

      const first = await fixture.repository.queryInventoriedTableRows({
        actorId: "user_dev_admin",
        actorType: "user",
        filters: [],
        includeTotals: true,
        limit: 101,
        orgId: "org_default",
        resource: "usage_events",
        searchFields: ["id", "metric"],
        sort: { direction: "desc", field: "createdAt" },
      });
      expect(first.items).toHaveLength(101);
      expect(first.total).toBeGreaterThanOrEqual(100_000);
      const last = first.items.at(-1);
      if (last === undefined || typeof last.createdAt !== "string")
        throw new Error("native page did not return a position");
      const second = await fixture.repository.queryInventoriedTableRows({
        actorId: "user_dev_admin",
        actorType: "user",
        filters: [],
        includeTotals: false,
        limit: 101,
        orgId: "org_default",
        position: { id: last.id, value: last.createdAt },
        resource: "usage_events",
        searchFields: ["id", "metric"],
        sort: { direction: "desc", field: "createdAt" },
      });
      expect(second.items).toHaveLength(101);
      expect(second.total).toBeUndefined();
      expect(second.items.some((row) => row.id === last.id)).toBe(false);
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 120_000);

  it("pages support projections without audit scans or per-session lookups", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl);
    const sql = postgres(fixture.databaseUrl, { max: 1 });
    try {
      await sql`
        insert into user_sessions (
          id, org_id, user_id, name, hashed_token, scopes, is_admin,
          expires_at, created_at
        ) values (
          'session_native_support', 'org_default', 'user_dev_admin',
          'Support session', ${"f".repeat(64)}, array['admin:read'], true,
          '2099-08-23T13:00:00.000Z', '2026-08-23T12:00:00.000Z'
        )
      `;
      await sql`
        insert into audit_logs (
          id, org_id, actor_id, action, resource_type, resource_id,
          outcome, metadata, created_at
        ) values
        (
          'audit_support_request_native', 'org_default', 'user_dev_admin',
          'support.impersonation.request.create',
          'support_impersonation_request', 'support_request_native', 'success',
          ${sql.json({
            targetUserId: "user_dev_admin",
            ttlMinutes: 20,
          })},
          '2026-08-23T11:59:00.000Z'
        ),
        (
          'audit_support_decision_native', 'org_default', 'user_dev_admin',
          'support.impersonation.request.approve',
          'support_impersonation_request', 'session_native_support', 'success',
          ${sql.json({ approvalRequestId: "support_request_native" })},
          '2026-08-23T11:59:30.000Z'
        ),
        (
          'audit_support_session_native', 'org_default', 'user_dev_admin',
          'support.impersonation.create', 'session', 'session_native_support',
          'success', ${sql.json({ targetUserId: "user_dev_admin" })},
          '2026-08-23T12:00:00.000Z'
        )
      `;

      const requests = await fixture.repository.queryInventoriedTableRows({
        actorId: "user_dev_admin",
        actorType: "user",
        filters: [{ field: "status", operator: "eq", value: "approved" }],
        includeTotals: true,
        limit: 26,
        orgId: "org_default",
        resource: "support_access_requests",
        searchFields: ["id", "targetUserId", "requestedByUserId"],
        sort: { direction: "desc", field: "createdAt" },
      });
      expect(requests.total).toBe(1);
      expect(requests.items).toEqual([
        expect.objectContaining({
          id: "support_request_native",
          sessionId: "session_native_support",
          status: "approved",
          targetUserId: "user_dev_admin",
        }),
      ]);

      const sessions = await fixture.repository.queryInventoriedTableRows({
        actorId: "user_dev_admin",
        actorType: "user",
        filters: [{ field: "status", operator: "eq", value: "active" }],
        includeTotals: true,
        limit: 26,
        orgId: "org_default",
        resource: "support_sessions",
        searchFields: ["id", "targetUserId", "adminUserId"],
        sort: { direction: "desc", field: "createdAt" },
      });
      expect(sessions.total).toBe(1);
      expect(sessions.items[0]).toMatchObject({
        id: "session_native_support",
        status: "active",
        session: { id: "session_native_support" },
      });

      await sql`set enable_seqscan = off`;
      const plan = await sql`
        explain (format json)
        select id, created_at
        from audit_logs
        where org_id = 'org_default'
          and action = 'support.impersonation.request.create'
          and resource_type = 'support_impersonation_request'
        order by created_at desc, id desc
        limit 26
      `;
      expect(JSON.stringify(plan[0]?.["QUERY PLAN"])).toContain(
        "audit_logs_support_request_created_idx",
      );
    } finally {
      await sql.end({ timeout: 5 });
      await fixture.close();
    }
  }, 120_000);
});
