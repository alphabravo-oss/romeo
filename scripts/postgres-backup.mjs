import {
  argInteger,
  argValue,
  ensureParentDirectory,
  hasFlag,
  postgresEnvironment,
  printPlan,
  readDatabaseUrl,
  redactedConnection,
  redactedRemoteUrl,
  repoPath,
  runPostgresCommand,
  sha256File,
  timestampForFilename,
} from "./lib/postgres-maintenance.mjs";
import { createReadStream, statSync, writeFileSync } from "node:fs";

const databaseUrl = readDatabaseUrl();
const outputValue = argValue("--output");
const output =
  outputValue === undefined
    ? repoPath(`backups/romeo-postgres-${timestampForFilename()}.dump`)
    : resolveRepoPath(outputValue);
const manifestOutputValue = argValue("--manifest-output");
const manifestOutput =
  manifestOutputValue === undefined
    ? `${output}.manifest.json`
    : resolveRepoPath(manifestOutputValue);
const command = argValue("--pg-dump") ?? "pg_dump";
const uploadUrl = nonEmpty(
  argValue("--upload-url") ?? process.env.POSTGRES_BACKUP_UPLOAD_URL,
);
const manifestUploadUrl = nonEmpty(
  argValue("--manifest-upload-url") ??
    process.env.POSTGRES_BACKUP_MANIFEST_UPLOAD_URL,
);
const uploadTimeoutMs = positiveInteger(
  argValue("--upload-timeout-ms") ??
    process.env.POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS ??
    "30000",
  "POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS",
);
const retentionDays = argInteger("--retention-days", 0);
const database = postgresEnvironment(databaseUrl).PGDATABASE;
const args = [
  "--format=custom",
  "--no-owner",
  "--no-acl",
  "--dbname",
  database,
  "--file",
  output,
];
const dryRun = hasFlag("--dry-run");

if (dryRun) {
  printPlan({
    operation: "postgres.backup",
    command,
    args,
    env: { PGCONNECTION: redactedConnection(databaseUrl) },
    output,
    manifestOutput,
    retentionDays,
    upload:
      uploadUrl === undefined
        ? undefined
        : {
            type: "presigned_put",
            url: redactedRemoteUrl(uploadUrl),
            timeoutMs: uploadTimeoutMs,
          },
    manifestUpload:
      manifestUploadUrl === undefined
        ? undefined
        : {
            type: "presigned_put",
            url: redactedRemoteUrl(manifestUploadUrl),
            timeoutMs: uploadTimeoutMs,
          },
  });
  process.exit(0);
}

ensureParentDirectory(output);
ensureParentDirectory(manifestOutput);
runPostgresCommand({ command, args, databaseUrl });
const uploaded =
  uploadUrl === undefined
    ? undefined
    : await uploadFile(
        output,
        uploadUrl,
        "application/octet-stream",
        uploadTimeoutMs,
      );
const backup = await backupEvidence(output, new Date());
writeFileSync(
  manifestOutput,
  `${JSON.stringify(
    {
      schemaVersion: "romeo.postgres-backup.v1",
      generatedAt: backup.generatedAt,
      database: redactedConnection(databaseUrl),
      backup,
      retentionUntil:
        retentionDays === 0
          ? undefined
          : retentionUntil(backup.generatedAt, retentionDays),
      upload: uploaded,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const manifestUploaded =
  manifestUploadUrl === undefined
    ? undefined
    : await uploadFile(
        manifestOutput,
        manifestUploadUrl,
        "application/json",
        uploadTimeoutMs,
      );
console.log(`Wrote PostgreSQL backup to ${output}`);
console.log(`Wrote PostgreSQL backup manifest to ${manifestOutput}`);
if (uploaded !== undefined)
  console.log(`Uploaded PostgreSQL backup to ${uploaded.url}`);
if (manifestUploaded !== undefined)
  console.log(`Uploaded PostgreSQL backup manifest to ${manifestUploaded.url}`);

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}

function nonEmpty(value) {
  return value === undefined || value.length === 0 ? undefined : value;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

async function backupEvidence(path, generatedAt) {
  const stat = statSync(path);
  return {
    file: path,
    bytes: stat.size,
    sha256: await sha256File(path),
    generatedAt: generatedAt.toISOString(),
  };
}

function retentionUntil(generatedAt, days) {
  const date = new Date(generatedAt);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function uploadFile(path, url, contentType, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: createReadStream(path),
      duplex: "half",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Backup upload failed with HTTP ${response.status}.`);
    return {
      type: "presigned_put",
      status: "completed",
      url: redactedRemoteUrl(url),
      statusCode: response.status,
      timeoutMs,
      etag: response.headers.get("etag") ?? undefined,
    };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`Backup upload timed out after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
