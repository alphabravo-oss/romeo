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
import { createHash } from "node:crypto";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { validateBackupDestinationPolicy } from "./lib/backup-destination-policy.mjs";

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
const statusOutputValue = argValue("--status-output");
const statusOutput =
  statusOutputValue === undefined
    ? `${manifestOutput}.status.json`
    : resolveRepoPath(statusOutputValue);
const command = argValue("--pg-dump") ?? "pg_dump";
const durabilityMode =
  argValue("--durability-mode") ??
  nonEmpty(process.env.POSTGRES_BACKUP_DURABILITY_MODE);
const destinations = {
  backupUpload: destination("--upload-url", "POSTGRES_BACKUP_UPLOAD_URL"),
  backupReadback: destination("--readback-url", "POSTGRES_BACKUP_READBACK_URL"),
  manifestUpload: destination(
    "--manifest-upload-url",
    "POSTGRES_BACKUP_MANIFEST_UPLOAD_URL",
  ),
  manifestReadback: destination(
    "--manifest-readback-url",
    "POSTGRES_BACKUP_MANIFEST_READBACK_URL",
  ),
  statusUpload: destination(
    "--status-upload-url",
    "POSTGRES_BACKUP_STATUS_UPLOAD_URL",
  ),
  statusReadback: destination(
    "--status-readback-url",
    "POSTGRES_BACKUP_STATUS_READBACK_URL",
  ),
  policyReadback: destination(
    "--policy-readback-url",
    "POSTGRES_BACKUP_POLICY_READBACK_URL",
  ),
};
const uploadTimeoutMs = positiveInteger(
  argValue("--upload-timeout-ms") ??
    process.env.POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS ??
    "30000",
  "POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS",
);
const retentionDays = argInteger("--retention-days", 0);
const backupSetId = nonEmpty(argValue("--backup-set-id"));
const checkpointAt = nonEmpty(argValue("--checkpoint-at"));
const localPersistenceEvidence = nonEmpty(
  argValue("--local-persistence-evidence") ??
    process.env.POSTGRES_BACKUP_LOCAL_PERSISTENCE_EVIDENCE,
);
const policyMaximumAgeSeconds = positiveInteger(
  argValue("--policy-max-age-seconds") ??
    process.env.POSTGRES_BACKUP_POLICY_MAX_AGE_SECONDS ??
    "3600",
  "POSTGRES_BACKUP_POLICY_MAX_AGE_SECONDS",
);
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

validateDurabilityMode();
validateCoordinationMetadata();

if (dryRun) {
  printPlan({
    operation: "postgres.backup",
    command,
    args,
    env: { PGCONNECTION: redactedConnection(databaseUrl) },
    output,
    manifestOutput,
    statusOutput,
    durabilityMode,
    retentionDays,
    backupSetId,
    checkpointAt,
    localPersistenceEvidenceConfigured: localPersistenceEvidence !== undefined,
    destinations: redactedDestinations(),
    uploadTimeoutMs,
  });
  process.exit(0);
}

ensureParentDirectory(output);
ensureParentDirectory(manifestOutput);
ensureParentDirectory(statusOutput);
const destinationPolicy =
  durabilityMode === "verified-upload"
    ? await fetchDestinationPolicy(destinations.policyReadback)
    : undefined;
