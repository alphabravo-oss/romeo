import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  assertLocalAuthFallbackFlow,
  localAuthFallbackChecks,
  setAdminLocalPassword,
} from "./lib/auth-smoke-support.mjs";
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
  podLogs,
  randomKubernetesName,
  run,
  startPortForward,
  waitForJobComplete,
  waitForKubectlRollout,
} from "./lib/kubernetes-smoke-support.mjs";

const outputPath = argValue("--output");
const keep = process.argv.includes("--keep");
const skipBuild = flagOrEnv(
  "--skip-build",
  "KUBERNETES_LIVE_SMOKE_SKIP_BUILD",
  false,
);
const namespace =
  argOrEnv("--namespace", "KUBERNETES_LIVE_SMOKE_NAMESPACE") ??
  randomKubernetesName("romeo-smoke");
const releaseName =
  argOrEnv("--release-name", "KUBERNETES_LIVE_SMOKE_RELEASE_NAME") ?? "romeo";
const appName = helmFullname(releaseName);
const image =
  argOrEnv("--image", "KUBERNETES_LIVE_SMOKE_APP_IMAGE") ??
  `romeo/kubernetes-live-smoke:${Date.now()}`;
const timeoutMs = parsePositiveIntegerEnv(
  "--timeout-ms",
  300000,
  "KUBERNETES_LIVE_SMOKE_TIMEOUT_MS",
);
const kindMinFreeMiB = parseNonNegativeIntegerEnv(
  "--kind-min-free-mib",
  8192,
  "KUBERNETES_LIVE_SMOKE_KIND_MIN_FREE_MIB",
);
const postgresImage =
  argOrEnv("--postgres-image", "KUBERNETES_LIVE_SMOKE_POSTGRES_IMAGE") ??
  "pgvector/pgvector:pg18";
const valkeyImage =
  argOrEnv("--valkey-image", "KUBERNETES_LIVE_SMOKE_VALKEY_IMAGE") ??
  "valkey/valkey:9";
const rustfsImage =
  argOrEnv("--rustfs-image", "KUBERNETES_LIVE_SMOKE_RUSTFS_IMAGE") ??
  "rustfs/rustfs:latest";
const objectStoreClientImage =
  argOrEnv(
    "--object-store-client-image",
    "KUBERNETES_LIVE_SMOKE_OBJECT_STORE_CLIENT_IMAGE",
  ) ?? "minio/mc:latest";
const rawContentSentinel = `k8s_raw_content_${randomBytes(18).toString("hex")}`;
const sessionSecret = `session_${randomBytes(32).toString("hex")}`;
const localAuthSecret = `local_auth_${randomBytes(32).toString("hex")}`;
const managedSecret = `managed_${randomBytes(32).toString("hex")}`;
const webhookSigningKey = `webhook_${randomBytes(32).toString("hex")}`;
const postgresPassword = `pg_${randomBytes(18).toString("hex")}`;
const s3Secret = `s3_${randomBytes(18).toString("hex")}`;
const localPassword = `local_${randomBytes(18).toString("hex")}A1!`;
const rawAuthSentinel = `k8s_auth_raw_${randomBytes(18).toString("hex")}`;
const appPort = await freePort();
const harness = { appPort, timeoutMs };

let adminToken;
let authEvidence;
let records;
let workflowRecords;
let webhookRecords;
let portForward;
let localImageLoad = { loadedToKind: false };
let kindDiskPreflight = {
  checked: false,
  minFreeMiB: undefined,
  requiredFreeMiB: kindMinFreeMiB,
};

assertClusterAvailable();

