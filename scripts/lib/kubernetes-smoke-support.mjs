import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

export function randomKubernetesName(prefix) {
  return `${prefix}-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

export async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address !== null) {
          resolvePort(address.port);
        } else {
          reject(new Error("Unable to allocate a local port."));
        }
      });
    });
  });
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe",
  });
  if (result.error !== undefined) {
    throw new Error(
      `${command} ${args.join(" ")} failed to start: ${result.error.message}`,
    );
  }
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\nSTDOUT:\n${result.stdout ?? ""}\nSTDERR:\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

export function kubectl(args, options = {}) {
  return run("kubectl", args, options);
}

export function helm(args, options = {}) {
  return run("helm", args, options);
}

export function kubectlJson(args, options = {}) {
  const result = kubectl([...args, "-o", "json"], options);
  return JSON.parse(result.stdout);
}

export function applyResources(namespace, resources) {
  kubectl(["apply", "-n", namespace, "-f", "-"], {
    input: JSON.stringify({
      apiVersion: "v1",
      kind: "List",
      items: resources,
    }),
  });
}

export function deleteNamespace(namespace) {
  kubectl(["delete", "namespace", namespace, "--ignore-not-found=true"], {
    allowFailure: true,
    stdio: "inherit",
  });
}

export async function waitForCondition(description, timeoutMs, check) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ""}`,
  );
}

export async function waitForKubectlRollout(namespace, resource, timeoutMs) {
  kubectl([
    "rollout",
    "status",
    resource,
    "-n",
    namespace,
    "--timeout",
    `${Math.ceil(timeoutMs / 1000)}s`,
  ]);
}

export async function waitForJobComplete(namespace, jobName, timeoutMs) {
  kubectl([
    "wait",
    "--for=condition=complete",
    `job/${jobName}`,
    "-n",
    namespace,
    "--timeout",
    `${Math.ceil(timeoutMs / 1000)}s`,
  ]);
}

export async function startPortForward(
  namespace,
  serviceName,
  localPort,
  remotePort,
) {
  const child = spawn(
    "kubectl",
    [
      "port-forward",
      "-n",
      namespace,
      `service/${serviceName}`,
      `${localPort}:${remotePort}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  await waitForCondition("kubectl port-forward to become ready", 30000, () => {
    if (child.exitCode !== null) {
      throw new Error(`kubectl port-forward exited early: ${output}`);
    }
    return output.includes("Forwarding from");
  });
  return {
    stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
    },
  };
}

export function podLogs(namespace, options = {}) {
  const pods = kubectlJson(["get", "pods", "-n", namespace], {
    allowFailure: options.allowFailure,
  }).items;
  const entries = [];
  for (const pod of pods) {
    const podName = pod.metadata?.name;
    if (typeof podName !== "string") continue;
    const result = kubectl(
      ["logs", "-n", namespace, podName, "--all-containers=true", "--prefix"],
      { allowFailure: true },
    );
    entries.push({
      podName,
      status: result.status,
      text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    });
  }
  return entries;
}

export function assertTextDoesNotContain(label, text, values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0 && text.includes(value)) {
      throw new Error(`${label} leaked a generated sentinel.`);
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
