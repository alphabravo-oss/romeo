import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const schemaVersion = "romeo.qdrant-live-evidence.v1";
const outputPath = argValue("--output");
const dryRun = hasFlag("--dry-run");
const confirmMutation = hasFlag("--confirm-mutation");
const allowUnauthenticated = hasFlag("--allow-unauthenticated");
const endpoint = argValue("--url") ?? process.env.QDRANT_URL ?? "";
const collection =
  argValue("--collection") ?? process.env.QDRANT_COLLECTION ?? "";
const apiKey = argValue("--api-key") ?? process.env.QDRANT_API_KEY ?? "";
const namespacePolicy = parsePolicy(
  argValue("--namespace-policy") ??
    process.env.VECTOR_NAMESPACE_POLICY ??
    "org",
  "--namespace-policy",
);
const partitioningPolicy = parsePolicy(
  argValue("--partitioning-policy") ??
    process.env.VECTOR_PARTITIONING_POLICY ??
    "workspace",
  "--partitioning-policy",
);
const dimensions = parsePositiveInteger("--dimensions", 8);
const timeoutMs = parsePositiveInteger("--timeout-ms", 15000);
const runId = randomBytes(8).toString("hex");
const expectedPointId = randomUUID();
const namespaceTrapPointId = randomUUID();
const partitionTrapPointId = randomUUID();
const foreignOrgPointId = randomUUID();
const expectedScope = {
  orgId: `org_${runId}`,
  workspaceId: `workspace_${runId}`,
  knowledgeBaseId: `kb_${runId}`,
  sourceId: `source_${runId}`,
  chunkId: `chunk_expected_${runId}`,
};
const namespaceTrapScope = {
  ...expectedScope,
  chunkId: `chunk_namespace_trap_${runId}`,
};
const partitionTrapScope = {
  ...expectedScope,
  chunkId: `chunk_partition_trap_${runId}`,
};
const foreignOrgScope = {
  ...expectedScope,
  orgId: `foreign_org_${runId}`,
  chunkId: `chunk_foreign_org_${runId}`,
};
const model = {
  embeddingProvider: "romeo_live_qdrant_smoke",
  embeddingModel: "romeo-qdrant-smoke-embedding",
  dimensions,
};
const vector = Array.from({ length: dimensions }, (_, index) =>
  index === 0 ? 1 : 0,
);
const cleanupPointIds = [
  expectedPointId,
  namespaceTrapPointId,
  partitionTrapPointId,
  foreignOrgPointId,
];

try {
  const evidence = dryRun ? plannedEvidence() : await liveEvidence();
  assertEvidenceRedacted(evidence);
  writeEvidence(evidence);
} catch (error) {
  await bestEffortCleanup();
  throw error;
}

function plannedEvidence() {
  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      driver: "qdrant",
      endpointConfigured: endpoint.trim().length > 0,
      endpointValid: endpoint.trim().length > 0 && endpointValid(endpoint),
      endpointScheme: endpointScheme(endpoint),
      endpointHostSha256: endpointHostSha256(endpoint),
      collectionConfigured: collection.trim().length > 0,
      collectionSha256: sha256Value(collection.trim()),
      credentialConfigured: apiKey.length > 0,
      unauthenticatedAllowed: allowUnauthenticated,
      namespacePolicy,
      partitioningPolicy,
      dimensions,
      timeoutMs,
    },
    mutation: {
      requiresConfirmMutation: true,
      confirmed: confirmMutation,
    },
    checks: [
      "qdrant_endpoint_required_for_live_mode",
      "collection_required_for_live_mode",
      "api_key_or_allow_unauthenticated_required_for_live_mode",
      "confirm_mutation_required_for_live_mode",
      "dry_run_is_planning_evidence_only",
    ],
    redaction: redactionSummary(),
  };
}