try {
  if (!skipBuild) {
    run(
      "docker",
      ["build", "-f", "deploy/compose/Dockerfile", "-t", image, "."],
      {
        cwd: root,
      },
    );
    localImageLoad = maybeLoadImageIntoKindCluster(image);
  }
  kindDiskPreflight = assertKindDiskHeadroom();

  kubectl(["create", "namespace", namespace]);
  applyResources(namespace, dependencyResources());
  await waitForKubectlRollout(
    namespace,
    "deployment/romeo-postgres",
    timeoutMs,
  );
  await waitForKubectlRollout(namespace, "deployment/romeo-valkey", timeoutMs);
  await waitForKubectlRollout(namespace, "deployment/romeo-rustfs", timeoutMs);
  await waitForJobComplete(namespace, "romeo-object-store-init", timeoutMs);

  helmInstall(true);
  await waitForJobComplete(namespace, `${releaseName}-seed`, timeoutMs);
  portForward = await startPortForward(namespace, appName, appPort, 3000);
  await waitForHealth(harness);
  adminToken = await createAdminApiKey(harness);
  await setAdminLocalPassword(harness, adminToken, localPassword);

  helmInstall(false);
  await waitForHealth(harness);
  await expectUnauthorizedMe(harness);
  await assertReadinessReady(harness, adminToken);
  authEvidence = await assertLocalAuthFallbackFlow(harness, adminToken, {
    label: "Kubernetes live smoke",
    localPassword,
    rawAuthSentinel,
  });

  records = await createDurableSmokeRecords(harness, adminToken, {
    createAttachment: true,
    titlePrefix: "Kubernetes live smoke",
    fileName: "kubernetes-live-smoke.txt",
    content: `Romeo Kubernetes live smoke raw document sentinel ${rawContentSentinel}.`,
  });
  workflowRecords = await createProductWorkflowSmokeRecords(
    harness,
    adminToken,
    records,
    { rawContentSentinel },
  );
  webhookRecords = await createWebhookDeliveryReadback(
    harness,
    adminToken,
    rawContentSentinel,
  );

  kubectl(["rollout", "restart", `deployment/${appName}`, "-n", namespace]);
  await waitForKubectlRollout(namespace, `deployment/${appName}`, timeoutMs);
  await waitForHealth(harness);
  await assertDurableSmokeRecords(harness, adminToken, records);
  await assertProductWorkflowSmokeRecords(harness, adminToken, workflowRecords);
  await assertWebhookDeliveryReadback(
    harness,
    adminToken,
    webhookRecords,
    rawContentSentinel,
  );
  await assertAttachmentReadable(harness, adminToken, records.attachment);
  await assertReadinessReady(harness, adminToken);

  const podLogEntries = podLogs(namespace);
  const logs = podLogEntries.map((entry) => entry.text).join("\n");
  const generatedSecretValues = [
    adminToken,
    postgresPassword,
    s3Secret,
    sessionSecret,
    localAuthSecret,
    managedSecret,
    webhookSigningKey,
    localPassword,
    authEvidence.enrollmentSecret,
    authEvidence.recoveryCode,
    webhookRecords.signingSecret,
  ];
  const rawAuthSentinels = [rawAuthSentinel];
  const rawContentSentinels = [rawContentSentinel];
  assertTextDoesNotContain("Kubernetes pod logs", logs, [
    ...generatedSecretValues,
    ...rawAuthSentinels,
    ...rawContentSentinels,
  ]);

  writeEvidence({
    schemaVersion: "romeo.kubernetes-live-smoke.v1",
    generatedAt: new Date().toISOString(),
    namespace,
    releaseName,
    appName,
    image,
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace,
      releaseName,
      appName,
      image,
      dependencyMode: "smoke_owned_external_dependencies",
    },
    imagePosture: {
      appImageReviewed: reviewedTaggedImage(image),
      dependencyImagesDigestPinned: dependencyImagesDigestPinned(),
      dependencyImageCount: 4,
      localImageLoadedToKind: localImageLoad.loadedToKind,
      kindDiskPreflight,
      rawDependencyImageRefsReturned: false,
    },
    checks: [
      "cluster_reachable",
      "local_image_available",
      ...(localImageLoad.loadedToKind ? ["local_image_loaded_to_kind"] : []),
      ...(kindDiskPreflight.checked ? ["kind_node_disk_headroom"] : []),
      "ephemeral_external_dependencies_ready",
      "helm_install_with_migration_job",
      "explicit_development_seed_job",
      "secure_upgrade_with_seeded_login_disabled",
      "admin_readiness_ready",
      "unauthenticated_api_denied",
      "admin_local_password_set",
      ...localAuthFallbackChecks,
      "product_workflow_readback",
      "webhook_delivery_readback",
      "webhook_delivery_payload_redacted",
      "app_rollout_restart_readback",
      "attachment_byte_readback",
      "pod_logs_redacted",
    ],
    productWorkflow: {
      chatId: records.chatId,
      sourceId: records.sourceId,
      runId: workflowRecords.runId,
      webhookDeliveryId: webhookRecords.deliveryId,
    },
    logRedaction: {
      status: "passed",
      scannedPodLogEntries: podLogEntries.length,
      generatedSecretValuesChecked: generatedSecretValues.length,
      rawAuthSentinelsChecked: rawAuthSentinels.length,
      rawContentSentinelsChecked: rawContentSentinels.length,
    },
  });
} finally {
  if (portForward !== undefined) portForward.stop();
  if (!keep) {
    deleteNamespace(namespace);
  } else {
    process.stderr.write(
      `Keeping Kubernetes namespace ${namespace} for inspection.\n`,
    );
  }
}

