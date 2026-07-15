import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const schemaVersion = "romeo.qdrant-dr-consistency.v1";
const outputPath = argValue("--output");
const dryRun = hasFlag("--dry-run");
const confirmMutation = hasFlag("--confirm-mutation");
const confirmCleanup = hasFlag("--confirm-cleanup");
const allowUnauthenticated = hasFlag("--allow-unauthenticated");
const phase = argValue("--phase") ?? "verify-restore";
const endpoint = argValue("--url") ?? process.env.QDRANT_URL ?? "";
const collection =
  argValue("--collection") ?? process.env.QDRANT_COLLECTION ?? "";
const apiKey = argValue("--api-key") ?? process.env.QDRANT_API_KEY ?? "";
const runSecret =
  argValue("--run-secret") ?? process.env.QDRANT_DR_RUN_SECRET ?? "";
const sourceEvidencePath = argValue("--source-evidence");
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

if (!["cleanup-source", "prepare-source", "verify-restore"].includes(phase)) {
  throw new Error(
    "--phase must be prepare-source, verify-restore, or cleanup-source.",
  );
}

const seed = deriveSeed(
  runSecret.length > 0
    ? runSecret
    : "dry-run-placeholder-qdrant-dr-secret-00000000",
);
const model = {
  embeddingProvider: "romeo_qdrant_dr_smoke",
  embeddingModel: "romeo-qdrant-dr-smoke-embedding",
  dimensions,
};
const vector = Array.from({ length: dimensions }, (_, index) =>
  index === 0 ? 1 : 0,
);

try {
  const evidence = dryRun ? plannedEvidence() : await liveEvidence();
  assertEvidenceRedacted(evidence);
  writeEvidence(evidence);
} catch (error) {
  if (phase === "verify-restore" && confirmCleanup) await bestEffortCleanup();
  throw error;
}

function plannedEvidence() {
  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    phase,
    target: targetSummary(),
    seed: {
      runSecretConfigured: runSecret.length > 0,
      runSecretSha256:
        runSecret.length > 0 ? sha256Value(runSecret) : undefined,
      sourceEvidenceConfigured: sourceEvidencePath !== undefined,
    },
    mutation: {
      requiresConfirmMutation: phase !== "verify-restore",
      confirmMutation,
      confirmCleanup,
    },
    checks: [
      "qdrant_endpoint_required_for_live_mode",
      "collection_required_for_live_mode",
      "run_secret_required_for_live_mode",
      "prepare_source_runs_before_operator_restore",
      "verify_restore_runs_after_operator_restore",
      "dry_run_is_planning_evidence_only",
    ],
    redaction: redactionSummary(),
  };
}

