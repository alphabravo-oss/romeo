import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { apiDeprecationRegistry } from "../packages/contracts/src/api-deprecations.ts";

const root = resolve(import.meta.dirname, "..");
const documentPath = resolve(root, "dist/generated/openapi.json");
const ledgerPath = resolve(root, "docs/api/deprecation-ledger.json");
const methods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);
const requiredMetric = "romeo_api_deprecated_requests_total";

export function validateApiEvolution(document, ledger, runtimeRegistry = []) {
  const failures = [];
  const operations = collectOperations(document, failures);
  const ledgerById = validateLedger(ledger, failures);
  const runtimeById = validateRuntimeRegistry(runtimeRegistry, failures);

  for (const operation of operations.values()) {
    const extension = operation.value["x-romeo-deprecation"];
    if (operation.value.deprecated !== true) {
      if (extension !== undefined)
        failures.push(
          `${operation.id}: x-romeo-deprecation requires deprecated: true.`,
        );
      continue;
    }
    validateDeprecatedOperation(
      operation,
      extension,
      ledgerById,
      runtimeById,
      failures,
    );
  }

  for (const [operationId, entry] of ledgerById) {
    if (entry.status === "active" && !operations.has(operationId))
      failures.push(
        `${operationId}: active deprecation ledger entry has no OpenAPI operation.`,
      );
    if (entry.status === "active" && !runtimeById.has(operationId))
      failures.push(
        `${operationId}: active ledger entry has no runtime registration.`,
      );
    if (
      entry.status === "active" &&
      operations.get(operationId)?.value.deprecated !== true
    )
      failures.push(
        `${operationId}: active ledger operation is not deprecated in OpenAPI.`,
      );
    if (entry.status === "removed" && operations.has(operationId))
      failures.push(
        `${operationId}: removed deprecation ledger entry still has an OpenAPI operation.`,
      );
    if (entry.status === "removed" && runtimeById.has(operationId))
      failures.push(
        `${operationId}: removed deprecation is still runtime-registered.`,
      );
    if (
      entry.replacementOperationId !== null &&
      typeof entry.replacementOperationId === "string" &&
      !operations.has(entry.replacementOperationId)
    )
      failures.push(
        `${operationId}: replacementOperationId ${entry.replacementOperationId} is not a current OpenAPI operation.`,
      );
  }
  for (const [operationId, runtime] of runtimeById) {
    const operation = operations.get(operationId);
    const ledger = ledgerById.get(operationId);
    if (operation === undefined)
      failures.push(
        `${operationId}: runtime deprecation registry has no OpenAPI operation.`,
      );
    else if (operation.value.deprecated !== true)
      failures.push(
        `${operationId}: runtime-registered operation is not deprecated in OpenAPI.`,
      );
    if (ledger?.status !== "active")
      failures.push(
        `${operationId}: runtime deprecation registry has no active ledger entry.`,
      );
    else
      for (const field of [
        "deprecatedAt",
        "documentationUrl",
        "replacementOperationId",
        "sinceVersion",
        "sunsetAt",
        "telemetryMetric",
        "zeroUsageDaysRequired",
      ])
        if (!Object.is(runtime[field], ledger[field]))
          failures.push(
            `${operationId}: runtime registry and ledger disagree on ${field}.`,
          );
  }
  return failures;
}

function collectOperations(document, failures) {
  const collected = new Map();
  if (!isRecord(document) || !isRecord(document.paths)) {
    failures.push("OpenAPI document must contain a paths object.");
    return collected;
  }
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const [method, value] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase()) || !isRecord(value)) continue;
      const operationId = value.operationId;
      if (typeof operationId !== "string" || operationId.length === 0) {
        failures.push(`${method.toUpperCase()} ${path}: missing operationId.`);
        continue;
      }
      if (collected.has(operationId)) {
        failures.push(`${operationId}: duplicate operationId.`);
        continue;
      }
      collected.set(operationId, {
        id: operationId,
        method: method.toLowerCase(),
        path,
        value,
      });
    }
  }
  return collected;
}

