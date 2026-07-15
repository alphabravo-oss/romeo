import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  apiJson,
  argValue,
  assertAttachmentReadable,
  assertDurableSmokeRecords,
  assertProductWorkflowSmokeRecords,
  assertReadinessReady,
  createAdminApiKey,
  createDurableSmokeRecords,
  createProductWorkflowSmokeRecords,
  expectUnauthorizedMe,
  parsePositiveInteger,
  repoPath,
  root,
  waitForHealth,
} from "./lib/compose-smoke-support.mjs";
import {
  applyResources,
  assertTextDoesNotContain,
  deleteNamespace,
  freePort,
  helm,
  kubectl,
  kubectlJson,
  podLogs,
  randomKubernetesName,
  run,
  startPortForward,
  waitForJobComplete,
  waitForKubectlRollout,
} from "./lib/kubernetes-smoke-support.mjs";
import {
  maintenanceJob,
  objectStoreInitJob,
  persistentVolumeClaim,
  postgresDeployment,
  rustfsDeployment,
  secret,
  secretEnv,
  seedJob,
  service,
  toolboxPod,
  valkeyDeployment,
} from "./lib/kubernetes-dr-resources.mjs";
import { readKubernetesDrPlan } from "./lib/kubernetes-dr-plan.mjs";

const mode = argValue("--mode") ?? "external-postgres";
if (!["external-postgres", "cloudnativepg"].includes(mode)) {
  throw new Error("--mode must be external-postgres or cloudnativepg.");
}
const drPlanPath = argValue("--dr-plan-file");
const drPlan =
  drPlanPath === undefined
    ? undefined
    : readKubernetesDrPlan(repoPath(drPlanPath));
const drPlanMode = drPlan?.modes?.[mode];

const dryRun = process.argv.includes("--dry-run");
const keep = process.argv.includes("--keep");
const skipBuild = process.argv.includes("--skip-build");
const releaseName =
  argValue("--release-name") ?? drPlanMode?.releaseName ?? "romeo-dr";
const image =
  argValue("--image") ??
  drPlanMode?.image ??
  `romeo/kubernetes-dr-smoke:${Date.now()}`;
const timeoutMs = parsePositiveInteger("--timeout-ms", 420000);
const outputPath = argValue("--output");
const sourceNamespace =
  argValue("--source-namespace") ??
  drPlanMode?.sourceNamespace ??
  randomKubernetesName("romeo-dr-source");
const restoreNamespace =
  argValue("--restore-namespace") ??
  drPlanMode?.restoreNamespace ??
  randomKubernetesName("romeo-dr-restore");
const sourceNamespaceProvided = argValue("--source-namespace") !== undefined;
const restoreNamespaceProvided = argValue("--restore-namespace") !== undefined;
const sourceReleaseName = `${releaseName}-source`;
const restoreReleaseName = `${releaseName}-restore`;
const sourceAppName = helmFullname(sourceReleaseName);
const restoreAppName = helmFullname(restoreReleaseName);
const tempDir = join(
  tmpdir(),
  `romeo-kubernetes-dr-${Date.now()}-${randomBytes(3).toString("hex")}`,
);
const backupDir = join(tempDir, "backup");
const labels = {
  "app.kubernetes.io/name": "romeo-kubernetes-dr-smoke",
  "app.kubernetes.io/part-of": "romeo",
};
const sourcePostgresPassword = `pg_source_${randomBytes(18).toString("hex")}`;
const restorePostgresPassword = `pg_restore_${randomBytes(18).toString("hex")}`;
const sourceS3Secret = `s3_source_${randomBytes(18).toString("hex")}`;
const restoreS3Secret = `s3_restore_${randomBytes(18).toString("hex")}`;
const sourceSessionSecret = `session_source_${randomBytes(32).toString("hex")}`;
const restoreSessionSecret = `session_restore_${randomBytes(32).toString("hex")}`;
const sourceWebhookKey = `webhook_source_${randomBytes(32).toString("hex")}`;
const restoreWebhookKey = `webhook_restore_${randomBytes(32).toString("hex")}`;
const rawContentSentinel = `k8s_dr_raw_content_${randomBytes(18).toString("hex")}`;
const workPvc = "romeo-dr-work";

