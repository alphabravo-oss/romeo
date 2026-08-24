import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { CliUsageError } from "./cli-errors";

export function rejectSecretFlag(
  flags: Record<string, string | true>,
  name: string,
): void {
  if (flags[name] === undefined) return;
  throw new CliUsageError(
    `--${name} is forbidden because secrets must not be passed on argv. Use the documented environment or protected file input.`,
  );
}

export function readCliSecret(
  env: NodeJS.ProcessEnv,
  environment: string,
  fileEnvironment = `${environment}_FILE`,
): string | undefined {
  const file = env[fileEnvironment];
  const direct = env[environment];
  if (file !== undefined && file.trim().length > 0) {
    if (direct !== undefined && direct.length > 0) {
      throw new CliUsageError(
        `${environment} and ${fileEnvironment} are mutually exclusive. Prefer ${fileEnvironment}.`,
      );
    }
    const path = resolve(file);
    const metadata = statSync(path);
    if (!metadata.isFile())
      throw new CliUsageError(
        `${fileEnvironment} must reference a regular file.`,
      );
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
      throw new CliUsageError(
        `${fileEnvironment} must reference a file with mode 0400 or 0600.`,
      );
    if (metadata.size > 65_536)
      throw new CliUsageError(
        `${fileEnvironment} exceeds the secret input size limit.`,
      );
    return normalize(readFileSync(path, "utf8"), fileEnvironment);
  }
  return direct === undefined || direct.length === 0
    ? undefined
    : normalize(direct, environment);
}

function normalize(value: string, source: string): string {
  const normalized = value.replace(/[\r\n]+$/u, "");
  if (normalized.length === 0)
    throw new CliUsageError(`${source} must not be empty.`);
  if (normalized.includes("\0"))
    throw new CliUsageError(`${source} contains an invalid NUL byte.`);
  return normalized;
}