async function liveEvidence() {
  validateLiveInputs();
  const collectionInfo = await request("GET", collectionPath(), undefined);
  const expectedPayload = payload(expectedScope);
  const namespaceTrapPayload = {
    ...payload(namespaceTrapScope),
    ...(namespacePolicy === "none"
      ? {}
      : { romeoNamespace: `wrong_namespace_${runId}` }),
  };
  const partitionTrapPayload = {
    ...payload(partitionTrapScope),
    ...(partitioningPolicy === "none"
      ? {}
      : { romeoPartition: `wrong_partition_${runId}` }),
  };
  const foreignOrgPayload = payload(foreignOrgScope);
  const points = [
    point(expectedPointId, expectedPayload),
    point(namespaceTrapPointId, namespaceTrapPayload),
    point(partitionTrapPointId, partitionTrapPayload),
    point(foreignOrgPointId, foreignOrgPayload),
  ];

  await request("PUT", `${collectionPath()}/points?wait=true`, { points });
  const filter = scopedFilter(expectedScope);
  const queryBody = {
    query: vector,
    filter,
    limit: points.length,
    with_payload: true,
    with_vector: false,
  };
  const queryResult = parseQueryResult(
    await request("POST", `${collectionPath()}/points/query`, queryBody),
  );
  assertQueryIsolation(queryResult);

  await request("POST", `${collectionPath()}/points/delete?wait=true`, {
    filter,
  });
  const postDeleteResult = parseQueryResult(
    await request("POST", `${collectionPath()}/points/query`, queryBody),
  );
  if (postDeleteResult.expectedReturned || postDeleteResult.resultCount !== 0) {
    throw new Error("Qdrant scoped delete did not remove the smoke point.");
  }
  await bestEffortCleanup();

  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      driver: "qdrant",
      endpointConfigured: true,
      endpointValid: true,
      endpointScheme: endpointScheme(endpoint),
      endpointHostSha256: endpointHostSha256(endpoint),
      collectionConfigured: true,
      collectionSha256: sha256Value(collection.trim()),
      credentialConfigured: apiKey.length > 0,
      unauthenticatedAllowed: allowUnauthenticated,
      namespacePolicy,
      partitioningPolicy,
      dimensions,
      timeoutMs,
    },
    collection: summarizeCollection(collectionInfo),
    mutation: {
      requiresConfirmMutation: true,
      confirmed: true,
      insertedPointCount: points.length,
      cleanupAttempted: true,
    },
    isolation: {
      scopedQueryResultCount: queryResult.resultCount,
      expectedHitReturned: queryResult.expectedReturned,
      namespaceTrapExcluded:
        namespacePolicy === "none" ? true : !queryResult.namespaceTrapReturned,
      partitionTrapExcluded:
        partitioningPolicy === "none"
          ? true
          : !queryResult.partitionTrapReturned,
      foreignOrgTrapExcluded: !queryResult.foreignOrgReturned,
      vectorsReturned: queryResult.vectorsReturned,
      payloadReturned: queryResult.payloadReturned,
      filter: summarizeFilter(filter),
    },
    deletion: {
      scopedDeleteIssued: true,
      postDeleteResultCount: postDeleteResult.resultCount,
      expectedHitRemoved: !postDeleteResult.expectedReturned,
      cleanupByPointIdAttempted: true,
    },
    checks: [
      "endpoint_shape_valid",
      "collection_health_readable",
      "synthetic_points_upserted",
      "scoped_query_returned_expected_point",
      "namespace_trap_excluded",
      "partition_trap_excluded",
      "foreign_org_trap_excluded",
      "query_omitted_vectors",
      "scoped_delete_removed_expected_point",
      "evidence_redaction_self_check_passed",
    ],
    redaction: redactionSummary(),
  };
}

function validateLiveInputs() {
  if (!endpointValid(endpoint)) {
    throw new Error(
      "--url or QDRANT_URL must be http(s) without credentials, query, or fragment.",
    );
  }
  if (collection.trim().length === 0) {
    throw new Error("--collection or QDRANT_COLLECTION is required.");
  }
  if (apiKey.length === 0 && !allowUnauthenticated) {
    throw new Error(
      "--api-key or QDRANT_API_KEY is required unless --allow-unauthenticated is set.",
    );
  }
  if (!confirmMutation) {
    throw new Error(
      "--confirm-mutation is required because live Qdrant evidence writes and deletes synthetic points.",
    );
  }
  if (namespacePolicy === "none") {
    throw new Error(
      "--namespace-policy must not be none for enterprise Qdrant isolation evidence.",
    );
  }
}

function point(id, pointPayload) {
  return { id, vector, payload: pointPayload };
}