let sourcePortForward;
let restorePortForward;
let adminToken;
let records;
let workflowRecords;

if (dryRun) {
  writeEvidence(plannedEvidence());
  process.exit(0);
}

assertClusterAvailable();
assertModeConfiguration();
mkdirSync(backupDir, { recursive: true });

try {
  if (!skipBuild) {
    run(
      "docker",
      ["build", "-f", "deploy/compose/Dockerfile", "-t", image, "."],
      {
        cwd: root,
      },
    );
  }

  ensureNamespace(sourceNamespace);
  ensureNamespace(restoreNamespace);
  await prepareNamespace({
    databaseSecretRef: sourceDatabaseSecretRef(),
    databaseSecretResource: sourceDatabaseSecretResource(),
    namespace: sourceNamespace,
    postgresPassword: sourcePostgresPassword,
    provisionPostgres: mode === "external-postgres",
    runtimeSecret: {
      sessionSecret: sourceSessionSecret,
      s3Secret: sourceS3Secret,
      webhookKey: sourceWebhookKey,
    },
    valkeyName: "romeo-valkey",
    rustfsName: "romeo-rustfs",
  });

  await installSource();
  const sourceHarness = await forwardedHarness(sourceNamespace, sourceAppName);
  sourcePortForward = sourceHarness.portForward;
  await waitForHealth(sourceHarness);
  adminToken = await createAdminApiKey(sourceHarness);

  await installSourceSecure();
  await waitForHealth(sourceHarness);
  await expectUnauthorizedMe(sourceHarness);
  await assertReadinessReady(sourceHarness, adminToken);

  records = await createDurableSmokeRecords(sourceHarness, adminToken, {
    createAttachment: true,
    titlePrefix: "Kubernetes DR smoke",
    fileName: "kubernetes-dr-smoke.txt",
    content: `Romeo Kubernetes DR smoke raw document sentinel ${rawContentSentinel}.`,
  });
  workflowRecords = await createProductWorkflowSmokeRecords(
    sourceHarness,
    adminToken,
    records,
    { rawContentSentinel },
  );

  await runBackupJobs();
  copyWorkDirFromJob(sourceNamespace, "romeo-dr-object-backup", backupDir);
  const backupManifest = readJson(
    join(backupDir, "romeo-postgres.dump.manifest.json"),
  );
  assertEvidenceRedacted("Kubernetes DR backup evidence", backupDir, [
    adminToken,
    sourcePostgresPassword,
    sourceS3Secret,
    sourceSessionSecret,
    sourceWebhookKey,
    rawContentSentinel,
  ]);

  await prepareNamespace({
    databaseSecretRef: restoreDatabaseSecretRef(),
    databaseSecretResource: restoreDatabaseSecretResource(),
    namespace: restoreNamespace,
    postgresPassword: restorePostgresPassword,
    provisionPostgres: mode === "external-postgres",
    runtimeSecret: {
      sessionSecret: restoreSessionSecret,
      s3Secret: restoreS3Secret,
      webhookKey: restoreWebhookKey,
    },
    valkeyName: "romeo-valkey",
    rustfsName: "romeo-rustfs",
  });
  copyBackupDirIntoRestoreNamespace();
  await runRestoreJobs(backupManifest.backup?.sha256);
  await installRestore();
  const restoreHarness = await forwardedHarness(
    restoreNamespace,
    restoreAppName,
  );
  restorePortForward = restoreHarness.portForward;
  await waitForHealth(restoreHarness);
  await expectUnauthorizedMe(restoreHarness);
  await assertReadinessReady(restoreHarness, adminToken);
  await assertDurableSmokeRecords(restoreHarness, adminToken, records);
  await assertProductWorkflowSmokeRecords(
    restoreHarness,
    adminToken,
    workflowRecords,
  );
  await assertAttachmentReadable(
    restoreHarness,
    adminToken,
    records.attachment,
  );

  const sourcePodLogEntries = podLogs(sourceNamespace);
  const restorePodLogEntries = podLogs(restoreNamespace);
  const logs = `${sourcePodLogEntries
    .map((entry) => entry.text)
    .join("\n")}\n${restorePodLogEntries
    .map((entry) => entry.text)
    .join("\n")}`;
  const generatedSecretValues = [
    adminToken,
    sourcePostgresPassword,
    restorePostgresPassword,
    sourceS3Secret,
    restoreS3Secret,
    sourceSessionSecret,
    restoreSessionSecret,
    sourceWebhookKey,
    restoreWebhookKey,
  ];
  const rawContentSentinels = [rawContentSentinel];
  assertTextDoesNotContain("Kubernetes DR pod logs", logs, [
    ...generatedSecretValues,
    ...rawContentSentinels,
  ]);

  writeEvidence({
    schemaVersion: "romeo.kubernetes-dr-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    databaseMode: mode,
    source: {
      namespace: sourceNamespace,
      releaseName: sourceReleaseName,
      databaseConnection: connectionPosture(sourceDatabaseSecretRef()),
    },
    restore: {
      namespace: restoreNamespace,
      releaseName: restoreReleaseName,
      databaseConnection: connectionPosture(restoreDatabaseSecretRef()),
    },
    checks: [
      "cluster_reachable",
      "source_namespace_ready",
      "source_migration_job",
      "source_seed_job",
      "source_seeded_login_disabled",
      "source_product_records_created",
      "postgres_backup_job",
      "object_store_backup_job",
      "backup_evidence_redacted",
      "restore_namespace_ready",
      "object_store_restore_drill_job",
      "postgres_restore_drill_job",
      "restored_schema_validation_job",
      "restored_app_readiness",
      "restored_chat_readback",
      "restored_knowledge_readback",
      "restored_product_workflow_readback",
      "restored_attachment_readback",
      "pod_logs_redacted",
    ],
    evidence: {
      postgresBackupManifest: "romeo-postgres.dump.manifest.json",
      objectStoreBackupManifest: "object-store/manifest.json",
      postgresDrill: "romeo-dr-drill.json",
      objectStoreDrill: "romeo-object-store-dr-drill.json",
      restoredSchemaValidation: "restored-postgres-validation.json",
    },
    productWorkflow: {
      chatId: records.chatId,
      sourceId: records.sourceId,
      runId: workflowRecords.runId,
    },
    logRedaction: {
      status: "passed",
      sourceScannedPodLogEntries: sourcePodLogEntries.length,
      restoreScannedPodLogEntries: restorePodLogEntries.length,
      generatedSecretValuesChecked: generatedSecretValues.length,
      rawContentSentinelsChecked: rawContentSentinels.length,
    },
  });
} finally {
  if (sourcePortForward !== undefined) sourcePortForward.stop();
  if (restorePortForward !== undefined) restorePortForward.stop();
  if (!keep) cleanup();
  rmSync(tempDir, { force: true, recursive: true });
}

