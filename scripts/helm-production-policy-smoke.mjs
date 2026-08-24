#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chart = resolve(root, "deploy/helm");
const digest = `sha256:${"a".repeat(64)}`;
const opsDigest = `sha256:${"b".repeat(64)}`;
const egress = JSON.stringify([
  {
    to: [{ podSelector: { matchLabels: { app: "valkey" } } }],
    ports: [{ protocol: "TCP", port: 6379 }],
  },
]);
const ingress = JSON.stringify([{ ipBlock: { cidr: "10.42.0.0/16" } }]);
const valid = [
  "--set-string",
  `image.digest=${digest}`,
  "--set-string",
  `opsImage.digest=${opsDigest}`,
  "--set-string",
  "valkey.urlSecret.name=romeo-valkey",
  "--set-json",
  `networkPolicy.egress=${egress}`,
  "--set-json",
  `networkPolicy.ingressFrom=${ingress}`,
  "--set-string",
  "env.EDGE_TRUSTED_PROXY_CIDRS=10.42.0.0/16",
  "--set-string",
  "backup.externalManagement.owner=platform-database-team",
  "--set-string",
  "backup.externalManagement.evidenceReference=reviewed-external-backup-runbook",
];

const rendered = helm(valid);
for (const required of [
  `image: "romeo/app@${digest}"`,
  `image: "romeo/ops@${opsDigest}"`,
  "kind: NetworkPolicy",
  "name: romeo-policy-default-deny",
  "name: romeo-policy-app",
  "name: romeo-policy-operations",
  "app.kubernetes.io/component: app",
  "policyTypes:\n    - Ingress\n    - Egress",
  "readinessProbe:\n            exec:",
  "/api/v1/readyz",
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
  "workers.toolDispatch.enabled=true",
  "--set-string",
  "workers.toolDispatch.identity.credentialSecret.name=romeo-tool-broker",
  "--set-string",
  "workers.toolDispatch.identity.previousCredentialSecret.name=romeo-tool-broker-previous",
  "--set-string",
  "workers.toolDispatch.identity.previousCredentialSecret.key=token",
  "--set",
  "workers.toolDispatch.networkPolicy.enabled=true",
  "--set-json",
  `workers.toolDispatch.networkPolicy.egress=${egress}`,
  "--set",
  "workers.browserAutomation.enabled=true",
  "--set-string",
  "workers.browserAutomation.identity.credentialSecret.name=romeo-browser-broker",
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
  "--set-string",
  "workers.knowledgeExtraction.identity.credentialSecret.name=romeo-knowledge-broker",
  "--set",
  "workers.knowledgeExtraction.networkPolicy.enabled=true",
  "--set",
  "backup.mode=managed-verified",
  "--set",
  "backup.enabled=true",
  "--set-string",
  "backup.uploadUrlSecret.name=romeo-postgres-backup",
  "--set-string",
  "backup.readbackUrlSecret.name=romeo-postgres-backup",
  "--set-string",
  "backup.manifestUploadUrlSecret.name=romeo-postgres-backup",
  "--set-string",
  "backup.manifestReadbackUrlSecret.name=romeo-postgres-backup",
  "--set-string",
  "backup.statusUploadUrlSecret.name=romeo-postgres-backup",
  "--set-string",
  "backup.statusReadbackUrlSecret.name=romeo-postgres-backup",
  "--set-string",
  "backup.policyReadbackUrlSecret.name=romeo-postgres-backup",
]);
assert(
  (workerRendered.match(/mountPath: \/tmp/gu) ?? []).length >= 6,
  "every enabled app/job container must receive a writable /tmp mount",
);
assert(
  (workerRendered.match(/readOnlyRootFilesystem: true/gu) ?? []).length >= 6,
  "every enabled app/job container must render a read-only root filesystem",
);
assert(
  workerRendered.includes("operator: NotIn") &&
    workerRendered.includes("- tool-dispatch") &&
    workerRendered.includes("- browser-automation") &&
    workerRendered.includes("- knowledge-extraction"),
  "generic operations NetworkPolicy must exclude workers with narrower egress policies",
);
assert(
  (workerRendered.match(/name: romeo-policy-default-deny/gu) ?? []).length ===
    1,
  "one release-wide default-deny policy must cover every Romeo workload",
);
assert(
  (
    workerRendered.match(new RegExp(`image: "romeo/ops@${opsDigest}"`, "gu")) ??
    []
  ).length === 5,
  "migration, three isolated workers, and backup must use the ops-runtime digest",
);
assert(
  (workerRendered.match(new RegExp(`image: "romeo/app@${digest}"`, "gu")) ?? [])
    .length === 1,
  "only the serving Deployment may use the app-runtime digest",
);
for (const required of [
  "--durability-mode verified-upload",
  "name: POSTGRES_BACKUP_READBACK_URL",
  "name: POSTGRES_BACKUP_MANIFEST_READBACK_URL",
  "name: POSTGRES_BACKUP_STATUS_UPLOAD_URL",
  "name: POSTGRES_BACKUP_STATUS_READBACK_URL",
  "name: POSTGRES_BACKUP_POLICY_READBACK_URL",
]) {
  assert(
    workerRendered.includes(required),
    `managed backup render missing ${required}`,
  );
}
for (const required of [
  "name: TOOL_DISPATCH_BROKER_TOKEN",
  "name: TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS",
  "name: BROWSER_AUTOMATION_BROKER_TOKEN",
  "name: KNOWLEDGE_EXTRACTION_BROKER_TOKEN",
  "name: ROMEO_WORKER_BROKER_ALLOW_INSECURE_HTTP",
  'value: "true"',
]) {
  assert(
    workerRendered.includes(required),
    `broker server/worker wiring missing ${required}`,
  );
}