function assertClusterAvailable() {
  kubectl(["cluster-info"]);
}

function maybeLoadImageIntoKindCluster(localImage) {
  const clusterName = currentKindClusterName();
  if (clusterName === undefined) return { loadedToKind: false };
  assertKindCliAvailable();

  run("kind", ["load", "docker-image", localImage, "--name", clusterName]);
  return { loadedToKind: true };
}

function assertKindDiskHeadroom() {
  const clusterName = currentKindClusterName();
  if (clusterName === undefined || kindMinFreeMiB === 0) {
    return {
      checked: false,
      minFreeMiB: undefined,
      requiredFreeMiB: kindMinFreeMiB,
    };
  }
  assertKindCliAvailable();
  const nodes = run("kind", ["get", "nodes", "--name", clusterName])
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (nodes.length === 0) {
    throw new Error(
      `kind cluster ${clusterName} did not report any nodes for disk preflight.`,
    );
  }
  const freeValues = nodes.map((nodeName) => ({
    nodeName,
    freeMiB: nodeFreeMiB(nodeName),
  }));
  const minFreeMiB = Math.min(...freeValues.map((item) => item.freeMiB));
  if (minFreeMiB < kindMinFreeMiB) {
    throw new Error(
      `kind cluster ${clusterName} has ${minFreeMiB} MiB free on its lowest-free node after image preparation; Kubernetes live smoke requires at least ${kindMinFreeMiB} MiB. Free Docker/Rancher Desktop disk, recreate the kind cluster, increase the Docker disk image, or override KUBERNETES_LIVE_SMOKE_KIND_MIN_FREE_MIB only for a known smaller smoke target.`,
    );
  }
  return {
    checked: true,
    minFreeMiB,
    requiredFreeMiB: kindMinFreeMiB,
  };
}

function currentKindClusterName() {
  const contextResult = kubectl(["config", "current-context"], {
    allowFailure: true,
  });
  if (contextResult.status !== 0) return undefined;
  const context = contextResult.stdout.trim();
  if (!context.startsWith("kind-")) return undefined;
  return context.slice("kind-".length);
}

function assertKindCliAvailable() {
  const kindVersion = run("kind", ["version"], { allowFailure: true });
  if (kindVersion.status !== 0) {
    throw new Error(
      "The current Kubernetes context is a kind cluster, but the kind CLI is not available. Install kind or rerun with --skip-build --image using a registry-hosted, digest-pinned image on a non-kind target cluster.",
    );
  }
}

function nodeFreeMiB(nodeName) {
  const result = run("docker", ["exec", nodeName, "df", "-Pm", "/"]);
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const row = lines.at(-1);
  const available = row?.split(/\s+/u)[3];
  const parsed = Number.parseInt(available ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Unable to parse free disk from kind node ${nodeName} during live-smoke preflight.`,
    );
  }
  return parsed;
}

function helmInstall(devSeededLogin) {
  const { repository, tag } = splitImage(image);
  kubectl(
    [
      "delete",
      "job",
      `${appName}-migrate`,
      "-n",
      namespace,
      "--ignore-not-found=true",
      "--wait=true",
    ],
    { allowFailure: true },
  );
  helm([
    "upgrade",
    "--install",
    releaseName,
    repoPath("deploy/helm"),
    "--namespace",
    namespace,
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
    "postgres.databaseUrlSecret.name=romeo-postgres-url",
    "--set-string",
    "postgres.databaseUrlSecret.key=DATABASE_URL",
    "--set-string",
    "secrets.existingSecret=romeo-runtime",
    "--set-string",
    "valkey.urlSecret.name=romeo-valkey-url",
    "--set-string",
    "valkey.urlSecret.key=VALKEY_URL",
    "--set-string",
    `env.APP_ORIGIN=http://127.0.0.1:${appPort}`,
    "--set-string",
    "env.S3_ENDPOINT=http://romeo-rustfs:9000",
    "--set-string",
    "env.S3_BUCKET=romeo",
    "--set-string",
    `env.DEV_SEEDED_LOGIN=${devSeededLogin ? "true" : "false"}`,
  ]);

  if (devSeededLogin) {
    applyResources(namespace, [seedJob()]);
  }
}

