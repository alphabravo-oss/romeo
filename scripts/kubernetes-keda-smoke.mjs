import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import {
  apiJson,
  argValue,
  assertReadinessReady,
  parsePositiveInteger,
  waitForHealth,
} from "./lib/compose-smoke-support.mjs";
import {
  assertTextDoesNotContain,
  freePort,
  kubectl,
  kubectlJson,
  startPortForward,
  waitForCondition,
} from "./lib/kubernetes-smoke-support.mjs";

const outputPath = argValue("--output");
const dryRun = hasFlag("--dry-run");
const namespace = argValue("--namespace") ?? process.env.ROMEO_NAMESPACE;
const kedaNamespace = argValue("--keda-namespace") ?? "keda";
const serviceName = argValue("--service") ?? "romeo";
const servicePort = parsePositiveInteger("--service-port", 3000);
const scaledJobName = argValue("--scaledjob") ?? "romeo-webhook-retry";
const triggerAuthenticationName =
  argValue("--triggerauthentication") ?? "romeo-webhook-retry-postgres";
const applyExample = hasFlag("--apply-example");
const allowMissingKedaOperatorLogs = hasFlag(
  "--allow-missing-keda-operator-logs",
);
const kedaOperatorSelector =
  argValue("--keda-operator-selector") ??
  "app.kubernetes.io/name=keda-operator";
const workerApiKeySecret = parseSecretRef(
  argValue("--worker-api-key-secret") ?? "romeo-worker-api-key:ROMEO_API_KEY",
);
const postgresSecret = parseSecretRef(
  argValue("--postgres-secret") ?? "romeo-postgres:DATABASE_URL",
);
const timeoutMs = parsePositiveInteger("--timeout-ms", 420000);
const dueBufferMs = parsePositiveInteger("--due-buffer-ms", 5000);
const adminToken = argValue("--api-key") ?? process.env.ROMEO_API_KEY;
const extraSecretSentinels = repeatedArgValues("--secret-sentinel");
const webhookPayloadSentinel = `keda_webhook_payload_${randomBytes(16).toString("hex")}`;
const webhookUrlSentinel = `keda_webhook_url_${randomBytes(16).toString("hex")}`;
const appPort = await freePort();
const harness = { appPort, timeoutMs };

let portForward;

try {
  const evidence = dryRun ? plannedEvidence() : await liveEvidence();
  writeEvidence(evidence);
} finally {
  if (portForward !== undefined) portForward.stop();
}

function plannedEvidence() {
  return {
    schemaVersion: "romeo.kubernetes-keda-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      deployment: "kubernetes",
      namespace: namespace ?? "required_for_live_mode",
      kedaNamespace,
      serviceName,
      servicePort,
      scaledJobName,
      triggerAuthenticationName,
    },
    requiredInputs: {
      apiKeyConfigured: adminToken !== undefined && adminToken.length > 0,
      workerApiKeySecret: workerApiKeySecret.name,
      postgresSecret: postgresSecret.name,
    },
    checks: [
      "kubernetes_cluster_required_for_live_mode",
      "keda_crds_required_for_live_mode",
      "romeo_namespace_required_for_live_mode",
      "admin_api_key_required_for_live_mode",
      "webhook_retry_scaledjob_required_for_live_mode",
      "dry_run_is_planning_evidence_only",
    ],
  };
}