runPostgresCommand({ command, args, databaseUrl });
const backup = await backupEvidence(output, new Date());
const backupDurability = await persistArtifact({
  contentType: "application/octet-stream",
  evidence: backup,
  label: "backup",
  path: output,
  readbackUrl: destinations.backupReadback,
  uploadUrl: destinations.backupUpload,
});
const manifest = {
  schemaVersion: "romeo.postgres-backup.v2",
  generatedAt: backup.generatedAt,
  database: redactedConnection(databaseUrl),
  durabilityMode,
  localPersistenceEvidenceHash:
    localPersistenceEvidence === undefined
      ? undefined
      : createHash("sha256").update(localPersistenceEvidence).digest("hex"),
  backupSetId,
  checkpointAt:
    checkpointAt === undefined
      ? undefined
      : new Date(checkpointAt).toISOString(),
  destinationPolicy,
  backup,
  retentionUntil:
    retentionDays === 0
      ? undefined
      : retentionUntil(backup.generatedAt, retentionDays),
  remoteBackup: backupDurability,
};
writeFileSync(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const manifestEvidence = await backupEvidence(manifestOutput, new Date());
const manifestDurability = await persistArtifact({
  contentType: "application/json",
  evidence: manifestEvidence,
  label: "manifest",
  path: manifestOutput,
  readbackUrl: destinations.manifestReadback,
  uploadUrl: destinations.manifestUpload,
});
const completedAt = new Date().toISOString();
const status = {
  schemaVersion: "romeo.postgres-backup-status.v1",
  generatedAt: completedAt,
  status: "passed",
  durabilityMode,
  destinationPolicy,
  lastSuccessAt: completedAt,
  backup: publicArtifactEvidence(backup),
  manifest: publicArtifactEvidence(manifestEvidence),
  remoteVerification:
    durabilityMode === "verified-upload"
      ? {
          backup: backupDurability,
          manifest: manifestDurability,
        }
      : undefined,
};
writeFileSync(statusOutput, `${JSON.stringify(status, null, 2)}\n`, "utf8");
const statusEvidence = await backupEvidence(statusOutput, new Date());
const statusDurability = await persistArtifact({
  contentType: "application/json",
  evidence: statusEvidence,
  label: "status",
  path: statusOutput,
  readbackUrl: destinations.statusReadback,
  uploadUrl: destinations.statusUpload,
});
console.log(`Wrote PostgreSQL backup to ${output}`);
console.log(`Wrote PostgreSQL backup manifest to ${manifestOutput}`);
console.log(`Wrote PostgreSQL backup status to ${statusOutput}`);
if (durabilityMode === "verified-upload") {
  console.log(`Verified durable PostgreSQL backup at ${backupDurability.url}`);
  console.log(
    `Verified durable PostgreSQL backup manifest at ${manifestDurability.url}`,
  );
  console.log(
    `Verified durable PostgreSQL backup status at ${statusDurability.url}`,
  );
}

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}

function nonEmpty(value) {
  return value === undefined || value.length === 0 ? undefined : value;
}

function destination(flag, environmentName) {
  return nonEmpty(argValue(flag) ?? process.env[environmentName]);
}

function validateDurabilityMode() {
  if (!["local-persistent", "verified-upload"].includes(durabilityMode)) {
    throw new Error(
      "POSTGRES_BACKUP_DURABILITY_MODE must be local-persistent or verified-upload.",
    );
  }
  if (durabilityMode === "local-persistent") {
    if (
      localPersistenceEvidence === undefined ||
      localPersistenceEvidence.trim().length < 16
    )
      throw new Error(
        "Local-persistent backups require --local-persistence-evidence naming the durable volume/storage owner.",
      );
    if (output === "/tmp" || output.startsWith("/tmp/"))
      throw new Error("Local-persistent backups may not use ephemeral /tmp.");
    return;
  }
  for (const [name, value] of Object.entries(destinations)) {
    if (value === undefined) {
      throw new Error(
        `Verified backup durability requires ${destinationEnvironmentName(name)}.`,
      );
    }
  }
}

function validateCoordinationMetadata() {
  if ((backupSetId === undefined) !== (checkpointAt === undefined))
    throw new Error(
      "--backup-set-id and --checkpoint-at must be supplied together.",
    );
  if (backupSetId !== undefined && backupSetId.length < 8)
    throw new Error("--backup-set-id must be at least 8 characters.");
  if (
    checkpointAt !== undefined &&
    Number.isNaN(new Date(checkpointAt).getTime())
  )
    throw new Error("--checkpoint-at must be an ISO timestamp.");
}

