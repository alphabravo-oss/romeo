import { createDatabaseConnection } from "./client";
import { runMessagePartBackfill } from "./message-part-backfill";
import { createPostgresRomeoRepositoryFromDatabase } from "./romeo-repository";

const databaseUrl = argValue("--database-url") ?? process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0)
  throw new Error("DATABASE_URL or --database-url is required.");

const batch = {
  maxMessages: integerArg("--max-messages", 100),
  maxPartRows: integerArg("--max-part-rows", 2_000),
};
const maxBatches = integerArg("--max-batches", 100);
const connection = createDatabaseConnection(databaseUrl, { maxConnections: 2 });
try {
  const result = await runMessagePartBackfill({
    repository: createPostgresRomeoRepositoryFromDatabase(connection.db),
    batch,
    maxBatches,
  });
  process.stdout.write(
    `${JSON.stringify({
      operation: "message_parts.backfill.v1",
      ...result,
    })}\n`,
  );
  if (!result.completed) process.exitCode = 2;
} finally {
  await connection.close();
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function integerArg(name: string, fallback: number): number {
  const raw = argValue(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}
