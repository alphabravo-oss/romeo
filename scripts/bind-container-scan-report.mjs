import { relative, resolve } from "node:path";

import {
  argValue,
  fileEvidence,
  nonEmptyString,
  readJson,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const rawPath = resolve(
  root,
  nonEmptyString(argValue("--raw-report"), "--raw-report"),
);
const output = argValue("--output") ?? "dist/ci/container-scan.report.json";
const role = nonEmptyString(argValue("--role"), "--role");
const reference = nonEmptyString(argValue("--reference"), "--reference");
const digest = imageDigest(argValue("--digest"), "--digest");
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const report = readJson(rawPath);

if (!Number.isInteger(report.SchemaVersion) || !Array.isArray(report.Results))
  throw new Error("Raw Trivy report is malformed.");
const scannerDigest = imageDigest(report.Metadata?.ImageID, "Trivy ImageID");
if (scannerDigest !== digest)
  throw new Error("Trivy report image digest does not match --digest.");
if (!["app", "ops"].includes(role))
  throw new Error("--role must be app or ops.");

writeJsonOrStdout({
  path: output,
  stdout: process.argv.includes("--stdout"),
  value: {
    schemaVersion: "romeo.container-scan-report.v1",
    generatedAt,
    image: { role, reference, digest },
    scanner: {
      name: "trivy",
      format: "trivy-json",
      rawReport: fileEvidence(rawPath, relative(root, rawPath)),
    },
    report,
  },
});

function imageDigest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    throw new Error(`${label} must be sha256:<64 lowercase hex>.`);
  return value;
}
