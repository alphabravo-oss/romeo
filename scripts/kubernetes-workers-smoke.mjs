import { randomBytes } from "node:crypto";

import {
  apiJson,
  argValue,
  assertReadinessReady,
  createDurableSmokeRecords,
  createProductWorkflowSmokeRecords,
  parsePositiveInteger,
  waitForHealth,
  writeJsonEvidence,
} from "./lib/compose-smoke-support.mjs";
import {
  applyResources,
  assertTextDoesNotContain,
  freePort,
  kubectl,
  kubectlJson,
  podLogs,
  randomKubernetesName,
  startPortForward,
  waitForCondition,
  waitForJobComplete,
  waitForKubectlRollout,
} from "./lib/kubernetes-smoke-support.mjs";
import {
  assertNoSensitiveLeak,
  assertWorkerOutput,
  assertWorkflowResumeWorkerOutput,
  assertWorkflowRunStatus,
  composeWorkerCommands,
  createSmokeAgent,
  createWorkflowResumePendingRun,
  kubernetesCoreWorkerSpecs,
  parseWorkerOutput,
  workerApiKeyScopes,
  workflowRuns,
} from "./lib/worker-smoke-support.mjs";

const keepJobs = hasFlag("--keep-jobs");
const applyWorkerApiKeySecret = hasFlag("--apply-worker-api-key-secret");
const namespace = requiredArg("--namespace");
const releaseName = argValue("--release-name") ?? "romeo";
const appName = helmFullname(releaseName);
const serviceName = argValue("--service") ?? appName;
const workerApiKeySecret = parseSecretRef(
  argValue("--worker-api-key-secret") ?? "romeo-worker-api-key:ROMEO_API_KEY",
);
const adminToken = argValue("--api-key") ?? process.env.ROMEO_API_KEY;
if (typeof adminToken !== "string" || adminToken.length === 0) {
  throw new Error("--api-key or ROMEO_API_KEY is required.");
}
const timeoutMs = parsePositiveInteger("--timeout-ms", 300000);
const jobPrefix = dnsName(
  argValue("--job-prefix") ?? randomKubernetesName("romeo-workers"),
);
const appPort = await freePort();
const harness = { appPort, timeoutMs };
const rawWorkerPromptSentinel = `k8s_worker_prompt_${randomBytes(16).toString("hex")}`;
const crashWorkerPromptSentinel = `k8s_worker_crash_${randomBytes(16).toString("hex")}`;
const rawContentSentinel = `k8s_worker_content_${randomBytes(16).toString("hex")}`;
const createdJobs = [];
const jobLogEntries = [];

let portForward;
let workerToken;
let smokeAgent;
let controlledWorkflow;
let crashWorkflow;

assertClusterAvailable();

