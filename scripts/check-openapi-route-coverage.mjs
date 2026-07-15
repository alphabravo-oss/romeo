import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  process.cwd(),
  argValue("--output") ?? "dist/ci/openapi-route-coverage.json",
);
const tempDir = resolve(root, "tmp", `openapi-route-coverage-${process.pid}`);
const openApiFile = join(tempDir, "openapi.json");
const openWebUiCompatibilityEnabled =
  process.env.OPENWEBUI_COMPATIBILITY_ENABLED === "true";

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

  const routes = discoverRoutes();
  const openApi = JSON.parse(readFileSync(openApiFile, "utf8"));
  const operations = openApiOperations(openApi.paths ?? {});
  const publicRouteKeys = new Set(
    routes.map((route) => operationKey(route.method, route.path)),
  );
  const uncoveredRoutes = routes
    .filter((route) => !operations.has(operationKey(route.method, route.path)))
    .map((route) => ({
      method: route.method,
      openApiPath: route.path,
      routeFile: relative(root, route.file),
      routePath: route.routePath,
      failureCode: "missing_openapi_operation",
    }));

  const evidence = {
    schemaVersion: "romeo.openapi-route-coverage.v1",
    generatedAt: new Date().toISOString(),
    status: uncoveredRoutes.length === 0 ? "passed" : "failed",
    checks: [
      "route_files_scanned",
      "openapi_document_exported",
      "public_api_v1_routes_have_openapi_operations",
    ],
    stats: {
      routeFiles: new Set(routes.map((route) => route.file)).size,
      publicApiV1Routes: routes.length,
      publicApiV1RouteKeys: publicRouteKeys.size,
      openApiOperations: operations.size,
      coveredRoutes: routes.length - uncoveredRoutes.length,
      uncoveredRoutes: uncoveredRoutes.length,
    },
    configuration: {
      openWebUiCompatibilityEnabled,
    },
    scannedRouteFiles: routeFiles().map((file) => ({
      path: relative(root, file),
      bytes: statSync(file).size,
    })),
    skippedRouteFiles: skippedRouteFiles().map((file) => ({
      path: relative(root, file),
      reason: "optional_openwebui_compatibility_disabled",
    })),
    uncoveredRoutes,
    redaction: {
      routeHandlerSourceReturned: false,
      requestBodiesReturned: false,
      responseBodiesReturned: false,
      secretValuesReturned: false,
    },
  };

  writeJson(outputPath, evidence);
  if (uncoveredRoutes.length > 0) {
    console.error(
      `OpenAPI route coverage failed with ${uncoveredRoutes.length} uncovered route(s).`,
    );
    process.exit(1);
  }
  console.log(`Wrote OpenAPI route coverage evidence to ${outputPath}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function discoverRoutes() {
  const routes = [];
  const routePattern =
    /app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/gms;

  for (const file of routeFiles()) {
    const source = readFileSync(file, "utf8");
    let match;
    while ((match = routePattern.exec(source)) !== null) {
      const routePath = match[2];
      if (!routePath.startsWith("/api/v1/")) continue;
      routes.push({
        file,
        method: match[1],
        path: toOpenApiPath(routePath),
        routePath,
      });
    }
  }

  return routes.sort((left, right) =>
    operationKey(left.method, left.path).localeCompare(
      operationKey(right.method, right.path),
    ),
  );
}

function routeFiles() {
  const directory = resolve(root, "packages/core/src/http/routes");
  return readdirSync(directory)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => join(directory, file))
    .filter((file) => existsSync(file))
    .filter(
      (file) =>
        openWebUiCompatibilityEnabled || !file.endsWith("/openwebui.ts"),
    )
    .sort();
}

function skippedRouteFiles() {
  if (openWebUiCompatibilityEnabled) return [];
  const file = resolve(root, "packages/core/src/http/routes/openwebui.ts");
  return existsSync(file) ? [file] : [];
}

function openApiOperations(paths) {
  const operations = new Set();
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "patch", "put", "delete"]) {
      if (pathItem?.[method] !== undefined) {
        operations.add(operationKey(method, path));
      }
    }
  }
  return operations;
}

function toOpenApiPath(routePath) {
  return (
    routePath
      .replace(/^\/api\/v1/u, "")
      .replace(/:([A-Za-z0-9_]+)/gu, "{$1}") || "/"
  );
}

function operationKey(method, path) {
  return `${method.toLowerCase()} ${path}`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
