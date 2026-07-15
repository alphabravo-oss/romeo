import { readEnv, type RomeoEnv } from "@romeo/config";
import {
  createRomeoApi,
  InMemoryRomeoRepository,
  type RomeoRepository,
} from "@romeo/core";
import {
  createDatabase,
  createPostgresRomeoRepositoryFromDatabase,
} from "@romeo/db";

const serverEnv = readEnv();

export const romeoServerApi = createRomeoApi(
  createServerRepository(serverEnv),
  { env: serverEnv },
);

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

  return new InMemoryRomeoRepository();
}

export function createPostgresRomeoRepository(
  databaseUrl: string,
  options: { maxConnections?: number } = {},
): RomeoRepository {
  return createPostgresRomeoRepositoryFromDatabase(
    createDatabase(databaseUrl, options),
  );
}
