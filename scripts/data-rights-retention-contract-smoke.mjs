import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const outputPath =
  argValue("--output") ?? "dist/ci/data-rights-retention-contract-smoke.json";
const tempDir = mkdtempSync(join(tmpdir(), "romeo-data-rights-retention-"));
const logEvidence = join(tempDir, "operational-log-retention.json");
const backupEvidence = join(tempDir, "backup-retention.json");
const supportBundle = join(tempDir, "support-bundle.json");
const rawPathSentinel = tempDir;
const rawBodySentinels = [
  "raw-log-host-contract-sentinel",
  "s3://tenant-sensitive-retention-bucket/raw-object-key",
  "RETENTION_SECRET_VALUE",
];

runNode([
  "scripts/record-data-rights-retention-evidence.mjs",
  "--control",
  "operational_logs",
  "--retention-days",
  "30",
  "--reviewed-system-count",
  "2",
  "--immutable-window-days",
  "7",
  "--output",
  logEvidence,
]);
runNode([
  "scripts/record-data-rights-retention-evidence.mjs",
  "--control",
  "backups",
  "--status",
  "failed",
  "--retention-days",
  "90",
  "--destruction-validated",
  "false",
  "--failure-code",
  "destruction_drill_missing",
  "--output",
  backupEvidence,
]);

const logRetention = readJson(logEvidence);
const backupRetention = readJson(backupEvidence);
assertRetentionEvidence(logRetention, {
  control: "operational_logs",
  status: "passed",
  retentionDays: 30,
});
assertRetentionEvidence(backupRetention, {
  control: "backups",
  status: "failed",
  retentionDays: 90,
});

appendRawSentinels(logEvidence);
appendRawSentinels(backupEvidence);
runNode(
  [
    "scripts/generate-support-bundle.mjs",
    "--output",
    supportBundle,
    "--evidence",
    logEvidence,
    "--evidence",
    backupEvidence,
  ],
  {
    DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH: logEvidence,
    DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH: backupEvidence,
    RETENTION_CONTRACT_SECRET: rawBodySentinels[2],
  },
);
const support = readJson(supportBundle);
const serializedSupport = JSON.stringify(support);
if (
  support.dataRights?.retentionEvidence
    ?.operationalLogEvidencePathConfigured !== true ||
  support.dataRights?.retentionEvidence?.backupEvidencePathConfigured !== true
) {
  throw new Error(
    "Support bundle did not record data-rights retention evidence posture.",
  );
}
if (!support.dataRights.retentionEvidence.operationalLogEvidenceEnvKey) {
  throw new Error(
    "Support bundle omitted retention evidence env-key metadata.",
  );
}
if (serializedSupport.includes(rawPathSentinel)) {
  throw new Error("Support bundle leaked raw data-rights evidence path.");
}
for (const sentinel of rawBodySentinels) {
  if (serializedSupport.includes(sentinel)) {
    throw new Error(
      `Support bundle leaked raw retention sentinel: ${sentinel}`,
    );
  }
}

const rejectedCases = [
  rejectNode(
    [
      "scripts/record-data-rights-retention-evidence.mjs",
      "--control",
      "operational_logs",
      "--status",
      "passed",
      "--retention-days",
      "30",
      "--failure-code",
      "should_not_pass",
      "--output",
      join(tempDir, "invalid-failure-code.json"),
    ],
    "passed_status_rejects_failure_code",
  ),
  rejectNode(
    [
      "scripts/record-data-rights-retention-evidence.mjs",
      "--control",
      "backups",
      "--status",
      "passed",
      "--retention-days",
      "30",
      "--destruction-validated",
      "false",
      "--output",
      join(tempDir, "invalid-destruction.json"),
    ],
    "passed_status_rejects_missing_destruction_validation",
  ),
  rejectNode(
    [
      "scripts/record-data-rights-retention-evidence.mjs",
      "--control",
      "logs",
      "--retention-days",
      "30",
      "--output",
      join(tempDir, "invalid-control.json"),
    ],
    "invalid_control_rejected",
  ),
  rejectNode(
    [
      "scripts/record-data-rights-retention-evidence.mjs",
      "--control",
      "backups",
      "--output",
      join(tempDir, "missing-retention-days.json"),
    ],
    "missing_retention_days_rejected",
  ),
];

const evidence = {
  schemaVersion: "romeo.data-rights-retention-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "retention_evidence_positive_generation",
    "retention_evidence_failed_status_generation",
    "retention_evidence_invalid_cli_inputs_rejected",
    "support_bundle_records_retention_evidence_posture",
    "support_bundle_omits_retention_evidence_paths_and_bodies",
  ],
  generatedEvidence: {
    operationalLogs: evidenceSummary(logRetention),
    backups: evidenceSummary(backupRetention),
  },
  rejectedCases,
  supportBundle: {
    schemaVersion: support.schemaVersion,
    dataRightsEvidenceConfigured:
      support.dataRights.retentionEvidence
        .operationalLogEvidencePathConfigured === true &&
      support.dataRights.retentionEvidence.backupEvidencePathConfigured ===
        true,
    evidenceCount: support.evidence.length,
  },
  redaction: {
    backupLocationsReturned: false,
    evidenceFileBodiesReturned: false,
    rawEvidencePathsReturned: false,
    rawLogDestinationsReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(resolve(process.cwd(), outputPath), evidence);
console.log(`Wrote data-rights retention contract smoke to ${outputPath}`);

function assertRetentionEvidence(value, expected) {
  if (value.schemaVersion !== "romeo.data-rights-retention-evidence.v1") {
    throw new Error("Unexpected data-rights retention evidence schema.");
  }
  if (value.control !== expected.control || value.status !== expected.status) {
    throw new Error("Unexpected data-rights retention evidence posture.");
  }
  if (value.retentionDays !== expected.retentionDays) {
    throw new Error("Unexpected data-rights retention days.");
  }
  if (value.redaction?.backupLocationIncluded !== false) {
    throw new Error("Retention evidence redaction metadata is incomplete.");
  }
}

function appendRawSentinels(path) {
  const value = readJson(path);
  writeJson(path, {
    ...value,
    rawLogDestination: rawBodySentinels[0],
    backupLocation: rawBodySentinels[1],
    secretValue: rawBodySentinels[2],
  });
}

function evidenceSummary(value) {
  return {
    schemaVersion: value.schemaVersion,
    control: value.control,
    status: value.status,
    retentionDays: value.retentionDays,
    destructionValidated: value.destructionValidated,
    encryptedAtRest: value.encryptedAtRest,
    immutableWindowDays: value.immutableWindowDays,
    reviewedSystemCount: value.reviewedSystemCount,
    failureCodeCount: value.failureCodes.length,
  };
}

function runNode(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: node ${args.join(" ")}\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function rejectNode(args, id) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    throw new Error(`Expected command to fail for case: ${id}`);
  }
  return {
    id,
    status: "rejected",
    stdoutBytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
