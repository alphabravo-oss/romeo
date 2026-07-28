import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tempDir = resolve(root, "tmp", `typescript-sdk-drift-${process.pid}`);
const generatedDir = join(tempDir, "generated");
const expectedDir = resolve(root, "packages/api-client/src/generated");

rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

try {
  run("pnpm", [
    "--filter",
    "@romeo/cli",
    "exec",
    "tsx",
    "../../scripts/export-openapi.ts",
    "--include-openwebui",
    "--output",
    "../../dist/generated/openapi.json",
  ]);
  run("node", ["scripts/prepare-query-openapi.mjs"]);
  run(
    "pnpm",
    [
      "--filter",
      "@romeo/api-client",
      "exec",
      "openapi-ts",
      "--file",
      "openapi-ts.config.ts",
      "--silent",
    ],
    {
      ROMEO_GENERATED_ROOT: relative(
        resolve(root, "packages/api-client"),
        generatedDir,
      ),
    },
  );
  run("node", ["scripts/normalize-generated-typescript.mjs", generatedDir]);

  const diffs = compareDirectories(expectedDir, generatedDir);
  if (diffs.length > 0) {
    console.error(
      "TypeScript SDK drift detected. Regenerate with: pnpm sdk:typescript",
    );
    for (const diff of diffs.slice(0, 50)) console.error(`- ${diff}`);
    process.exit(1);
  }
  console.log("TypeScript SDK is in sync with the Romeo OpenAPI document.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
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
    } else if (!existsSync(actualPath)) {
      diffs.push(`missing generated file: ${file}`);
    } else if (
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
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const fullPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) walk(fullPath, path);
      else if (entry.isFile()) files.push(path);
    }
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
