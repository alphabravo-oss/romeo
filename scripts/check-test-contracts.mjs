import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "dist/ci/test-contracts.json");
const manifests = [
  ...workspaceManifests(resolve(root, "apps")),
  ...workspaceManifests(resolve(root, "packages")),
];

const checks = manifests
  .map((manifestPath) => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const testScript = manifest.scripts?.test;
    if (typeof testScript !== "string" || !testScript.includes("vitest")) {
      return undefined;
    }
    const packageRoot = dirname(manifestPath);
    const testFiles = sourceFiles(packageRoot).filter((file) =>
      /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file),
    );
    const configAllowsNoTests = sourceFiles(packageRoot)
      .filter((file) => /vitest\.config\.[cm]?[jt]s$/u.test(file))
      .some((file) =>
        /passWithNoTests\s*:\s*true/u.test(readFileSync(file, "utf8")),
      );
    const failures = validateTestContract({
      configAllowsNoTests,
      testFileCount: testFiles.length,
      testScript,
    });
    return {
      package: manifest.name ?? relative(root, packageRoot),
      path: relative(root, manifestPath),
      status: failures.length === 0 ? "passed" : "failed",
      testFileCount: testFiles.length,
      failures,
    };
  })
  .filter(Boolean);

const selfTests = {
  rejectsMissingTests:
    validateTestContract({ testFileCount: 0, testScript: "vitest run" })
      .length === 1,
  rejectsConfigBypass:
    validateTestContract({
      configAllowsNoTests: true,
      testFileCount: 1,
      testScript: "vitest run",
    }).length === 1,
  rejectsPassWithNoTests:
    validateTestContract({
      testFileCount: 1,
      testScript: "vitest run --passWithNoTests",
    }).length === 1,
  acceptsStrictVitest:
    validateTestContract({ testFileCount: 1, testScript: "vitest run" })
      .length === 0,
};
const failures = checks.filter((check) => check.status === "failed");
const status =
  failures.length === 0 && Object.values(selfTests).every(Boolean)
    ? "passed"
    : "failed";
const evidence = {
  schemaVersion: "romeo.test-contracts.v1",
  generatedAt: new Date().toISOString(),
  status,
  selfTests,
  checks,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  `Test contract ${status} for ${checks.length} Vitest workspace packages.`,
);
console.log(`Wrote test contract evidence to ${outputPath}`);
if (status !== "passed") {
  for (const failure of failures) {
    console.error(
      `${failure.path}: ${failure.failures.join("; ")} (${failure.testFileCount} test files)`,
    );
  }
  process.exitCode = 1;
}

export function validateTestContract({
  configAllowsNoTests = false,
  testFileCount,
  testScript,
}) {
  const failures = [];
  if (testScript.includes("--passWithNoTests")) {
    failures.push("test script must not use --passWithNoTests");
  }
  if (testFileCount === 0) {
    failures.push("Vitest package has no test files");
  }
  if (configAllowsNoTests) {
    failures.push("Vitest config must not enable passWithNoTests");
  }
  return failures;
}

function workspaceManifests(directory) {
  if (!exists(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name, "package.json"))
    .filter(exists);
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".output" ||
      entry.name === "coverage"
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else files.push(path);
  }
  return files;
}

function exists(path) {
  try {
    return statSync(path).isFile() || statSync(path).isDirectory();
  } catch {
    return false;
  }
}