function validateRuntimeRegistry(registry, failures) {
  const entries = new Map();
  if (!Array.isArray(registry)) {
    failures.push("Runtime deprecation registry must be an array.");
    return entries;
  }
  for (const [index, value] of registry.entries()) {
    const label = `runtimeRegistry[${index}]`;
    if (!isRecord(value)) {
      failures.push(`${label}: must be an object.`);
      continue;
    }
    if (
      typeof value.operationId !== "string" ||
      value.operationId.length === 0
    ) {
      failures.push(`${label}: operationId is required.`);
      continue;
    }
    if (entries.has(value.operationId)) {
      failures.push(`${value.operationId}: duplicate runtime registry entry.`);
      continue;
    }
    if (!methods.has(String(value.method).toLowerCase()))
      failures.push(`${value.operationId}: invalid runtime method.`);
    if (typeof value.path !== "string" || !value.path.startsWith("/"))
      failures.push(`${value.operationId}: invalid runtime path.`);
    validateDeprecationFields(value.operationId, value, failures);
    entries.set(value.operationId, value);
  }
  return entries;
}

function validateLedger(ledger, failures) {
  const entries = new Map();
  if (
    !isRecord(ledger) ||
    ledger.schemaVersion !== 1 ||
    !Array.isArray(ledger.operations)
  ) {
    failures.push(
      "Deprecation ledger must be schemaVersion 1 with operations[].",
    );
    return entries;
  }
  for (const [index, value] of ledger.operations.entries()) {
    const label = `ledger.operations[${index}]`;
    if (!isRecord(value)) {
      failures.push(`${label}: must be an object.`);
      continue;
    }
    const operationId = value.operationId;
    if (typeof operationId !== "string" || operationId.length === 0) {
      failures.push(`${label}: operationId is required.`);
      continue;
    }
    if (entries.has(operationId)) {
      failures.push(`${operationId}: duplicate ledger entry.`);
      continue;
    }
    if (value.status !== "active" && value.status !== "removed")
      failures.push(`${operationId}: status must be active or removed.`);
    validateDeprecationFields(operationId, value, failures);
    if (value.status === "removed") {
      if (!isIsoDate(value.removedAt))
        failures.push(`${operationId}: removedAt is required when removed.`);
      if (
        typeof value.removalEvidence !== "string" ||
        !isSafeRepositoryPath(value.removalEvidence)
      )
        failures.push(
          `${operationId}: safe repository-relative removalEvidence is required.`,
        );
      if (
        isIsoDate(value.sunsetAt) &&
        isIsoDate(value.removedAt) &&
        Date.parse(value.removedAt) < Date.parse(value.sunsetAt)
      )
        failures.push(`${operationId}: removedAt precedes sunsetAt.`);
    }
    entries.set(operationId, value);
  }
  return entries;
}

function validateDeprecatedOperation(
  operation,
  extension,
  ledgerById,
  runtimeById,
  failures,
) {
  if (!isRecord(extension)) {
    failures.push(`${operation.id}: missing x-romeo-deprecation object.`);
    return;
  }
  validateDeprecationFields(operation.id, extension, failures);
  const ledger = ledgerById.get(operation.id);
  const runtime = runtimeById.get(operation.id);
  if (ledger === undefined || ledger.status !== "active") {
    failures.push(`${operation.id}: missing active deprecation ledger entry.`);
  } else {
    for (const field of [
      "deprecatedAt",
      "documentationUrl",
      "replacementOperationId",
      "sinceVersion",
      "sunsetAt",
      "telemetryMetric",
      "zeroUsageDaysRequired",
    ]) {
      if (!Object.is(extension[field], ledger[field]))
        failures.push(
          `${operation.id}: OpenAPI and ledger disagree on ${field}.`,
        );
    }
  }
  if (runtime === undefined) {
    failures.push(`${operation.id}: missing runtime deprecation registration.`);
  } else {
    if (runtime.method !== operation.method)
      failures.push(`${operation.id}: runtime method does not match OpenAPI.`);
    if (normalizeRuntimePath(runtime.path) !== operation.path)
      failures.push(`${operation.id}: runtime path does not match OpenAPI.`);
    for (const field of [
      "deprecatedAt",
      "documentationUrl",
      "replacementOperationId",
      "sinceVersion",
      "sunsetAt",
      "telemetryMetric",
      "zeroUsageDaysRequired",
    ]) {
      if (!Object.is(extension[field], runtime[field]))
        failures.push(
          `${operation.id}: OpenAPI and runtime registry disagree on ${field}.`,
        );
    }
  }
  const successResponses = Object.entries(
    operation.value.responses ?? {},
  ).filter(([status]) => /^2\d\d$/u.test(status));
  if (successResponses.length === 0)
    failures.push(`${operation.id}: deprecated operation has no 2xx response.`);
  for (const [status, response] of successResponses) {
    const headers =
      isRecord(response) && isRecord(response.headers) ? response.headers : {};
    for (const header of ["Deprecation", "Sunset", "Link"])
      if (!hasHeader(headers, header))
        failures.push(
          `${operation.id}: ${status} response is missing ${header} header.`,
        );
  }
}

