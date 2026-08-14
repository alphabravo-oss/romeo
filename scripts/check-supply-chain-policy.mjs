#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "SECURITY.md",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".gitleaksignore",
  ".semgrep.yml",
  "docs/security/runtime-prerelease-risk-acceptance.md",
];

for (const path of requiredFiles) {
  const value = read(path);
  assert(value.trim().length > 0, `${path} must exist and be non-empty`);
}

const workflowDirectory = join(root, ".github/workflows");
for (const name of readdirSync(workflowDirectory).filter((name) =>
  /\.ya?ml$/u.test(name),
)) {
  const workflow = read(`.github/workflows/${name}`);
  for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    assert(
      /^[^/\s]+\/[^@\s]+@[a-f0-9]{40}$/u.test(reference),
      `${name} has a mutable or invalid action reference: ${reference}`,
    );
  }
}

const ci = read(".github/workflows/ci.yml");
for (const required of [
  "fetch-depth: 0",
  "gitleaks@sha256:",
  "git --redact=100",
  "semgrep@sha256:",
  "semgrep scan --config .semgrep.yml --error",
  "trivy@sha256:",
  "fs --scanners vuln,misconfig,secret",
  "docker build --target app-runtime",
  "image --scanners vuln,secret",
]) {
  assert(
    ci.includes(required),
    `CI is missing required executed security control: ${required}`,
  );
}

const dependabot = read(".github/dependabot.yml");
for (const ecosystem of ["npm", "github-actions", "docker"]) {
  assert(
    dependabot.includes(`package-ecosystem: ${ecosystem}`),
    `Dependabot must manage ${ecosystem}`,
  );
}

const owners = read(".github/CODEOWNERS");
assert(/^\*\s+@\S+/mu.test(owners), "CODEOWNERS must define a default owner");
assert(
  /^\/\.github\/\s+@\S+/mu.test(owners),
  "CODEOWNERS must protect GitHub configuration",
);

const ignore = read(".gitleaksignore")
  .split(/\r?\n/u)
  .filter((line) => line.length > 0 && !line.startsWith("#"));
assert(
  ignore.length > 0,
  ".gitleaksignore must contain reviewed fingerprint-specific fixtures",
);
assert(
  ignore.every((line) => /^[a-f0-9]{40}:.+:[^:]+:\d+$/u.test(line)),
  ".gitleaksignore entries must be exact history fingerprints",
);

const workspace = read("pnpm-workspace.yaml");
const releaseAge = Number(
  workspace.match(/^minimumReleaseAge:\s*(\d+)\s*$/mu)?.[1],
);
assert(
  Number.isInteger(releaseAge) && releaseAge >= 1440,
  "pnpm minimumReleaseAge must quarantine new releases for at least 24 hours",
);
const releaseAgeExclusionSection = workspace.match(
  /^minimumReleaseAgeExclude:\s*\n((?:\s{2}-.+(?:\n|$))*)/mu,
)?.[1];
assert(
  releaseAgeExclusionSection !== undefined,
  "pnpm minimumReleaseAgeExclude must remain an explicit reviewed list",
);
const releaseAgeExclusions = [
  ...(releaseAgeExclusionSection ?? "").matchAll(
    /^\s{2}-\s+"?([^"\s]+)"?\s*$/gmu,
  ),
].map((match) => match[1]);
assert(
  releaseAgeExclusions.every((value) =>
    /^(?:@[^/]+\/[^@]+|[^@]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(
      value ?? "",
    ),
  ),
  "pnpm release-age exceptions must identify one exact package version",
);

for (const packagePath of workspacePackageFiles()) {
  const manifest = JSON.parse(read(packagePath));
  for (const dependencyGroup of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, version] of Object.entries(
      manifest[dependencyGroup] ?? {},
    )) {
      if (/\d+\.\d+\.\d+-/u.test(String(version))) {
        assert(
          /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/u.test(String(version)),
          `${packagePath} must pin prerelease dependency ${name} exactly`,
        );
      }
    }
  }
}

const runtimeAcceptance = read(
  "docs/security/runtime-prerelease-risk-acceptance.md",
);
const reviewBy = runtimeAcceptance.match(
  /^Review by:\s*(\d{4}-\d{2}-\d{2})\s*$/mu,
)?.[1];
assert(
  reviewBy !== undefined,
  "runtime prerelease acceptance needs a review date",
);
assert(
  Date.parse(`${reviewBy}T23:59:59Z`) >= Date.now(),
  "runtime prerelease acceptance expired; migrate or renew after review",
);
assert(
  /^Owner:\s*@\S+\s*$/mu.test(runtimeAcceptance),
  "runtime prerelease acceptance needs an accountable owner",
);
assert(
  runtimeAcceptance.includes("nitro@3.0.260610-beta"),
  "runtime prerelease acceptance must match the pinned Nitro version",
);

console.log(
  "supply-chain policy: immutable actions and executed scan gates verified",
);

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function workspacePackageFiles() {
  const paths = [];
  for (const directory of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const packagePath = `${directory}/${entry.name}/package.json`;
      if (existsSync(join(root, packagePath))) paths.push(packagePath);
    }
  }
  return paths;
}