function payload(scope) {
  const value = {
    chunkId: scope.chunkId,
    dimensions,
    embeddingModel: model.embeddingModel,
    embeddingProvider: model.embeddingProvider,
    knowledgeBaseId: scope.knowledgeBaseId,
    orgId: scope.orgId,
    sourceId: scope.sourceId,
    workspaceId: scope.workspaceId,
  };
  const namespace = vectorScopeToken(namespacePolicy, scope);
  if (namespace !== undefined) value.romeoNamespace = namespace;
  const partition = vectorScopeToken(partitioningPolicy, scope);
  if (partition !== undefined) value.romeoPartition = partition;
  return value;
}

function scopedFilter(scope) {
  const must = [
    ...scopeConditions(scope),
    fieldCondition("orgId", scope.orgId),
    fieldCondition("workspaceId", scope.workspaceId),
    fieldCondition("knowledgeBaseId", scope.knowledgeBaseId),
    fieldCondition("embeddingProvider", model.embeddingProvider),
    fieldCondition("embeddingModel", model.embeddingModel),
    fieldCondition("dimensions", dimensions),
    { key: "sourceId", match: { any: [scope.sourceId] } },
  ];
  return { must };
}

function scopeConditions(scope) {
  const conditions = [];
  const namespace = vectorScopeToken(namespacePolicy, scope);
  if (namespace !== undefined)
    conditions.push(fieldCondition("romeoNamespace", namespace));
  const partition = vectorScopeToken(partitioningPolicy, scope);
  if (partition !== undefined)
    conditions.push(fieldCondition("romeoPartition", partition));
  return conditions;
}

function vectorScopeToken(policy, scope) {
  if (policy === "none") return undefined;
  if (policy === "org") return `org:${scope.orgId}`;
  if (policy === "workspace")
    return `workspace:${scope.orgId}:${scope.workspaceId}`;
  return `knowledge_base:${scope.orgId}:${scope.workspaceId}:${scope.knowledgeBaseId}`;
}

function fieldCondition(key, value) {
  return { key, match: { value } };
}

function summarizeFilter(filter) {
  const keys = new Set(
    Array.isArray(filter.must)
      ? filter.must
          .map((condition) => condition.key)
          .filter((key) => typeof key === "string")
      : [],
  );
  return {
    orgFilterApplied: keys.has("orgId"),
    workspaceFilterApplied: keys.has("workspaceId"),
    knowledgeBaseFilterApplied: keys.has("knowledgeBaseId"),
    sourceFilterApplied: keys.has("sourceId"),
    providerModelDimensionFilterApplied:
      keys.has("embeddingProvider") &&
      keys.has("embeddingModel") &&
      keys.has("dimensions"),
    namespaceFilterApplied: keys.has("romeoNamespace"),
    partitionFilterApplied: keys.has("romeoPartition"),
  };
}

async function bestEffortCleanup() {
  if (
    dryRun ||
    !confirmMutation ||
    !endpointValid(endpoint) ||
    collection.trim().length === 0 ||
    (apiKey.length === 0 && !allowUnauthenticated)
  ) {
    return;
  }
  try {
    await request("POST", `${collectionPath()}/points/delete?wait=true`, {
      points: cleanupPointIds,
    });
  } catch {
    // Cleanup failure is reported by the main delete check when it matters.
  }
}

function parseQueryResult(response) {
  const result = asRecord(response)?.result;
  const points = Array.isArray(asRecord(result)?.points)
    ? asRecord(result).points
    : [];
  const summaries = points.map((rawPoint) => {
    const pointRecord = asRecord(rawPoint);
    const payloadRecord = asRecord(pointRecord?.payload);
    return {
      hasPayload: payloadRecord !== undefined,
      hasVector: pointRecord?.vector !== undefined,
      chunkId:
        typeof payloadRecord?.chunkId === "string"
          ? payloadRecord.chunkId
          : undefined,
    };
  });
  return {
    resultCount: summaries.length,
    expectedReturned: summaries.some(
      (summary) => summary.chunkId === expectedScope.chunkId,
    ),
    namespaceTrapReturned: summaries.some(
      (summary) => summary.chunkId === namespaceTrapScope.chunkId,
    ),
    partitionTrapReturned: summaries.some(
      (summary) => summary.chunkId === partitionTrapScope.chunkId,
    ),
    foreignOrgReturned: summaries.some(
      (summary) => summary.chunkId === foreignOrgScope.chunkId,
    ),
    vectorsReturned: summaries.some((summary) => summary.hasVector),
    payloadReturned: summaries.some((summary) => summary.hasPayload),
  };
}

