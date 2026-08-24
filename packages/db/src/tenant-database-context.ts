import type { RepositoryRequestScope, RomeoRepository } from "@romeo/core";
import { sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { createPostgresRomeoRepositoryFromDatabase } from "./romeo-repository";
import {
  type RuntimeRolePosture,
  RuntimeRolePostureValidator,
} from "./runtime-role-posture-validator";

const validators = new WeakMap<object, RuntimeRolePostureValidator>();

export function createPostgresRepositoryRequestScope(
  database: RomeoDatabase,
): RepositoryRequestScope {
  const validator = runtimeRoleValidator(database);
  const runtime = createPostgresRomeoRepositoryFromDatabase(database).runtime;
  return {
    runAsSystem: (work) =>
      work(
        createShortLivedScopedRepository(runtime, (operation) =>
          withSystemCoordinatorDatabaseContext(database, operation, validator),
        ),
      ),
    runAsTenant: (orgId, work) =>
      work(
        createShortLivedScopedRepository(runtime, (operation) =>
          withTenantDatabaseContext(database, orgId, operation, validator),
        ),
      ),
  };
}

/**
 * A request, stream, or detached callback may retain this proxy safely. Each
 * repository method opens one fresh role-bound database scope. Only an
 * explicit repository.transaction callback pins the scoped repository for a
 * multi-operation atomic unit.
 */
export function createShortLivedScopedRepository(
  runtime: RomeoRepository["runtime"],
  run: <T>(work: (repository: RomeoRepository) => Promise<T>) => Promise<T>,
): RomeoRepository {
  const target = runtime === undefined ? {} : { runtime };
  return new Proxy(target as RomeoRepository, {
    get(_target, property) {
      if (property === "runtime") return runtime;
      if (property === "then") return undefined;
      if (property === "transaction")
        return <T>(work: (repository: RomeoRepository) => Promise<T>) =>
          run(work);
      if (typeof property !== "string") return undefined;
      return (...args: unknown[]) =>
        run(async (repository) => {
          const member = Reflect.get(repository, property);
          if (typeof member !== "function")
            throw new TypeError("repository_method_unavailable");
          return await Reflect.apply(member, repository, args);
        });
    },
  });
}

export async function withTenantDatabaseContext<T>(
  database: RomeoDatabase,
  orgId: string,
  work: (repository: RomeoRepository) => Promise<T>,
  validator = runtimeRoleValidator(database),
): Promise<T> {
  const tenantId = orgId.trim();
  if (tenantId.length === 0 || tenantId.length > 200)
    throw new Error("tenant_database_context_org_id_invalid");
  await validator.assertEligible();
  return database.transaction(async (transaction) => {
    await transaction.execute(sql.raw("set local role romeo_tenant_runtime"));
    await transaction.execute(
      sql`select set_config('romeo.tenant_id', ${tenantId}, true)`,
    );
    return work(
      createPostgresRomeoRepositoryFromDatabase(
        transaction as unknown as RomeoDatabase,
      ),
    );
  });
}

export async function withSystemCoordinatorDatabaseContext<T>(
  database: RomeoDatabase,
  work: (repository: RomeoRepository) => Promise<T>,
  validator = runtimeRoleValidator(database),
): Promise<T> {
  await validator.assertEligible();
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql.raw("set local role romeo_system_coordinator"),
    );
    return work(
      createPostgresRomeoRepositoryFromDatabase(
        transaction as unknown as RomeoDatabase,
      ),
    );
  });
}

export function runtimeRoleValidator(
  database: RomeoDatabase,
): RuntimeRolePostureValidator {
  const existing = validators.get(database);
  if (existing !== undefined) return existing;
  const validator = new RuntimeRolePostureValidator(() =>
    loadRuntimeRolePosture(database),
  );
  validators.set(database, validator);
  return validator;
}

export async function loadRuntimeRolePosture(
  database: RomeoDatabase,
): Promise<RuntimeRolePosture | undefined> {
  const rows = await database.execute<RuntimeRolePosture>(sql`
    select
      role.rolbypassrls as "bypassesRls",
      pg_has_role(current_user, 'romeo_system_coordinator', 'member') as coordinator,
      role.rolinherit as "inheritsPrivileges",
      role.rolsuper as superuser,
      pg_has_role(current_user, 'romeo_tenant_runtime', 'member') as "tenantRuntime"
    from pg_roles role
    where role.rolname = current_user
  `);
  return rows[0];
}
