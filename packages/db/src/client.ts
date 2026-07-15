import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export const defaultDatabasePoolMax = 10;

export interface DatabaseConnectionOptions {
  maxConnections?: number;
}

export function createDatabase(
  databaseUrl: string,
  options: DatabaseConnectionOptions = {},
) {
  return createDatabaseConnection(databaseUrl, options).db;
}

export function createDatabaseConnection(
  databaseUrl: string,
  options: DatabaseConnectionOptions = {},
) {
  const client = postgres(databaseUrl, {
    max: normalizeDatabasePoolMax(options.maxConnections),
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export function normalizeDatabasePoolMax(value = defaultDatabasePoolMax) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Database pool max must be a positive integer.");
  }
  return value;
}

export type RomeoDatabase = ReturnType<typeof createDatabase>;
