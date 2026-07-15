import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import {
  argValue,
  fileEvidence,
  readJson,
  repoPath,
  root,
  writeJson,
} from "./lib/release-artifacts.mjs";

const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/live-alert-firing-contract-smoke.json",
);
const generatedAt = new Date().toISOString();
const tempDir = join(
  tmpdir(),
  `romeo-alert-firing-smoke-${randomBytes(6).toString("hex")}`,
);
const tokens = {
  prometheus: `prom_${randomBytes(24).toString("hex")}`,
  alertmanager: `am_${randomBytes(24).toString("hex")}`,
};
const requiredAlerts = [
  { name: "RomeoProviderCircuitOpen", category: "provider" },
  { name: "RomeoBackgroundJobQueuedLag", category: "queue" },
  { name: "RomeoBackgroundJobDeadLetters", category: "queue" },
  { name: "RomeoPostgresBackupJobFailed", category: "backup" },
];
let serverMode = "passing";

mkdirSync(tempDir, { recursive: true });
const server = createServer((request, response) => {
  try {
    handleRequest(request, response);
  } catch {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("error");
  }
});

try {
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const positivePath = join(tempDir, "live-alert-firing.json");
  const missingPrometheusPath = join(tempDir, "missing-prometheus-alert.json");
  const missingAlertmanagerPath = join(
    tempDir,
    "missing-alertmanager-alert.json",
  );

  serverMode = "passing";
  const positive = await runLiveAlertSmoke(baseUrl, positivePath);
  assertPassingEvidence(positivePath);

  serverMode = "missing-prometheus-backup";
  const missingPrometheus = await runLiveAlertSmoke(
    baseUrl,
    missingPrometheusPath,
    { expectFailure: true },
  );

  serverMode = "missing-alertmanager-backup";
  const missingAlertmanager = await runLiveAlertSmoke(
    baseUrl,
    missingAlertmanagerPath,
    { expectFailure: true },
  );

  assertNoTokenLeak([
    positivePath,
    missingPrometheus.stdoutFile,
    missingPrometheus.stderrFile,
    missingAlertmanager.stdoutFile,
    missingAlertmanager.stderrFile,
  ]);

  writeJson(outputPath, {
    schemaVersion: "romeo.live-alert-firing-contract-smoke.v1",
    generatedAt,
    status: "passed",
    checks: [
      check("live Prometheus required alerts readback", positive),
      check("live Alertmanager active alert readback", positive),
      check("missing Prometheus firing alert rejection", missingPrometheus),
      check("missing Alertmanager active alert rejection", missingAlertmanager),
      { name: "alert evidence redaction flags", status: "passed" },
      { name: "alert evidence bearer token redaction", status: "passed" },
    ],
    requiredAlerts,
    evidence: {
      positive: fileEvidence(positivePath, "live-alert-firing.json"),
      missingPrometheusStdout: fileEvidence(
        missingPrometheus.stdoutFile,
        "missing-prometheus-alert.stdout",
      ),
      missingPrometheusStderr: fileEvidence(
        missingPrometheus.stderrFile,
        "missing-prometheus-alert.stderr",
      ),
      missingAlertmanagerStdout: fileEvidence(
        missingAlertmanager.stdoutFile,
        "missing-alertmanager-alert.stdout",
      ),
      missingAlertmanagerStderr: fileEvidence(
        missingAlertmanager.stderrFile,
        "missing-alertmanager-alert.stderr",
      ),
    },
  });
  console.log(`Wrote alert-firing contract smoke evidence to ${outputPath}`);
} finally {
  await close(server);
  rmSync(tempDir, { recursive: true, force: true });
}

function handleRequest(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/api/v1/alerts") {
    if (!hasBearer(request, tokens.prometheus)) return unauthorized(response);
    return json(response, {
      status: "success",
      data: {
        alerts: prometheusAlerts(),
      },
    });
  }
  if (url.pathname === "/api/v2/alerts") {
    if (!hasBearer(request, tokens.alertmanager)) return unauthorized(response);
    return json(response, alertmanagerAlerts());
  }
  return notFound(response);
}

function prometheusAlerts() {
  return requiredAlerts
    .filter(
      (alert) =>
        serverMode !== "missing-prometheus-backup" ||
        alert.category !== "backup",
    )
    .map((alert, index) => ({
      state: "firing",
      activeAt: `2026-07-02T12:0${index}:00.000Z`,
      labels: {
        alertname: alert.name,
        severity: alert.category === "provider" ? "warning" : "critical",
      },
    }));
}