function plannedEvidence() {
  return {
    schemaVersion: "romeo.kubernetes-dr-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    databaseMode: mode,
    target: {
      sourceNamespace,
      restoreNamespace,
      releaseName,
      image,
      drPlanConfigured: drPlanPath !== undefined,
    },
    checks: [
      "cluster_required_for_live_mode",
      "source_and_restore_namespaces_defined",
      "same_backup_restore_scripts_as_compose",
      "live_dr_jobs_required_for_passed_evidence",
      mode === "cloudnativepg"
        ? "cloudnativepg_database_url_secrets_required_for_live_mode"
        : "smoke_owned_pgvector_databases_planned",
    ],
  };
}

function assertClusterAvailable() {
  kubectl(["cluster-info"]);
}

function assertModeConfiguration() {
  if (mode !== "cloudnativepg") return;
  for (const name of [
    "--source-namespace",
    "--restore-namespace",
    "--source-database-url-secret",
    "--restore-database-url-secret",
  ]) {
    if (argValue(name) === undefined) {
      if (
        name === "--source-namespace" &&
        drPlanMode?.sourceNamespace !== undefined
      ) {
        continue;
      }
      if (
        name === "--restore-namespace" &&
        drPlanMode?.restoreNamespace !== undefined
      ) {
        continue;
      }
      if (
        name === "--source-database-url-secret" &&
        drPlanMode?.sourceDatabaseUrlSecret !== undefined
      ) {
        continue;
      }
      if (
        name === "--restore-database-url-secret" &&
        drPlanMode?.restoreDatabaseUrlSecret !== undefined
      ) {
        continue;
      }
      throw new Error(`${name} is required when --mode cloudnativepg.`);
    }
  }
}