function normalizeRuntimePath(path) {
  return path.replace(/^\/api\/v1(?=\/|$)/u, "") || "/";
}

function validateDeprecationFields(label, value, failures) {
  if (
    typeof value.sinceVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(value.sinceVersion)
  )
    failures.push(`${label}: sinceVersion must be a semantic version.`);
  if (!isIsoDate(value.deprecatedAt))
    failures.push(`${label}: deprecatedAt must be an ISO timestamp.`);
  if (!isIsoDate(value.sunsetAt))
    failures.push(`${label}: sunsetAt must be an ISO timestamp.`);
  if (isIsoDate(value.deprecatedAt) && isIsoDate(value.sunsetAt)) {
    const noticeDays =
      (Date.parse(value.sunsetAt) - Date.parse(value.deprecatedAt)) /
      86_400_000;
    if (noticeDays < 90)
      failures.push(`${label}: deprecation notice must be at least 90 days.`);
  }
  if (
    value.replacementOperationId !== null &&
    (typeof value.replacementOperationId !== "string" ||
      value.replacementOperationId.length === 0)
  )
    failures.push(`${label}: replacementOperationId must be a string or null.`);
  if (
    typeof value.documentationUrl !== "string" ||
    !isSafeDocumentationUrl(value.documentationUrl)
  )
    failures.push(`${label}: documentationUrl must be HTTPS or root-relative.`);
  if (value.telemetryMetric !== requiredMetric)
    failures.push(`${label}: telemetryMetric must be ${requiredMetric}.`);
  if (
    !Number.isSafeInteger(value.zeroUsageDaysRequired) ||
    value.zeroUsageDaysRequired < 30
  )
    failures.push(`${label}: zeroUsageDaysRequired must be at least 30.`);
}

