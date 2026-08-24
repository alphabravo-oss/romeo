#!/usr/bin/env node
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { assertNoSecretArgv, readSecretInput } from "./lib/secret-input.mjs";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "romeo-secret-input-"));
const root = resolve(import.meta.dirname, "..");
const protectedFile = join(temporaryDirectory, "api-key");
const exposedFile = join(temporaryDirectory, "exposed-key");
const savedEnvironment = { ...process.env };

try {
  expectThrow(() => assertNoSecretArgv(["--api-key", "secret"]));
  expectThrow(() => assertNoSecretArgv(["--run-secret=secret"]));
  assertNoSecretArgv(["--base-url", "https://romeo.example"]);

  process.env.ROMEO_SECRET_INPUT_TEST = "environment-secret";
  if (
    readSecretInput({ environment: "ROMEO_SECRET_INPUT_TEST" }) !==
    "environment-secret"
  ) {
    throw new Error("Environment secret input did not round-trip.");
  }

  delete process.env.ROMEO_SECRET_INPUT_TEST;
  writeFileSync(protectedFile, "file-secret\n", { mode: 0o600 });
  process.env.ROMEO_SECRET_INPUT_TEST_FILE = protectedFile;
  if (
    readSecretInput({ environment: "ROMEO_SECRET_INPUT_TEST" }) !==
    "file-secret"
  ) {
    throw new Error("Protected-file secret input did not round-trip.");
  }

  writeFileSync(exposedFile, "exposed-secret", { mode: 0o644 });
  chmodSync(exposedFile, 0o644);
  process.env.ROMEO_SECRET_INPUT_TEST_FILE = exposedFile;
  if (process.platform !== "win32") {
    expectThrow(() =>
      readSecretInput({ environment: "ROMEO_SECRET_INPUT_TEST" }),
    );
  }

  assertProductionSourcesDoNotOfferSecretFlags();

  console.log(
    "secret input contract smoke: argv denied; env/file inputs and source scan pass",
  );
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, savedEnvironment);
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function expectThrow(callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error("Expected operation to throw.");
}

function assertProductionSourcesDoNotOfferSecretFlags() {
  const sourceRoots = [join(root, "scripts"), join(root, "packages/cli/src")];
  const prohibited =
    /["'`]--(?:api-key|client-secret|password|prompt-sentinel|provider-payload-sentinel|refresh-token|run-secret|secret-sentinel|token|worker-payload-sentinel)(?=["'`\s=])/u;
  const violations = sourceRoots.flatMap(walk).filter((path) => {
    const relative = path.slice(root.length + 1);
    if (
      relative.includes("contract-smoke") ||
      relative.includes("secret-input") ||
      relative.includes(".test.")
    ) {
      return false;
    }
    return prohibited.test(readFileSync(path, "utf8"));
  });
  if (violations.length > 0) {
    throw new Error(
      `Production sources still offer secret argv flags: ${violations
        .map((path) => path.slice(root.length + 1))
        .join(", ")}`,
    );
  }
}

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return walk(child);
    return /\.(?:mjs|ts)$/u.test(entry.name) ? [child] : [];
  });
}