function ensureNamespace(namespace) {
  kubectl(["create", "namespace", namespace], { allowFailure: true });
}

async function prepareNamespace(options) {
  applyResources(options.namespace, [
    persistentVolumeClaim(workPvc, labels),
    secret(
      "romeo-valkey-url",
      { VALKEY_URL: `redis://${options.valkeyName}:6379` },
      labels,
    ),
    secret(
      "romeo-runtime",
      {
        SESSION_SECRET: options.runtimeSecret.sessionSecret,
        WEBHOOK_SIGNING_KEY: options.runtimeSecret.webhookKey,
        S3_ACCESS_KEY_ID: "romeo",
        S3_SECRET_ACCESS_KEY: options.runtimeSecret.s3Secret,
      },
      labels,
    ),
    ...(options.provisionPostgres
      ? [
          options.databaseSecretResource,
          postgresDeployment(
            "romeo-postgres",
            options.postgresPassword,
            labels,
          ),
          service("romeo-postgres", 5432, labels),
        ]
      : []),
    valkeyDeployment(options.valkeyName, labels),
    service(options.valkeyName, 6379, labels),
    rustfsDeployment(
      options.rustfsName,
      options.runtimeSecret.s3Secret,
      labels,
    ),
    service(options.rustfsName, 9000, labels),
    objectStoreInitJob("romeo-object-store-init", {
      endpoint: `http://${options.rustfsName}:9000`,
      labels,
      secretKey: options.runtimeSecret.s3Secret,
    }),
  ]);
  if (options.provisionPostgres) {
    await waitForKubectlRollout(
      options.namespace,
      "deployment/romeo-postgres",
      timeoutMs,
    );
  }
  await waitForKubectlRollout(
    options.namespace,
    `deployment/${options.valkeyName}`,
    timeoutMs,
  );
  await waitForKubectlRollout(
    options.namespace,
    `deployment/${options.rustfsName}`,
    timeoutMs,
  );
  await waitForJobComplete(
    options.namespace,
    "romeo-object-store-init",
    timeoutMs,
  );
}

async function installSource() {
  helmInstall({
    appPort: "3000",
    databaseSecret: sourceDatabaseSecretRef(),
    devSeededLogin: true,
    namespace: sourceNamespace,
    release: sourceReleaseName,
  });
  applyResources(sourceNamespace, [
    seedJob({
      databaseSecret: sourceDatabaseSecretRef(),
      image,
      labels,
      name: `${sourceReleaseName}-seed`,
    }),
  ]);
  await waitForJobComplete(
    sourceNamespace,
    `${sourceReleaseName}-seed`,
    timeoutMs,
  );
}