async function liveEvidence() {
  validateLiveInputs();
  const sourceEvidence =
    phase === "verify-restore" ? readSourceEvidence() : undefined;
  const collectionInfo = await request("GET", collectionPath(), undefined);
  if (phase === "prepare-source") {
    await request("PUT", `${collectionPath()}/points?wait=true`, {
      points: [
        point(seed.expectedPointId, payload(seed.expectedScope)),
        point(seed.foreignOrgPointId, payload(seed.foreignOrgScope)),
      ],
    });
    const readback = parseQueryResult(
      await request("POST", `${collectionPath()}/points/query`, queryBody()),
    );
    if (!readback.expectedReturned || readback.vectorsReturned) {
      throw new Error("Qdrant DR source preparation readback failed.");
    }
    return evidenceForPhase({
      collectionInfo,
      sourceEvidence,
      checks: [
        "collection_health_readable",
        "source_synthetic_points_upserted",
        "source_scoped_readback_succeeded",
        "source_foreign_org_trap_excluded",
        "query_omitted_vectors",
        "evidence_redaction_self_check_passed",
      ],
      prepare: {
        preparedPointCount: 2,
        scopedReadbackReturnedExpectedPoint: readback.expectedReturned,
        foreignOrgTrapExcluded: !readback.foreignOrgReturned,
        vectorsReturned: readback.vectorsReturned,
      },
    });
  }

  if (phase === "cleanup-source") {
    await deleteAllSmokePoints();
    const postDelete = parseQueryResult(
      await request("POST", `${collectionPath()}/points/query`, queryBody()),
    );
    if (postDelete.expectedReturned || postDelete.resultCount !== 0) {
      throw new Error("Qdrant DR source cleanup did not remove smoke points.");
    }
    return evidenceForPhase({
      collectionInfo,
      sourceEvidence,
      checks: [
        "collection_health_readable",
        "source_all_smoke_point_delete_issued",
        "source_all_smoke_point_delete_verified",
        "evidence_redaction_self_check_passed",
      ],
      cleanup: {
        allSmokePointDeleteIssued: true,
        postDeleteResultCount: postDelete.resultCount,
        expectedHitRemoved: !postDelete.expectedReturned,
      },
    });
  }

  const readback = parseQueryResult(
    await request("POST", `${collectionPath()}/points/query`, queryBody()),
  );
  if (!readback.expectedReturned) {
    throw new Error(
      "Qdrant DR restore readback did not return the smoke point.",
    );
  }
  if (readback.foreignOrgReturned) {
    throw new Error("Qdrant DR restore readback returned a foreign-org trap.");
  }
  if (readback.vectorsReturned) {
    throw new Error("Qdrant DR restore readback returned vector values.");
  }
  if (!confirmCleanup) {
    throw new Error("--confirm-cleanup is required for restore delete proof.");
  }
  await deleteAllSmokePoints();
  const postDelete = parseQueryResult(
    await request("POST", `${collectionPath()}/points/query`, queryBody()),
  );
  if (postDelete.expectedReturned || postDelete.resultCount !== 0) {
    throw new Error("Qdrant DR restore cleanup did not remove smoke points.");
  }
  return evidenceForPhase({
    collectionInfo,
    sourceEvidence,
    checks: [
      "source_evidence_matches_run_secret",
      "collection_health_readable",
      "restored_scoped_query_returned_expected_point",
      "restored_foreign_org_trap_excluded",
      "query_omitted_vectors",
      "restored_all_smoke_point_delete_issued",
      "restored_all_smoke_point_delete_verified",
      "evidence_redaction_self_check_passed",
    ],
    restore: {
      sourceEvidenceMatched: true,
      scopedReadbackReturnedExpectedPoint: readback.expectedReturned,
      foreignOrgTrapExcluded: !readback.foreignOrgReturned,
      vectorsReturned: readback.vectorsReturned,
      allSmokePointDeleteIssued: true,
      postDeleteResultCount: postDelete.resultCount,
      expectedHitRemoved: !postDelete.expectedReturned,
    },
  });
}

function evidenceForPhase(input) {
  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    phase,
    target: targetSummary(),
    seed: {
      runSecretSha256: sha256Value(runSecret),
      sourceEvidenceSha256:
        sourceEvidencePath === undefined
          ? undefined
          : sha256Value(readFileSync(sourceEvidencePath, "utf8")),
      deterministicScope: true,
    },
    collection: summarizeCollection(input.collectionInfo),
    policy: {
      namespacePolicy,
      partitioningPolicy,
      dimensions,
      filter: summarizeFilter(scopedFilter(seed.expectedScope)),
    },
    ...(input.prepare === undefined ? {} : { prepare: input.prepare }),
    ...(input.restore === undefined ? {} : { restore: input.restore }),
    ...(input.cleanup === undefined ? {} : { cleanup: input.cleanup }),
    checks: input.checks,
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
  if (runSecret.length < 32) {
    throw new Error(
      "--run-secret or QDRANT_DR_RUN_SECRET must be at least 32 characters.",
    );
  }
  if (namespacePolicy === "none") {
    throw new Error(
      "--namespace-policy must not be none for enterprise Qdrant DR evidence.",
    );
  }
  if (
    (phase === "prepare-source" || phase === "cleanup-source") &&
    !confirmMutation
  ) {
    throw new Error(
      "--confirm-mutation is required for source mutation phases.",
    );
  }
  if (phase === "verify-restore" && sourceEvidencePath === undefined) {
    throw new Error("--source-evidence is required for verify-restore.");
  }
}

