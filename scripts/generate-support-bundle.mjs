import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  process.cwd(),
  argValue("--output") ?? "dist/ci/support-bundle.json",
);
const evidenceDirs = argValues("--evidence-dir");
if (evidenceDirs.length === 0) {
  evidenceDirs.push("dist/ci", "dist/release");
}
const logFiles = argValues("--log-file");
const evidence = evidenceInventory(evidenceDirs);
const bundle = {
  schemaVersion: "romeo.support-bundle.v1",
  generatedAt: new Date().toISOString(),
  status: "generated",
  runtime: runtimeSummary(),
  package: packageSummary(),
  configuration: configurationPosture(process.env),
  deployment: deploymentFiles(),
  migrations: migrationSummary(),
  evidence,
  complianceEvidence: complianceEvidenceLinks(evidence),
  dataRights: dataRightsPosture(),
  logs: logInventory(logFiles),
  redaction: {
    rawContentIncluded: false,
    secretValuesIncluded: false,
    notes: [
      "Evidence files are summarized by schema/status/hash only.",
      "Compliance evidence links contain metadata only and never embed report bodies.",
      "Data-rights posture contains API paths, command names, and static coverage categories only.",
      "Log files are summarized by basename/hash/size only.",
      "Environment values are reported only as configured booleans, safe enums, safe numbers, or URL hosts.",
    ],
  },
};

writeJson(outputPath, bundle);
console.log(
  `Wrote Romeo support bundle to ${supportPath(outputPath, "output")}`,
);

function runtimeSummary() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function packageSummary() {
  const pkg = readJsonIfExists(resolve(root, "package.json")) ?? {};
  return {
    name: safeString(pkg.name),
    version: safeString(pkg.version),
    packageManager: safeString(pkg.packageManager),
  };
}

function configurationPosture(env) {
  const safeEnums = {
    DATA_CONNECTOR_EXECUTION_DRIVER: [
      "disabled",
      "website-fetch",
      "github-fetch",
      "s3-fetch",
      "atlassian-fetch",
      "notion-fetch",
      "linear-fetch",
      "slack-fetch",
      "managed-fetch",
    ],
    DATA_CONNECTOR_EGRESS_POLICY: ["allow_public", "require_allowlist"],
    DEV_SEEDED_LOGIN: ["true", "false"],
    KNOWLEDGE_EXTRACTION_DRIVER: [
      "disabled",
      "local-pdftotext",
      "local-documents",
    ],
    NOTIFICATION_DELIVERY_DRIVER: [
      "disabled",
      "resend-email",
      "slack-webhook",
      "webhook",
    ],
    OBJECT_STORE_DRIVER: ["memory", "s3"],
    OPENWEBUI_COMPATIBILITY_ENABLED: ["true", "false"],
    REPOSITORY_DRIVER: ["memory", "postgres"],
    SECRET_RESOLVER_DRIVER: [
      "disabled",
      "env",
      "vault",
      "aws-sm",
      "gcp-sm",
      "azure-kv",
      "cloud",
    ],
    TENANCY_MODE: ["single", "multi"],
    TOOL_OPERATION_EXECUTION_DRIVER: ["disabled", "http-fetch"],
    BROWSER_AUTOMATION_NETWORK_POLICY_ENABLED: ["true", "false"],
    BROWSER_AUTOMATION_WORKER_ENABLED: ["true", "false"],
    VOICE_PROVIDER_DRIVER: ["disabled", "dev", "openai-compatible"],
  };
  const safeNumbers = [
    "BROWSER_AUTOMATION_LEASE_SECONDS",
    "BROWSER_AUTOMATION_MAX_BYTES",
    "BROWSER_AUTOMATION_MAX_JOBS",
    "BROWSER_AUTOMATION_TIMEOUT_MS",
    "DATA_CONNECTOR_FETCH_MAX_BYTES",
    "DATA_CONNECTOR_FETCH_TIMEOUT_MS",
    "KNOWLEDGE_EXTRACTION_MAX_BYTES",
    "KNOWLEDGE_EXTRACTION_TIMEOUT_MS",
    "MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS",
    "MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD",
    "MODEL_PROVIDER_RETRY_ATTEMPTS",
    "MODEL_PROVIDER_RETRY_BACKOFF_MS",
    "MODEL_PROVIDER_STREAM_TIMEOUT_MS",
    "POSTGRES_BACKUP_RETENTION_DAYS",
    "POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS",
    "POSTGRES_POOL_MAX",
    "TOOL_OPERATION_FETCH_MAX_BYTES",
    "TOOL_OPERATION_FETCH_TIMEOUT_MS",
  ];
  const urlHosts = [
    "APP_ORIGIN",
    "AZURE_KEY_VAULT_URL",
    "BROWSER_AUTOMATION_RUNNER_URL",
    "ROMEO_BASE_URL",
    "NOTIFICATION_RESEND_BASE_URL",
    "OIDC_ISSUER_URL",
    "S3_ENDPOINT",
    "VAULT_ADDR",
    "VOICE_OPENAI_BASE_URL",
  ];
  const configuredOnly = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AZURE_ACCESS_TOKEN",
    "BILLING_GENERIC_WEBHOOK_SECRET",
    "BILLING_STRIPE_WEBHOOK_SECRET",
    "BROWSER_AUTOMATION_LIVE_EVIDENCE_PATH",
    "DATA_CONNECTOR_GITHUB_TOKEN",
    "DELEGATED_OAUTH_GITHUB_CLIENT_SECRET",
    "DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY",
    "DATABASE_URL",
    "GCP_ACCESS_TOKEN",
    "LOCAL_AUTH_SECRET_ENCRYPTION_KEY",
    "ROMEO_API_KEY",
    "NOTIFICATION_RESEND_API_KEY",
    "MANAGED_SECRET_ENCRYPTION_KEY",
    "POSTGRES_BACKUP_MANIFEST_UPLOAD_URL",
    "POSTGRES_BACKUP_UPLOAD_URL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SESSION_SECRET",
    "SESSION_SECRET_PREVIOUS",
    "VAULT_TOKEN",
    "VOICE_OPENAI_API_KEY",
    "WEBHOOK_SIGNING_KEY",
  ];

  return {
    safeEnums: Object.fromEntries(
      Object.entries(safeEnums).map(([key, allowedValues]) => [
        key,
        safeEnumValue(env[key], allowedValues),
      ]),
    ),
    safeNumbers: Object.fromEntries(
      safeNumbers.map((key) => [key, safeNumberValue(env[key])]),
    ),
    urlHosts: Object.fromEntries(
      urlHosts.map((key) => [key, hostValue(env[key])]),
    ),
    configuredSecrets: Object.fromEntries(
      configuredOnly.map((key) => [key, isConfigured(env[key])]),
    ),
  };
}