function assertQueryIsolation(result) {
  if (!result.expectedReturned) {
    throw new Error("Qdrant scoped query did not return the expected point.");
  }
  if (namespacePolicy !== "none" && result.namespaceTrapReturned) {
    throw new Error("Qdrant scoped query returned the namespace trap point.");
  }
  if (partitioningPolicy !== "none" && result.partitionTrapReturned) {
    throw new Error("Qdrant scoped query returned the partition trap point.");
  }
  if (result.foreignOrgReturned) {
    throw new Error("Qdrant scoped query returned the foreign-org trap point.");
  }
  if (result.vectorsReturned) {
    throw new Error("Qdrant scoped query returned vector values.");
  }
}

async function request(method, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (apiKey.length > 0) headers["api-key"] = apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(qdrantUrl(path), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Qdrant ${method} request failed with HTTP ${response.status}.`,
      );
    }
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Qdrant ${method} response was not valid JSON.`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Qdrant ${method} request timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function qdrantUrl(path) {
  const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  return new URL(path.replace(/^\/+/u, ""), base).toString();
}

function collectionPath() {
  return `/collections/${encodeURIComponent(collection.trim())}`;
}

function summarizeCollection(response) {
  const result = asRecord(response)?.result;
  return {
    status: stringValue(result, "status"),
    optimizerStatus: stringValue(result, "optimizer_status"),
    pointsCount: integerValue(result, "points_count"),
    vectorsCount: integerValue(result, "vectors_count"),
    indexedVectorsCount: integerValue(result, "indexed_vectors_count"),
    segmentsCount: integerValue(result, "segments_count"),
  };
}

function redactionSummary() {
  return {
    endpointReturned: false,
    collectionReturned: false,
    apiKeyReturned: false,
    evidenceFileBodyReturned: false,
    rawEvidencePathReturned: false,
    namespaceValuesReturned: false,
    partitionValuesReturned: false,
    payloadValuesReturned: false,
    pointIdsReturned: false,
    vectorValuesReturned: false,
  };
}

function assertEvidenceRedacted(evidence) {
  const serialized = JSON.stringify(evidence);
  const forbidden = [
    endpoint,
    collection,
    apiKey,
    expectedPointId,
    namespaceTrapPointId,
    partitionTrapPointId,
    foreignOrgPointId,
    ...Object.values(expectedScope),
    ...Object.values(namespaceTrapScope),
    ...Object.values(partitionTrapScope),
    ...Object.values(foreignOrgScope),
    vectorScopeToken(namespacePolicy, expectedScope),
    vectorScopeToken(partitioningPolicy, expectedScope),
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const value of forbidden) {
    if (serialized.includes(value)) {
      throw new Error("Qdrant evidence redaction self-check failed.");
    }
  }
}

function writeEvidence(evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  process.stdout.write(serialized);
  if (outputPath !== undefined) {
    const absolute = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, serialized, "utf8");
  }
}

function endpointValid(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
}

function endpointScheme(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.protocol.slice(0, -1)
      : undefined;
  } catch {
    return undefined;
  }
}

function endpointHostSha256(value) {
  try {
    const parsed = new URL(value);
    return parsed.host.length > 0 ? sha256Value(parsed.host) : undefined;
  } catch {
    return undefined;
  }
}

function sha256Value(value) {
  if (value.length === 0) return undefined;
  return createHash("sha256").update(value).digest("hex");
}

function parsePolicy(value, name) {
  if (
    value === "none" ||
    value === "org" ||
    value === "workspace" ||
    value === "knowledge_base"
  ) {
    return value;
  }
  throw new Error(
    `${name} must be one of none, org, workspace, or knowledge_base.`,
  );
}

function parsePositiveInteger(name, fallback) {
  const parsed = Number.parseInt(argValue(name) ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function stringValue(source, key) {
  const value = asRecord(source)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerValue(source, key) {
  const value = asRecord(source)?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