function splitImage(value) {
  const slashIndex = value.lastIndexOf("/");
  const colonIndex = value.lastIndexOf(":");
  if (colonIndex <= slashIndex) {
    return { repository: value, tag: "latest" };
  }
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

function dependencyResources() {
  return [
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "romeo-postgres-url" },
      stringData: {
        DATABASE_URL: `postgres://romeo:${postgresPassword}@romeo-postgres:5432/romeo`,
      },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "romeo-valkey-url" },
      stringData: { VALKEY_URL: "redis://romeo-valkey:6379" },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "romeo-runtime" },
      stringData: {
        SESSION_SECRET: sessionSecret,
        LOCAL_AUTH_SECRET_ENCRYPTION_KEY: localAuthSecret,
        MANAGED_SECRET_ENCRYPTION_KEY: managedSecret,
        WEBHOOK_SIGNING_KEY: webhookSigningKey,
        S3_ACCESS_KEY_ID: "romeo",
        S3_SECRET_ACCESS_KEY: s3Secret,
      },
    },
    postgresDeployment(),
    service("romeo-postgres", 5432),
    valkeyDeployment(),
    service("romeo-valkey", 6379),
    rustfsDeployment(),
    service("romeo-rustfs", 9000),
    objectStoreInitJob(),
  ];
}

function service(name, port) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name },
    spec: {
      selector: { "app.kubernetes.io/name": name },
      ports: [{ name: "tcp", port, targetPort: port }],
    },
  };
}

function postgresDeployment() {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "romeo-postgres" },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { "app.kubernetes.io/name": "romeo-postgres" },
      },
      template: {
        metadata: { labels: { "app.kubernetes.io/name": "romeo-postgres" } },
        spec: {
          containers: [
            {
              name: "postgres",
              image: postgresImage,
              ports: [{ containerPort: 5432 }],
              env: [
                { name: "POSTGRES_DB", value: "romeo" },
                { name: "POSTGRES_USER", value: "romeo" },
                { name: "POSTGRES_PASSWORD", value: postgresPassword },
              ],
              readinessProbe: {
                exec: {
                  command: ["pg_isready", "-U", "romeo", "-d", "romeo"],
                },
                periodSeconds: 5,
                failureThreshold: 20,
              },
            },
          ],
        },
      },
    },
  };
}

function valkeyDeployment() {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "romeo-valkey" },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { "app.kubernetes.io/name": "romeo-valkey" },
      },
      template: {
        metadata: { labels: { "app.kubernetes.io/name": "romeo-valkey" } },
        spec: {
          containers: [
            {
              name: "valkey",
              image: valkeyImage,
              ports: [{ containerPort: 6379 }],
              readinessProbe: {
                exec: { command: ["valkey-cli", "ping"] },
                periodSeconds: 5,
                failureThreshold: 20,
              },
            },
          ],
        },
      },
    },
  };
}

function rustfsDeployment() {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "romeo-rustfs" },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { "app.kubernetes.io/name": "romeo-rustfs" },
      },
      template: {
        metadata: { labels: { "app.kubernetes.io/name": "romeo-rustfs" } },
        spec: {
          containers: [
            {
              name: "rustfs",
              image: rustfsImage,
              ports: [{ containerPort: 9000 }],
              env: [
                { name: "RUSTFS_ACCESS_KEY", value: "romeo" },
                { name: "RUSTFS_SECRET_KEY", value: s3Secret },
              ],
            },
          ],
        },
      },
    },
  };
}

function objectStoreInitJob() {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "romeo-object-store-init" },
    spec: {
      backoffLimit: 6,
      template: {
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "mc",
              image: objectStoreClientImage,
              command: ["/bin/sh", "-lc"],
              args: [
                'until mc alias set romeo "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"; do sleep 2; done; mc mb --ignore-existing "romeo/$S3_BUCKET"',
              ],
              env: [
                { name: "S3_ENDPOINT", value: "http://romeo-rustfs:9000" },
                { name: "S3_ACCESS_KEY_ID", value: "romeo" },
                { name: "S3_SECRET_ACCESS_KEY", value: s3Secret },
                { name: "S3_BUCKET", value: "romeo" },
              ],
            },
          ],
        },
      },
    },
  };
}