function deploymentFiles() {
  return [
    "deploy/compose/compose.yml",
    "deploy/compose/external-postgres.compose.yml",
    "deploy/helm/Chart.yaml",
    "deploy/helm/values.yaml",
    "deploy/helm/values.schema.json",
    "deploy/monitoring/prometheus-rules.yaml",
    "deploy/monitoring/operational-exporter.deployment.example.yaml",
  ]
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => fileSummary(path));
}

function migrationSummary() {
  const dir = resolve(root, "packages/db/migrations");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => fileSummary(join("packages/db/migrations", name)))
    : [];
  return {
    count: files.length,
    files,
    greenfieldBaselineOnly:
      files.length === 1 &&
      files[0]?.path === "packages/db/migrations/0000_greenfield_baseline.sql",
  };
}

function evidenceInventory(dirs) {
  return dirs
    .flatMap((dir) => listEvidenceFiles(resolve(root, dir)))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function listEvidenceFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listEvidenceFiles(path));
    else if (entry.isFile()) files.push(evidenceFileSummary(path));
  }
  return files;
}

function evidenceFileSummary(path) {
  const summary = fileSummary(supportPath(path, "external-evidence"), path);
  if (!path.endsWith(".json")) return summary;
  const json = readJsonIfExists(path);
  const schemaVersion =
    safeString(json?.schemaVersion) ?? safeString(json?.schema);
  return {
    ...summary,
    schemaVersion,
    evidenceStatus: safeString(json?.status),
    releaseVersion: safeString(json?.release?.version),
  };
}

function complianceEvidenceLinks(evidence) {
  return {
    accessReview: evidenceLinkGroup(
      evidence.filter((item) => isAccessReviewEvidence(item)),
    ),
  };
}

function dataRightsPosture() {
  return {
    coverageApiPath: "/api/v1/governance/data-rights/coverage",
    exportPreviewApiPath: "/api/v1/governance/data-exports/preview",
    exportExecuteApiPath: "/api/v1/governance/data-exports/execute",
    deletionPreviewApiPath: "/api/v1/governance/data-deletions/preview",
    deletionExecuteApiPath: "/api/v1/governance/data-deletions/execute",
    supportedDeletionResourceTypes: ["chat", "file_object", "knowledge_source"],
    evidenceCommands: [
      "pnpm support:bundle",
      "pnpm smoke:support-bundle-redaction",
      "pnpm smoke:compose:backup-restore",
      "pnpm smoke:compose:tiered-rag",
      "pnpm evidence:data-rights-retention",
    ],
    retentionEvidence: {
      schemaVersion: "romeo.data-rights-retention-evidence.v1",
      operationalLogEvidencePathConfigured: isConfigured(
        process.env.DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH,
      ),
      backupEvidencePathConfigured: isConfigured(
        process.env.DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH,
      ),
      operationalLogEvidenceEnvKey:
        "DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH",
      backupEvidenceEnvKey: "DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH",
    },
    externalRetentionControls: ["operational_logs", "backups"],
  };
}

function evidenceLinkGroup(items) {
  const artifacts = items.map((item) => ({
    path: item.path,
    bytes: item.bytes,
    sha256: item.sha256,
    modifiedAt: item.modifiedAt,
    schemaVersion: item.schemaVersion,
    evidenceStatus: item.evidenceStatus,
  }));
  return {
    status: artifacts.length > 0 ? "present" : "missing",
    count: artifacts.length,
    artifacts,
  };
}

function isAccessReviewEvidence(item) {
  return (
    item.schemaVersion === "romeo.access-review-report.v1" ||
    item.path.toLowerCase().includes("access-review")
  );
}

function logInventory(paths) {
  return paths.map((path) => {
    const absolute = resolve(process.cwd(), path);
    const summary = fileSummary(
      supportPath(absolute, "external-log"),
      absolute,
    );
    return { ...summary, basename: basename(path) };
  });
}

function fileSummary(path, absolute = resolve(root, path)) {
  const stat = statSync(absolute);
  return {
    path,
    bytes: stat.size,
    sha256: sha256File(absolute),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function supportPath(absolute, externalPrefix) {
  const relativePath = relative(root, absolute);
  if (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith("../") &&
    !isAbsolute(relativePath)
  ) {
    return relativePath;
  }
  return `${externalPrefix}/${basename(absolute)}`;
}

function safeEnumValue(value, allowedValues) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return allowedValues.includes(value) ? value : "configured_unrecognized";
}

function safeNumberValue(value) {
  if (value === undefined || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hostValue(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function isConfigured(value) {
  return typeof value === "string" && value.length > 0;
}

function safeString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}