function alertmanagerAlerts() {
  return requiredAlerts
    .filter(
      (alert) =>
        serverMode !== "missing-alertmanager-backup" ||
        alert.category !== "backup",
    )
    .map((alert) => ({
      labels: {
        alertname: alert.name,
      },
      status: {
        state: "active",
      },
    }));
}

function runLiveAlertSmoke(baseUrl, evidencePath, options = {}) {
  const stdoutFile = join(
    tempDir,
    `${serverMode}-${options.expectFailure ? "failure" : "success"}.stdout`,
  );
  const stderrFile = join(
    tempDir,
    `${serverMode}-${options.expectFailure ? "failure" : "success"}.stderr`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        repoPath("scripts/live-alert-firing-smoke.mjs"),
        "--prometheus-url",
        baseUrl,
        "--prometheus-bearer-token",
        tokens.prometheus,
        "--alertmanager-url",
        baseUrl,
        "--alertmanager-bearer-token",
        tokens.alertmanager,
        "--output",
        evidencePath,
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      const failed = code !== 0;
      writeFileSync(stdoutFile, redactOutput(stdout), "utf8");
      writeFileSync(stderrFile, redactOutput(stderr), "utf8");
      if (failed !== Boolean(options.expectFailure)) {
        reject(
          new Error(
            `live-alert-firing-smoke exited ${code}; expected failure=${Boolean(options.expectFailure)}`,
          ),
        );
        return;
      }
      resolve({
        stdout: redactOutput(stdout),
        stderr: redactOutput(stderr),
        stdoutFile,
        stderrFile,
      });
    });
  });
}

function assertPassingEvidence(path) {
  const evidence = readJson(path);
  if (
    evidence.schemaVersion !== "romeo.live-alert-firing.v1" ||
    evidence.status !== "passed" ||
    evidence.mode !== "live"
  ) {
    throw new Error(
      "Positive alert smoke did not produce live passed evidence.",
    );
  }
  const firing = new Set(
    (evidence.prometheus?.requiredAlertsFiring ?? []).map(
      (alert) => alert.name,
    ),
  );
  for (const alert of requiredAlerts) {
    if (!firing.has(alert.name)) {
      throw new Error(`Positive alert smoke missed ${alert.name}.`);
    }
  }
  if (evidence.alertmanager?.status !== "passed") {
    throw new Error("Positive alert smoke did not pass Alertmanager readback.");
  }
  for (const [field, value] of Object.entries(evidence.redaction ?? {})) {
    if (value !== false) {
      throw new Error(`Positive alert smoke redaction flag failed: ${field}.`);
    }
  }
  for (const field of [
    "bearerTokensReturned",
    "rawPrometheusResponseReturned",
    "rawAlertmanagerResponseReturned",
    "rawPrometheusUrlReturned",
    "rawAlertmanagerUrlReturned",
    "rawAlertPayloadsReturned",
  ]) {
    if (evidence.redaction?.[field] !== false) {
      throw new Error(`Positive alert smoke missed redaction flag: ${field}.`);
    }
  }
}

function assertNoTokenLeak(paths) {
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    if (content.includes("Bearer")) {
      throw new Error(`${path} leaked an Authorization scheme.`);
    }
    for (const token of Object.values(tokens)) {
      if (content.includes(token)) {
        throw new Error(`${path} leaked a token value.`);
      }
    }
  }
}

function check(name, command) {
  return {
    name,
    status: "passed",
    stdoutSha256: sha256String(command.stdout),
    stderrSha256: sha256String(command.stderr),
  };
}

function redactOutput(value) {
  let redacted = value;
  for (const token of Object.values(tokens)) {
    redacted = redacted.replaceAll(token, "[redacted]");
  }
  return redacted.replaceAll(/Bearer\s+\S+/gu, "Bearer [redacted]");
}

function hasBearer(request, token) {
  return request.headers.authorization === `Bearer ${token}`;
}

function json(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function unauthorized(response) {
  response.writeHead(401, { "content-type": "text/plain" });
  response.end("unauthorized");
}

function notFound(response) {
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
}

function listen(input) {
  return new Promise((resolve) => input.listen(0, "127.0.0.1", resolve));
}

function close(input) {
  return new Promise((resolve) => input.close(resolve));
}

function sha256String(value) {
  return createHash("sha256").update(value).digest("hex");
}
