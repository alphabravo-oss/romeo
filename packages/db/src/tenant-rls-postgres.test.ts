import { randomUUID } from "node:crypto";

import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { createDatabaseConnection } from "./client";
import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";
import { createPostgresRepositoryRequestScope } from "./tenant-database-context";
import { createPostgresRuntimeReadinessProbe } from "./runtime-readiness-probe";

const livePostgresUrl = postgresConformanceDatabaseUrl();

describe("live Postgres tenant RLS boundary", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
    return;
  }

  it("isolates exact active roles, settings, nested transactions, and pooled reuse", async () => {
    const fixture = await createLivePostgresRepositoryFixture(livePostgresUrl);
    const suffix = randomUUID().replaceAll("-", "");
    const appRole = `romeo_app_test_${suffix}`;
    const password = `Rls-${suffix}`;
    const adminSql = postgres(fixture.databaseUrl, { max: 1 });
    let runtimeSql: ReturnType<typeof postgres> | undefined;
    let runtimeConnection:
      | ReturnType<typeof createDatabaseConnection>
      | undefined;
    try {
      await adminSql.unsafe(
        `create role ${quoteIdentifier(appRole)} login password ${quoteLiteral(password)} noinherit nosuperuser nobypassrls`,
      );
      await adminSql.unsafe(
        `grant romeo_tenant_runtime, romeo_system_coordinator to ${quoteIdentifier(appRole)}`,
      );
      // Direct grants deliberately make ambient reads reach RLS. Exact-role
      // policies must still return zero rows until a transaction activates a
      // narrowly scoped runtime role.
      await adminSql.unsafe(
        `grant select, insert, update, delete on organizations, workspaces, system_settings, server_table_saved_views to ${quoteIdentifier(appRole)}`,
      );
      await adminSql`
        insert into organizations (id, name, slug)
        values ('org_rls_other', 'Other tenant', 'other-tenant')
      `;
      await adminSql`
        insert into workspaces (id, org_id, name, slug)
        values ('workspace_rls_other', 'org_rls_other', 'Other', 'other')
      `;
      await adminSql`
        insert into users (id, org_id, email, name)
        values ('user_rls_other', 'org_rls_other', 'other@example.test', 'Other')
      `;
      await adminSql`
        insert into system_settings (scope_org_id, key, org_id, value)
        values
          ('__global__', 'shared-key', null, '{"scope":"global"}'::jsonb),
          ('org_default', 'shared-key', 'org_default', '{"scope":"default"}'::jsonb),
          ('org_rls_other', 'shared-key', 'org_rls_other', '{"scope":"other"}'::jsonb)
      `;

      const appUrl = databaseUrlWithCredentials(
        fixture.databaseUrl,
        appRole,
        password,
      );
      runtimeSql = postgres(appUrl, { max: 1 });
      const ambientVisible = await runtimeSql<{ count: string }[]>`
        select count(*)::text as count from organizations
      `;
      expect(ambientVisible[0]?.count).toBe("0");
      await expect(
        runtimeSql`
          insert into workspaces (id, org_id, name, slug)
          values ('workspace_rls_ambient', 'org_default', 'Ambient', 'ambient')
        `,
      ).rejects.toThrow("new row violates row-level security policy");

      const visible = await runtimeSql.begin(async (transaction) => {
        await transaction.unsafe("set local role romeo_tenant_runtime");
        await transaction`select set_config('romeo.tenant_id', 'org_default', true)`;
        return transaction<{ id: string }[]>`
          select id from organizations order by id
        `;
      });
      expect(visible.map((row) => row.id)).toEqual(["org_default"]);

      await expect(
        runtimeSql.begin(async (transaction) => {
          await transaction.unsafe("set local role romeo_tenant_runtime");
          await transaction`select set_config('romeo.tenant_id', 'org_default', true)`;
          await transaction`
            insert into workspaces (id, org_id, name, slug)
            values ('workspace_rls_escape', 'org_rls_other', 'Escape', 'escape')
          `;
        }),
      ).rejects.toThrow("new row violates row-level security policy");

      await expect(
        runtimeSql.begin(async (transaction) => {
          await transaction.unsafe("set local role romeo_tenant_runtime");
          await transaction`select set_config('romeo.tenant_id', 'org_default', true)`;
          await transaction`
            insert into server_table_saved_views (
              id, org_id, workspace_id, owner_user_id, resource,
              parent_scope_key, name, name_normalized, query, presentation,
              visibility, schema_version, version
            ) values (
              'view_cross_workspace', 'org_default', 'workspace_rls_other',
              'user_dev_admin', 'usage_events', '', 'Cross workspace',
              'cross workspace',
              '{"sort":[],"filters":[],"pageSize":25}'::jsonb,
              '{"columnVisibility":{},"density":"comfortable"}'::jsonb,
              'private', 2, 1
            )
          `;
        }),
      ).rejects.toThrow(/server_table_saved_views_org_workspace_fk/iu);
      await expect(
        runtimeSql.begin(async (transaction) => {
          await transaction.unsafe("set local role romeo_tenant_runtime");
          await transaction`select set_config('romeo.tenant_id', 'org_default', true)`;
          await transaction`
            insert into server_table_saved_views (
              id, org_id, workspace_id, owner_user_id, resource,
              parent_scope_key, name, name_normalized, query, presentation,
              visibility, schema_version, version
            ) values (
              'view_cross_owner', 'org_default', 'workspace_default',
              'user_rls_other', 'usage_events', '', 'Cross owner',
              'cross owner',
              '{"sort":[],"filters":[],"pageSize":25}'::jsonb,
              '{"columnVisibility":{},"density":"comfortable"}'::jsonb,
              'private', 2, 1
            )
          `;
        }),
      ).rejects.toThrow(/server_table_saved_views_org_owner_fk/iu);

      const isolatedSettings = await runtimeSql.begin(async (transaction) => {
        await transaction.unsafe("set local role romeo_tenant_runtime");
        await transaction`select set_config('romeo.tenant_id', 'org_default', true)`;
        const own = await transaction<{ key: string; scope: string }[]>`
          select key, value ->> 'scope' as scope
          from system_settings where key = 'shared-key'
        `;
        const guessed = await transaction<{ count: string }[]>`
          select count(*)::text as count from system_settings
          where scope_org_id = 'org_rls_other' and key = 'shared-key'
        `;
        await expect(
          transaction`
            insert into system_settings (scope_org_id, key, org_id, value)
            values ('org_rls_other', 'guessed-key', 'org_rls_other', '{}'::jsonb)
          `,
        ).rejects.toThrow("new row violates row-level security policy");
        return { guessed: guessed[0]?.count, own };
      });
      expect(isolatedSettings).toEqual({
        guessed: "0",
        own: [{ key: "shared-key", scope: "default" }],
      });

      const afterPoolReuse = await runtimeSql<{ count: string }[]>`
        select count(*)::text as count from organizations
      `;
      expect(afterPoolReuse[0]?.count).toBe("0");

      const systemVisible = await runtimeSql.begin(async (transaction) => {
        await transaction.unsafe("set local role romeo_system_coordinator");
        const organizations = await transaction<{ id: string }[]>`
          select id from organizations order by id
        `;
        const settings = await transaction<{ scopeOrgId: string }[]>`
          select scope_org_id as "scopeOrgId" from system_settings
          where key = 'shared-key' order by scope_org_id
        `;
        return { organizations, settings };
      });
      expect(systemVisible.organizations.map((row) => row.id)).toEqual([
        "org_default",
        "org_rls_other",
      ]);
      expect(systemVisible.settings.map((row) => row.scopeOrgId)).toEqual([
        "__global__",
        "org_default",
        "org_rls_other",
      ]);

      runtimeConnection = createDatabaseConnection(appUrl, {
        maxConnections: 1,
      });
      const requestScope = createPostgresRepositoryRequestScope(
        runtimeConnection.db,
      );
      const readinessProbe = createPostgresRuntimeReadinessProbe(
        runtimeConnection.db,
      );
      await expect(
        readinessProbe.check(new AbortController().signal),
      ).resolves.toMatchObject({
        connected: true,
        migrationsCurrent: true,
        runtimeRoleSafe: true,
      });
      await requestScope.runAsTenant("org_default", (repository) =>
        repository.transaction(async (nested) => {
          expect(await nested.listOrganizations("org_default")).toHaveLength(1);
          expect(
            await nested.getSystemSetting("shared-key", "org_default"),
          ).toMatchObject({ orgId: "org_default" });
        }),
      );
      const reset = await runtimeConnection.db.execute<{ count: string }>(
        drizzleSql`select count(*)::text as count from organizations`,
      );
      expect(reset[0]?.count).toBe("0");

      await adminSql.unsafe(
        `revoke romeo_tenant_runtime from ${quoteIdentifier(appRole)}`,
      );
      await expect(
        readinessProbe.check(new AbortController().signal),
      ).resolves.toMatchObject({
        connected: true,
        runtimeRoleSafe: false,
      });
      await expect(
        requestScope.runAsTenant("org_default", (repository) =>
          repository.listOrganizations("org_default"),
        ),
      ).rejects.toThrow(
        /permission denied to set role|must be member of role/iu,
      );
      await adminSql.unsafe(
        `grant romeo_tenant_runtime to ${quoteIdentifier(appRole)}`,
      );

      await assertPolicyInventory(adminSql);
      const runtimeRoles = await adminSql<
        {
          bypassRls: boolean;
          canLogin: boolean;
          inheritsPrivileges: boolean;
          roleName: string;
        }[]
      >`
        select rolname as "roleName", rolcanlogin as "canLogin",
          rolbypassrls as "bypassRls", rolinherit as "inheritsPrivileges"
        from pg_roles
        where rolname in ('romeo_tenant_runtime', 'romeo_system_coordinator')
        order by rolname
      `;
      expect(runtimeRoles).toEqual([
        {
          roleName: "romeo_system_coordinator",
          canLogin: false,
          bypassRls: false,
          inheritsPrivileges: false,
        },
        {
          roleName: "romeo_tenant_runtime",
          canLogin: false,
          bypassRls: false,
          inheritsPrivileges: false,
        },
      ]);
    } finally {
      await runtimeConnection?.close();
      await runtimeSql?.end({ timeout: 5 });
      await adminSql.end({ timeout: 5 });
      await fixture.close();
      const admin = postgres(livePostgresUrl, { max: 1 });
      try {
        await admin.unsafe(`drop role if exists ${quoteIdentifier(appRole)}`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
  }, 60_000);
});

async function assertPolicyInventory(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  const missingPolicies = await sql<{ tableName: string }[]>`
    with recursive tenant_tables(oid) as (
      select distinct relation.oid
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      left join information_schema.columns tenant_column
        on tenant_column.table_schema = namespace.nspname
        and tenant_column.table_name = relation.relname
        and tenant_column.column_name = 'org_id'
      where namespace.nspname = 'public'
        and relation.relkind = 'r'
        and (tenant_column.column_name is not null or relation.relname = 'organizations')
      union
      select foreign_key.conrelid
      from pg_constraint foreign_key
      join tenant_tables parent on parent.oid = foreign_key.confrelid
      where foreign_key.contype = 'f'
    )
    select relation.relname as "tableName"
    from tenant_tables tenant_table
    join pg_class relation on relation.oid = tenant_table.oid
    where not relation.relrowsecurity
      or not relation.relforcerowsecurity
      or not exists (
        select 1 from pg_policy policy
        where policy.polrelid = relation.oid
          and policy.polname = 'romeo_tenant_isolation'
      )
    order by relation.relname
  `;
  expect(missingPolicies).toEqual([]);
}

function databaseUrlWithCredentials(
  databaseUrl: string,
  username: string,
  password: string,
): string {
  const parsed = new URL(databaseUrl);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value))
    throw new Error("unsafe_test_role_identifier");
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