helm([
  ...valid,
  "--set-string",
  "env.POSTGRES_TLS_EXCEPTION_ENABLED=true",
  "--set-string",
  "env.POSTGRES_TLS_EXCEPTION_SCOPE=in_cluster",
  "--set-string",
  "env.POSTGRES_TLS_EXCEPTION_OWNER=database-platform",
  "--set-string",
  "env.POSTGRES_TLS_EXCEPTION_REASON=service-mesh migration is under active review",
  "--set-string",
  "env.POSTGRES_TLS_EXCEPTION_EXPIRES_AT=2026-10-01T00:00:00Z",
  "--set-string",
  "env.VALKEY_SECURITY_EXCEPTION_ENABLED=true",
  "--set-string",
  "env.VALKEY_SECURITY_EXCEPTION_SCOPE=in_cluster",
  "--set-string",
  "env.VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED=true",
  "--set-string",
  "env.VALKEY_SECURITY_EXCEPTION_OWNER=cache-platform",
  "--set-string",
  "env.VALKEY_SECURITY_EXCEPTION_REASON=service-mesh migration is under active review",
  "--set-string",
  "env.VALKEY_SECURITY_EXCEPTION_EXPIRES_AT=2026-10-01T00:00:00Z",
  "--set-string",
  "env.FILE_MALWARE_SCAN_ENABLED=false",
  "--set-string",
  "env.FILE_MALWARE_SCAN_POLICY=off",
  "--set-string",
  "env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED=true",
  "--set-string",
  "env.FILE_MALWARE_SCAN_EXCEPTION_OWNER=security-platform",
  "--set-string",
  "env.FILE_MALWARE_SCAN_EXCEPTION_REASON=managed upload quarantine rollout is under active review",
  "--set-string",
  "env.FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT=2026-10-01T00:00:00Z",
  "--set-string",
  "env.NOTIFICATION_DELIVERY_DRIVER=slack-webhook",
  "--set-string",
  "env.NOTIFICATION_WEBHOOK_EGRESS_POLICY=require_allowlist",
  "--set-string",
  "env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS=hooks.slack.com",
]);