async function installSourceSecure() {
  helmInstall({
    appPort: "3000",
    databaseSecret: sourceDatabaseSecretRef(),
    devSeededLogin: false,
    namespace: sourceNamespace,
    release: sourceReleaseName,
  });
}

async function installRestore() {
  helmInstall({
    appPort: "3000",
    databaseSecret: restoreDatabaseSecretRef(),
    devSeededLogin: false,
    namespace: restoreNamespace,
    release: restoreReleaseName,
  });
}

function helmInstall(options) {
  const { repository, tag } = splitImage(image);
  const appName = helmFullname(options.release);
  kubectl(
    [
      "delete",
      "job",
      `${appName}-migrate`,
      "-n",
      options.namespace,
      "--ignore-not-found=true",
      "--wait=true",
    ],
    { allowFailure: true },
  );
  helm([
    "upgrade",
    "--install",
    options.release,
    repoPath("deploy/helm"),
    "--namespace",
    options.namespace,
    "--wait",
    "--wait-for-jobs",
    "--timeout",
    `${Math.ceil(timeoutMs / 1000)}s`,
    "--set-string",
    `image.repository=${repository}`,
    "--set-string",
    `image.tag=${tag}`,
    "--set-string",
    "image.pullPolicy=IfNotPresent",
    "--set",
    "replicaCount=1",
    "--set",
    "podDisruptionBudget.enabled=false",
    "--set",
    "migration.useHelmHook=false",
    "--set-string",
    `postgres.mode=${mode === "cloudnativepg" ? "cloudnativepg" : "external"}`,
    "--set-string",
    "postgres.databaseUrlSecret.name=romeo-postgres-url",
    "--set-string",
    "postgres.databaseUrlSecret.key=DATABASE_URL",
    "--set-string",
    `postgres.cloudnativepg.databaseUrlSecret.name=${options.databaseSecret.name}`,
    "--set-string",
    `postgres.cloudnativepg.databaseUrlSecret.key=${options.databaseSecret.key}`,
    "--set-string",
    "secrets.existingSecret=romeo-runtime",
    "--set-string",
    "valkey.urlSecret.name=romeo-valkey-url",
    "--set-string",
    "valkey.urlSecret.key=VALKEY_URL",
    "--set-string",
    "env.APP_ORIGIN=http://127.0.0.1",
    "--set-string",
    "env.S3_ENDPOINT=http://romeo-rustfs:9000",
    "--set-string",
    "env.S3_BUCKET=romeo",
    "--set-string",
    `env.DEV_SEEDED_LOGIN=${options.devSeededLogin ? "true" : "false"}`,
  ]);
  return appName;
}

async function forwardedHarness(namespace, serviceName) {
  const appPort = await freePort();
  const portForward = await startPortForward(
    namespace,
    serviceName,
    appPort,
    3000,
  );
  return { appPort, portForward, timeoutMs };
}

async function runBackupJobs() {
  applyResources(sourceNamespace, [
    maintenanceJob({
      command: [
        "pnpm",
        "backup:postgres",
        "--",
        "--output",
        "/work/romeo-postgres.dump",
        "--manifest-output",
        "/work/romeo-postgres.dump.manifest.json",
        "--retention-days",
        "30",
      ],
      env: [secretEnv("DATABASE_URL", sourceDatabaseSecretRef())],
      image,
      labels,
      name: "romeo-dr-postgres-backup",
      volumeClaim: workPvc,
    }),
  ]);
  await waitForJobComplete(
    sourceNamespace,
    "romeo-dr-postgres-backup",
    timeoutMs,
  );
  applyResources(sourceNamespace, [
    maintenanceJob({
      command: [
        "pnpm",
        "backup:object-store",
        "--",
        "--output-dir",
        "/work/object-store",
        "--manifest-output",
        "/work/object-store/manifest.json",
      ],
      env: objectStoreEnv("S3", sourceS3Secret),
      image,
      labels,
      name: "romeo-dr-object-backup",
      volumeClaim: workPvc,
    }),
  ]);
  await waitForJobComplete(
    sourceNamespace,
    "romeo-dr-object-backup",
    timeoutMs,
  );
}

