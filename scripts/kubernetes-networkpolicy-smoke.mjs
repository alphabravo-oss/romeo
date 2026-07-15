import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  applyResources,
  assertTextDoesNotContain,
  deleteNamespace,
  kubectl,
  kubectlJson,
  podLogs,
  randomKubernetesName,
  sleep,
  waitForCondition,
  waitForKubectlRollout,
} from "./lib/kubernetes-smoke-support.mjs";

const namespace =
  argOrEnv("--namespace", "KUBERNETES_NETWORKPOLICY_NAMESPACE") ??
  randomKubernetesName("romeo-cni");
const outputPath = argValue("--output");
const dryRun = hasFlag("--dry-run");
const keep = hasFlag("--keep");
const timeoutMs = parsePositiveInteger(
  "--timeout-ms",
  180000,
  "KUBERNETES_NETWORKPOLICY_TIMEOUT_MS",
);
const policyPropagationMs = parsePositiveInteger(
  "--policy-propagation-ms",
  5000,
  "KUBERNETES_NETWORKPOLICY_POLICY_PROPAGATION_MS",
);
const clientImage =
  argOrEnv("--client-image", "KUBERNETES_NETWORKPOLICY_CLIENT_IMAGE") ??
  "curlimages/curl:8.15.0";
const serverImage =
  argOrEnv("--server-image", "KUBERNETES_NETWORKPOLICY_SERVER_IMAGE") ??
  "nginxinc/nginx-unprivileged:stable-alpine";
const secretSentinel = `network_policy_secret_${Date.now().toString(36)}`;

if (dryRun) {
  writeEvidence(plannedEvidence());
  process.exit(0);
}

try {
  kubectl(["cluster-info"]);
  kubectl(["create", "namespace", namespace]);
  applyResources(namespace, resources());
  await waitForKubectlRollout(
    namespace,
    "deployment/allowed-egress",
    timeoutMs,
  );
  await waitForKubectlRollout(namespace, "deployment/denied-egress", timeoutMs);
  await waitForCondition(
    "network policy client pod to become ready",
    timeoutMs,
    () => {
      const pod = clientPod();
      return pod.status?.phase === "Running" && podReady(pod);
    },
  );

  const allowedPodIp = readyPodIp("app.kubernetes.io/name=allowed-egress");
  const deniedPodIp = readyPodIp("app.kubernetes.io/name=denied-egress");

  execCurl(allowedPodIp);
  execCurl(deniedPodIp);

  applyResources(namespace, [egressPolicy()]);
  await sleep(policyPropagationMs);

  const allowedAfterPolicyIp = readyPodIp(
    "app.kubernetes.io/name=allowed-egress",
  );
  const deniedAfterPolicyIp = readyPodIp(
    "app.kubernetes.io/name=denied-egress",
  );

  execCurl(allowedAfterPolicyIp);
  const deniedAfterPolicy = execCurl(deniedAfterPolicyIp, {
    allowFailure: true,
  });
  if (deniedAfterPolicy.status === 0) {
    throw new Error(
      "NetworkPolicy did not block client egress to the denied pod. Verify the cluster CNI enforces networking.k8s.io/v1 NetworkPolicy.",
    );
  }

  const podLogEntries = podLogs(namespace);
  const logs = podLogEntries.map((entry) => entry.text).join("\n");
  assertTextDoesNotContain("NetworkPolicy smoke pod logs", logs, [
    secretSentinel,
  ]);

  writeEvidence({
    schemaVersion: "romeo.kubernetes-networkpolicy-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    namespace,
    target: {
      deployment: "kubernetes",
      enforcement: "networking.k8s.io/v1 NetworkPolicy",
      cni: "cluster_current_context",
    },
    images: {
      client: clientImage,
      server: serverImage,
    },
    checks: [
      "cluster_reachable",
      "namespace_created",
      "baseline_allowed_endpoint_reachable_before_policy",
      "baseline_denied_endpoint_reachable_before_policy",
      "egress_policy_applied",
      "allowed_endpoint_reachable_after_policy",
      "denied_endpoint_blocked_after_policy",
      "pod_logs_redacted",
    ],
    policy: {
      selectedComponent: "app",
      allowedPodLabel: "app.kubernetes.io/name=allowed-egress",
      deniedPodLabel: "app.kubernetes.io/name=denied-egress",
      allowedPort: 8080,
      propagationWaitMs: policyPropagationMs,
    },
    logRedaction: {
      status: "passed",
      scannedPodLogEntries: podLogEntries.length,
      generatedSentinelChecked: true,
    },
  });
} finally {
  if (!dryRun && !keep) {
    deleteNamespace(namespace);
  } else if (!dryRun) {
    process.stderr.write(
      `Keeping Kubernetes namespace ${namespace} for inspection.\n`,
    );
  }
}

