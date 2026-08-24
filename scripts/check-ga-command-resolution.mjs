#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { gaTargetGateSpecs } from "./lib/ga-target-preflight.mjs";

if (process.argv.includes("--self-test")) {
  const scripts = { existing: "node existing.mjs" };
  assertEqual(extractPnpmScripts("pnpm existing && pnpm missing -- --help"), [
    "existing",
    "missing",
  ]);
  assertEqual(unresolvedScripts(["existing", "missing"], scripts), ["missing"]);
  console.log("GA command resolution policy: self-test passed");
  process.exit(0);
}

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json")));
const scripts = packageJson.scripts ?? {};
const referenced = [
  ...new Set(
    gaTargetGateSpecs.flatMap((gate) =>
      extractPnpmScripts(
        typeof gate.command === "function" ? gate.command() : gate.command,
      ),
    ),
  ),
].sort();
const unresolved = unresolvedScripts(referenced, scripts);
if (unresolved.length > 0) {
  throw new Error(
    `GA target plans reference unresolved package scripts: ${unresolved.join(", ")}.`,
  );
}

const evidenceScripts = referenced.filter((name) =>
  name.startsWith("evidence:"),
);
for (const script of evidenceScripts) {
  assertLifecycleCommand(root, script, "--help");
  assertLifecycleCommand(root, script, "--dry-run");
}

console.log(
  `GA command resolution policy: ${referenced.length} generated pnpm commands resolved; ${evidenceScripts.length} evidence commands passed help/dry-run`,
);

function extractPnpmScripts(command) {
  if (typeof command !== "string") return [];
  return [...command.matchAll(/(?:^|\s|&&)pnpm\s+([A-Za-z0-9:_-]+)/gu)].map(
    (match) => match[1],
  );
}

function unresolvedScripts(referenced, scripts) {
  return referenced.filter(
    (name) => typeof scripts[name] !== "string" || scripts[name].length === 0,
  );
}

function assertLifecycleCommand(root, script, flag) {
  const result = spawnSync("pnpm", [script, "--", flag], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${script} ${flag} failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

function assertEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Self-test mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}