async function runRestoreJobs(backupSha256) {
  if (typeof backupSha256 !== "string" || backupSha256.length !== 64) {
    throw new Error("Postgres backup manifest did not include a SHA-256.");
  }
  applyResources(restoreNamespace, [
    maintenanceJob({
      command: [
        "pnpm",
        "drill:object-store-restore",
        "--",
        "--manifest",
        "/work/object-store/manifest.json",
        "--output",
        "/work/romeo-object-store-dr-drill.json",
        "--confirm-isolated-target",
      ],
      env: objectStoreEnv("RESTORE_S3", restoreS3Secret),
      image,
      labels,
      name: "romeo-dr-object-restore",
      volumeClaim: workPvc,
    }),
  ]);
  await waitForJobComplete(
    restoreNamespace,
    "romeo-dr-object-restore",
    timeoutMs,
  );
  applyResources(restoreNamespace, [
    maintenanceJob({
      command: [
        "pnpm",
        "drill:postgres-restore",
        "--",
        "--input",
        "/work/romeo-postgres.dump",
        "--expected-sha256",
        backupSha256,
        "--output",
        "/work/romeo-dr-drill.json",
        "--confirm-isolated-target",
      ],
      env: [secretEnv("DRILL_DATABASE_URL", restoreDatabaseSecretRef())],
      image,
      labels,
      name: "romeo-dr-postgres-restore",
      volumeClaim: workPvc,
    }),
  ]);
  await waitForJobComplete(
    restoreNamespace,
    "romeo-dr-postgres-restore",
    timeoutMs,
  );
  applyResources(restoreNamespace, [
    maintenanceJob({
      command: [
        "pnpm",
        "validate:postgres",
        "--",
        "--output",
        "/work/restored-postgres-validation.json",
      ],
      env: [secretEnv("DATABASE_URL", restoreDatabaseSecretRef())],
      image,
      labels,
      name: "romeo-dr-schema-validation",
      volumeClaim: workPvc,
    }),
  ]);
  await waitForJobComplete(
    restoreNamespace,
    "romeo-dr-schema-validation",
    timeoutMs,
  );
}

function copyWorkDirFromJob(namespace, jobName, targetDir) {
  const pod = jobPodName(namespace, jobName);
  mkdirSync(targetDir, { recursive: true });
  kubectl(["cp", `${namespace}/${pod}:/work/.`, targetDir]);
}

function copyBackupDirIntoRestoreNamespace() {
  const name = "romeo-dr-toolbox";
  applyResources(restoreNamespace, [
    toolboxPod({ image, labels, name, volumeClaim: workPvc }),
  ]);
  kubectl([
    "wait",
    "--for=condition=Ready",
    `pod/${name}`,
    "-n",
    restoreNamespace,
    "--timeout",
    `${Math.ceil(timeoutMs / 1000)}s`,
  ]);
  kubectl(["cp", `${backupDir}/.`, `${restoreNamespace}/${name}:/work`]);
  kubectl(["delete", "pod", name, "-n", restoreNamespace, "--wait=true"]);
}

function jobPodName(namespace, jobName) {
  const pods = kubectlJson([
    "get",
    "pods",
    "-n",
    namespace,
    "-l",
    `job-name=${jobName}`,
  ]);
  const podName = pods.items?.[0]?.metadata?.name;
  if (typeof podName !== "string" || podName.length === 0) {
    throw new Error(`Could not find pod for job ${jobName} in ${namespace}.`);
  }
  return podName;
}

