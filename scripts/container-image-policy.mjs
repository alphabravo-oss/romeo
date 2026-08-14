#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticOnly = process.argv.includes("--static-only");
const dockerfilePath = join(root, "deploy/compose/Dockerfile");
const dockerignorePath = join(root, ".dockerignore");
const composePath = join(root, "deploy/compose/compose.yml");

const dockerfile = readFileSync(dockerfilePath, "utf8");
const dockerignore = readFileSync(dockerignorePath, "utf8");
const compose = readFileSync(composePath, "utf8");

for (const rule of [
  ".git",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "credentials*",
  "node_modules",
  "docs",
  "**/*.test.*",
  "**/*.spec.*",
]) {
  assert(
    dockerignore.split(/\r?\n/u).includes(rule),
    `.dockerignore must include ${rule}`,
  );
}

assert(
  /FROM scratch AS context-policy-probe/u.test(dockerfile),
  "missing context policy probe target",
);
assert(
  /FROM base AS app-runtime/u.test(dockerfile),
  "app runtime must not inherit operational OS packages",
);
assert(
  /^FROM node:24\.18\.0-bookworm-slim@sha256:[a-f0-9]{64} AS base$/mu.test(
    dockerfile,
  ),
  "Node base image must be versioned and digest-pinned",
);
assert(
  /COPY --from=build --chown=node:node \/app\/apps\/app\/\.output \/app\/apps\/app\/\.output/u.test(
    dockerfile,
  ),
  "app runtime must copy only Nitro output",
);
assert(
  /USER node/u.test(dockerfile),
  "app runtime must use the non-root node user",
);
const stages = [...dockerfile.matchAll(/^FROM\s+.+?\s+AS\s+(\S+)/gimu)].map(
  (match) => match[1],
);
assert(
  stages.at(-1) === "app-runtime",
  "app-runtime must remain the default final Docker stage",
);

assert(
  compose.includes("DEVELOPMENT ONLY"),
  "Compose must be visibly development-only",
);
assert(
  compose.includes("environment: development-only"),
  "Compose must expose a machine-readable development-only scope",
);
for (const port of [
  "POSTGRES_PORT:-5432",
  "VALKEY_PORT:-6379",
  "RUSTFS_PORT:-9000",
]) {
  assert(
    compose.includes(`127.0.0.1:\${${port}}`),
    `${port} must bind only to loopback`,
  );
}

if (staticOnly) {
  console.log("container image policy: static checks passed");
  process.exit(0);
}

run("docker", ["info", "--format", "{{.ServerVersion}}"]);

const nonce = `${process.pid}-${randomUUID().slice(0, 8)}`;
const contextTag = `romeo-context-policy:${nonce}`;
const runtimeTag = `romeo-runtime-policy:${nonce}`;
const sentinels = [
  join(root, ".env.romeo-context-sentinel"),
  join(root, "romeo-context-sentinel.pem"),
  join(root, "romeo-context-sentinel.test.ts"),
];
const containers = [];
const images = [contextTag, runtimeTag];

try {
  for (const path of sentinels) {
    assert(
      !existsSync(path),
      `refusing to overwrite existing sentinel path ${path}`,
    );
    writeFileSync(path, "DO_NOT_SHIP\n", { flag: "wx", mode: 0o600 });
  }

  build("context-policy-probe", contextTag);
  const contextEntries = exportEntries(contextTag, "context");
  assertNoSentinel(contextEntries);
  for (const forbidden of [
    "context/.git",
    "context/node_modules",
    "context/docs",
  ]) {
    assert(
      !contextEntries.some(
        (entry) => entry === forbidden || entry.startsWith(`${forbidden}/`),
      ),
      `effective build context contains ${forbidden}`,
    );
  }

  build("app-runtime", runtimeTag);
  const runtimeEntries = exportEntries(runtimeTag, "runtime");
  assertNoSentinel(runtimeEntries);
  const appEntries = runtimeEntries.filter(
    (entry) => entry === "app" || entry.startsWith("app/"),
  );
  const allowedAppRoots = [
    "app",
    "app/apps",
    "app/apps/app",
    "app/apps/app/.output",
  ];
  for (const entry of appEntries) {
    assert(
      allowedAppRoots.includes(entry) ||
        entry.startsWith("app/apps/app/.output/"),
      `runtime image contains non-allowlisted application path /${entry}`,
    );
  }
  for (const forbidden of [
    "app/packages",
    "app/scripts",
    "app/node_modules",
    "app/.env",
    "app/docs",
  ]) {
    assert(
      !runtimeEntries.some(
        (entry) => entry === forbidden || entry.startsWith(`${forbidden}/`),
      ),
      `runtime image contains forbidden path /${forbidden}`,
    );
  }

  console.log(
    "container image policy: context sentinels excluded and runtime allowlist passed",
  );
} finally {
  for (const container of containers)
    runCleanup("docker", ["container", "rm", "--force", container]);
  for (const image of images)
    runCleanup("docker", ["image", "rm", "--force", image]);
  for (const path of sentinels) rmSync(path, { force: true });
}

function build(target, tag) {
  run(
    "docker",
    ["build", "--target", target, "--tag", tag, "--file", dockerfilePath, root],
    { stdio: "inherit" },
  );
}

function exportEntries(tag, label) {
  const container = `romeo-${label}-policy-${nonce}`;
  containers.push(container);
  run("docker", ["create", "--name", container, tag, "true"]);
  const archive = join(tmpdir(), `${container}.tar`);
  try {
    run("docker", ["export", "--output", archive, container]);
    return run("tar", ["-tf", archive])
      .stdout.split(/\r?\n/u)
      .filter(Boolean)
      .map((entry) => entry.replace(/^\.\//u, "").replace(/\/$/u, ""));
  } finally {
    rmSync(archive, { force: true });
  }
}

function assertNoSentinel(entries) {
  assert(
    !entries.some((entry) => entry.includes("romeo-context-sentinel")),
    "a context sentinel was copied into an image",
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`,
    );
  }
  return result;
}

function runCleanup(command, args) {
  spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "ignore" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
