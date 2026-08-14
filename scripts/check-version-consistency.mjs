import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const rootPackage = await json("package.json");
const expected = String(rootPackage.version);

const workspaceManifests = [
  "apps/app/package.json",
  "packages/ai-runtime/package.json",
  "packages/api-client/package.json",
  "packages/auth/package.json",
  "packages/cli/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/core/package.json",
  "packages/db/package.json",
  "packages/providers/package.json",
  "packages/rag/package.json",
  "packages/secrets/package.json",
  "packages/storage/package.json",
  "packages/tools/package.json",
  "packages/ui/package.json",
  "packages/voices/package.json",
];

const failures = [];
for (const file of workspaceManifests) {
  const manifest = await json(file);
  if (manifest.version !== expected)
    failures.push(`${file}: ${String(manifest.version)}`);
}

const source = await text("packages/contracts/src/version.ts");
if (!source.includes(`ROMEO_PRODUCT_VERSION = "${expected}"`))
  failures.push("packages/contracts/src/version.ts");

const chart = await text("deploy/helm/Chart.yaml");
if (!chart.includes(`version: ${expected}`))
  failures.push("deploy/helm/Chart.yaml chart version");
if (!chart.includes(`appVersion: "${expected}"`))
  failures.push("deploy/helm/Chart.yaml appVersion");

const pythonProject = await text("sdks/python/pyproject.toml");
if (!pythonProject.includes(`version = "${expected}"`))
  failures.push("sdks/python/pyproject.toml");

if (failures.length > 0) {
  console.error(`Version consistency failed; expected ${expected}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Version consistency passed for ${expected} across runtime, workspace, chart, and SDK surfaces.`,
  );
}

async function json(path) {
  return JSON.parse(await text(path));
}

async function text(path) {
  return readFile(join(root, path), "utf8");
}
