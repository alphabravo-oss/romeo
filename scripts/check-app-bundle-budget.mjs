import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assetsDir = resolve(root, "apps/app/.output/public/assets");
const manifestPath = resolve(
  root,
  "apps/app/.output/public/.vite/manifest.json",
);
const outputPath = resolve(root, "dist/ci/app-bundle-budget.json");
const budgets = [
  {
    id: "route_shell_js",
    source: "src/routes/index.tsx?tsr-split=component",
    maxBytes: 250_000,
  },
  {
    id: "workspace_route_js",
    source: "src/routes/workspace.tsx?tsr-split=component",
    maxBytes: 75_000,
  },
  {
    id: "admin_route_js",
    source: "src/routes/admin.tsx?tsr-split=component",
    maxBytes: 320_000,
  },
  {
    id: "settings_route_js",
    source: "src/routes/settings.tsx?tsr-split=component",
    maxBytes: 40_000,
  },
  {
    id: "application_css",
    sourceSuffix: "/src/styles/app.css",
    maxBytes: 80_000,
  },
];

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const checks = budgets.map((budget) => {
  const matches = Object.entries(manifest).filter(([source]) =>
    "source" in budget
      ? source === budget.source
      : source.endsWith(budget.sourceSuffix),
  );
  const assets = matches.map(([, entry]) => entry.file);
  const bytes = assets.reduce(
    (total, file) =>
      total + statSync(resolve(assetsDir, file.replace(/^assets\//u, ""))).size,
    0,
  );
  return {
    id: budget.id,
    status:
      matches.length === 1 && bytes <= budget.maxBytes ? "passed" : "failed",
    bytes,
    maxBytes: budget.maxBytes,
    matchedFileCount: matches.length,
    assets,
  };
});
const status = checks.every((check) => check.status === "passed")
  ? "passed"
  : "failed";
const evidence = {
  schemaVersion: "romeo.app-bundle-budget.v1",
  generatedAt: new Date().toISOString(),
  status,
  checks,
  redaction: {
    assetContentsIncluded: false,
    sourceMapsIncluded: false,
  },
  manifest: "apps/app/.output/public/.vite/manifest.json",
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Wrote app bundle budget evidence to ${outputPath}`);
if (status !== "passed") process.exitCode = 1;
