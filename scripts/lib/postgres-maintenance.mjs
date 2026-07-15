import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));

export function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

export function argInteger(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

export function readDatabaseUrl() {
  const value = argValue("--database-url") ?? process.env.DATABASE_URL;
  if (value === undefined || value.length === 0) {
    throw new Error("DATABASE_URL or --database-url is required.");
  }
  return value;
}

export function postgresEnvironment(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      "Postgres backup/restore requires a postgres:// or postgresql:// URL.",
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (database.length === 0)
    throw new Error("Database URL must include a database name.");
  const env = {
    PGDATABASE: database,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
  };
  if (parsed.username.length > 0)
    env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password.length > 0)
    env.PGPASSWORD = decodeURIComponent(parsed.password);
  const sslMode = parsed.searchParams.get("sslmode");
  const connectTimeout = parsed.searchParams.get("connect_timeout");
  if (sslMode !== null) env.PGSSLMODE = sslMode;
  if (connectTimeout !== null) env.PGCONNECT_TIMEOUT = connectTimeout;
  return env;
}

export function redactedConnection(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const user =
    parsed.username.length > 0 ? `${decodeURIComponent(parsed.username)}@` : "";
  const port = parsed.port.length > 0 ? `:${parsed.port}` : "";
  const database = parsed.pathname.replace(/^\//u, "");
  return `${parsed.protocol}//${user}${parsed.hostname}${port}/${database}`;
}

export function redactedRemoteUrl(value) {
  const parsed = new URL(value);
  parsed.username = "";
  parsed.password = "";
  if (parsed.search.length > 0) parsed.search = "?redacted=true";
  return parsed.toString();
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export async function assertExpectedSha256(path, expectedSha256) {
  if (expectedSha256 === undefined) return;
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256))
    throw new Error(
      "--expected-sha256 must be a lowercase SHA-256 hex digest.",
    );
  const actual = await sha256File(path);
  if (actual !== expectedSha256)
    throw new Error(
      `Backup checksum mismatch. Expected ${expectedSha256}, got ${actual}.`,
    );
}

export function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function repoPath(path) {
  return resolve(root, path);
}

export function ensureParentDirectory(path) {
  mkdirSync(dirname(path), { recursive: true });
}

export function runPostgresCommand({ command, args, databaseUrl }) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...postgresEnvironment(databaseUrl) },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function runPostgresCommandCapture({ command, args, databaseUrl }) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...postgresEnvironment(databaseUrl) },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

export function printPlan(plan) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}
