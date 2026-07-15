import { readFileSync, writeFileSync } from "node:fs";

import {
  argValue,
  ensureParentDirectory,
  hasFlag,
  printPlan,
  repoPath,
} from "./lib/postgres-maintenance.mjs";

const inventoryPath = repoPath(
  "packages/core/src/domain/repository-contract-inventory.ts",
);
const conformanceTestPath = repoPath(
  "packages/db/src/romeo-repository.test.ts",
);
const outputValue = argValue("--output");
const output =
  outputValue === undefined ? undefined : resolveRepoPath(outputValue);
const strict = hasFlag("--strict");
const dryRun = hasFlag("--dry-run");

if (dryRun) {
  printPlan({
    operation: "postgres.repository-conformance.review",
    inventory: "packages/core/src/domain/repository-contract-inventory.ts",
    conformanceTest: "packages/db/src/romeo-repository.test.ts",
    strict,
    output,
    checks: [
      "contract_method_inventory",
      "behavioral_conformance_references",
      "uncovered_method_report",
    ],
  });
  process.exit(0);
}

const evidence = reviewConformanceCoverage();

if (output !== undefined) {
  ensureParentDirectory(output);
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (strict && evidence.status !== "passed") {
  console.error(
    `Repository conformance coverage incomplete: ${evidence.uncoveredMethods.length} uncovered methods.`,
  );
  process.exit(1);
}

console.log(`Repository conformance coverage ${evidence.status}.`);
if (output !== undefined)
  console.log(`Wrote repository conformance coverage evidence to ${output}`);

function reviewConformanceCoverage() {
  const methods = extractMethodInventory(readFileSync(inventoryPath, "utf8"));
  const conformanceSource = conformanceSection(
    readFileSync(conformanceTestPath, "utf8"),
  );
  const coveredMethods = methods.filter((method) =>
    methodReferenced(conformanceSource, method),
  );
  const uncoveredMethods = methods.filter(
    (method) => !coveredMethods.includes(method),
  );

  return {
    schemaVersion: "romeo.repository-conformance-coverage.v1",
    generatedAt: new Date().toISOString(),
    status: uncoveredMethods.length === 0 ? "passed" : "needs_coverage",
    contractMethodCount: methods.length,
    coveredMethodCount: coveredMethods.length,
    uncoveredMethodCount: uncoveredMethods.length,
    coveredMethods,
    uncoveredMethods,
    note: "Coverage is based on direct method references inside the shared RomeoRepository conformance test block. It is a planning gate, not a substitute for behavioral assertions.",
  };
}

function extractMethodInventory(source) {
  const match = source.match(
    /ROMEO_REPOSITORY_METHOD_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/u,
  );
  if (match === null) throw new Error("Repository method inventory not found.");
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((method) => method[1]);
}

function conformanceSection(source) {
  const start = source.indexOf('describe("RomeoRepository conformance"');
  if (start < 0)
    throw new Error("RomeoRepository conformance block not found.");
  const end = source.indexOf(
    'describe("live Postgres API readiness smoke"',
    start,
  );
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function methodReferenced(source, method) {
  const pattern = new RegExp(`\\brepository\\.${escapeRegExp(method)}\\b`, "u");
  return pattern.test(source);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}
