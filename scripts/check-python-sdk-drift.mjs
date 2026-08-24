import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const generatedFileAllowlist = Object.freeze([
  "README.md",
  "pyproject.toml",
  "romeo_client/__init__.py",
  "romeo_client/client.py",
  "romeo_client/errors.py",
  "romeo_client/openapi.py",
  "tests/test_stream.py",
]);
const ignoredDirectories = new Set([".pytest_cache", "__pycache__"]);
const tempDir = resolve(root, "tmp", `python-sdk-drift-${process.pid}`);
const openApiFile = join(tempDir, "openapi.json");
const generatedDir = join(tempDir, "python");
const expectedDir = resolve(root, "sdks", "python");
const keep = process.argv.includes("--keep");

if (process.argv.includes("--self-test")) selfTest();
else main();

function main() {
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
        console.error(
          `- ${diffs.length - 50} additional drift entries omitted`,
        );
      process.exitCode = 1;
      return;
    }

    console.log("Python SDK is in sync with the Romeo OpenAPI document.");
  } finally {
    if (!keep) rmSync(tempDir, { recursive: true, force: true });
  }
}

function compareDirectories(expectedRoot, actualRoot) {
  const expectedFiles = listFiles(expectedRoot);
  const actualFiles = listFiles(actualRoot);
  const diffs = [];

  for (const file of expectedFiles) {
    if (!generatedFileAllowlist.includes(file))
      diffs.push(`unexpected committed SDK file: ${file}`);
  }
  for (const file of actualFiles) {
    if (!generatedFileAllowlist.includes(file))
      diffs.push(`unexpected generated SDK file: ${file}`);
  }

  for (const file of generatedFileAllowlist) {
    const expectedPath = join(expectedRoot, file);
    const actualPath = join(actualRoot, file);
    if (!existsSync(expectedPath)) {
      diffs.push(`missing committed SDK file: ${file}`);
      continue;
    }
    if (!existsSync(actualPath)) {
      diffs.push(`missing generated SDK file: ${file}`);
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
      if (ignoredDirectories.has(entry.name)) continue;
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

function selfTest() {
  const fixture = join(tmpdir(), `romeo-sdk-drift-self-test-${process.pid}`);
  const expected = join(fixture, "expected");
  const actual = join(fixture, "actual");
  rmSync(fixture, { recursive: true, force: true });
  try {
    for (const rootDirectory of [expected, actual]) {
      for (const file of generatedFileAllowlist) {
        const target = join(rootDirectory, file);
        mkdirSync(resolve(target, ".."), { recursive: true });
        writeFileSync(target, `${file}\n`, "utf8");
      }
    }
    mkdirSync(join(expected, ".pytest_cache"), { recursive: true });
    writeFileSync(join(expected, ".pytest_cache", "README.md"), "junk\n");
    mkdirSync(join(expected, "romeo_client", "__pycache__"), {
      recursive: true,
    });
    writeFileSync(
      join(expected, "romeo_client", "__pycache__", "client.pyc"),
      "junk",
    );
    assert(
      compareDirectories(expected, actual).length === 0,
      "cache directories must not create SDK drift",
    );

    writeFileSync(join(actual, "romeo_client", "client.py"), "changed\n");
    assert(
      compareDirectories(expected, actual).some((diff) =>
        diff.includes("changed generated file: romeo_client/client.py"),
      ),
      "a changed generated file must create SDK drift",
    );
    writeFileSync(join(actual, "unexpected.txt"), "unexpected\n");
    assert(
      compareDirectories(expected, actual).some((diff) =>
        diff.includes("unexpected generated SDK file: unexpected.txt"),
      ),
      "an unallowlisted generated file must create SDK drift",
    );
    console.log("Python SDK drift self-test passed.");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
