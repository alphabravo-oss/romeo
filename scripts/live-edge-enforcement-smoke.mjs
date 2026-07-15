import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  collectEdgeEnforcementEvidence,
  parseStatusList,
  plannedEdgeEnforcementEvidence,
  positiveInteger,
} from "./lib/edge-enforcement-smoke.mjs";

const outputPath = argValue("--output");
const dryRun = process.argv.includes("--dry-run");
const config = {
  apiKey: argValue("--api-key") ?? process.env.ROMEO_API_KEY,
  baseUrl: argValue("--base-url") ?? process.env.ROMEO_BASE_URL,
  bodyLimitBytes: positiveInteger(
    argOrEnv("--body-limit-bytes", "EDGE_ENFORCEMENT_BODY_LIMIT_BYTES"),
    1_048_576,
    "--body-limit-bytes",
  ),
  bodyLimitExpectedStatuses: parseStatusList(
    argOrEnv(
      "--body-limit-expected-statuses",
      "EDGE_ENFORCEMENT_BODY_LIMIT_EXPECTED_STATUSES",
    ),
    [413],
  ),
  bodyLimitPath:
    argOrEnv("--body-limit-path", "EDGE_ENFORCEMENT_BODY_LIMIT_PATH") ??
    "/api/v1/billing/webhooks/generic",
  headerPath:
    argOrEnv("--header-path", "EDGE_ENFORCEMENT_HEADER_PATH") ??
    "/api/v1/health",
  rateLimitAttempts: positiveInteger(
    argOrEnv("--rate-limit-attempts", "EDGE_ENFORCEMENT_RATE_LIMIT_ATTEMPTS"),
    8,
    "--rate-limit-attempts",
  ),
  rateLimitExpectedStatus: positiveInteger(
    argOrEnv(
      "--rate-limit-expected-status",
      "EDGE_ENFORCEMENT_RATE_LIMIT_EXPECTED_STATUS",
    ),
    429,
    "--rate-limit-expected-status",
  ),
  rateLimitPath:
    argOrEnv("--rate-limit-path", "EDGE_ENFORCEMENT_RATE_LIMIT_PATH") ??
    "/api/v1/health",
  requireAdminPosture: flagOrEnv(
    "--require-admin-posture",
    "EDGE_ENFORCEMENT_REQUIRE_ADMIN_POSTURE",
    false,
  ),
  requireHsts: process.argv.includes("--no-require-hsts")
    ? false
    : boolEnv("EDGE_ENFORCEMENT_REQUIRE_HSTS", true),
  requireWafBlockMode: flagOrEnv(
    "--require-waf-block-mode",
    "EDGE_ENFORCEMENT_REQUIRE_WAF_BLOCK_MODE",
    false,
  ),
  timeoutMs: positiveInteger(
    argOrEnv("--timeout-ms", "EDGE_ENFORCEMENT_TIMEOUT_MS"),
    10_000,
    "--timeout-ms",
  ),
  wafExpectedHeader: argOrEnv(
    "--waf-expected-header",
    "EDGE_ENFORCEMENT_WAF_EXPECTED_HEADER",
  ),
  wafExpectedStatuses: parseStatusList(
    argOrEnv(
      "--waf-expected-statuses",
      "EDGE_ENFORCEMENT_WAF_EXPECTED_STATUSES",
    ),
    [403, 406, 429],
  ),
  wafProbeHeaderName: argOrEnv(
    "--waf-probe-header-name",
    "EDGE_ENFORCEMENT_WAF_PROBE_HEADER_NAME",
  ),
  wafProbeHeaderValue:
    argOrEnv(
      "--waf-probe-header-value",
      "EDGE_ENFORCEMENT_WAF_PROBE_HEADER_VALUE",
    ) ?? "romeo-edge-probe UNION SELECT <script>alert(1)</script>",
  wafProbePath:
    argOrEnv("--waf-probe-path", "EDGE_ENFORCEMENT_WAF_PROBE_PATH") ??
    "/api/v1/health?romeo_edge_probe=%27%20OR%201%3D1%20UNION%20SELECT%20%3Cscript%3Ealert%281%29%3C%2Fscript%3E",
};

const evidence = dryRun
  ? plannedEdgeEnforcementEvidence(config)
  : await collectEdgeEnforcementEvidence(config);

writeEvidence(evidence);

function writeEvidence(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  const resolved = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, body, "utf8");
  console.log(`Wrote live edge enforcement evidence to ${resolved}`);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argOrEnv(argName, envName) {
  return argValue(argName) ?? process.env[envName];
}

function flagOrEnv(argName, envName, fallback) {
  if (process.argv.includes(argName)) return true;
  return boolEnv(envName, fallback);
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}