function hasHeader(headers, expected) {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === expected.toLowerCase(),
  );
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isSafeDocumentationUrl(value) {
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeRepositoryPath(value) {
  return (
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    value.length <= 500
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function validateRemovalEvidenceFiles(ledger, failures) {
  if (!isRecord(ledger) || !Array.isArray(ledger.operations)) return;
  for (const entry of ledger.operations) {
    if (
      !isRecord(entry) ||
      entry.status !== "removed" ||
      typeof entry.removalEvidence !== "string" ||
      !isSafeRepositoryPath(entry.removalEvidence)
    )
      continue;
    try {
      if (!(await stat(resolve(root, entry.removalEvidence))).isFile())
        failures.push(`${entry.operationId}: removalEvidence is not a file.`);
    } catch {
      failures.push(
        `${entry.operationId}: removalEvidence file does not exist.`,
      );
    }
  }
}

function validDeprecatedFixture() {
  const fields = {
    deprecatedAt: "2026-01-01T00:00:00.000Z",
    documentationUrl: "/docs/api/migrate-example",
    replacementOperationId: "example.getV2",
    sinceVersion: "1.2.3",
    sunsetAt: "2026-04-15T00:00:00.000Z",
    telemetryMetric: requiredMetric,
    zeroUsageDaysRequired: 30,
  };
  return {
    document: {
      paths: {
        "/example": {
          get: {
            deprecated: true,
            operationId: "example.getV1",
            responses: {
              200: {
                headers: {
                  Deprecation: { schema: { type: "string" } },
                  Link: { schema: { type: "string" } },
                  Sunset: { schema: { type: "string" } },
                },
              },
            },
            "x-romeo-deprecation": fields,
          },
        },
        "/example-v2": {
          get: { operationId: "example.getV2", responses: { 200: {} } },
        },
      },
    },
    ledger: {
      schemaVersion: 1,
      operations: [
        { operationId: "example.getV1", status: "active", ...fields },
      ],
    },
    runtimeRegistry: [
      {
        operationId: "example.getV1",
        method: "get",
        path: "/example",
        ...fields,
      },
    ],
  };
}

function runSelfTest() {
  const valid = validDeprecatedFixture();
  const validFailures = validateApiEvolution(
    valid.document,
    valid.ledger,
    valid.runtimeRegistry,
  );
  if (validFailures.length > 0)
    throw new Error(
      `Valid API evolution fixture failed: ${validFailures.join(" | ")}`,
    );

  const missingMetadata = structuredClone(valid);
  delete missingMetadata.document.paths["/example"].get["x-romeo-deprecation"];
  const missingFailures = validateApiEvolution(
    missingMetadata.document,
    missingMetadata.ledger,
    missingMetadata.runtimeRegistry,
  );
  if (!missingFailures.some((failure) => failure.includes("missing x-romeo")))
    throw new Error("Self-test did not reject missing deprecation metadata.");

  const shortWindow = structuredClone(valid);
  shortWindow.document.paths["/example"].get["x-romeo-deprecation"].sunsetAt =
    "2026-01-15T00:00:00.000Z";
  shortWindow.ledger.operations[0].sunsetAt = "2026-01-15T00:00:00.000Z";
  const shortFailures = validateApiEvolution(
    shortWindow.document,
    shortWindow.ledger,
    shortWindow.runtimeRegistry,
  );
  if (!shortFailures.some((failure) => failure.includes("at least 90 days")))
    throw new Error("Self-test did not reject a short notice window.");

  const missingHeader = structuredClone(valid);
  delete missingHeader.document.paths["/example"].get.responses[200].headers
    .Sunset;
  const headerFailures = validateApiEvolution(
    missingHeader.document,
    missingHeader.ledger,
    missingHeader.runtimeRegistry,
  );
  if (!headerFailures.some((failure) => failure.includes("missing Sunset")))
    throw new Error("Self-test did not reject missing sunset headers.");

  const missingRuntime = structuredClone(valid);
  missingRuntime.runtimeRegistry = [];
  const runtimeFailures = validateApiEvolution(
    missingRuntime.document,
    missingRuntime.ledger,
    missingRuntime.runtimeRegistry,
  );
  if (
    !runtimeFailures.some((failure) => failure.includes("runtime deprecation"))
  )
    throw new Error("Self-test did not reject missing runtime registration.");

  const missingReplacement = structuredClone(valid);
  delete missingReplacement.document.paths["/example-v2"];
  const replacementFailures = validateApiEvolution(
    missingReplacement.document,
    missingReplacement.ledger,
    missingReplacement.runtimeRegistry,
  );
  if (
    !replacementFailures.some((failure) => failure.includes("is not a current"))
  )
    throw new Error(
      "Self-test did not reject a missing replacement operation.",
    );

  const removed = structuredClone(valid);
  delete removed.document.paths["/example"];
  removed.runtimeRegistry = [];
  removed.ledger.operations[0] = {
    ...removed.ledger.operations[0],
    status: "removed",
    removedAt: "2026-05-15T00:00:00.000Z",
    removalEvidence: "docs/api/example-removal-evidence.md",
  };
  const removedFailures = validateApiEvolution(
    removed.document,
    removed.ledger,
    removed.runtimeRegistry,
  );
  if (removedFailures.length > 0)
    throw new Error(
      `Valid removed-operation fixture failed: ${removedFailures.join(" | ")}`,
    );
}

async function main() {
  runSelfTest();
  const [document, ledger] = await Promise.all([
    readFile(documentPath, "utf8").then(JSON.parse),
    readFile(ledgerPath, "utf8").then(JSON.parse),
  ]);
  const failures = validateApiEvolution(
    document,
    ledger,
    apiDeprecationRegistry,
  );
  await validateRemovalEvidenceFiles(ledger, failures);
  if (failures.length > 0) {
    console.error(
      "API evolution policy failed:\n" +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `API evolution policy passed (${Object.keys(document.paths ?? {}).length} paths, ${ledger.operations.length} ledger entries).`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
