import { readEnv, type RomeoEnv } from "@romeo/config";
import {
  createRomeoApiRuntime,
  createRuntimeSeedData,
  InMemoryRomeoRepository,
  type RomeoRepository,
} from "@romeo/core";
import {
  createDatabase,
  createDatabaseConnection,
  createPostgresRomeoRepositoryFromDatabase,
} from "@romeo/db";

const serverEnv = readEnv();

const serverRuntime = createServerRuntime(serverEnv);
export const romeoServerApi = serverRuntime.api;
export const closeRomeoServerRuntime = serverRuntime.close;

function createServerRuntime(env: RomeoEnv): {
  api: ReturnType<typeof createRomeoApiRuntime>["app"];
  close: () => Promise<void>;
} {
  if (env.REPOSITORY_DRIVER === "postgres") {
    const connection = createDatabaseConnection(env.DATABASE_URL, {
      maxConnections: env.POSTGRES_POOL_MAX,
    });
    const runtime = createRomeoApiRuntime(
      createPostgresRomeoRepositoryFromDatabase(connection.db),
      { env },
    );
    runtime.start();
    return {
      api: runtime.app,
      close: async () => {
        await runtime.close();
        await connection.close();
      },
    };
  }
  const runtime = createRomeoApiRuntime(createServerRepository(env), { env });
  runtime.start();
  return {
    api: runtime.app,
    close: () => runtime.close(),
  };
}

export function createServerRepository(
  env: RomeoEnv = readEnv(),
): RomeoRepository {
  if (env.REPOSITORY_DRIVER === "postgres") {
    return createPostgresRomeoRepository(env.DATABASE_URL, {
      maxConnections: env.POSTGRES_POOL_MAX,
    });
  }

  if (!env.DEV_SEEDED_LOGIN) {
    throw new Error(
      "REPOSITORY_DRIVER=postgres is required when DEV_SEEDED_LOGIN=false.",
    );
  }

  return new InMemoryRomeoRepository(createRuntimeSeedData());
}

export function createPostgresRomeoRepository(
  databaseUrl: string,
  options: { maxConnections?: number } = {},
): RomeoRepository {
  return createPostgresRomeoRepositoryFromDatabase(
    createDatabase(databaseUrl, options),
  );
}
