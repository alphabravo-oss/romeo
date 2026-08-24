import type { RuntimeDatabaseReadinessProbe } from "@romeo/core";
import { sql } from "drizzle-orm";

import migrationJournal from "../migrations/meta/_journal.json";
import type { RomeoDatabase } from "./client";

interface MigrationRow extends Record<string, unknown> {
  createdAt: string;
}

interface RuntimeRoleRow extends Record<string, unknown> {
  bypassesRls: boolean;
  coordinator: boolean;
  inheritsPrivileges: boolean;
  superuser: boolean;
  tenantRuntime: boolean;
}

export function createPostgresRuntimeReadinessProbe(
  database: RomeoDatabase,
): RuntimeDatabaseReadinessProbe {
  return {
    async check(signal) {
      assertNotAborted(signal);
      const connected = await database.execute<{ ready: number }>(
        sql`select 1 as ready`,
      );
      assertNotAborted(signal);
      if (Number(connected[0]?.ready) !== 1) {
        return {
          connected: false,
          migrationsCurrent: false,
          runtimeRoleSafe: false,
        };
      }
      const roles = await database.execute<RuntimeRoleRow>(sql`
        select
          role.rolbypassrls as "bypassesRls",
          pg_has_role(current_user, 'romeo_system_coordinator', 'member') as coordinator,
          role.rolinherit as "inheritsPrivileges",
          role.rolsuper as superuser,
          pg_has_role(current_user, 'romeo_tenant_runtime', 'member') as "tenantRuntime"
        from pg_roles role
        where role.rolname = current_user
      `);
      const role = roles[0];
      const runtimeRoleSafe =
        role !== undefined &&
        !role.bypassesRls &&
        role.coordinator &&
        !role.inheritsPrivileges &&
        !role.superuser &&
        role.tenantRuntime;
      assertNotAborted(signal);
      const applied = await database.execute<MigrationRow>(sql`
        select created_at::text as "createdAt"
        from drizzle.__drizzle_migrations
        order by id asc
      `);
      assertNotAborted(signal);
      const expected = migrationJournal.entries.map((entry) =>
        String(entry.when),
      );
      const observed = applied.map((entry) => entry.createdAt);
      return {
        connected: true,
        runtimeRoleSafe,
        migrationsCurrent:
          observed.length === expected.length &&
          observed.every((value, index) => value === expected[index]),
      };
    },
  };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("runtime_readiness_probe_aborted");
}
