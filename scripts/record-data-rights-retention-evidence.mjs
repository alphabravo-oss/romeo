import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const output = argValue("--output");
if (output === undefined || output.length === 0) {
  throw new Error("--output is required.");
}

const control = enumArg("--control", ["operational_logs", "backups"]);
const status = enumArg("--status", ["passed", "failed"], "passed");
const retentionDays = positiveInteger(argValue("--retention-days"), {
  label: "--retention-days",
  required: true,
});
const reviewedSystemCount = positiveInteger(
  argValue("--reviewed-system-count"),
  {
    label: "--reviewed-system-count",
    fallback: "1",
  },
);
const immutableWindowDays = nonNegativeInteger(
  argValue("--immutable-window-days"),
  {
    label: "--immutable-window-days",
    fallback: "0",
  },
);
const destructionValidated = booleanArg("--destruction-validated", true);
const encryptedAtRest = booleanArg("--encrypted-at-rest", true);
const failureCodes = argValues("--failure-code");

if (status === "passed" && failureCodes.length > 0) {
  throw new Error("--failure-code can only be supplied with --status failed.");
}
if (status === "passed" && !destructionValidated) {
  throw new Error(
    "--destruction-validated=false can only be supplied with --status failed.",
  );
}

const evidence = {
  schemaVersion: "romeo.data-rights-retention-evidence.v1",
  generatedAt: new Date().toISOString(),
  control,
  status,
  retentionDays,
  destructionValidated,
  encryptedAtRest,
  immutableWindowDays,
  reviewedSystemCount,
  failureCodes,
  redaction: {
    backupLocationIncluded: false,
    logContentIncluded: false,
    objectStoreKeysIncluded: false,
    rawSystemNamesIncluded: false,
    secretValuesIncluded: false,
  },
};

writeJson(resolve(process.cwd(), output), evidence);
console.log(`Wrote data-rights retention evidence to ${output}`);

function enumArg(name, allowedValues, fallback) {
  const value = argValue(name) ?? fallback;
  if (value === undefined || !allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}.`);
  }
  return value;
}

function booleanArg(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function positiveInteger(value, options) {
  const resolved = value ?? options.fallback;
  if (resolved === undefined) {
    if (options.required) throw new Error(`${options.label} is required.`);
    return undefined;
  }
  const parsed = Number.parseInt(resolved, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${options.label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, options) {
  const resolved = value ?? options.fallback;
  if (resolved === undefined) return undefined;
  const parsed = Number.parseInt(resolved, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${options.label} must be a non-negative integer.`);
  }
  return parsed;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