async function liveEvidence() {
  if (namespace === undefined || namespace.length === 0) {
    throw new Error("--namespace or ROMEO_NAMESPACE is required.");
  }
  if (typeof adminToken !== "string" || adminToken.length === 0) {
    throw new Error("--api-key or ROMEO_API_KEY is required.");
  }

  kubectl(["cluster-info"]);
  assertKedaCrds();
  const namespaceInfo = kubectlJson(["get", "namespace", namespace]);
  if (applyExample) {
    kubectl([
      "apply",
      "-n",
      namespace,
      "-f",
      "deploy/keda/webhook-retry-scaledjob.example.yaml",
    ]);
  }
  const scaledJob = kubectlJson([
    "get",
    "scaledjob",
    scaledJobName,
    "-n",
    namespace,
  ]);
  kubectlJson([
    "get",
    "triggerauthentication",
    triggerAuthenticationName,
    "-n",
    namespace,
  ]);
  const workerApiKey = readSecretValue(namespace, workerApiKeySecret);
  const databaseUrl = readSecretValue(namespace, postgresSecret);

  portForward = await startPortForward(
    namespace,
    serviceName,
    appPort,
    servicePort,
  );
  await waitForHealth(harness);
  await assertReadinessReady(harness, adminToken);

  const seeded = await createDueWebhookRetryBacklog();
  await waitUntilDeliveryDue(seeded.nextAttemptAt);
  const startedAt = new Date().toISOString();
  const kedaJob = await waitForKedaJobCompletion(startedAt);
  const retried = await waitForDeliveryRetry(seeded);

  const targetLogs = readTargetLogs();
  const operatorLogs = readKedaOperatorLogs();
  if (targetLogs.entries < 1) {
    throw new Error("KEDA smoke target namespace log scan found no entries.");
  }
  if (operatorLogs.entries < 1 && !allowMissingKedaOperatorLogs) {
    throw new Error("KEDA smoke operator log scan found no entries.");
  }
  const forbiddenValues = [
    adminToken,
    workerApiKey,
    databaseUrl,
    seeded.signingSecret,
    webhookPayloadSentinel,
    webhookUrlSentinel,
    ...extraSecretSentinels,
  ];
  assertTextDoesNotContain(
    "KEDA target namespace logs",
    targetLogs.text,
    forbiddenValues,
  );
  assertTextDoesNotContain(
    "KEDA operator logs",
    operatorLogs.text,
    forbiddenValues,
  );

  return {
    schemaVersion: "romeo.kubernetes-keda-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace,
      namespaceUid: namespaceInfo.metadata?.uid,
      kedaNamespace,
      serviceName,
      servicePort,
      scaledJobName,
      triggerAuthenticationName,
      appliedExample: applyExample,
    },
    scaledJob: {
      name: scaledJob.metadata?.name,
      minReplicaCount: scaledJob.spec?.minReplicaCount,
      maxReplicaCount: scaledJob.spec?.maxReplicaCount,
      pollingInterval: scaledJob.spec?.pollingInterval,
    },
    seededDelivery: {
      subscriptionId: seeded.subscriptionId,
      deliveryId: seeded.deliveryId,
      initialAttemptCount: seeded.initialAttemptCount,
      retriedAttemptCount: retried.attemptCount,
      statusAfterRetry: retried.status,
    },
    kedaJob: {
      name: kedaJob.metadata?.name,
      succeeded: kedaJob.status?.succeeded ?? 0,
      failed: kedaJob.status?.failed ?? 0,
      startTime: kedaJob.status?.startTime,
      completionTime: kedaJob.status?.completionTime,
    },
    logRedaction: {
      status: "passed",
      targetNamespaceLogEntries: targetLogs.entries,
      kedaOperatorLogEntries: operatorLogs.entries,
      kedaOperatorLogsRequired: !allowMissingKedaOperatorLogs,
      checkedAdminApiKey: true,
      checkedWorkerApiKey: true,
      checkedDatabaseUrl: true,
      checkedWebhookSigningSecret: true,
      checkedWebhookPayloadSentinel: true,
      checkedWebhookUrlSentinel: true,
      extraSecretSentinelCount: extraSecretSentinels.length,
    },
    checks: [
      "cluster_reachable",
      "keda_crds_present",
      "namespace_readable",
      "scaledjob_present",
      "triggerauthentication_present",
      "worker_api_key_secret_readable",
      "postgres_secret_readable",
      "admin_readiness_ready",
      "webhook_retry_backlog_seeded_via_api",
      "webhook_delivery_due_observed",
      "keda_scaledjob_created_worker_job",
      "keda_worker_job_completed",
      "webhook_delivery_retry_readback",
      "target_namespace_logs_redacted",
      "keda_operator_logs_redacted",
      "evidence_omits_secret_values",
    ],
  };
}

function assertKedaCrds() {
  kubectl(["get", "crd", "scaledjobs.keda.sh"]);
  kubectl(["get", "crd", "triggerauthentications.keda.sh"]);
}

async function createDueWebhookRetryBacklog() {
  const created = await apiJson(harness, "/api/v1/webhooks", {
    method: "POST",
    token: adminToken,
    body: {
      url: `https://romeo-keda-webhook.invalid/${webhookUrlSentinel}`,
      eventTypes: ["webhook.test"],
    },
    expectedStatus: 201,
  });
  const subscriptionId = created.data?.subscription?.id;
  const signingSecret = created.data?.signingSecret;
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
    throw new Error(
      "KEDA smoke webhook creation did not return a subscription id.",
    );
  }
  if (typeof signingSecret !== "string" || signingSecret.length === 0) {
    throw new Error(
      "KEDA smoke webhook creation did not return a signing secret.",
    );
  }

  const delivery = await apiJson(
    harness,
    `/api/v1/webhooks/${subscriptionId}/test`,
    {
      method: "POST",
      token: adminToken,
      body: {
        payload: {
          check: "kubernetes-keda-smoke",
          rawBody: webhookPayloadSentinel,
        },
      },
      expectedStatus: 202,
    },
  );
  if (JSON.stringify(delivery.data).includes(webhookPayloadSentinel)) {
    throw new Error("KEDA smoke webhook delivery readback leaked raw payload.");
  }
  if (JSON.stringify(delivery.data).includes(webhookUrlSentinel)) {
    throw new Error(
      "KEDA smoke webhook delivery readback leaked raw URL sentinel.",
    );
  }
  if (delivery.data?.status !== "failed") {
    throw new Error(
      `Expected seeded webhook delivery to fail, got ${delivery.data?.status}.`,
    );
  }
  if (typeof delivery.data?.nextAttemptAt !== "string") {
    throw new Error("Seeded webhook delivery is not scheduled for retry.");
  }
  return {
    subscriptionId,
    signingSecret,
    deliveryId: delivery.data.id,
    initialAttemptCount: delivery.data.attemptCount,
    nextAttemptAt: delivery.data.nextAttemptAt,
  };
}

