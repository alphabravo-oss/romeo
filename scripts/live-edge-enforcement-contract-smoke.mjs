import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  argValue,
  fileEvidence,
  readJson,
  repoPath,
  root,
  writeJson,
} from "./lib/release-artifacts.mjs";
import { redactOutput } from "./lib/edge-enforcement-smoke.mjs";

const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/live-edge-enforcement-contract-smoke.json",
);
const generatedAt = new Date().toISOString();
const tempDir = join(
  tmpdir(),
  `romeo-edge-enforcement-smoke-${randomBytes(6).toString("hex")}`,
);
const apiKey = `edge_${randomBytes(24).toString("hex")}`;
const wafSentinel = `romeo-edge-waf-${randomBytes(16).toString("hex")}`;
let serverMode = "passing";
let rateLimitHits = 0;

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
  const positivePath = join(tempDir, "live-edge-enforcement.json");
  const missingHeaderPath = join(tempDir, "missing-header.json");
  const missingWafPath = join(tempDir, "missing-waf.json");
  const missingBodyLimitPath = join(tempDir, "missing-body-limit.json");
  const missingRateLimitPath = join(tempDir, "missing-rate-limit.json");

  const positive = await runEdgeSmoke(baseUrl, positivePath);
  assertPassingEvidence(positivePath);

  serverMode = "missing-header";
  const missingHeader = await runEdgeSmoke(baseUrl, missingHeaderPath, {
    expectFailure: true,
  });

  serverMode = "missing-waf";
  const missingWaf = await runEdgeSmoke(baseUrl, missingWafPath, {
    expectFailure: true,
  });

  serverMode = "missing-body-limit";
  const missingBodyLimit = await runEdgeSmoke(baseUrl, missingBodyLimitPath, {
    expectFailure: true,
  });

  serverMode = "missing-rate-limit";
  const missingRateLimit = await runEdgeSmoke(baseUrl, missingRateLimitPath, {
    expectFailure: true,
  });

  assertNoSecretLeak([
    positivePath,
    missingHeader.stdoutFile,
    missingHeader.stderrFile,
    missingWaf.stdoutFile,
    missingWaf.stderrFile,
    missingBodyLimit.stdoutFile,
    missingBodyLimit.stderrFile,
    missingRateLimit.stdoutFile,
    missingRateLimit.stderrFile,
  ]);

  writeJson(outputPath, {
    schemaVersion: "romeo.live-edge-enforcement-contract-smoke.v1",
    generatedAt,
    status: "passed",
    checks: [
      check("security header readback", positive),
      check("admin edge posture redaction readback", positive),
      check("WAF/API-gateway block proof", positive),
      check("oversized request rejection proof", positive),
      check("public rate-limit proof", positive),
      check("missing security header rejection", missingHeader),
      check("missing WAF block rejection", missingWaf),
      check("missing body-limit rejection", missingBodyLimit),
      check("missing rate-limit rejection", missingRateLimit),
      { name: "edge evidence token and probe redaction", status: "passed" },
    ],
    evidence: {
      positive: fileEvidence(positivePath, "live-edge-enforcement.json"),
      missingHeaderStdout: fileEvidence(
        missingHeader.stdoutFile,
        "missing-header.stdout",
      ),
      missingHeaderStderr: fileEvidence(
        missingHeader.stderrFile,
        "missing-header.stderr",
      ),
      missingWafStdout: fileEvidence(
        missingWaf.stdoutFile,
        "missing-waf.stdout",
      ),
      missingWafStderr: fileEvidence(
        missingWaf.stderrFile,
        "missing-waf.stderr",
      ),
      missingBodyLimitStdout: fileEvidence(
        missingBodyLimit.stdoutFile,
        "missing-body-limit.stdout",
      ),
      missingBodyLimitStderr: fileEvidence(
        missingBodyLimit.stderrFile,
        "missing-body-limit.stderr",
      ),
      missingRateLimitStdout: fileEvidence(
        missingRateLimit.stdoutFile,
        "missing-rate-limit.stdout",
      ),
      missingRateLimitStderr: fileEvidence(
        missingRateLimit.stderrFile,
        "missing-rate-limit.stderr",
      ),
    },
  });
  console.log(
    `Wrote edge enforcement contract smoke evidence to ${outputPath}`,
  );
} finally {
  await close(server);
  rmSync(tempDir, { recursive: true, force: true });
}

