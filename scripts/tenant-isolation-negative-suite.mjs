import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputPath = resolve(
  process.cwd(),
  argValue("--output") ?? "dist/ci/tenant-isolation-negative-suite.json",
);
const testFiles = [
  "src/services/authorization.test.ts",
  "src/collaboration.test.ts",
  "src/groups.test.ts",
  "src/data-connectors.test.ts",
  "src/device-authorizations.test.ts",
  "src/knowledge.test.ts",
  "src/quota.test.ts",
  "src/workflows.test.ts",
  "src/vector-isolation.test.ts",
  "src/api.test.ts",
];
const command = ["pnpm", "--filter", "@romeo/core", "test", "--", ...testFiles];
const startedAt = Date.now();
const result = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
});
const durationMs = Date.now() - startedAt;
const status = result.status === 0 ? "passed" : "failed";
const evidence = {
  schemaVersion: "romeo.tenant-isolation-negative-suite.v1",
  generatedAt: new Date().toISOString(),
  status,
  checks: [
    "object_grant_negative_authorization",
    "cross_workspace_worker_path_denials",
    "cross_org_governed_deletion_denial",
    "share_and_folder_resource_filtering",
    "group_membership_subject_resolution",
    "connector_owner_source_isolation",
    "device_authorization_scope_bounds",
    "quota_scope_and_limit_enforcement",
    "suspended_tenant_work_boundary_enforcement",
    "service_account_scope_and_visibility_bounds",
    "external_vector_provider_model_allowlist_denial",
    "external_vector_hit_post_filtering",
  ],
  command: {
    executable: command[0],
    args: command.slice(1),
  },
  testFiles,
  result: {
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    stdout: outputSummary(result.stdout),
    stderr: outputSummary(result.stderr),
  },
};

writeJson(outputPath, evidence);
if (status !== "passed") {
  console.error("Tenant isolation negative suite failed.");
  process.exit(1);
}
console.log(`Wrote tenant isolation negative evidence to ${outputPath}`);

function outputSummary(value) {
  return {
    bytes: Buffer.byteLength(value ?? "", "utf8"),
    sha256: sha256(value ?? ""),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
