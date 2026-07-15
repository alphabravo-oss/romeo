import { readFileSync } from "node:fs";

import { parseAllDocuments } from "yaml";

const examplePaths = ["deploy/keda/webhook-retry-scaledjob.example.yaml"];

const expectedCommand = [
  "pnpm",
  "--filter",
  "@romeo/cli",
  "start",
  "--",
  "workers",
  "webhook-retry",
  "--once",
];

export function checkKedaExamples() {
  const resources = examplePaths.flatMap((path) =>
    parseResources(readFileSync(path, "utf8"), path),
  );
  const byId = new Map(
    resources.map((resource) => [resourceId(resource), resource]),
  );

  const auth = requireResource(
    byId,
    "keda.sh/v1alpha1",
    "TriggerAuthentication",
    "romeo-webhook-retry-postgres",
  );
  const scaledJob = requireResource(
    byId,
    "keda.sh/v1alpha1",
    "ScaledJob",
    "romeo-webhook-retry",
  );

  assertTriggerAuthentication(auth);
  assertScaledJob(scaledJob);

  return {
    resourceCount: resources.length,
    resources: resources
      .map((resource) => ({
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        name: resource.metadata?.name,
      }))
      .sort((left, right) =>
        `${left.kind}/${left.name}`.localeCompare(
          `${right.kind}/${right.name}`,
        ),
      ),
  };
}

function parseResources(text, path) {
  return parseAllDocuments(text)
    .map((document) => document.toJSON())
    .filter((resource) => resource !== null && resource !== undefined)
    .map((resource) => ({ ...resource, __path: path }));
}

function resourceId(resource) {
  return `${resource.apiVersion}/${resource.kind}/${resource.metadata?.name}`;
}

function requireResource(byId, apiVersion, kind, name) {
  const resource = byId.get(`${apiVersion}/${kind}/${name}`);
  if (resource === undefined) {
    throw new Error(`KEDA examples are missing ${apiVersion} ${kind}/${name}.`);
  }
  return resource;
}

function assertTriggerAuthentication(auth) {
  const secretTargetRefs = auth.spec?.secretTargetRef ?? [];
  if (secretTargetRefs.length !== 1) {
    throw new Error("KEDA webhook retry auth must have one Secret target.");
  }
  const [connection] = secretTargetRefs;
  if (
    connection.parameter !== "connection" ||
    connection.name !== "romeo-postgres" ||
    connection.key !== "DATABASE_URL"
  ) {
    throw new Error(
      "KEDA webhook retry auth must reference romeo-postgres/DATABASE_URL as the connection parameter.",
    );
  }
}

function assertScaledJob(scaledJob) {
  const spec = scaledJob.spec ?? {};
  if (spec.pollingInterval !== 30) {
    throw new Error("KEDA webhook retry must poll every 30 seconds.");
  }
  if (spec.minReplicaCount !== 0 || spec.maxReplicaCount !== 3) {
    throw new Error("KEDA webhook retry replica bounds drifted.");
  }
  if (
    spec.successfulJobsHistoryLimit !== 3 ||
    spec.failedJobsHistoryLimit !== 5
  ) {
    throw new Error("KEDA webhook retry history limits drifted.");
  }
  if (
    spec.rollout?.strategy !== "gradual" ||
    spec.rollout?.propagationPolicy !== "foreground"
  ) {
    throw new Error("KEDA webhook retry rollout policy drifted.");
  }
  if (spec.scalingStrategy?.strategy !== "default") {
    throw new Error("KEDA webhook retry scaling strategy drifted.");
  }

  assertJobTargetRef(spec.jobTargetRef);
  assertPostgresTrigger(spec.triggers);
}

