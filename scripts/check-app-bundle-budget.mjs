import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = resolve(root, "apps/app/.output/public");
const manifestPath = resolve(publicDir, ".vite/manifest.json");
const outputPath = resolve(root, "dist/ci/app-bundle-budget.json");
const budgets = [
  {
    id: "route_shell_js",
    source: "src/routes/index.tsx?tsr-split=component",
    maxEntryBytes: 250_000,
    maxInitialBytes: 1_450_000,
    maxInitialGzipBytes: 405_000,
  },
  {
    id: "workspace_route_js",
    source: "src/routes/workspace.tsx?tsr-split=component",
    maxEntryBytes: 50_000,
    maxInitialBytes: 1_340_000,
    maxInitialGzipBytes: 365_000,
  },
  {
    id: "admin_route_js",
    source: "src/routes/admin.tsx?tsr-split=component",
    maxEntryBytes: 30_000,
    maxInitialBytes: 1_320_000,
    maxInitialGzipBytes: 360_000,
  },
  {
    id: "settings_route_js",
    source: "src/routes/settings.tsx?tsr-split=component",
    maxEntryBytes: 42_000,
    maxInitialBytes: 1_280_000,
    maxInitialGzipBytes: 350_000,
  },
  {
    id: "application_css",
    sourceSuffix: "/src/styles/app.css",
    maxEntryBytes: 85_000,
    maxInitialBytes: 85_000,
    maxInitialGzipBytes: 18_000,
  },
];

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const checks = budgets.map((budget) => {
  const matches = Object.entries(manifest).filter(([source]) =>
    "source" in budget
      ? source === budget.source
      : source.endsWith(budget.sourceSuffix),
  );
  if (matches.length !== 1) {
    return {
      id: budget.id,
      status: "failed",
      matchedEntryCount: matches.length,
      entryBytes: 0,
      initialBytes: 0,
      initialGzipBytes: 0,
      maxEntryBytes: budget.maxEntryBytes,
      maxInitialBytes: budget.maxInitialBytes,
      maxInitialGzipBytes: budget.maxInitialGzipBytes,
      assets: [],
    };
  }

  const [source, entry] = matches[0];
  const manifestKeys = collectStaticImports(source);
  const assetNames = [
    ...new Set(
      [...manifestKeys].flatMap((key) => {
        const importedEntry = manifest[key];
        return importedEntry === undefined
          ? []
          : [importedEntry.file, ...(importedEntry.css ?? [])];
      }),
    ),
  ];
  const assets = assetNames.map((file) => {
    const contents = readFileSync(resolve(publicDir, file));
    return {
      file,
      bytes: contents.length,
      gzipBytes: gzipSync(contents, { level: 9 }).length,
    };
  });
  const entryBytes =
    assets.find((asset) => asset.file === entry.file)?.bytes ?? 0;
  const initialBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  const initialGzipBytes = assets.reduce(
    (total, asset) => total + asset.gzipBytes,
    0,
  );
  const status =
    entryBytes <= budget.maxEntryBytes &&
    initialBytes <= budget.maxInitialBytes &&
    initialGzipBytes <= budget.maxInitialGzipBytes
      ? "passed"
      : "failed";
  return {
    id: budget.id,
    status,
    matchedEntryCount: matches.length,
    entryBytes,
    initialBytes,
    initialGzipBytes,
    maxEntryBytes: budget.maxEntryBytes,
    maxInitialBytes: budget.maxInitialBytes,
    maxInitialGzipBytes: budget.maxInitialGzipBytes,
    assets,
  };
});
const status = checks.every((check) => check.status === "passed")
  ? "passed"
  : "failed";
const evidence = {
  schemaVersion: "romeo.app-bundle-budget.v2",
  generatedAt: new Date().toISOString(),
  status,
  checks,
  measurement: {
    dynamicImportsIncluded: false,
    gzipLevel: 9,
    staticImportClosureIncluded: true,
  },
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

function collectStaticImports(source, visited = new Set()) {
  if (visited.has(source)) return visited;
  const entry = manifest[source];
  if (entry === undefined) return visited;
  visited.add(source);
  for (const importedSource of entry.imports ?? []) {
    collectStaticImports(importedSource, visited);
  }
  return visited;
}