function handleRequest(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/api/v1/admin/edge-security/posture") {
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      return text(response, 401, "unauthorized");
    }
    return json(response, 200, {
      status: "ready",
      ingress: { wafMode: "block" },
      limits: { rateLimit: { driver: "valkey", distributed: true } },
      checks: [],
      redaction: {
        rawAllowedOriginsReturned: false,
        rawAppOriginReturned: false,
        rawIngressAnnotationsReturned: false,
        rawProxyIpRangesReturned: false,
        rawSecretsReturned: false,
      },
    });
  }
  if (url.pathname === "/api/v1/health") {
    if (url.searchParams.has("romeo_edge_probe")) {
      if (serverMode === "missing-waf") return health(response);
      response.writeHead(403, {
        ...securityHeaders(),
        "content-type": "text/plain",
        "x-romeo-waf-blocked": "true",
      });
      response.end("blocked");
      return undefined;
    }
    if (url.searchParams.has("rate_limit_probe")) {
      rateLimitHits += 1;
      if (serverMode !== "missing-rate-limit" && rateLimitHits >= 3) {
        response.writeHead(429, {
          ...securityHeaders(),
          "content-type": "application/json",
          "retry-after": "60",
        });
        response.end(
          JSON.stringify({ error: { code: "rate_limit_exceeded" } }),
        );
        return undefined;
      }
    }
    return health(response);
  }
  if (url.pathname === "/api/v1/billing/webhooks/generic") {
    return collectBody(request).then((body) => {
      if (serverMode !== "missing-body-limit" && body.length > 512) {
        return text(response, 413, "too large");
      }
      return text(response, 400, "signature required");
    });
  }
  return text(response, 404, "not found");
}

function runEdgeSmoke(baseUrl, evidencePath, options = {}) {
  rateLimitHits = 0;
  const modeName = serverMode;
  const stdoutFile = join(
    tempDir,
    `${modeName}-${options.expectFailure ? "failure" : "success"}.stdout`,
  );
  const stderrFile = join(
    tempDir,
    `${modeName}-${options.expectFailure ? "failure" : "success"}.stderr`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        repoPath("scripts/live-edge-enforcement-smoke.mjs"),
        "--base-url",
        baseUrl,
        "--api-key",
        apiKey,
        "--require-admin-posture",
        "--require-waf-block-mode",
        "--body-limit-bytes",
        "512",
        "--body-limit-expected-statuses",
        "413",
        "--rate-limit-attempts",
        "4",
        "--rate-limit-path",
        "/api/v1/health?rate_limit_probe=1",
        "--waf-probe-path",
        `/api/v1/health?romeo_edge_probe=${encodeURIComponent(wafSentinel)}`,
        "--waf-expected-statuses",
        "403",
        "--waf-expected-header",
        "x-romeo-waf-blocked",
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
      const secrets = [apiKey, wafSentinel];
      writeFileSync(stdoutFile, redactOutput(stdout, secrets), "utf8");
      writeFileSync(stderrFile, redactOutput(stderr, secrets), "utf8");
      if (failed !== Boolean(options.expectFailure)) {
        reject(
          new Error(
            [
              `live-edge-enforcement-smoke exited ${code}; expected failure=${Boolean(options.expectFailure)}`,
              `stdout: ${redactOutput(stdout, secrets).trim()}`,
              `stderr: ${redactOutput(stderr, secrets).trim()}`,
            ].join("\n"),
          ),
        );
        return;
      }
      resolve({
        stdout: redactOutput(stdout, secrets),
        stderr: redactOutput(stderr, secrets),
        stdoutFile,
        stderrFile,
      });
    });
  });
}

function assertPassingEvidence(path) {
  const evidence = readJson(path);
  if (
    evidence.schemaVersion !== "romeo.live-edge-enforcement.v1" ||
    evidence.status !== "passed" ||
    evidence.mode !== "live"
  ) {
    throw new Error(
      "Positive edge smoke did not produce live passed evidence.",
    );
  }
  const checks = new Set(evidence.checks ?? []);
  for (const required of [
    "security_headers_present",
    "hsts_header_present",
    "admin_edge_posture_readback",
    "waf_or_gateway_probe_blocked",
    "oversized_request_rejected",
    "public_rate_limit_enforced",
    "raw_probe_payload_not_retained",
  ]) {
    if (!checks.has(required)) {
      throw new Error(`Positive edge smoke missed check ${required}.`);
    }
  }
  if (evidence.adminPosture?.checked !== true) {
    throw new Error("Positive edge smoke missed admin posture readback.");
  }
  if (evidence.waf?.httpStatus !== 403) {
    throw new Error("Positive edge smoke did not capture WAF block status.");
  }
  if (evidence.requestBodyLimit?.httpStatus !== 413) {
    throw new Error("Positive edge smoke did not capture body-limit status.");
  }
  if (evidence.rateLimit?.blockedAt !== 3) {
    throw new Error("Positive edge smoke did not capture rate-limit blocking.");
  }
  const serialized = JSON.stringify(evidence);
  if (serialized.includes(apiKey) || serialized.includes(wafSentinel)) {
    throw new Error("Positive edge evidence leaked a secret or raw probe.");
  }
}

function assertNoSecretLeak(paths) {
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    if (content.includes("Bearer")) {
      throw new Error(`${path} leaked an Authorization scheme.`);
    }
    if (content.includes(apiKey) || content.includes(wafSentinel)) {
      throw new Error(`${path} leaked a generated secret or raw probe.`);
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

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    ...(serverMode === "missing-header" ? {} : { "x-frame-options": "DENY" }),
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  };
}

function health(response) {
  return json(response, 200, { status: "ok" });
}

function json(response, status, value) {
  response.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json",
  });
  response.end(JSON.stringify(value));
}

function text(response, status, value) {
  response.writeHead(status, {
    ...securityHeaders(),
    "content-type": "text/plain",
  });
  response.end(value);
}

function collectBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
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