try {
  await waitForKubectlRollout(namespace, `deployment/${appName}`, timeoutMs);
  portForward = await startPortForward(namespace, serviceName, appPort, 3000);
  await waitForHealth(harness);
  await assertReadinessReady(harness, adminToken);

  const workerSecretMode = await prepareWorkerApiKeySecret();
  const workers = selectedWorkerSpecs();
  assertWorkerCronJobsPresent(workers);

  const records = await createDurableSmokeRecords(harness, adminToken, {
    createAttachment: false,
    titlePrefix: "Kubernetes worker smoke",
    fileName: "kubernetes-workers-smoke.txt",
    content: `Romeo Kubernetes worker smoke raw document sentinel ${rawContentSentinel}.`,
  });
  await createProductWorkflowSmokeRecords(harness, adminToken, records, {
    rawContentSentinel,
  });
  const webhookReadback = await createWebhookDeliveryReadback(
    harness,
    adminToken,
    rawContentSentinel,
  );

  smokeAgent = await createSmokeAgent(harness, adminToken, {
    name: "Kubernetes worker smoke agent",
  });
  controlledWorkflow = await createWorkflowResumePendingRun(
    harness,
    adminToken,
    {
      name: "Kubernetes worker controlled resume",
      agentId: smokeAgent.id,
      prompt: `Kubernetes worker raw prompt redaction ${rawWorkerPromptSentinel}`,
    },
  );

  const results = [];
  for (const worker of workers) {
    const result = await runCronJobWorker(worker);
    if (worker.name === "workflow_resume") {
      assertWorkflowResumeWorkerOutput(result.output, controlledWorkflow);
      await assertWorkflowRunStatus(
        harness,
        adminToken,
        controlledWorkflow,
        "waiting_approval",
      );
    }
    results.push(result.evidence);
  }

  crashWorkflow = await createWorkflowResumePendingRun(harness, adminToken, {
    name: "Kubernetes worker crash resume",
    agentId: smokeAgent.id,
    prompt: `Kubernetes worker crash prompt redaction ${crashWorkerPromptSentinel}`,
  });
  const crashRecovery =
    await runWorkflowResumePodCrashRecoverySmoke(crashWorkflow);

  const podLogEntries = podLogs(namespace);
  const allPodLogs = podLogEntries.map((entry) => entry.text).join("\n");
  const allJobLogs = jobLogEntries.map((entry) => entry.text).join("\n");
  const rawPromptSentinels = [
    rawWorkerPromptSentinel,
    crashWorkerPromptSentinel,
  ];
  const rawContentSentinels = [rawContentSentinel];
  const generatedSecrets = [
    adminToken,
    ...(typeof workerToken === "string" ? [workerToken] : []),
    webhookReadback.signingSecret,
  ];
  const forbiddenValues = [
    ...generatedSecrets,
    ...rawPromptSentinels,
    ...rawContentSentinels,
  ];
  assertTextDoesNotContain(
    "Kubernetes worker pod logs",
    allPodLogs,
    forbiddenValues,
  );
  assertTextDoesNotContain(
    "Kubernetes worker job logs",
    allJobLogs,
    forbiddenValues,
  );

  writeJsonEvidence({
    schemaVersion: "romeo.kubernetes-workers-smoke.v1",
    generatedAt: new Date().toISOString(),
    namespace,
    releaseName,
    appName,
    serviceName,
    status: "passed",
    mode: "live",
    target: {
      deployment: "kubernetes",
      namespace,
      releaseName,
      appName,
      serviceName,
      workerApiKeySecretName: workerApiKeySecret.name,
      workerApiKeySecretKey: workerApiKeySecret.key,
      workerApiKeySecretMode: workerSecretMode,
    },
    workerCount: results.length,
    workers: results,
    controlledWorkflowResume: {
      workflowId: controlledWorkflow.workflowId,
      workflowRunId: controlledWorkflow.workflowRunId,
      linkedRunId: controlledWorkflow.linkedRunId,
    },
    crashRecovery,
    webhookDeliveryId: webhookReadback.deliveryId,
    logRedaction: {
      status: "passed",
      scannedPodLogEntries: podLogEntries.length,
      scannedJobLogEntries: jobLogEntries.length,
      checkedAdminApiKey: true,
      checkedSmokeOwnedWorkerApiKey: typeof workerToken === "string",
      workerApiKeySecretValueKnown: typeof workerToken === "string",
      webhookSigningSecretChecked: true,
      generatedSecretValuesChecked: generatedSecrets.length,
      rawPromptSentinelsChecked: rawPromptSentinels.length,
      rawContentSentinelsChecked: rawContentSentinels.length,
    },
    checks: [
      "cluster_reachable",
      "app_deployment_rollout_ready",
      "admin_readiness_ready",
      "worker_api_key_secret_ready",
      "worker_cronjobs_present",
      "worker_jobs_completed",
      "worker_output_json_valid",
      "worker_output_secret_redaction",
      "worker_output_raw_content_redaction",
      "workflow_resume_controlled_pending_work",
      "workflow_resume_pod_crash_recovery",
      "workflow_resume_crash_no_duplicate_linked_run",
      "worker_logs_redacted",
      "pod_logs_redacted",
    ],
  });
} finally {
  if (portForward !== undefined) portForward.stop();
  if (!keepJobs) cleanupCreatedJobs();
}

function assertClusterAvailable() {
  kubectl(["cluster-info"]);
}

async function prepareWorkerApiKeySecret() {
  if (!applyWorkerApiKeySecret) {
    assertWorkerApiKeySecretKeyPresent();
    return "preexisting";
  }

  workerToken = await createScopedWorkerApiKey();
  applyResources(namespace, [
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: workerApiKeySecret.name },
      stringData: { [workerApiKeySecret.key]: workerToken },
    },
  ]);
  assertWorkerApiKeySecretKeyPresent();
  return "applied_by_smoke";
}

function assertWorkerApiKeySecretKeyPresent() {
  const secret = kubectlJson([
    "get",
    "secret",
    workerApiKeySecret.name,
    "-n",
    namespace,
  ]);
  if (typeof secret.data?.[workerApiKeySecret.key] !== "string") {
    throw new Error(
      `Worker API key Secret ${workerApiKeySecret.name} does not contain key ${workerApiKeySecret.key}.`,
    );
  }
}

async function createScopedWorkerApiKey() {
  const response = await apiJson(harness, "/api/v1/api-keys", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Kubernetes worker smoke",
      scopes: workerApiKeyScopes,
    },
    expectedStatus: 201,
  });
  const token = response.data?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Worker API key creation did not return a token.");
  }
  return token;
}