function objectStoreEnv(prefix, secretKey) {
  const base = prefix === "S3" ? "" : "RESTORE_";
  return [
    { name: `${base}S3_ENDPOINT`, value: "http://romeo-rustfs:9000" },
    { name: `${base}S3_BUCKET`, value: "romeo" },
    { name: `${base}S3_ACCESS_KEY_ID`, value: "romeo" },
    { name: `${base}S3_SECRET_ACCESS_KEY`, value: secretKey },
  ];
}

function sourceDatabaseSecretRef() {
  if (mode === "cloudnativepg") {
    return parseSecretRef(
      argValue("--source-database-url-secret") ??
        drPlanMode?.sourceDatabaseUrlSecret,
    );
  }
  return { key: "DATABASE_URL", name: "romeo-postgres-url" };
}

function sourceDatabaseSecretResource() {
  if (mode === "cloudnativepg") return undefined;
  return secret(
    "romeo-postgres-url",
    {
      DATABASE_URL: `postgres://romeo:${sourcePostgresPassword}@romeo-postgres:5432/romeo`,
    },
    labels,
  );
}

function restoreDatabaseSecretRef() {
  if (mode === "cloudnativepg") {
    return parseSecretRef(
      argValue("--restore-database-url-secret") ??
        drPlanMode?.restoreDatabaseUrlSecret,
    );
  }
  return { key: "DATABASE_URL", name: "romeo-postgres-url" };
}

function restoreDatabaseSecretResource() {
  if (mode === "cloudnativepg") return undefined;
  return secret(
    "romeo-postgres-url",
    {
      DATABASE_URL: `postgres://romeo:${restorePostgresPassword}@romeo-postgres:5432/romeo`,
    },
    labels,
  );
}

function parseSecretRef(value) {
  const [name, key] = String(value).split(":", 2);
  if (name.length === 0 || key?.length === 0) {
    throw new Error("Secret refs must use name:key format.");
  }
  return { name, key };
}

function connectionPosture(secretRef) {
  return {
    secretName: secretRef.name,
    secretKey: secretRef.key,
    source: mode === "cloudnativepg" ? "operator_secret" : "smoke_owned_secret",
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertEvidenceRedacted(label, path, values) {
  const result = run("find", [
    path,
    "-maxdepth",
    "4",
    "-type",
    "f",
    "-name",
    "*.json",
    "-print",
  ]);
  const files = result.stdout.split("\n").filter(Boolean);
  const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assertTextDoesNotContain(label, text, values);
}

function cleanup() {
  if (!sourceNamespaceProvided) {
    deleteNamespace(sourceNamespace);
  } else {
    cleanupKnownResources(sourceNamespace, sourceReleaseName);
  }
  if (!restoreNamespaceProvided) {
    deleteNamespace(restoreNamespace);
  } else {
    cleanupKnownResources(restoreNamespace, restoreReleaseName);
  }
}

function cleanupKnownResources(namespace, release) {
  helm(["uninstall", release, "-n", namespace], { allowFailure: true });
  kubectl(
    [
      "delete",
      "jobs,pod,pvc,secret,service,deployment",
      "-n",
      namespace,
      "-l",
      "app.kubernetes.io/name=romeo-kubernetes-dr-smoke",
      "--ignore-not-found=true",
      "--wait=true",
    ],
    { allowFailure: true },
  );
}

function writeEvidence(evidence) {
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  process.stdout.write(body);
  if (outputPath !== undefined) {
    const output = outputPath.startsWith("/")
      ? outputPath
      : repoPath(outputPath);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, body, "utf8");
  }
}

function splitImage(value) {
  const slashIndex = value.lastIndexOf("/");
  const colonIndex = value.lastIndexOf(":");
  if (colonIndex <= slashIndex) return { repository: value, tag: "latest" };
  return {
    repository: value.slice(0, colonIndex),
    tag: value.slice(colonIndex + 1),
  };
}

function helmFullname(value) {
  const chartName = "romeo";
  const name = value.includes(chartName) ? value : `${value}-${chartName}`;
  return name.slice(0, 63).replace(/-+$/u, "");
}
