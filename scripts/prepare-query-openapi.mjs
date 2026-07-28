import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = resolve(root, "dist/generated/openapi.json");
const outputPath = resolve(root, "dist/generated/openapi-query.json");
const document = JSON.parse(readFileSync(sourcePath, "utf8"));
const excludedOperationIds = [];

for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
  for (const method of ["delete", "get", "patch", "post", "put"]) {
    const operation = pathItem?.[method];
    if (operation === undefined || !hasEventStreamResponse(operation)) continue;
    excludedOperationIds.push(operation.operationId ?? `${method} ${path}`);
    delete pathItem[method];
  }
  if (
    !["delete", "get", "patch", "post", "put"].some(
      (method) => pathItem?.[method] !== undefined,
    )
  ) {
    delete document.paths[path];
  }
}

document.info = {
  ...document.info,
  description:
    "Romeo non-streaming operations used to generate TanStack Query helpers. Streaming operations are owned by the API client runtime.",
  "x-romeo-excluded-streaming-operation-ids": excludedOperationIds.sort(),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(
  `Prepared TanStack Query OpenAPI view with ${excludedOperationIds.length} streaming operation(s) delegated to the runtime transport.`,
);

function hasEventStreamResponse(operation) {
  return Object.values(operation.responses ?? {}).some(
    (response) =>
      response !== null &&
      typeof response === "object" &&
      response.content?.["text/event-stream"] !== undefined,
  );
}