function assertJobTargetRef(job) {
  if (
    job?.parallelism !== 1 ||
    job.completions !== 1 ||
    job.backoffLimit !== 1 ||
    job.activeDeadlineSeconds !== 600
  ) {
    throw new Error("KEDA webhook retry Job bounds drifted.");
  }

  const podSpec = job.template?.spec;
  if (podSpec?.restartPolicy !== "Never") {
    throw new Error("KEDA webhook retry Job must use restartPolicy Never.");
  }
  if (podSpec.serviceAccountName !== "romeo-worker") {
    throw new Error("KEDA webhook retry Job must use romeo-worker.");
  }
  if (podSpec.automountServiceAccountToken !== false) {
    throw new Error("KEDA webhook retry Job must not automount API tokens.");
  }
  assertPodSecurityContext(podSpec.securityContext);

  const containers = podSpec.containers ?? [];
  if (containers.length !== 1) {
    throw new Error("KEDA webhook retry Job must have one container.");
  }
  const [container] = containers;
  if (container.name !== "webhook-retry") {
    throw new Error("KEDA webhook retry container name drifted.");
  }
  if (JSON.stringify(container.command) !== JSON.stringify(expectedCommand)) {
    throw new Error("KEDA webhook retry command drifted.");
  }
  assertContainerSecurityContext(container.securityContext);
  assertResources(container.resources);
  assertWorkerEnv(container.env ?? []);
}

function assertPodSecurityContext(securityContext) {
  if (securityContext?.runAsNonRoot !== true) {
    throw new Error("KEDA webhook retry pod must run as non-root.");
  }
  if (securityContext?.seccompProfile?.type !== "RuntimeDefault") {
    throw new Error("KEDA webhook retry pod must use RuntimeDefault seccomp.");
  }
}

function assertContainerSecurityContext(securityContext) {
  if (securityContext?.allowPrivilegeEscalation !== false) {
    throw new Error("KEDA webhook retry must forbid privilege escalation.");
  }
  if (!securityContext?.capabilities?.drop?.includes("ALL")) {
    throw new Error("KEDA webhook retry must drop all capabilities.");
  }
}

function assertResources(resources) {
  if (
    resources?.requests?.cpu === undefined ||
    resources.requests.memory === undefined ||
    resources?.limits?.cpu === undefined ||
    resources.limits.memory === undefined
  ) {
    throw new Error("KEDA webhook retry is missing CPU/memory resources.");
  }
}

function assertWorkerEnv(env) {
  const names = new Set(env.map((entry) => entry.name));
  if (names.has("DATABASE_URL")) {
    throw new Error(
      "KEDA webhook retry Job must not mount DATABASE_URL into the worker container.",
    );
  }
  const baseUrl = env.find((entry) => entry.name === "ROMEO_BASE_URL");
  if (baseUrl?.value !== "http://romeo:3000") {
    throw new Error("KEDA webhook retry base URL drifted.");
  }
  const apiKey = env.find((entry) => entry.name === "ROMEO_API_KEY");
  const secretRef = apiKey?.valueFrom?.secretKeyRef;
  if (
    secretRef?.name !== "romeo-worker-api-key" ||
    secretRef.key !== "ROMEO_API_KEY"
  ) {
    throw new Error("KEDA webhook retry API key must be Secret-backed.");
  }
}

function assertPostgresTrigger(triggers) {
  if (!Array.isArray(triggers) || triggers.length !== 1) {
    throw new Error("KEDA webhook retry must have one trigger.");
  }
  const [trigger] = triggers;
  if (trigger.type !== "postgresql") {
    throw new Error("KEDA webhook retry must use the PostgreSQL scaler.");
  }
  if (trigger.authenticationRef?.name !== "romeo-webhook-retry-postgres") {
    throw new Error("KEDA webhook retry must reference TriggerAuthentication.");
  }
  const metadata = trigger.metadata ?? {};
  for (const forbidden of [
    "connection",
    "connectionFromEnv",
    "host",
    "userName",
    "password",
    "passwordFromEnv",
  ]) {
    if (metadata[forbidden] !== undefined) {
      throw new Error(
        `KEDA webhook retry must not inline PostgreSQL auth metadata ${forbidden}.`,
      );
    }
  }
  if (
    metadata.targetQueryValue !== "1" ||
    metadata.activationTargetQueryValue !== "0"
  ) {
    throw new Error("KEDA webhook retry target values drifted.");
  }
  const query = String(metadata.query ?? "").toLowerCase();
  for (const token of [
    "webhook_deliveries",
    "status = 'failed'",
    "next_attempt_at",
    "attempt_count < 5",
  ]) {
    if (!query.includes(token)) {
      throw new Error(`KEDA webhook retry query is missing ${token}.`);
    }
  }
}
