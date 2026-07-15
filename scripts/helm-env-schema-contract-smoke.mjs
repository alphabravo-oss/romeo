import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import YAML from "yaml";

import {
  argValue,
  repoPath,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const valuesPath = repoPath(argValue("--values") ?? "deploy/helm/values.yaml");
const schemaPath = repoPath(
  argValue("--schema") ?? "deploy/helm/values.schema.json",
);
const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/helm-env-schema-contract-smoke.json",
);
const stdout = process.argv.includes("--stdout");
const blockers = [];
const checks = [];

const valuesSource = readRequired(valuesPath, "helm_values_missing");
const schemaSource = readRequired(schemaPath, "helm_values_schema_missing");
const values = parseYaml(valuesSource);
const schema = parseJson(schemaSource);
const helmEnvKeys = uniqueSorted(Object.keys(values?.env ?? {}));
const schemaEnvKeys = uniqueSorted(
  Object.keys(schema?.properties?.env?.properties ?? {}),
);
const schemaEnvSet = new Set(schemaEnvKeys);
const valuesEnvSet = new Set(helmEnvKeys);
const missingFromSchema = helmEnvKeys.filter((key) => !schemaEnvSet.has(key));
const schemaOnlyKeys = schemaEnvKeys.filter((key) => !valuesEnvSet.has(key));

check("Helm values file exists", valuesSource !== undefined, {
  code: "helm_values_missing",
});
check("Helm values schema exists", schemaSource !== undefined, {
  code: "helm_values_schema_missing",
});
check("Helm values YAML parses", values !== undefined, {
  code: "helm_values_invalid_yaml",
});
check("Helm values schema JSON parses", schema !== undefined, {
  code: "helm_values_schema_invalid_json",
});
check("Helm env keys are schema-covered", missingFromSchema.length === 0, {
  code: "helm_env_missing_schema_keys",
  metadata: { missingFromSchema },
});
check("Helm env schema keys have defaults", schemaOnlyKeys.length === 0, {
  code: "helm_env_schema_only_keys",
  metadata: { schemaOnlyKeys },
});

const evidence = {
  schemaVersion: "romeo.helm-env-schema-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: blockers.length === 0 ? "passed" : "blocked",
  files: {
    values: relative(root, valuesPath),
    schema: relative(root, schemaPath),
  },
  summary: {
    helmEnvKeyCount: helmEnvKeys.length,
    schemaEnvKeyCount: schemaEnvKeys.length,
    missingSchemaKeyCount: missingFromSchema.length,
    schemaOnlyKeyCount: schemaOnlyKeys.length,
  },
  missingFromSchema,
  schemaOnlyKeys,
  checks,
  blockers,
  redaction: {
    valuesIncluded: false,
    schemaBodyIncluded: false,
    secretValuesIncluded: false,
  },
};

writeJsonOrStdout({ path: outputPath, value: evidence, stdout });
if (!stdout) {
  console.log(
    `Wrote Helm env schema contract smoke to ${relative(root, outputPath)}`,
  );
}
if (blockers.length > 0) process.exit(1);

function readRequired(path, code) {
  if (!existsSync(path)) {
    blockers.push({
      code,
      message: `Required file is missing: ${relative(root, path)}`,
    });
    return undefined;
  }
  return readFileSync(path, "utf8");
}

function parseYaml(source) {
  if (source === undefined) return undefined;
  try {
    return YAML.parse(source);
  } catch {
    blockers.push({
      code: "helm_values_invalid_yaml",
      message: "Helm values YAML could not be parsed.",
    });
    return undefined;
  }
}

function parseJson(source) {
  if (source === undefined) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    blockers.push({
      code: "helm_values_schema_invalid_json",
      message: "Helm values schema JSON could not be parsed.",
    });
    return undefined;
  }
}

function check(name, passed, { code, metadata } = {}) {
  checks.push({ name, status: passed ? "pass" : "fail", ...(metadata ?? {}) });
  if (!passed && !blockers.some((blocker) => blocker.code === code)) {
    blockers.push({ code, message: name, ...(metadata ?? {}) });
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
