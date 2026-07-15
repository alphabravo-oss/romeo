import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  argValue,
  repoPath,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const composePath = repoPath(
  argValue("--compose-file") ?? "deploy/compose/compose.yml",
);
const envExamplePath = repoPath(
  argValue("--env-example") ?? "deploy/compose/.env.example",
);
const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/compose-env-contract-smoke.json",
);
const stdout = process.argv.includes("--stdout");

const blockers = [];
const checks = [];
const composeSource = readRequired(composePath, "compose_file_missing");
const envExampleSource = readRequired(envExamplePath, "env_example_missing");
const composeVariables = composeSource
  ? uniqueSorted(
      [...composeSource.matchAll(/(?<!\$)\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/gu)]
        .map((match) => match[1])
        .filter(Boolean),
    )
  : [];
const envExampleVariables = envExampleSource
  ? uniqueSorted(
      envExampleSource
        .split(/\r?\n/u)
        .map((line) => line.match(/^([A-Z0-9_]+)=/u)?.[1])
        .filter(Boolean),
    )
  : [];
const envExampleSet = new Set(envExampleVariables);
const missingVariables = composeVariables.filter(
  (variable) => !envExampleSet.has(variable),
);
const duplicateVariables = envExampleSource
  ? duplicateKeys(envExampleSource)
  : [];

check("compose file exists", composeSource !== undefined, {
  code: "compose_file_missing",
});
check("env example exists", envExampleSource !== undefined, {
  code: "env_example_missing",
});
check(
  "compose interpolated variables are represented",
  missingVariables.length === 0,
  {
    code: "compose_env_missing_variables",
    metadata: { missingVariables },
  },
);
check("env example does not duplicate keys", duplicateVariables.length === 0, {
  code: "env_example_duplicate_variables",
  metadata: { duplicateVariables },
});

const evidence = {
  schemaVersion: "romeo.compose-env-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: blockers.length === 0 ? "passed" : "blocked",
  files: {
    compose: relative(root, composePath),
    envExample: relative(root, envExamplePath),
  },
  summary: {
    composeVariableCount: composeVariables.length,
    envExampleVariableCount: envExampleVariables.length,
    missingVariableCount: missingVariables.length,
    duplicateVariableCount: duplicateVariables.length,
  },
  missingVariables,
  duplicateVariables,
  checks,
  blockers,
  redaction: {
    envValuesIncluded: false,
    secretValuesIncluded: false,
    composeBodyIncluded: false,
    envExampleBodyIncluded: false,
  },
};

writeJsonOrStdout({ path: outputPath, value: evidence, stdout });
if (!stdout) {
  console.log(
    `Wrote Compose env contract smoke to ${relative(root, outputPath)}`,
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

function check(name, passed, { code, metadata } = {}) {
  checks.push({ name, status: passed ? "pass" : "fail", ...(metadata ?? {}) });
  if (!passed && !blockers.some((blocker) => blocker.code === code)) {
    blockers.push({ code, message: name, ...(metadata ?? {}) });
  }
}

function duplicateKeys(source) {
  const seen = new Set();
  const duplicates = new Set();
  for (const line of source.split(/\r?\n/u)) {
    const key = line.match(/^([A-Z0-9_]+)=/u)?.[1];
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return uniqueSorted([...duplicates]);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