function readSourceEvidence() {
  const raw = readFileSync(sourceEvidencePath, "utf8");
  const parsed = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== schemaVersion ||
    parsed.status !== "passed" ||
    parsed.mode !== "live" ||
    parsed.phase !== "prepare-source"
  ) {
    throw new Error(
      "--source-evidence must be passed prepare-source evidence.",
    );
  }
  if (parsed.seed?.runSecretSha256 !== sha256Value(runSecret)) {
    throw new Error(
      "--source-evidence does not match the supplied run secret.",
    );
  }
  if (
    parsed.policy?.namespacePolicy !== namespacePolicy ||
    parsed.policy?.partitioningPolicy !== partitioningPolicy ||
    parsed.policy?.dimensions !== dimensions
  ) {
    throw new Error("--source-evidence policy does not match verify inputs.");
  }
  return parsed;
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

function queryBody() {
  return {
    query: vector,
    filter: scopedFilter(seed.expectedScope),
    limit: 4,
    with_payload: true,
    with_vector: false,
  };
}

async function deleteAllSmokePoints() {
  await request("POST", `${collectionPath()}/points/delete?wait=true`, {
    points: [seed.expectedPointId, seed.foreignOrgPointId],
  });
}

async function bestEffortCleanup() {
  if (
    !confirmCleanup ||
    !endpointValid(endpoint) ||
    collection.trim().length === 0 ||
    (apiKey.length === 0 && !allowUnauthenticated)
  ) {
    return;
  }
  try {
    await deleteAllSmokePoints();
  } catch {
    // Best-effort cleanup must not obscure the original failure.
  }
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
      (summary) => summary.chunkId === seed.expectedScope.chunkId,
    ),
    foreignOrgReturned: summaries.some(
      (summary) => summary.chunkId === seed.foreignOrgScope.chunkId,
    ),
    vectorsReturned: summaries.some((summary) => summary.hasVector),
    payloadReturned: summaries.some((summary) => summary.hasPayload),
  };
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

function targetSummary() {
  return {
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
  };
}

function redactionSummary() {
  return {
    apiKeyReturned: false,
    collectionReturned: false,
    endpointReturned: false,
    namespaceValuesReturned: false,
    partitionValuesReturned: false,
    payloadValuesReturned: false,
    pointIdsReturned: false,
    runSecretReturned: false,
    sourceEvidenceBodyReturned: false,
    sourceEvidencePathReturned: false,
    vectorValuesReturned: false,
  };
}

function assertEvidenceRedacted(evidence) {
  const serialized = JSON.stringify(evidence);
  const forbidden = [
    endpoint,
    collection,
    apiKey,
    runSecret,
    seed.expectedPointId,
    seed.foreignOrgPointId,
    ...Object.values(seed.expectedScope),
    ...Object.values(seed.foreignOrgScope),
    vectorScopeToken(namespacePolicy, seed.expectedScope),
    vectorScopeToken(partitioningPolicy, seed.expectedScope),
    sourceEvidencePath,
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const value of forbidden) {
    if (serialized.includes(value)) {
      throw new Error("Qdrant DR evidence redaction self-check failed.");
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

function deriveSeed(secret) {
  const digest = sha256Value(`romeo:qdrant-dr:${secret}`);
  const prefix = digest.slice(0, 16);
  const expectedScope = {
    orgId: `org_${prefix}`,
    workspaceId: `workspace_${digest.slice(16, 32)}`,
    knowledgeBaseId: `kb_${digest.slice(32, 48)}`,
    sourceId: `source_${digest.slice(48, 64)}`,
    chunkId: `chunk_${sha256Value(`chunk:${secret}`).slice(0, 24)}`,
  };
  return {
    expectedPointId: uuidFromHash(`point:expected:${secret}`),
    foreignOrgPointId: uuidFromHash(`point:foreign:${secret}`),
    expectedScope,
    foreignOrgScope: {
      ...expectedScope,
      orgId: `foreign_org_${sha256Value(`foreign:${secret}`).slice(0, 16)}`,
      chunkId: `chunk_${sha256Value(`foreign-chunk:${secret}`).slice(0, 24)}`,
    },
  };
}

function uuidFromHash(value) {
  const bytes = Buffer.from(sha256Value(value), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value) {
  return isRecord(value) ? value : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
