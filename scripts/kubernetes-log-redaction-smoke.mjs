import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  assertTextDoesNotContain,
  kubectl,
  kubectlJson,
} from "./lib/kubernetes-smoke-support.mjs";

const outputPath = argValue("--output");
const dryRun = hasFlag("--dry-run");
const namespace = argValue("--namespace") ?? process.env.ROMEO_NAMESPACE;
const releaseName = argValue("--release-name") ?? "romeo";
const podSelector =
  argValue("--pod-selector") ??
  `app.kubernetes.io/name=romeo,app.kubernetes.io/instance=${releaseName}`;
const jobSelector =
  argValue("--job-selector") ??
  `app.kubernetes.io/name=romeo,app.kubernetes.io/instance=${releaseName}`;
const since = argValue("--since");
const tail = argValue("--tail");
const allowMissingJobs = hasFlag("--allow-missing-jobs");
const allowLogReadFailures = hasFlag("--allow-log-read-failures");

const sentinelGroups = {
  prompt: repeatedArgValues("--prompt-sentinel"),
  providerPayload: repeatedArgValues("--provider-payload-sentinel"),
  workerPayload: repeatedArgValues("--worker-payload-sentinel"),
  secret: repeatedArgValues("--secret-sentinel"),
};

const requiredSentinelGroups = ["prompt", "providerPayload", "workerPayload"];

if (dryRun) {
  writeEvidence(plannedEvidence());
  process.exit(0);
}

if (namespace === undefined || namespace.length === 0) {
  throw new Error("--namespace or ROMEO_NAMESPACE is required.");
}

for (const group of requiredSentinelGroups) {
  if (sentinelGroups[group].length === 0) {
    throw new Error(
      `${sentinelArgName(group)} is required for live Kubernetes log-redaction evidence.`,
    );
  }
}

kubectl(["cluster-info"]);
const namespaceInfo = kubectlJson(["get", "namespace", namespace]);
const podLogEntries = readPodLogs();
const jobLogEntries = readJobLogs();
const failedLogReads = [
  ...podLogEntries.filter((entry) => entry.status !== 0),
  ...jobLogEntries.filter((entry) => entry.status !== 0),
];

if (podLogEntries.length === 0) {
  throw new Error(
    `No pods matched selector ${podSelector} in namespace ${namespace}.`,
  );
}
if (!allowMissingJobs && jobLogEntries.length === 0) {
  throw new Error(
    `No jobs matched selector ${jobSelector} in namespace ${namespace}. Use --allow-missing-jobs only for a reviewed app-pod-only scan.`,
  );
}
if (!allowLogReadFailures && failedLogReads.length > 0) {
  throw new Error(
    `Failed to read ${failedLogReads.length} Kubernetes log target(s). Use --allow-log-read-failures only with reviewed partial evidence.`,
  );
}

const combinedLogs = [...podLogEntries, ...jobLogEntries]
  .map((entry) => entry.text)
  .join("\n");
for (const [group, values] of Object.entries(sentinelGroups)) {
  assertTextDoesNotContain(
    `Kubernetes ${sentinelDisplayName(group)} logs`,
    combinedLogs,
    values,
  );
}

writeEvidence({
  schemaVersion: "romeo.kubernetes-log-redaction-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  mode: "live",
  target: {
    deployment: "kubernetes",
    namespace,
    namespaceUid: namespaceInfo.metadata?.uid,
    releaseName,
    podSelector,
    jobSelector,
    since: since ?? null,
    tail: tail ?? null,
  },
  scanned: {
    podLogEntries: podLogEntries.length,
    jobLogEntries: jobLogEntries.length,
    failedLogReads: failedLogReads.length,
  },
  sentinelCounts: Object.fromEntries(
    Object.entries(sentinelGroups).map(([group, values]) => [
      group,
      values.length,
    ]),
  ),
  redaction: {
    status: "passed",
    promptSentinelsAbsent: true,
    providerPayloadSentinelsAbsent: true,
    workerPayloadSentinelsAbsent: true,
    secretSentinelsAbsent: true,
    evidenceStoresSentinelValues: false,
  },
  checks: [
    "cluster_reachable",
    "namespace_readable",
    "pod_logs_readable",
    "job_logs_readable",
    "prompt_sentinels_absent",
    "provider_payload_sentinels_absent",
    "worker_payload_sentinels_absent",
    "secret_sentinels_absent",
    "evidence_omits_sentinel_values",
  ],
});

function plannedEvidence() {
  return {
    schemaVersion: "romeo.kubernetes-log-redaction-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      deployment: "kubernetes",
      namespace: namespace ?? "required_for_live_mode",
      releaseName,
      podSelector,
      jobSelector,
      since: since ?? null,
      tail: tail ?? null,
    },
    requiredInputs: {
      namespace: namespace !== undefined,
      promptSentinelCount: sentinelGroups.prompt.length,
      providerPayloadSentinelCount: sentinelGroups.providerPayload.length,
      workerPayloadSentinelCount: sentinelGroups.workerPayload.length,
      secretSentinelCount: sentinelGroups.secret.length,
    },
    checks: [
      "cluster_reachable_required_for_live_mode",
      "namespace_readable_required_for_live_mode",
      "pod_logs_required_for_live_mode",
      "job_logs_required_for_live_mode",
      "prompt_provider_and_worker_payload_sentinels_required",
      "dry_run_is_planning_evidence_only",
    ],
  };
}

function readPodLogs() {
  const pods = kubectlJson([
    "get",
    "pods",
    "-n",
    namespace,
    "-l",
    podSelector,
  ]).items;
  return pods
    .map((pod) => pod.metadata?.name)
    .filter((name) => typeof name === "string")
    .map((podName) => {
      const result = kubectl(["logs", "-n", namespace, podName, ...logArgs()], {
        allowFailure: true,
      });
      return {
        kind: "Pod",
        name: podName,
        status: result.status,
        text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      };
    });
}

function readJobLogs() {
  const jobs = kubectlJson([
    "get",
    "jobs",
    "-n",
    namespace,
    "-l",
    jobSelector,
  ]).items;
  return jobs
    .map((job) => job.metadata?.name)
    .filter((name) => typeof name === "string")
    .map((jobName) => {
      const result = kubectl(
        ["logs", "-n", namespace, `job/${jobName}`, ...logArgs()],
        { allowFailure: true },
      );
      return {
        kind: "Job",
        name: jobName,
        status: result.status,
        text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      };
    });
}

function logArgs() {
  return [
    "--all-containers=true",
    "--prefix",
    ...(since === undefined ? [] : [`--since=${since}`]),
    ...(tail === undefined ? [] : [`--tail=${tail}`]),
  ];
}

function writeEvidence(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  process.stdout.write(serialized);
  if (outputPath === undefined) return;
  const absolute = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, serialized, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
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

function sentinelArgName(group) {
  if (group === "prompt") return "--prompt-sentinel";
  if (group === "providerPayload") return "--provider-payload-sentinel";
  if (group === "workerPayload") return "--worker-payload-sentinel";
  return "--secret-sentinel";
}

function sentinelDisplayName(group) {
  if (group === "providerPayload") return "provider payload";
  if (group === "workerPayload") return "worker payload";
  return group;
}
