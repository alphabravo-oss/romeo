import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  assertTextDoesNotContain,
  freePort,
  kubectl,
  kubectlJson,
  podLogs,
  startPortForward,
  waitForKubectlRollout,
  sleep,
} from "./lib/kubernetes-smoke-support.mjs";
import {
  generateScaleFixtures,
  summarizeScaleFixtures,
} from "./lib/scale-fixtures.mjs";

const outputPath = argValue("--output");
const dryRun = process.argv.includes("--dry-run");
const namespace =
  argOrEnv("--namespace", "KUBERNETES_LOAD_SOAK_NAMESPACE") ??
  process.env.ROMEO_NAMESPACE;
const releaseName =
  argOrEnv("--release-name", "KUBERNETES_LOAD_SOAK_RELEASE_NAME") ??
  process.env.ROMEO_RELEASE_NAME ??
  "romeo";
const serviceName =
  argOrEnv("--service", "KUBERNETES_LOAD_SOAK_SERVICE_NAME") ??
  process.env.ROMEO_SERVICE_NAME ??
  helmFullname(releaseName);
const deploymentName =
  argOrEnv("--deployment", "KUBERNETES_LOAD_SOAK_DEPLOYMENT_NAME") ??
  process.env.ROMEO_DEPLOYMENT_NAME ??
  serviceName;
const selector =
  argOrEnv("--selector", "KUBERNETES_LOAD_SOAK_SELECTOR") ??
  `app.kubernetes.io/name=romeo,app.kubernetes.io/instance=${releaseName},app.kubernetes.io/component=app`;
const tier = argOrEnv("--tier", "KUBERNETES_LOAD_SOAK_TIER") ?? "small";
const iterations = parsePositiveInteger(
  "--iterations",
  2,
  "KUBERNETES_LOAD_SOAK_ITERATIONS",
);
const requestedSoakSeconds = parseNonNegativeInteger(
  "--soak-seconds",
  60,
  "KUBERNETES_LOAD_SOAK_SOAK_SECONDS",
);
const intervalSeconds = parseNonNegativeInteger(
  "--interval-seconds",
  15,
  "KUBERNETES_LOAD_SOAK_INTERVAL_SECONDS",
);
const timeoutMs = parsePositiveInteger(
  "--timeout-ms",
  300000,
  "KUBERNETES_LOAD_SOAK_TIMEOUT_MS",
);
const servicePort = parsePositiveInteger(
  "--service-port",
  3000,
  "KUBERNETES_LOAD_SOAK_SERVICE_PORT",
);
const apiKey = argValue("--api-key") ?? process.env.ROMEO_API_KEY;
const baseUrl = argOrEnv("--base-url", "KUBERNETES_LOAD_SOAK_BASE_URL");
const tempDir = mkdtempSync(join(tmpdir(), "romeo-k8s-load-soak-"));

let portForward;

try {
  const evidence = dryRun ? plannedEvidence() : await liveEvidence();
  writeEvidence(evidence);
} finally {
  if (portForward !== undefined) portForward.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

function plannedEvidence() {
  const fixtures = generateScaleFixtures({
    tier,
    seed: `${releaseName}-${tier}-kubernetes-load-soak-plan`,
  });
  return {
    schemaVersion: "romeo.kubernetes-load-soak.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      deployment: "kubernetes",
      namespace: namespace ?? "required_for_live_mode",
      releaseName,
      serviceName,
      deploymentName,
      selector,
    },
    tier,
    soak: {
      requestedSeconds: requestedSoakSeconds,
      observedSeconds: 0,
      intervalSeconds,
    },
    iterations,
    fixtureReport: summarizeScaleFixtures(fixtures),
    checks: [
      "scale_fixture_validation",
      "kubernetes_namespace_required_for_live_mode",
      "api_key_required_for_live_mode",
      "live_scale_load_driver_required_for_passed_evidence",
    ],
  };
}

