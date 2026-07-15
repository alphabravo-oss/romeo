import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  argValue,
  assertComposeLogsRedacted,
  assertAttachmentReadable,
  assertDurableSmokeRecords,
  assertKnowledgeQuery,
  assertReadinessReady,
  cleanupComposeHarness,
  compose,
  createAdminApiKey,
  createComposeHarness,
  createDurableSmokeRecords,
  expectUnauthorizedMe,
  parsePositiveInteger,
  randomProjectName,
  repoPath,
  waitForHealth,
  writeJsonEvidence,
  writeComposeEnv,
} from "./lib/compose-smoke-support.mjs";

const keep = process.argv.includes("--keep");
const timeoutMs = parsePositiveInteger("--timeout-ms", 240000);
const sourceProjectName =
  argValue("--source-project-name") ??
  randomProjectName("romeo_backup_source");
const restoreProjectName =
  argValue("--restore-project-name") ??
  randomProjectName("romeo_backup_restore");

const rootTmp = repoPath("tmp");
mkdirSync(rootTmp, { recursive: true });
const tempDir = mkdtempSync(join(rootTmp, "compose-backup-restore-"));
const backupDir = join(tempDir, "backups");
mkdirSync(backupDir, { recursive: true });

const source = await createComposeHarness({
  projectName: sourceProjectName,
  timeoutMs,
  tempDir: join(tempDir, "source"),
});
const restore = await createComposeHarness({
  projectName: restoreProjectName,
  timeoutMs,
  tempDir: join(tempDir, "restore"),
});

const dumpContainerPath = "/smoke-backups/romeo-postgres.dump";
const manifestContainerPath =
  "/smoke-backups/romeo-postgres.dump.manifest.json";
const validationContainerPath =
  "/smoke-backups/restored-postgres-validation.json";
const drillContainerPath = "/smoke-backups/romeo-dr-drill.json";
const objectManifestContainerPath = "/smoke-backups/object-store/manifest.json";
const objectDrillContainerPath =
  "/smoke-backups/romeo-object-store-dr-drill.json";
const manifestPath = join(backupDir, "romeo-postgres.dump.manifest.json");
const validationPath = join(backupDir, "restored-postgres-validation.json");
const drillPath = join(backupDir, "romeo-dr-drill.json");
const objectManifestPath = join(backupDir, "object-store", "manifest.json");
const objectDrillPath = join(backupDir, "romeo-object-store-dr-drill.json");

let adminToken;
let records;

