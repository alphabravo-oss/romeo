#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chart = resolve(root, "deploy/helm");
const digest = `sha256:${"a".repeat(64)}`;
const egress = JSON.stringify([
  {
    to: [{ podSelector: { matchLabels: { app: "valkey" } } }],
    ports: [{ protocol: "TCP", port: 6379 }],
  },
]);
const valid = [
  "--set-string",
  `image.digest=${digest}`,
  "--set-string",
  "valkey.urlSecret.name=romeo-valkey",
  "--set-json",
  `networkPolicy.egress=${egress}`,
];

const rendered = helm(valid);
for (const required of [
  `image: "romeo/app@${digest}"`,
  "kind: NetworkPolicy",
  "app.kubernetes.io/component: app",
  "policyTypes:\n    - Ingress\n    - Egress",
  "readinessProbe:\n            exec:",
  "readOnlyRootFilesystem: true",
  "mountPath: /tmp",
]) {
  assert(
    rendered.includes(required),
    `positive production render missing ${required}`,
  );
}

const workerRendered = helm([
  ...valid,
  "--set",
  "workers.dataConnectorSync.enabled=true",
  "--set",
  "workers.workflowResume.enabled=true",
  "--set",
  "workers.webhookRetry.enabled=true",
  "--set",
  "workers.notificationRetry.enabled=true",
  "--set",
  "workers.retentionEnforce.enabled=true",
  "--set",
  "workers.billingEntitlementReconcile.enabled=true",
  "--set",
  "workers.billingLifecycleEnforce.enabled=true",
  "--set",
  "workers.toolDispatch.enabled=true",
  "--set",
  "workers.toolDispatch.networkPolicy.enabled=true",
  "--set-json",
  `workers.toolDispatch.networkPolicy.egress=${egress}`,
  "--set",
  "workers.browserAutomation.enabled=true",
  "--set-string",
  "workers.browserAutomation.runnerUrl=http://browser-runner",
  "--set",
  "workers.browserAutomation.networkPolicy.enabled=true",
  "--set-json",
  `workers.browserAutomation.networkPolicy.egress=${egress}`,
  "--set",
  "workers.knowledgeExtraction.enabled=true",
  "--set-string",
  "workers.knowledgeExtraction.knowledgeBaseId=kb-policy-check",
  "--set",
  "workers.voiceCatalogSync.enabled=true",
  "--set",
  "backup.enabled=true",
]);
assert(
  (workerRendered.match(/mountPath: \/tmp/gu) ?? []).length >= 13,
  "every enabled app/job container must receive a writable /tmp mount",
);
assert(
  (workerRendered.match(/readOnlyRootFilesystem: true/gu) ?? []).length >= 13,
  "every enabled app/job container must render a read-only root filesystem",
);

const negativeCases = [
  [
    "memory rate limiting",
    ["--set-string", "env.HTTP_RATE_LIMIT_DRIVER=memory"],
  ],
  [
    "disabled quota coordination",
    ["--set-string", "env.QUOTA_COORDINATION_DRIVER=disabled"],
  ],
  [
    "optional malware scanning",
    ["--set-string", "env.FILE_MALWARE_SCAN_POLICY=off"],
  ],
  ["missing immutable digest", ["--set-string", "image.digest="]],
  [
    "writable app root",
    ["--set", "securityContext.readOnlyRootFilesystem=false"],
  ],
  ["root-capable app", ["--set", "podSecurityContext.runAsNonRoot=false"]],
  ["disabled network policy", ["--set", "networkPolicy.enabled=false"]],
  ["empty egress policy", ["--set-json", "networkPolicy.egress=[]"]],
  [
    "process-only readiness",
    ["--set", "probes.readiness.dependencyCheck.enabled=false"],
  ],
  ["migration not gating rollout", ["--set", "migration.useHelmHook=false"]],
  ["missing Valkey secret", ["--set-string", "valkey.urlSecret.name="]],
  ["non-production Helm mode", ["--set", "global.production=false"]],
  [
    "tool-dispatch worker without egress policy",
    ["--set", "workers.toolDispatch.enabled=true"],
  ],
  [
    "browser worker without egress policy",
    [
      "--set",
      "workers.browserAutomation.enabled=true",
      "--set-string",
      "workers.browserAutomation.runnerUrl=http://browser-runner",
    ],
  ],
];

for (const [name, override] of negativeCases) {
  expectFailure(name, [...valid, ...override]);
  expectFailure(`${name} (template invariant)`, [...valid, ...override], true);
}

helm([
  ...valid,
  "--set-string",
  "image.digest=",
  "--set",
  "imagePolicyException.enabled=true",
  "--set-string",
  "imagePolicyException.reason=development registry cannot publish digests",
]);

console.log(
  `helm production policy: app/full-worker positive renders and ${negativeCases.length * 2} negative checks passed`,
);

function helm(extra, skipSchema = false) {
  const args = [
    "template",
    "romeo-policy",
    chart,
    ...(skipSchema ? ["--skip-schema-validation"] : []),
    ...extra,
  ];
  const result = spawnSync("helm", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `helm ${args.join(" ")} failed\n${result.stderr || result.stdout}`,
    );
  return result.stdout;
}

function expectFailure(name, extra, skipSchema = false) {
  const args = [
    "template",
    "romeo-policy",
    chart,
    ...(skipSchema ? ["--skip-schema-validation"] : []),
    ...extra,
  ];
  const result = spawnSync("helm", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert(result.status !== 0, `${name} unexpectedly rendered successfully`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