async function liveEvidence() {
  if (namespace === undefined || namespace.length === 0) {
    throw new Error("--namespace or ROMEO_NAMESPACE is required.");
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("--api-key or ROMEO_API_KEY is required.");
  }
  if (tier === "local") {
    throw new Error(
      "Kubernetes load/soak evidence must use --tier small or --tier enterprise.",
    );
  }

  kubectl(["cluster-info"]);
  const namespaceInfo = kubectlJson(["get", "namespace", namespace]);
  await waitForKubectlRollout(
    namespace,
    `deployment/${deploymentName}`,
    timeoutMs,
  );
  const url = await resolveBaseUrl();

  const startedAt = Date.now();
  const loadRuns = [];
  const rawSentinels = [];
  let runIndex = 0;

  while (shouldRunAgain(startedAt, runIndex)) {
    if (runIndex > 0 && intervalSeconds > 0) {
      await sleep(intervalSeconds * 1000);
    }
    runIndex += 1;
    const fixtures = generateScaleFixtures({
      tier,
      seed: `${namespace}-${releaseName}-${tier}-load-soak-${runIndex}`,
    });
    rawSentinels.push(...rawFixtureSentinels(fixtures));
    const loadEvidence = runScaleLoadSmoke({ fixtures, runIndex, url });
    assertScaleLoadEvidence(loadEvidence, fixtures);
    loadRuns.push(summarizeLoadRun(loadEvidence, fixtures, runIndex));
  }

  const observedSeconds = Math.round((Date.now() - startedAt) / 1000);
  const deployment = kubectlJson([
    "get",
    "deployment",
    deploymentName,
    "-n",
    namespace,
  ]);
  const pods = kubectlJson(["get", "pods", "-n", namespace, "-l", selector]);
  const hpa = optionalKubernetesJson(["get", "hpa", "-n", namespace]);
  const logs = podLogs(namespace)
    .map((entry) => entry.text)
    .join("\n");
  assertTextDoesNotContain("Kubernetes load/soak pod logs", logs, [
    apiKey,
    ...rawSentinels,
  ]);

  return {
    schemaVersion: "romeo.kubernetes-load-soak.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace,
      namespaceUid: namespaceInfo.metadata?.uid,
      releaseName,
      serviceName,
      deploymentName,
      selector,
      baseUrlMode: baseUrl === undefined ? "port-forward" : "provided",
    },
    tier,
    iterations,
    loadRuns: loadRuns.length,
    soak: {
      requestedSeconds: requestedSoakSeconds,
      observedSeconds,
      intervalSeconds,
      passed: observedSeconds >= requestedSoakSeconds,
    },
    checks: [
      "cluster_reachable",
      "namespace_readable",
      "deployment_rollout_available",
      "scale_fixture_validation",
      "live_scale_load_repeated",
      "scale_load_evidence_summaries",
      "non_local_scale_tier",
      "soak_duration_observed",
      "pod_inventory_readback",
      "pod_logs_redacted",
    ],
    kubernetes: {
      deployment: summarizeDeployment(deployment),
      pods: summarizePods(pods),
      hpa: summarizeHpa(hpa),
    },
    loadEvidence: loadRuns,
    logRedaction: {
      status: "passed",
      scannedPods: pods.items?.length ?? 0,
      rawFixtureSentinelsChecked: rawSentinels.length,
      apiKeyChecked: true,
    },
  };
}

function resolveBaseUrl() {
  if (baseUrl !== undefined) return normalizeBaseUrl(baseUrl);
  return startForwardedBaseUrl();
}

async function startForwardedBaseUrl() {
  const port = await freePort();
  portForward = await startPortForward(
    namespace,
    serviceName,
    port,
    servicePort,
  );
  return `http://127.0.0.1:${port}/`;
}

function shouldRunAgain(startedAt, completedRuns) {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return completedRuns < iterations || elapsedSeconds < requestedSoakSeconds;
}