const negativeCases = [
  ["chart-created production secret", ["--set", "secrets.create=true"]],
  [
    "missing externally provisioned runtime secret",
    ["--set-string", "secrets.existingSecret="],
  ],
  [
    "inline production secret",
    ["--set-string", "secretEnv.SESSION_SECRET=plaintext-in-values"],
  ],
  ["memory repository", ["--set-string", "env.REPOSITORY_DRIVER=memory"]],
  ["memory object storage", ["--set-string", "env.OBJECT_STORE_DRIVER=memory"]],
  [
    "S3 encryption posture disabled",
    ["--set-string", "env.S3_READINESS_REQUIRE_ENCRYPTION=false"],
  ],
  [
    "S3 versioning posture disabled",
    ["--set-string", "env.S3_READINESS_REQUIRE_VERSIONING=false"],
  ],
  [
    "S3 lifecycle posture disabled",
    ["--set-string", "env.S3_READINESS_REQUIRE_LIFECYCLE=false"],
  ],
  [
    "memory rate limiting",
    ["--set-string", "env.HTTP_RATE_LIMIT_DRIVER=memory"],
  ],
  [
    "memory realtime fanout",
    ["--set-string", "env.REALTIME_EVENT_DRIVER=memory"],
  ],
  [
    "disabled quota coordination",
    ["--set-string", "env.QUOTA_COORDINATION_DRIVER=disabled"],
  ],
  [
    "malware required without enabling the scanner",
    [
      "--set-string",
      "env.FILE_MALWARE_SCAN_ENABLED=false",
      "--set-string",
      "env.FILE_MALWARE_SCAN_POLICY=required",
    ],
  ],
  [
    "malware enabled without required policy",
    [
      "--set-string",
      "env.FILE_MALWARE_SCAN_ENABLED=true",
      "--set-string",
      "env.FILE_MALWARE_SCAN_POLICY=off",
    ],
  ],
  [
    "malware enabled without scanner endpoint",
    ["--set-string", "env.CLAMAV_ADDRESS="],
  ],
  [
    "malware exception enabled while scanner is hardened",
    ["--set-string", "env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED=true"],
  ],
  [
    "malware disabled without exception owner",
    [
      "--set-string",
      "env.FILE_MALWARE_SCAN_ENABLED=false",
      "--set-string",
      "env.FILE_MALWARE_SCAN_POLICY=off",
      "--set-string",
      "env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED=true",
      "--set-string",
      "env.FILE_MALWARE_SCAN_EXCEPTION_REASON=reviewed migration exception",
      "--set-string",
      "env.FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT=2026-10-01T00:00:00Z",
    ],
  ],
  [
    "Postgres exception without in-cluster scope",
    ["--set-string", "env.POSTGRES_TLS_EXCEPTION_ENABLED=true"],
  ],
  [
    "Valkey exception without NetworkPolicy evidence",
    [
      "--set-string",
      "env.VALKEY_SECURITY_EXCEPTION_ENABLED=true",
      "--set-string",
      "env.VALKEY_SECURITY_EXCEPTION_SCOPE=in_cluster",
      "--set-string",
      "env.VALKEY_SECURITY_EXCEPTION_OWNER=cache-platform",
      "--set-string",
      "env.VALKEY_SECURITY_EXCEPTION_REASON=reviewed migration exception",
      "--set-string",
      "env.VALKEY_SECURITY_EXCEPTION_EXPIRES_AT=2026-10-01T00:00:00Z",
    ],
  ],
  [
    "notification webhook without allowlist policy",
    [
      "--set-string",
      "env.NOTIFICATION_DELIVERY_DRIVER=slack-webhook",
      "--set-string",
      "env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS=hooks.slack.com",
    ],
  ],
  [
    "notification webhook without allowed hosts",
    [
      "--set-string",
      "env.NOTIFICATION_DELIVERY_DRIVER=slack-webhook",
      "--set-string",
      "env.NOTIFICATION_WEBHOOK_EGRESS_POLICY=require_allowlist",
    ],
  ],
  [
    "notification webhook with non-normalized allowed hosts",
    [
      "--set-string",
      "env.NOTIFICATION_DELIVERY_DRIVER=slack-webhook",
      "--set-string",
      "env.NOTIFICATION_WEBHOOK_EGRESS_POLICY=require_allowlist",
      "--set-string",
      "env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS=Hooks.Slack.com",
    ],
  ],
  ["missing immutable digest", ["--set-string", "image.digest="]],
  ["missing immutable ops digest", ["--set-string", "opsImage.digest="]],
  [
    "externally managed backup without evidence",
    ["--set-string", "backup.externalManagement.evidenceReference="],
  ],
  [
    "externally managed backup without live status",
    ["--set-string", "backup.externalManagement.statusReference="],
  ],
  [
    "externally managed backup without alerting",
    ["--set", "backup.externalManagement.alertsConfigured=false"],
  ],
  [
    "missing object backup owner",
    ["--set-string", "essentialOperations.objectStoreBackup.owner="],
  ],
  [
    "missing disaster recovery evidence",
    ["--set-string", "essentialOperations.disasterRecovery.evidenceReference="],
  ],
  [
    "object backup without alerting",
    ["--set", "essentialOperations.objectStoreBackup.alertsConfigured=false"],
  ],
  [
    "retired webhook retry CronJob enabled",
    ["--set", "workers.webhookRetry.enabled=true"],
  ],
  [
    "retired notification retry CronJob enabled",
    ["--set", "workers.notificationRetry.enabled=true"],
  ],
  [
    "retired retention CronJob enabled",
    ["--set", "workers.retentionEnforce.enabled=true"],
  ],
  [
    "managed backup without readback destination",
    [
      "--set-string",
      "backup.mode=managed-verified",
      "--set",
      "backup.enabled=true",
      "--set-string",
      "backup.uploadUrlSecret.name=romeo-postgres-backup",
    ],
  ],
  [
    "writable app root",
    ["--set", "securityContext.readOnlyRootFilesystem=false"],
  ],
  ["root-capable app", ["--set", "podSecurityContext.runAsNonRoot=false"]],
  ["disabled network policy", ["--set", "networkPolicy.enabled=false"]],
  [
    "missing trusted proxy source CIDRs",
    ["--set-string", "env.EDGE_TRUSTED_PROXY_CIDRS="],
  ],
  ["empty ingress policy", ["--set-json", "networkPolicy.ingressFrom=[]"]],
  ["empty egress policy", ["--set-json", "networkPolicy.egress=[]"]],
  [
    "process-only readiness",
    ["--set", "probes.readiness.dependencyCheck.enabled=false"],
  ],
  ["migration not gating rollout", ["--set", "migration.useHelmHook=false"]],
  [
    "migration sharing app ServiceAccount",
    ["--set-string", "migration.serviceAccount.name=romeo-policy"],
  ],
  [
    "migration automounting Kubernetes API token",
    ["--set", "migration.serviceAccount.automountServiceAccountToken=true"],
  ],
  ["missing Valkey secret", ["--set-string", "valkey.urlSecret.name="]],
  ["non-production Helm mode", ["--set", "global.production=false"]],
  [
    "tool-dispatch worker without egress policy",
    ["--set", "workers.toolDispatch.enabled=true"],
  ],
  [
    "tool-dispatch worker without broker credential",
    [
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set-json",
      `workers.toolDispatch.networkPolicy.egress=${egress}`,
    ],
  ],
  [
    "tool-dispatch worker with wrong audience",
    [
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set-json",
      `workers.toolDispatch.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.toolDispatch.identity.credentialSecret.name=tool-broker",
      "--set-string",
      "workers.toolDispatch.identity.audience=browser_automation",
    ],
  ],
  [
    "browser worker without broker credential",
    [
      "--set",
      "workers.browserAutomation.enabled=true",
      "--set-string",
      "workers.browserAutomation.runnerUrl=http://browser-runner",
      "--set",
      "workers.browserAutomation.networkPolicy.enabled=true",
      "--set-json",
      `workers.browserAutomation.networkPolicy.egress=${egress}`,
    ],
  ],
  [
    "duplicate worker broker secrets",
    [
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set-json",
      `workers.toolDispatch.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.toolDispatch.identity.credentialSecret.name=shared-broker",
      "--set",
      "workers.browserAutomation.enabled=true",
      "--set-string",
      "workers.browserAutomation.runnerUrl=http://browser-runner",
      "--set",
      "workers.browserAutomation.networkPolicy.enabled=true",
      "--set-json",
      `workers.browserAutomation.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.browserAutomation.identity.credentialSecret.name=shared-broker",
    ],
  ],
  [
    "duplicate worker ServiceAccounts",
    [
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set-json",
      `workers.toolDispatch.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.toolDispatch.identity.credentialSecret.name=tool-broker",
      "--set-string",
      "workers.toolDispatch.identity.serviceAccount.name=shared-worker",
      "--set",
      "workers.browserAutomation.enabled=true",
      "--set-string",
      "workers.browserAutomation.runnerUrl=http://browser-runner",
      "--set",
      "workers.browserAutomation.networkPolicy.enabled=true",
      "--set-json",
      `workers.browserAutomation.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.browserAutomation.identity.credentialSecret.name=browser-broker",
      "--set-string",
      "workers.browserAutomation.identity.serviceAccount.name=shared-worker",
    ],
  ],
  [
    "partial previous broker credential reference",
    [
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set-json",
      `workers.toolDispatch.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.toolDispatch.identity.credentialSecret.name=tool-broker",
      "--set-string",
      "workers.toolDispatch.identity.previousCredentialSecret.name=tool-broker-previous",
    ],
  ],
  [
    "previous broker credential reuses current reference",
    [
      "--set",
      "workers.toolDispatch.enabled=true",
      "--set",
      "workers.toolDispatch.networkPolicy.enabled=true",
      "--set-json",
      `workers.toolDispatch.networkPolicy.egress=${egress}`,
      "--set-string",
      "workers.toolDispatch.identity.credentialSecret.name=tool-broker",
      "--set-string",
      "workers.toolDispatch.identity.previousCredentialSecret.name=tool-broker",
      "--set-string",
      "workers.toolDispatch.identity.previousCredentialSecret.key=token",
    ],
  ],
  [
    "scheduled owner env mismatch",
    ["--set-string", "env.SCHEDULED_TENANT_WORK_OWNER=external"],
  ],
  [
    "external scheduled owner without evidence mount",
    [
      "--set-string",
      "env.SCHEDULED_TENANT_WORK_OWNER=external",
      "--set-string",
      "essentialOperations.scheduledTenantWork.mode=external",
    ],
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
  [
    "knowledge worker without isolated egress policy",
    [
      "--set",
      "workers.knowledgeExtraction.enabled=true",
      "--set-string",
      "workers.knowledgeExtraction.identity.credentialSecret.name=knowledge-broker",
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
