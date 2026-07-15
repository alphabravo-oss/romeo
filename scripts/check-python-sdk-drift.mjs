import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tempDir = resolve(root, "tmp", `python-sdk-drift-${process.pid}`);
const openApiFile = join(tempDir, "openapi.json");
const generatedDir = join(tempDir, "python");
const expectedDir = resolve(root, "sdks", "python");
const keep = process.argv.includes("--keep");

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

try {
  run("pnpm", [
    "--filter",
    "@romeo/cli",
    "exec",
    "tsx",
    "../../scripts/export-openapi.ts",
    "--output",
    openApiFile,
  ]);
  run("node", [
    "scripts/generate-python-sdk.mjs",
    "--openapi-file",
    openApiFile,
    "--out-dir",
    generatedDir,
  ]);

  const diffs = compareDirectories(expectedDir, generatedDir);
  if (diffs.length > 0) {
    console.error(
      "Python SDK drift detected. Regenerate with: pnpm sdk:python -- --openapi-url <running-api>/api/v1/openapi.json",
    );
    for (const diff of diffs.slice(0, 50)) console.error(`- ${diff}`);
    if (diffs.length > 50)
      console.error(`- ${diffs.length - 50} additional drift entries omitted`);
    process.exit(1);
  }

  console.log("Python SDK is in sync with the Romeo OpenAPI document.");
} finally {
  if (!keep) rmSync(tempDir, { recursive: true, force: true });
}

function compareDirectories(expectedRoot, actualRoot) {
  const expectedFiles = listFiles(expectedRoot);
  const actualFiles = listFiles(actualRoot);
  const allFiles = [...new Set([...expectedFiles, ...actualFiles])].sort();
  const diffs = [];

  for (const file of allFiles) {
    const expectedPath = join(expectedRoot, file);
    const actualPath = join(actualRoot, file);
    if (!existsSync(expectedPath)) {
      diffs.push(`unexpected generated file: ${file}`);
      continue;
    }
    if (!existsSync(actualPath)) {
      diffs.push(`missing generated file: ${file}`);
      continue;
    }
    if (
      readFileSync(expectedPath, "utf8") !== readFileSync(actualPath, "utf8")
    ) {
      diffs.push(`changed generated file: ${file}`);
    }
  }

  return diffs;
}

function listFiles(directory) {
  const files = [];
  walk(directory, "");
  return files.sort();

  function walk(currentDirectory, prefix) {
    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      if (entry.name === "__pycache__") continue;
      const relativePath =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const fullPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
