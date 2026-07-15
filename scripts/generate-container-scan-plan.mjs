import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  argValue,
  argValues,
  hasFlag,
  repoPath,
  root,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";

const outputPath = repoPath(
  argValue("--output") ?? "dist/release/container-scan-plan.json",
);
const scanDir = repoPath(
  argValue("--scan-dir") ?? "dist/release/container-scans",
);
const scanner = argValue("--scanner") ?? "trivy";
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const runScanners = hasFlag("--run");
const stdout = hasFlag("--stdout");
const cronjobFiles = argValues("--cronjob-file");
const defaultCronjobFiles = [
  "deploy/helm/postgres-backup-cronjob.example.yaml",
  "deploy/helm/data-connector-sync-cronjob.example.yaml",
];

if (!["grype", "trivy"].includes(scanner))
  throw new Error("--scanner must be trivy or grype.");

const imageSources = [
  ...imagesFromHelmValues(
    repoPath(argValue("--helm-values") ?? "deploy/helm/values.yaml"),
  ),
  ...imagesFromImageYaml(
    repoPath(argValue("--compose-file") ?? "deploy/compose/compose.yml"),
    "compose",
  ),
  ...(cronjobFiles.length > 0 ? cronjobFiles : defaultCronjobFiles).flatMap(
    (path) => imagesFromImageYaml(repoPath(path), "kubernetes-cronjob"),
  ),
  ...argValues("--image").map((image) => ({ image, source: "cli" })),
];

const images = dedupeImages(imageSources).map((item) => {
  const scanFile = resolve(
    scanDir,
    `${safeImageName(item.image)}.${scanner}.json`,
  );
  return {
    image: item.image,
    sources: item.sources,
    scanFile: relative(root, scanFile),
    command: commandFor(scanner, item.image, scanFile),
  };
});

if (runScanners) {
  mkdirSync(scanDir, { recursive: true });
  for (const image of images) runScanner(image.command);
}

const plan = {
  schemaVersion: "romeo.container-scan-plan.v1",
  generatedAt,
  scanner,
  runScanners,
  images,
  releaseSecurityArgs: images.flatMap((image) => [
    "--container-scan-file",
    image.scanFile,
  ]),
};

writeJsonOrStdout({ path: outputPath, value: plan, stdout });
if (!stdout)
  console.log(
    `Wrote Romeo container scan plan to ${relative(root, outputPath)}`,
  );

function imagesFromHelmValues(path) {
  const text = readFileSync(path, "utf8");
  const repository = matchIndentedValue(text, "image", "repository");
  const tag = matchIndentedValue(text, "image", "tag");
  if (repository === undefined || tag === undefined) return [];
  return [
    {
      image: `${repository}:${tag}`,
      source: `helm-values:${relative(root, path)}`,
    },
  ];
}

function imagesFromImageYaml(path, sourcePrefix) {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/^\s*image:\s*['"]?([^'"#\n]+)['"]?\s*(?:#.*)?$/gmu)]
    .map((match) => match[1]?.trim())
    .filter((image) => image !== undefined && image.length > 0)
    .map((image) => ({
      image,
      source: `${sourcePrefix}:${relative(root, path)}`,
    }));
}

function matchIndentedValue(text, blockName, key) {
  const block = text.match(
    new RegExp(`^${blockName}:\\n((?:  [^\\n]+\\n?)+)`, "mu"),
  )?.[1];
  return block
    ?.match(
      new RegExp(`^  ${key}:\\s*['"]?([^'"#\\n]+)['"]?\\s*(?:#.*)?$`, "mu"),
    )?.[1]
    ?.trim();
}

function dedupeImages(items) {
  const byImage = new Map();
  for (const item of items) {
    const image = imageRefForScan(item.image);
    if (!isSafeImageRef(image))
      throw new Error(`Unsafe image reference: ${item.image}`);
    const source =
      image === item.image
        ? item.source
        : `${item.source} default:${item.image}`;
    const existing = byImage.get(image);
    if (existing === undefined)
      byImage.set(image, { image, sources: [source] });
    else existing.sources.push(source);
  }
  return [...byImage.values()].sort((left, right) =>
    left.image.localeCompare(right.image),
  );
}

function imageRefForScan(value) {
  const defaultMatch = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-|-)([^}]+)\}$/u.exec(
    value,
  );
  if (defaultMatch !== null) return defaultMatch[1].trim();
  if (value.includes("$"))
    throw new Error(
      `Image reference uses an unresolved variable without a default: ${value}`,
    );
  return value;
}

function isSafeImageRef(value) {
  return (
    /^[A-Za-z0-9._:/@-]+$/u.test(value) &&
    !value.startsWith("-") &&
    !value.includes("..")
  );
}

function safeImageName(image) {
  return image
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 160);
}

function commandFor(scannerName, image, scanFile) {
  if (scannerName === "trivy")
    return ["trivy", "image", "--format", "json", "--output", scanFile, image];
  return ["grype", image, "-o", "json", "--file", scanFile];
}

function runScanner(command) {
  const [binary, ...args] = command;
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(
      `${binary} failed with exit code ${result.status ?? "unknown"}.`,
    );
}