function selectedWorkerSpecs() {
  const workers = [...kubernetesCoreWorkerSpecs];
  if (hasFlag("--include-knowledge")) {
    workers.push(requiredWorkerSpec("knowledge_extraction"));
  }
  if (hasFlag("--include-voice")) {
    workers.push(requiredWorkerSpec("voice_catalog_sync"));
  }
  return workers;
}

function requiredWorkerSpec(name) {
  const worker = composeWorkerCommands.find((item) => item.name === name);
  if (worker === undefined) throw new Error(`Missing worker spec ${name}.`);
  return worker;
}

function assertWorkerCronJobsPresent(workers) {
  for (const worker of workers) {
    kubectl([
      "get",
      "cronjob",
      cronJobName(worker),
      "-n",
      namespace,
      "-o",
      "name",
    ]);
  }
}

async function runCronJobWorker(worker, suffix = worker.component) {
  const jobName = uniqueJobName(suffix);
  createdJobs.push(jobName);
  kubectl([
    "delete",
    "job",
    jobName,
    "-n",
    namespace,
    "--ignore-not-found=true",
    "--wait=true",
  ]);
  kubectl([
    "create",
    "job",
    jobName,
    "-n",
    namespace,
    `--from=cronjob/${cronJobName(worker)}`,
  ]);
  try {
    await waitForJobComplete(namespace, jobName, timeoutMs);
  } catch (error) {
    const logs = readJobLogs(jobName);
    throw new Error(
      `${worker.name} Kubernetes worker Job did not complete: ${
        error instanceof Error ? error.message : String(error)
      }\n${logs}`,
    );
  }
  const logs = readJobLogs(jobName);
  assertNoSensitiveLeak(worker.name, logs, [
    adminToken,
    workerToken,
    rawWorkerPromptSentinel,
    crashWorkerPromptSentinel,
    rawContentSentinel,
  ]);
  const output = parseWorkerOutput(worker.name, logs);
  assertWorkerOutput(worker, output);
  return {
    output,
    evidence: {
      name: worker.name,
      component: worker.component,
      cronJobName: cronJobName(worker),
      jobName,
      iteration: output.iteration,
      checks: worker.numericChecks.reduce(
        (checks, key) => ({ ...checks, [key]: output[key] }),
        {},
      ),
    },
  };
}

async function runWorkflowResumePodCrashRecoverySmoke(workflow) {
  const worker = requiredWorkerSpec("workflow_resume");
  const crashJobName = uniqueJobName("workflow-crash");
  createdJobs.push(crashJobName);
  kubectl([
    "delete",
    "job",
    crashJobName,
    "-n",
    namespace,
    "--ignore-not-found=true",
    "--wait=true",
  ]);
  const cronJob = kubectlJson([
    "get",
    "cronjob",
    cronJobName(worker),
    "-n",
    namespace,
  ]);
  applyResources(namespace, [crashJobFromCronJob(cronJob, crashJobName)]);
  const podName = await waitForRunningJobPod(crashJobName);
  const iterationLogs = await waitForJobLogsContain(
    crashJobName,
    '"iteration"',
  );
  assertNoSensitiveLeak("workflow_resume crash job", iterationLogs, [
    adminToken,
    workerToken,
    crashWorkerPromptSentinel,
    rawContentSentinel,
  ]);
  kubectl([
    "delete",
    "pod",
    podName,
    "-n",
    namespace,
    "--grace-period=0",
    "--force",
  ]);
  kubectl(
    [
      "wait",
      "--for=condition=failed",
      `job/${crashJobName}`,
      "-n",
      namespace,
      "--timeout",
      `${Math.ceil(timeoutMs / 1000)}s`,
    ],
    { allowFailure: true },
  );
  readJobLogs(crashJobName);

  const recovery = await runCronJobWorker(worker, "workflow-recovery");
  const recovered = await assertWorkflowRunStatus(
    harness,
    adminToken,
    workflow,
    "waiting_approval",
  );
  const step = recovered.steps.find((item) => item.stepId === "step_1");
  if (step?.output?.runId !== workflow.linkedRunId) {
    throw new Error(
      "Kubernetes workflow resume crash recovery created a duplicate linked run.",
    );
  }
  const runs = await workflowRuns(harness, adminToken, workflow.workflowId);
  if (runs.filter((item) => item.id === workflow.workflowRunId).length !== 1) {
    throw new Error(
      "Kubernetes workflow resume crash recovery duplicated the workflow run.",
    );
  }
  return {
    component: worker.component,
    crashJobName,
    killedPodName: podName,
    termination: "forced_pod_delete",
    recoveryJobName: recovery.evidence.jobName,
    workflowId: workflow.workflowId,
    workflowRunId: workflow.workflowRunId,
    linkedRunId: workflow.linkedRunId,
    recoveredStatus: recovered.status,
  };
}