async function waitUntilDeliveryDue(nextAttemptAt) {
  const dueAtMs = Date.parse(nextAttemptAt);
  if (!Number.isFinite(dueAtMs)) {
    throw new Error(`Invalid nextAttemptAt returned by API: ${nextAttemptAt}`);
  }
  const waitMs = dueAtMs + dueBufferMs - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function waitForKedaJobCompletion(startedAt) {
  return waitForCondition(
    "KEDA ScaledJob worker Job to complete",
    timeoutMs,
    () => {
      const jobs = listKedaJobs(startedAt);
      const completed = jobs.find((job) => (job.status?.succeeded ?? 0) > 0);
      return completed ?? false;
    },
  );
}

function listKedaJobs(startedAt) {
  const jobs = kubectlJson(["get", "jobs", "-n", namespace]).items ?? [];
  return jobs.filter((job) => {
    const metadata = job.metadata ?? {};
    if (metadata.creationTimestamp < startedAt) return false;
    const labels = metadata.labels ?? {};
    const owners = metadata.ownerReferences ?? [];
    return (
      labels["scaledjob.keda.sh/name"] === scaledJobName ||
      labels["app.kubernetes.io/component"] === "webhook-retry" ||
      owners.some(
        (owner) => owner.kind === "ScaledJob" && owner.name === scaledJobName,
      )
    );
  });
}

async function waitForDeliveryRetry(seeded) {
  return waitForCondition(
    "webhook delivery retry readback",
    timeoutMs,
    async () => {
      const page = await apiJson(
        harness,
        `/api/v1/webhooks/${seeded.subscriptionId}/deliveries`,
        { token: adminToken },
      );
      const delivery = (page.data ?? []).find(
        (item) => item.id === seeded.deliveryId,
      );
      if (delivery === undefined) return false;
      if (JSON.stringify(delivery).includes(webhookPayloadSentinel)) {
        throw new Error(
          "KEDA smoke retry readback leaked raw webhook payload.",
        );
      }
      if (delivery.attemptCount <= seeded.initialAttemptCount) return false;
      return delivery;
    },
  );
}

function readTargetLogs() {
  const result = kubectl(
    [
      "logs",
      "-n",
      namespace,
      "-l",
      "app.kubernetes.io/component=webhook-retry",
      "--all-containers=true",
      "--prefix",
      "--tail=500",
    ],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to read KEDA worker Job logs: ${result.stderr ?? result.stdout}`,
    );
  }
  return {
    entries: countPrefixedEntries(result.stdout),
    text: result.stdout ?? "",
  };
}

function readKedaOperatorLogs() {
  const result = kubectl(
    [
      "logs",
      "-n",
      kedaNamespace,
      "-l",
      kedaOperatorSelector,
      "--all-containers=true",
      "--prefix",
      "--tail=500",
    ],
    { allowFailure: true },
  );
  if (result.status !== 0 && !allowMissingKedaOperatorLogs) {
    throw new Error(
      `Unable to read KEDA operator logs: ${result.stderr ?? result.stdout}`,
    );
  }
  return {
    entries: result.status === 0 ? countPrefixedEntries(result.stdout) : 0,
    text: result.status === 0 ? (result.stdout ?? "") : "",
  };
}

function readSecretValue(secretNamespace, ref) {
  const secret = kubectlJson([
    "get",
    "secret",
    ref.name,
    "-n",
    secretNamespace,
  ]);
  const encoded = secret.data?.[ref.key];
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error(
      `Secret ${ref.name} in namespace ${secretNamespace} is missing key ${ref.key}.`,
    );
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}

function parseSecretRef(value) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Secret reference must use name:key format, got ${value}.`);
  }
  return { name: value.slice(0, separator), key: value.slice(separator + 1) };
}

function countPrefixedEntries(text = "") {
  return text.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
}

function writeEvidence(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  process.stdout.write(serialized);
  if (outputPath === undefined) return;
  const absolute = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, serialized, "utf8");
}

function repeatedArgValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      const value = process.argv[index + 1];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${name} requires a non-empty value.`);
      }
      values.push(value);
    }
  }
  return values;
}

function hasFlag(name) {
  return process.argv.includes(name);
}
