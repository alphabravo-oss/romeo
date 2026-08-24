import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "apps/app/src");
const generatedAllowlist = new Map([
  [
    "apps/app/src/routeTree.gen.ts",
    new Set(["/* eslint-disable */", "// @ts-nocheck"]),
  ],
]);
const suppressionPattern =
  /(?:eslint|oxlint)-(?:disable|enable)|@ts-(?:ignore|nocheck)/gu;

function findingsFor(path, source) {
  const allowed = generatedAllowlist.get(path);
  return source.split(/\r?\n/u).flatMap((line, index) => {
    suppressionPattern.lastIndex = 0;
    if (!suppressionPattern.test(line)) return [];
    if (allowed?.has(line.trim()) === true) return [];
    return [`${path}:${index + 1}: ${line.trim()}`];
  });
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:[cm]?[jt]sx?|css)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

if (process.argv.includes("--self-test")) {
  const rejected = findingsFor(
    "apps/app/src/components/Bad.tsx",
    "// eslint-disable-next-line react-hooks/exhaustive-deps",
  );
  const generated = findingsFor(
    "apps/app/src/routeTree.gen.ts",
    "/* eslint-disable */",
  );
  if (rejected.length !== 1 || generated.length !== 0) {
    throw new Error("source-suppression policy self-test failed");
  }
  console.log("Source-suppression policy self-test passed.");
  process.exit(0);
}

const findings = [];
for (const absolutePath of await sourceFiles(sourceRoot)) {
  const path = relative(root, absolutePath);
  findings.push(...findingsFor(path, await readFile(absolutePath, "utf8")));
}
if (findings.length > 0) {
  console.error(
    `Handwritten source suppressions are forbidden:\n${findings.join("\n")}`,
  );
  process.exit(1);
}
console.log("App source-suppression policy passed.");