function crashJobFromCronJob(cronJob, jobName) {
  const template = JSON.parse(
    JSON.stringify(cronJob.spec?.jobTemplate?.spec?.template),
  );
  const container = template?.spec?.containers?.[0];
  if (container === undefined) {
    throw new Error(
      "workflow-resume CronJob did not contain a worker container.",
    );
  }
  container.command = [
    "pnpm",
    "--filter",
    "@romeo/cli",
    "start",
    "--",
    "workers",
    "workflow-resume",
    "--workspace",
    "workspace_default",
    "--interval-ms",
    "15000",
    "--max-iterations",
    "2",
    "--max-workflows",
    "1",
    "--max-runs",
    "1",
  ];
  delete container.args;
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName,
      labels: {
        "app.kubernetes.io/name": "romeo",
        "app.kubernetes.io/component": "workflow-resume-crash-smoke",
      },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 120,
      template,
    },
  };
}

async function waitForRunningJobPod(jobName) {
  return waitForCondition(`running pod for ${jobName}`, timeoutMs, () => {
    const pods = kubectlJson([
      "get",
      "pods",
      "-n",
      namespace,
      "-l",
      `job-name=${jobName}`,
    ]).items;
    const running = pods.find((pod) => pod.status?.phase === "Running");
    return running?.metadata?.name;
  });
}

async function waitForJobLogsContain(jobName, needle) {
  return waitForCondition(
    `${jobName} logs to contain ${needle}`,
    timeoutMs,
    () => {
      const logs = readJobLogs(jobName, { allowFailure: true });
      return logs.includes(needle) ? logs : false;
    },
  );
}

function readJobLogs(jobName, options = {}) {
  const result = kubectl(
    [
      "logs",
      "-n",
      namespace,
      `job/${jobName}`,
      "--all-containers=true",
      "--prefix",
    ],
    { allowFailure: true },
  );
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`Unable to read logs for job ${jobName}: ${text}`);
  }
  jobLogEntries.push({ jobName, text });
  return text;
}

async function createWebhookDeliveryReadback(harness, token, sentinel) {
  const created = await apiJson(harness, "/api/v1/webhooks", {
    method: "POST",
    token,
    body: {
      url: "https://romeo-kubernetes-workers-webhook.invalid/romeo",
      eventTypes: ["webhook.test"],
    },
    expectedStatus: 201,
  });
  const subscriptionId = created.data?.subscription?.id;
  const signingSecret = created.data?.signingSecret;
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
    throw new Error(
      "Kubernetes worker smoke webhook subscription did not return an id.",
    );
  }
  if (typeof signingSecret !== "string" || signingSecret.length === 0) {
    throw new Error(
      "Kubernetes worker smoke webhook subscription did not return a signing secret.",
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
          check: "kubernetes-workers-smoke",
          rawBody: sentinel,
          nested: { rawBody: sentinel },
        },
      },
      expectedStatus: 202,
    },
  );
  const deliveryId = delivery.data?.id;
  if (typeof deliveryId !== "string" || deliveryId.length === 0) {
    throw new Error("Kubernetes worker smoke webhook delivery lacked an id.");
  }
  if (JSON.stringify(delivery.data).includes(sentinel)) {
    throw new Error(
      "Kubernetes worker smoke webhook delivery leaked raw payload content.",
    );
  }
  return { subscriptionId, deliveryId, signingSecret };
}

function cleanupCreatedJobs() {
  for (const jobName of createdJobs) {
    kubectl(
      [
        "delete",
        "job",
        jobName,
        "-n",
        namespace,
        "--ignore-not-found=true",
        "--wait=false",
      ],
      { allowFailure: true },
    );
  }
}

function cronJobName(worker) {
  return `${appName}-${worker.component}`;
}

function uniqueJobName(suffix) {
  return dnsName(`${jobPrefix}-${suffix}`).slice(0, 63).replace(/-+$/u, "");
}

function dnsName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
}

function helmFullname(value) {
  const chartName = "romeo";
  const name = value.includes(chartName) ? value : `${value}-${chartName}`;
  return name.slice(0, 63).replace(/-+$/u, "");
}

function parseSecretRef(value) {
  const [name, key] = value.split(":");
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof key !== "string" ||
    key.length === 0
  ) {
    throw new Error("--worker-api-key-secret must use name:key.");
  }
  return { name, key };
}

function requiredArg(name) {
  const value = argValue(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}