try {
  writeComposeEnv(source, { devSeededLogin: true });
  compose(source, ["up", "-d", "--build", "app"]);
  await waitForHealth(source);
  compose(source, [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "seed:postgres",
    "--",
    "--confirm-development-seed",
  ]);

  adminToken = await createAdminApiKey(source);
  writeComposeEnv(source, { devSeededLogin: false });
  compose(source, ["up", "-d", "--force-recreate", "app"]);
  await waitForHealth(source);
  await expectUnauthorizedMe(source);
  await assertReadinessReady(source, adminToken);

  records = await createDurableSmokeRecords(source, adminToken, {
    titlePrefix: "Compose backup restore smoke",
    fileName: "compose-backup-restore-smoke.txt",
    content:
      "Romeo backup restore smoke validates restored Postgres records and queryable knowledge chunks.",
    createAttachment: true,
  });

  compose(source, [
    "--profile",
    "backup",
    "run",
    "--rm",
    "--build",
    "-v",
    `${backupDir}:/smoke-backups`,
    "postgres-backup",
    "pnpm",
    "backup:postgres",
    "--",
    "--output",
    dumpContainerPath,
    "--manifest-output",
    manifestContainerPath,
    "--retention-days",
    "30",
  ]);

  const manifest = readJson(manifestPath);
  const backupSha256 = manifest.backup?.sha256;
  if (typeof backupSha256 !== "string" || backupSha256.length !== 64) {
    throw new Error("Postgres backup manifest did not include a SHA-256.");
  }
  assertEvidenceRedacted("backup manifest", manifestPath, [
    source.postgresPassword,
    source.s3Secret,
    source.sessionSecret,
    source.webhookSigningKey,
    adminToken,
  ]);

  compose(source, [
    "--profile",
    "backup",
    "run",
    "--rm",
    "--build",
    "-v",
    `${backupDir}:/smoke-backups`,
    "object-store-backup",
    "pnpm",
    "backup:object-store",
    "--",
    "--output-dir",
    "/smoke-backups/object-store",
    "--manifest-output",
    objectManifestContainerPath,
  ]);
  const objectManifest = readJson(objectManifestPath);
  if (
    !Array.isArray(objectManifest.objects) ||
    objectManifest.objects.length === 0
  ) {
    throw new Error("Object-store backup manifest did not include objects.");
  }
  if (
    !objectManifest.objects.some((object) =>
      object.key.includes(records.attachment.id),
    )
  ) {
    throw new Error(
      "Object-store backup manifest did not include the run attachment object.",
    );
  }
  assertEvidenceRedacted("object-store backup manifest", objectManifestPath, [
    source.postgresPassword,
    source.s3Secret,
    source.sessionSecret,
    source.webhookSigningKey,
    adminToken,
  ]);

  writeComposeEnv(restore, { devSeededLogin: false });
  compose(restore, ["up", "-d", "postgres"]);
  compose(restore, ["up", "-d", "rustfs", "object-store-init"]);
  compose(restore, [
    "run",
    "--rm",
    "--build",
    "-v",
    `${backupDir}:/smoke-backups`,
    "-e",
    "RESTORE_S3_ENDPOINT=http://rustfs:9000",
    "-e",
    "RESTORE_S3_BUCKET=romeo",
    "-e",
    "RESTORE_S3_ACCESS_KEY_ID=romeo",
    "-e",
    `RESTORE_S3_SECRET_ACCESS_KEY=${restore.s3Secret}`,
    "-e",
    "RESTORE_S3_REGION=us-east-1",
    "migrate",
    "pnpm",
    "drill:object-store-restore",
    "--",
    "--manifest",
    objectManifestContainerPath,
    "--output",
    objectDrillContainerPath,
    "--confirm-isolated-target",
  ]);

  const objectDrillEvidence = readJson(objectDrillPath);
  if (objectDrillEvidence.status !== "passed") {
    throw new Error(
      `Object-store DR drill did not pass: ${JSON.stringify(objectDrillEvidence, null, 2)}`,
    );
  }
  assertEvidenceRedacted("object-store DR drill evidence", objectDrillPath, [
    restore.s3Secret,
    source.s3Secret,
    adminToken,
  ]);

  compose(restore, [
    "run",
    "--rm",
    "--build",
    "-v",
    `${backupDir}:/smoke-backups`,
    "-e",
    `DRILL_DATABASE_URL=postgres://romeo:${restore.postgresPassword}@postgres:5432/romeo`,
    "migrate",
    "pnpm",
    "drill:postgres-restore",
    "--",
    "--input",
    dumpContainerPath,
    "--expected-sha256",
    backupSha256,
    "--output",
    drillContainerPath,
    "--confirm-isolated-target",
  ]);

  const drillEvidence = readJson(drillPath);
  if (drillEvidence.status !== "passed") {
    throw new Error(
      `DR drill did not pass: ${JSON.stringify(drillEvidence, null, 2)}`,
    );
  }
  assertEvidenceRedacted("DR drill evidence", drillPath, [
    restore.postgresPassword,
    source.postgresPassword,
    adminToken,
  ]);

  compose(restore, [
    "run",
    "--rm",
    "-v",
    `${backupDir}:/smoke-backups`,
    "migrate",
    "pnpm",
    "validate:postgres",
    "--",
    "--output",
    validationContainerPath,
  ]);
  assertEvidenceRedacted("restored schema validation", validationPath, [
    restore.postgresPassword,
    source.postgresPassword,
    adminToken,
  ]);

  compose(restore, ["up", "-d", "app"]);
  await waitForHealth(restore);
  await expectUnauthorizedMe(restore);
  await assertReadinessReady(restore, adminToken);
  await assertDurableSmokeRecords(restore, adminToken, records);
  await assertKnowledgeQuery(
    restore,
    adminToken,
    "backup restore queryable knowledge chunks",
    records.sourceId,
  );
  await assertAttachmentReadable(restore, adminToken, records.attachment);

  assertComposeLogsRedacted(
    source,
    [
      adminToken,
      source.postgresPassword,
      source.s3Secret,
      source.sessionSecret,
      source.webhookSigningKey,
    ],
    "Source Compose logs",
  );
  assertComposeLogsRedacted(
    restore,
    [
      adminToken,
      restore.postgresPassword,
      restore.s3Secret,
      restore.sessionSecret,
      restore.webhookSigningKey,
    ],
    "Restore Compose logs",
  );

  writeJsonEvidence({
    schemaVersion: "romeo.compose-backup-restore-smoke.v1",
    generatedAt: new Date().toISOString(),
    sourceProjectName,
    restoreProjectName,
    status: "passed",
    evidence: {
      backupManifest: "backups/romeo-postgres.dump.manifest.json",
      objectStoreBackupManifest: "backups/object-store/manifest.json",
      drDrill: "backups/romeo-dr-drill.json",
      objectStoreDrDrill: "backups/romeo-object-store-dr-drill.json",
      restoredSchemaValidation: "backups/restored-postgres-validation.json",
    },
    checks: [
      "source_compose_start",
      "source_migration_service",
      "explicit_development_seed",
      "source_secure_recreate_with_seeded_login_disabled",
      "source_admin_readiness_ready",
      "source_records_created",
      "postgres_backup_manifest_sha256",
      "backup_manifest_redacted",
      "object_store_backup_manifest",
      "object_store_backup_manifest_redacted",
      "isolated_object_store_restore_passed",
      "object_store_dr_drill_evidence_redacted",
      "isolated_dr_restore_passed",
      "dr_drill_evidence_redacted",
      "restored_schema_validation",
      "restored_schema_validation_redacted",
      "restored_app_readiness_ready",
      "restored_chat_readback",
      "restored_knowledge_source_readback",
      "restored_knowledge_query",
      "restored_attachment_readback",
      "source_compose_logs_redacted",
      "restore_compose_logs_redacted",
    ],
  });
} finally {
  if (!keep) {
    cleanupComposeHarness(source);
    cleanupComposeHarness(restore);
    rmSync(tempDir, { force: true, recursive: true });
  } else {
    process.stderr.write(
      `Keeping Compose projects ${sourceProjectName} and ${restoreProjectName}; evidence is under ${tempDir}.\n`,
    );
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertEvidenceRedacted(label, path, secrets) {
  const text = readFileSync(path, "utf8");
  for (const secret of secrets) {
    if (
      typeof secret === "string" &&
      secret.length > 0 &&
      text.includes(secret)
    ) {
      throw new Error(`${label} leaked a generated secret in ${path}.`);
    }
  }
}