function destinationEnvironmentName(name) {
  return {
    backupUpload: "POSTGRES_BACKUP_UPLOAD_URL",
    backupReadback: "POSTGRES_BACKUP_READBACK_URL",
    manifestUpload: "POSTGRES_BACKUP_MANIFEST_UPLOAD_URL",
    manifestReadback: "POSTGRES_BACKUP_MANIFEST_READBACK_URL",
    statusUpload: "POSTGRES_BACKUP_STATUS_UPLOAD_URL",
    statusReadback: "POSTGRES_BACKUP_STATUS_READBACK_URL",
    policyReadback: "POSTGRES_BACKUP_POLICY_READBACK_URL",
  }[name];
}

async function fetchDestinationPolicy(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), uploadTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(
        `Backup destination policy readback failed with HTTP ${response.status}.`,
      );
    const declaredBytes = Number(response.headers.get("content-length") ?? "0");
    if (declaredBytes > 1024 * 1024)
      throw new Error("Backup destination policy exceeds 1 MiB.");
    const body = await response.text();
    if (Buffer.byteLength(body) > 1024 * 1024)
      throw new Error("Backup destination policy exceeds 1 MiB.");
    let policy;
    try {
      policy = JSON.parse(body);
    } catch {
      throw new Error("Backup destination policy is not valid JSON.");
    }
    return validateBackupDestinationPolicy(policy, {
      maximumAgeSeconds: policyMaximumAgeSeconds,
      minimumRetentionDays: retentionDays,
    });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        `Backup destination policy readback timed out after ${uploadTimeoutMs}ms.`,
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function redactedDestinations() {
  return Object.fromEntries(
    Object.entries(destinations)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, redactedRemoteUrl(value)]),
  );
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

function publicArtifactEvidence(evidence) {
  return {
    bytes: evidence.bytes,
    sha256: evidence.sha256,
    generatedAt: evidence.generatedAt,
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

async function persistArtifact({
  contentType,
  evidence,
  label,
  path,
  readbackUrl,
  uploadUrl,
}) {
  if (durabilityMode === "local-persistent") {
    return {
      type: "local_persistent",
      status: "completed",
      bytes: evidence.bytes,
      sha256: evidence.sha256,
    };
  }
  const upload = await uploadFile(
    path,
    uploadUrl,
    contentType,
    uploadTimeoutMs,
  );
  const readback = await verifyReadback({
    expectedBytes: evidence.bytes,
    expectedSha256: evidence.sha256,
    label,
    timeoutMs: uploadTimeoutMs,
    url: readbackUrl,
  });
  return {
    type: "verified_remote",
    status: "verified",
    url: upload.url,
    upload,
    readback,
  };
}

async function verifyReadback({
  expectedBytes,
  expectedSha256,
  label,
  timeoutMs,
  url,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Backup ${label} readback failed with HTTP ${response.status}.`,
      );
    const declaredBytes = response.headers.get("content-length");
    if (declaredBytes !== null && Number(declaredBytes) !== expectedBytes) {
      throw new Error(`Backup ${label} readback size mismatch.`);
    }
    if (response.body === null)
      throw new Error(`Backup ${label} readback returned no body.`);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > expectedBytes)
        throw new Error(`Backup ${label} readback size mismatch.`);
      hash.update(chunk);
    }
    if (bytes !== expectedBytes)
      throw new Error(`Backup ${label} readback size mismatch.`);
    const sha256 = hash.digest("hex");
    if (sha256 !== expectedSha256)
      throw new Error(`Backup ${label} readback digest mismatch.`);
    return {
      status: "verified",
      url: redactedRemoteUrl(url),
      statusCode: response.status,
      bytes,
      sha256,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        `Backup ${label} readback timed out after ${timeoutMs}ms.`,
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
