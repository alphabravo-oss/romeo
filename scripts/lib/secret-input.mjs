import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const defaultForbiddenFlags = [
  "--api-key",
  "--client-secret",
  "--password",
  "--prompt-sentinel",
  "--provider-payload-sentinel",
  "--refresh-token",
  "--run-secret",
  "--secret-sentinel",
  "--token",
  "--worker-payload-sentinel",
];

/**
 * Secret values must never be accepted on argv: process listings, shell
 * history, CI diagnostics, and support bundles can all retain them.
 */
export function assertNoSecretArgv(
  argv = process.argv.slice(2),
  forbiddenFlags = defaultForbiddenFlags,
) {
  const violation = argv.find((argument) =>
    forbiddenFlags.some(
      (flag) => argument === flag || argument.startsWith(`${flag}=`),
    ),
  );
  if (violation !== undefined) {
    const flag = violation.split("=", 1)[0];
    throw new Error(
      `${flag} is forbidden because secret values must not be passed on argv. Use the documented environment or protected file input.`,
    );
  }
}

export function splitSecretLines(value) {
  if (value === undefined) return [];
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function readSecretInput({
  environment,
  fileEnvironment = `${environment}_FILE`,
  maximumBytes = 65_536,
}) {
  const file = process.env[fileEnvironment];
  const direct = process.env[environment];
  if (file !== undefined && file.trim().length > 0) {
    if (direct !== undefined && direct.length > 0) {
      throw new Error(
        `${environment} and ${fileEnvironment} are mutually exclusive. Prefer ${fileEnvironment}.`,
      );
    }
    const path = resolve(file);
    const metadata = statSync(path);
    if (!metadata.isFile()) {
      throw new Error(`${fileEnvironment} must reference a regular file.`);
    }
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error(
        `${fileEnvironment} must reference a file without group or other permissions (mode 0400 or 0600).`,
      );
    }
    if (metadata.size > maximumBytes) {
      throw new Error(
        `${fileEnvironment} exceeds the secret input size limit.`,
      );
    }
    return normalizeSecret(readFileSync(path, "utf8"), fileEnvironment);
  }
  return direct === undefined || direct.length === 0
    ? undefined
    : normalizeSecret(direct, environment);
}

function normalizeSecret(value, source) {
  const normalized = value.replace(/[\r\n]+$/u, "");
  if (normalized.length === 0) {
    throw new Error(`${source} must not be empty.`);
  }
  if (normalized.includes("\0")) {
    throw new Error(`${source} contains an invalid NUL byte.`);
  }
  return normalized;
}
