import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RomeoRepository } from "@romeo/core";
import postgres from "postgres";

import { createDatabaseConnection, type RomeoDatabase } from "../client";
import { createPostgresRomeoRepositoryFromDatabase } from "../romeo-repository";
import { groups, organizations, users, workspaces } from "../schema";

export const POSTGRES_CONFORMANCE_DATABASE_URL_ENV =
  "ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL";

export interface LivePostgresRepositoryFixture {
  databaseName: string;
  databaseUrl: string;
  repository: RomeoRepository;
  close: () => Promise<void>;
}

export function postgresConformanceDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[POSTGRES_CONFORMANCE_DATABASE_URL_ENV];
  return value === undefined || value.length === 0 ? undefined : value;
}

export async function createLivePostgresRepositoryFixture(
  adminDatabaseUrl: string,
): Promise<LivePostgresRepositoryFixture> {
  const databaseName = `romeo_conformance_${randomUUID().replaceAll("-", "")}`;
  const targetUrl = databaseUrlWithDatabase(adminDatabaseUrl, databaseName);
  const admin = postgres(adminDatabaseUrl, { max: 1 });
  let connection: ReturnType<typeof createDatabaseConnection> | undefined;

  await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

  try {
    await applyGreenfieldBaseline(targetUrl);
    connection = createDatabaseConnection(targetUrl);
    await seedConformanceFixtures(connection.db);
  } catch (error) {
    await dropDatabase(admin, databaseName);
    await admin.end({ timeout: 5 });
    throw error;
  }

  return {
    databaseName,
    databaseUrl: targetUrl,
    repository: createPostgresRomeoRepositoryFromDatabase(connection.db),
    close: async () => {
      await connection?.close();
      await dropDatabase(admin, databaseName);
      await admin.end({ timeout: 5 });
    },
  };
}

async function applyGreenfieldBaseline(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const statement of greenfieldMigrationStatements()) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function greenfieldMigrationStatements(): string[] {
  const migrationsDir = fileURLToPath(
    new URL("../../migrations/", import.meta.url),
  );
  return readdirSync(migrationsDir)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()
    .flatMap((fileName) => {
      const migration = readFileSync(
        new URL(`../../migrations/${fileName}`, import.meta.url),
        { encoding: "utf8" },
      );
      return migration
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    });
}

async function seedConformanceFixtures(db: RomeoDatabase): Promise<void> {
  await db.insert(organizations).values({
    id: "org_default",
    name: "Romeo Local",
    slug: "romeo-local",
  });
  await db.insert(workspaces).values({
    id: "workspace_default",
    orgId: "org_default",
    name: "Default",
    slug: "default",
  });
  await db.insert(users).values({
    id: "user_dev_admin",
    orgId: "org_default",
    email: "admin@romeo.local",
    name: "Romeo Admin",
    role: "global_admin",
  });
  await db.insert(groups).values({
    id: "group_admins",
    orgId: "org_default",
    name: "Admins",
    slug: "admins",
  });
}

async function dropDatabase(
  admin: ReturnType<typeof postgres>,
  databaseName: string,
): Promise<void> {
  await admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(databaseName)} AND pid <> pg_backend_pid()`,
  );
  await admin.unsafe(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`,
  );
}

function databaseUrlWithDatabase(
  databaseUrl: string,
  databaseName: string,
): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error(`Unsafe Postgres identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