function runScaleLoadSmoke({ fixtures, runIndex, url }) {
  const fixturePath = join(tempDir, `scale-fixtures-${runIndex}.json`);
  const evidencePath = join(tempDir, `scale-load-smoke-${runIndex}.json`);
  writeFileSync(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/scale-load-smoke.mjs",
      "--fixture-file",
      fixturePath,
      "--base-url",
      url,
      "--output",
      evidencePath,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ROMEO_API_KEY: apiKey },
      timeout: timeoutMs,
    },
  );
  if (result.error !== undefined) {
    throw new Error(
      `scale-load-smoke failed to start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `scale-load-smoke failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return JSON.parse(readFileSync(evidencePath, "utf8"));
}

function assertScaleLoadEvidence(evidence, fixtures) {
  if (
    evidence.schemaVersion !== "romeo.scale-load-smoke.v1" ||
    evidence.status !== "passed" ||
    evidence.mode !== "live"
  ) {
    throw new Error("Scale load smoke did not produce live passing evidence.");
  }
  if (evidence.created?.chats !== fixtures.chats.length) {
    throw new Error("Scale load smoke did not create every planned chat.");
  }
  if (evidence.created?.knowledgeSources !== fixtures.knowledgeSources.length) {
    throw new Error(
      "Scale load smoke did not create every planned knowledge source.",
    );
  }
  if (evidence.created?.connectorSyncs !== fixtures.connectorSyncs.length) {
    throw new Error("Scale load smoke did not sync every planned connector.");
  }
  if (
    evidence.created?.toolDispatchRequests !== fixtures.toolDispatches.length ||
    evidence.cancelled?.toolDispatchRequests !== fixtures.toolDispatches.length
  ) {
    throw new Error(
      "Scale load smoke did not queue and cancel every planned tool dispatch request.",
    );
  }
  if (evidence.latencyMs?.count < fixtures.chats.length) {
    throw new Error("Scale load smoke did not record request latency.");
  }
}

function summarizeLoadRun(evidence, fixtures, runIndex) {
  return {
    runIndex,
    status: evidence.status,
    mode: evidence.mode,
    fixtureReport: summarizeScaleFixtures(fixtures),
    created: evidence.created,
    cancelled: evidence.cancelled,
    latencyMs: evidence.latencyMs,
    workerExecution: evidence.workerExecution,
  };
}

function summarizeDeployment(deployment) {
  return {
    name: deployment.metadata?.name,
    generation: deployment.metadata?.generation,
    replicas: deployment.status?.replicas ?? 0,
    readyReplicas: deployment.status?.readyReplicas ?? 0,
    availableReplicas: deployment.status?.availableReplicas ?? 0,
    updatedReplicas: deployment.status?.updatedReplicas ?? 0,
    observedGeneration: deployment.status?.observedGeneration,
  };
}

function summarizePods(pods) {
  return (pods.items ?? []).map((pod) => ({
    name: pod.metadata?.name,
    phase: pod.status?.phase,
    ready: pod.status?.containerStatuses?.every(
      (status) => status.ready === true,
    ),
    restarts: (pod.status?.containerStatuses ?? []).reduce(
      (total, status) => total + (status.restartCount ?? 0),
      0,
    ),
    containers: (pod.status?.containerStatuses ?? []).map((status) => ({
      name: status.name,
      ready: status.ready,
      restartCount: status.restartCount,
      imageIdConfigured: typeof status.imageID === "string",
    })),
  }));
}

function summarizeHpa(hpa) {
  if (hpa === undefined) return { present: false };
  return {
    present: true,
    items: (hpa.items ?? []).map((item) => ({
      name: item.metadata?.name,
      minReplicas: item.spec?.minReplicas,
      maxReplicas: item.spec?.maxReplicas,
      currentReplicas: item.status?.currentReplicas,
      desiredReplicas: item.status?.desiredReplicas,
      currentMetrics: (item.status?.currentMetrics ?? []).map((metric) => ({
        type: metric.type,
        resource: metric.resource?.name,
      })),
    })),
  };
}

function optionalKubernetesJson(args) {
  const result = kubectl([...args, "-o", "json"], { allowFailure: true });
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    return undefined;
  }
  return JSON.parse(result.stdout);
}

function rawFixtureSentinels(input) {
  return [
    ...input.knowledgeSources.map((source) => source.content),
    ...input.runs.map((run) => run.content),
    ...input.comments.map((comment) => comment.body),
    ...input.attachments.map((attachment) => attachment.content),
  ];
}

function helmFullname(value) {
  const chartName = "romeo";
  const name = value.includes(chartName) ? value : `${value}-${chartName}`;
  return name.slice(0, 63).replace(/-+$/u, "");
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const resolved = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, body, "utf8");
}

function parsePositiveInteger(name, fallback, envName) {
  const value = parseInteger(name, fallback, envName);
  if (value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function parseNonNegativeInteger(name, fallback, envName) {
  const value = parseInteger(name, fallback, envName);
  if (value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function parseInteger(name, fallback, envName) {
  const raw = argValue(name) ?? process.env[envName];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argOrEnv(argName, envName) {
  return argValue(argName) ?? process.env[envName];
}