function resources() {
  return [
    serverDeployment("allowed-egress"),
    serverDeployment("denied-egress"),
    clientPodResource(),
  ];
}

function serverDeployment(name) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      labels: {
        "app.kubernetes.io/name": name,
        "app.kubernetes.io/part-of": "romeo-networkpolicy-smoke",
      },
      name,
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": name,
            "app.kubernetes.io/part-of": "romeo-networkpolicy-smoke",
          },
        },
        spec: {
          automountServiceAccountToken: false,
          containers: [
            {
              image: serverImage,
              name: "server",
              ports: [{ containerPort: 8080, name: "http" }],
              readinessProbe: {
                httpGet: { path: "/", port: 8080 },
                failureThreshold: 20,
                periodSeconds: 3,
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                runAsNonRoot: true,
              },
            },
          ],
          securityContext: {
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
        },
      },
    },
  };
}

function clientPodResource() {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      labels: {
        "app.kubernetes.io/name": "romeo",
        "app.kubernetes.io/instance": "romeo",
        "app.kubernetes.io/component": "app",
        "app.kubernetes.io/part-of": "romeo-networkpolicy-smoke",
      },
      name: "networkpolicy-client",
    },
    spec: {
      automountServiceAccountToken: false,
      containers: [
        {
          command: ["sh", "-c", "sleep 3600"],
          env: [
            { name: "ROMEO_NETWORK_POLICY_SENTINEL", value: secretSentinel },
          ],
          image: clientImage,
          name: "curl",
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
            runAsNonRoot: true,
          },
        },
      ],
      restartPolicy: "Never",
      securityContext: {
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
    },
  };
}

function egressPolicy() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "romeo-cni-egress-contract" },
    spec: {
      podSelector: {
        matchLabels: {
          "app.kubernetes.io/name": "romeo",
          "app.kubernetes.io/instance": "romeo",
          "app.kubernetes.io/component": "app",
        },
      },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              podSelector: {
                matchLabels: { "app.kubernetes.io/name": "allowed-egress" },
              },
            },
          ],
          ports: [{ protocol: "TCP", port: 8080 }],
        },
      ],
    },
  };
}

function clientPod() {
  return kubectlJson(["get", "pod", "networkpolicy-client", "-n", namespace]);
}

function podReady(pod) {
  return (pod.status?.conditions ?? []).some(
    (condition) => condition.type === "Ready" && condition.status === "True",
  );
}

function readyPodIp(selector) {
  const pods = kubectlJson([
    "get",
    "pods",
    "-n",
    namespace,
    "-l",
    selector,
  ]).items;
  const pod = pods.find(
    (item) => item.status?.phase === "Running" && podReady(item),
  );
  const ip = pod?.status?.podIP;
  if (typeof ip !== "string" || ip.length === 0) {
    throw new Error(`Could not resolve ready pod IP for selector ${selector}.`);
  }
  return ip;
}

function execCurl(ip, options = {}) {
  return kubectl(
    [
      "exec",
      "-n",
      namespace,
      "networkpolicy-client",
      "--",
      "curl",
      "-fsS",
      "--connect-timeout",
      "3",
      "--max-time",
      "5",
      `http://${ip}:8080/`,
    ],
    { allowFailure: options.allowFailure },
  );
}

function plannedEvidence() {
  return {
    schemaVersion: "romeo.kubernetes-networkpolicy-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    namespace,
    target: {
      deployment: "kubernetes",
      enforcement: "networking.k8s.io/v1 NetworkPolicy",
    },
    images: {
      client: clientImage,
      server: serverImage,
    },
    checks: [
      "cluster_required_for_live_mode",
      "baseline_connectivity_required_before_policy",
      "allowed_egress_required_after_policy",
      "denied_egress_block_required_after_policy",
      "pod_log_redaction_required_for_passed_evidence",
    ],
  };
}

function writeEvidence(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  process.stdout.write(serialized);
  if (outputPath !== undefined) {
    const absolute = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, serialized, "utf8");
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argOrEnv(argName, envName) {
  return argValue(argName) ?? process.env[envName];
}

function parsePositiveInteger(name, fallback, envName) {
  const value = argValue(name) ?? process.env[envName];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