function seedJob() {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: `${releaseName}-seed` },
    spec: {
      backoffLimit: 1,
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/instance": releaseName,
            "app.kubernetes.io/component": "seed",
          },
        },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "seed",
              image,
              imagePullPolicy: "IfNotPresent",
              command: [
                "pnpm",
                "seed:postgres",
                "--",
                "--confirm-development-seed",
              ],
              env: [
                { name: "HOME", value: "/tmp" },
                { name: "XDG_CACHE_HOME", value: "/tmp/.cache" },
                { name: "COREPACK_HOME", value: "/tmp/.cache/corepack" },
                { name: "PNPM_HOME", value: "/tmp/.local/share/pnpm" },
                {
                  name: "DATABASE_URL",
                  valueFrom: {
                    secretKeyRef: {
                      name: "romeo-postgres-url",
                      key: "DATABASE_URL",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };
}

async function createWebhookDeliveryReadback(harness, token, sentinel) {
  const created = await apiJson(harness, "/api/v1/webhooks", {
    method: "POST",
    token,
    body: {
      url: "https://romeo-kubernetes-webhook.invalid/romeo",
      eventTypes: ["webhook.test"],
    },
    expectedStatus: 201,
  });
  const subscriptionId = created.data?.subscription?.id;
  const signingSecret = created.data?.signingSecret;
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
    throw new Error(
      "Kubernetes smoke webhook subscription did not return an id.",
    );
  }
  if (typeof signingSecret !== "string" || signingSecret.length === 0) {
    throw new Error(
      "Kubernetes smoke webhook subscription did not return a signing secret.",
    );
  }

  const delivery = await apiJson(
    harness,
    `/api/v1/webhooks/${subscriptionId}/test`,
    {
      method: "POST",
      token,
      body: {
        payload: {
          check: "kubernetes-live-smoke",
          rawBody: sentinel,
          nested: { rawBody: sentinel },
        },
      },
      expectedStatus: 202,
    },
  );
  const deliveryId = delivery.data?.id;
  if (typeof deliveryId !== "string" || deliveryId.length === 0) {
    throw new Error("Kubernetes smoke webhook delivery did not return an id.");
  }
  assertWebhookDeliveryRedacted(delivery.data, sentinel);
  return { subscriptionId, deliveryId, signingSecret };
}

async function assertWebhookDeliveryReadback(
  harness,
  token,
  webhook,
  sentinel,
) {
  const response = await apiJson(
    harness,
    `/api/v1/webhooks/${webhook.subscriptionId}/deliveries`,
    { token },
  );
  const delivery = response.data?.find(
    (item) => item.id === webhook.deliveryId,
  );
  if (delivery === undefined) {
    throw new Error("Kubernetes smoke webhook delivery was not readable.");
  }
  assertWebhookDeliveryRedacted(delivery, sentinel);
}

function assertWebhookDeliveryRedacted(delivery, sentinel) {
  if (delivery.status !== "failed" || delivery.errorCode !== "network_error") {
    throw new Error(
      "Kubernetes smoke webhook delivery did not record the expected network failure.",
    );
  }
  if (delivery.payload?.redacted !== true) {
    throw new Error("Kubernetes smoke webhook payload was not redacted.");
  }
  const keys = delivery.payload?.keys;
  if (
    !Array.isArray(keys) ||
    !keys.includes("check") ||
    !keys.includes("nested") ||
    !keys.includes("rawBody")
  ) {
    throw new Error(
      "Kubernetes smoke webhook payload summary did not preserve payload keys.",
    );
  }
  if (JSON.stringify(delivery).includes(sentinel)) {
    throw new Error(
      "Kubernetes smoke webhook delivery readback leaked raw payload content.",
    );
  }
}

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  process.stdout.write(body);
  if (outputPath !== undefined) {
    const absolute = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body, "utf8");
  }
}

function reviewedTaggedImage(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes(":latest@sha256:") &&
    /:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$/u.test(value)
  );
}

function dependencyImagesDigestPinned() {
  return [
    postgresImage,
    valkeyImage,
    rustfsImage,
    objectStoreClientImage,
  ].every((value) => /@sha256:[a-f0-9]{64}$/u.test(value));
}

function flagOrEnv(argName, envName, fallback) {
  if (process.argv.includes(argName)) return true;
  const value = process.env[envName];
  if (value === undefined || value.length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${envName} must be true or false.`);
}

function argOrEnv(argName, envName) {
  return argValue(argName) ?? process.env[envName];
}

function parsePositiveIntegerEnv(argName, fallback, envName) {
  const raw = argValue(argName) ?? process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${argName} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeIntegerEnv(argName, fallback, envName) {
  const raw = argValue(argName) ?? process.env[envName];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${argName} must be a non-negative integer.`);
  }
  return parsed;
}
