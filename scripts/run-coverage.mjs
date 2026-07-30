import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportRoot = join(root, "tmp", "coverage", "ratchet");
const require = createRequire(import.meta.url);

// Fail immediately when the Vitest coverage provider is absent or cannot be
// resolved from the same toolchain that runs this gate.
require.resolve("@vitest/coverage-v8/package.json");

const targets = [
  {
    name: "app",
    packageName: "@romeo/app",
    config: "vitest.config.ts",
    thresholds: { statements: 7.7, branches: 7.1, functions: 5.7, lines: 7.5 },
  },
  {
    name: "auth",
    packageName: "@romeo/auth",
    thresholds: {
      statements: 62.9,
      branches: 59.6,
      functions: 57.5,
      lines: 60.4,
    },
  },
  {
    name: "core",
    packageName: "@romeo/core",
    thresholds: {
      statements: 82,
      branches: 68.5,
      functions: 89.1,
      lines: 84.5,
    },
  },
  {
    name: "db",
    packageName: "@romeo/db",
    thresholds: {
      statements: 34.9,
      branches: 29.1,
      functions: 29.7,
      lines: 35.3,
    },
  },
  {
    name: "providers",
    packageName: "@romeo/providers",
    thresholds: {
      statements: 83.1,
      branches: 70.9,
      functions: 85.8,
      lines: 86.3,
    },
  },
  {
    name: "ui",
    packageName: "@romeo/ui",
    config: "vitest.config.ts",
    thresholds: {
      statements: 74.5,
      branches: 64.3,
      functions: 62.3,
      lines: 77,
    },
  },
];

await rm(reportRoot, { force: true, recursive: true });

const pending = [...targets];
const results = [];
const workerCount = Math.min(2, pending.length);
await Promise.all(
  Array.from({ length: workerCount }, async () => {
    while (pending.length > 0) {
      const target = pending.shift();
      if (target === undefined) return;
      await runTarget(target);
      results.push(await readResult(target));
    }
  }),
);

results.sort((left, right) => left.name.localeCompare(right.name));
const failures = [];
for (const result of results) {
  const summary = Object.entries(result.coverage)
    .map(([metric, value]) => `${metric} ${value.toFixed(2)}%`)
    .join(", ");
  console.log(`coverage ${result.name}: ${summary}`);
  for (const [metric, minimum] of Object.entries(result.thresholds)) {
    const actual = result.coverage[metric];
    if (actual < minimum) {
      failures.push(
        `${result.name} ${metric}: ${actual.toFixed(2)}% < ${minimum.toFixed(2)}%`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Coverage ratchet failed:\n${failures.join("\n")}`);
}

console.log("Coverage ratchet passed for all critical packages.");

async function runTarget(target) {
  const reportDirectory = join(reportRoot, target.name);
  const args = [
    "--filter",
    target.packageName,
    "exec",
    "vitest",
    "run",
    ...(target.config === undefined ? [] : ["--config", target.config]),
    "--reporter=dot",
    "--coverage",
    "--coverage.include=src/**/*.{ts,tsx}",
    "--coverage.exclude=src/**/*.test.*",
    "--coverage.exclude=src/**/*.gen.ts",
    "--coverage.reporter=text-summary",
    "--coverage.reporter=json-summary",
    `--coverage.reportsDirectory=${reportDirectory}`,
  ];
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn("pnpm", args, { cwd: root, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else {
        rejectRun(
          new Error(
            `${target.packageName} coverage exited with ${signal ?? code ?? "unknown status"}`,
          ),
        );
      }
    });
  });
}

async function readResult(target) {
  const report = JSON.parse(
    await readFile(
      join(reportRoot, target.name, "coverage-summary.json"),
      "utf8",
    ),
  );
  return {
    name: target.name,
    thresholds: target.thresholds,
    coverage: Object.fromEntries(
      ["statements", "branches", "functions", "lines"].map((metric) => [
        metric,
        report.total[metric].pct,
      ]),
    ),
  };
}
