import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { seededSubject, type Scope } from "../packages/auth/src/index";
import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { createServices } from "../packages/core/src/services";

type RomeoTestApi = ReturnType<typeof createRomeoApi>;

const output = argValue("--output");
const repository = new InMemoryRomeoRepository();
const env = { ...readEnv(), DEV_SEEDED_LOGIN: true };
const api = createRomeoApi(repository, { env });
const services = createServices(repository, { env });
const rawSentinels = {
  evalInput: `RAW_ANALYTICS_EVAL_INPUT_${process.pid}`,
  evalExpected: `RAW_ANALYTICS_EVAL_EXPECTED_${process.pid}`,
  usageMetadata: `RAW_ANALYTICS_USAGE_METADATA_${process.pid}`,
  jobPayload: `RAW_ANALYTICS_JOB_PAYLOAD_${process.pid}`,
};
const now = new Date().toISOString();

await seedAnalyticsData();

const analyticsToken = await createApiKey("analytics-read", [
  "admin:read",
  "usage:read",
]);
const usageOnlyToken = await createApiKey("usage-without-admin", [
  "usage:read",
]);
const adminOnlyToken = await createApiKey("admin-without-usage", [
  "admin:read",
]);
const agentReadToken = await createApiKey("agent-read", ["agents:read"]);
const nonAgentToken = await createApiKey("non-agent-read", ["me:read"]);

const secureApi = createRomeoApi(repository, {
  env: { ...env, DEV_SEEDED_LOGIN: false },
});
const unauthenticatedAnalyticsStatus = await requestStatus(
  secureApi,
  "/api/v1/admin/analytics/summary",
);
assertStatusNumber(
  unauthenticatedAnalyticsStatus,
  401,
  "unauthenticated analytics read",
);

const seededJobSummary = await services.jobs.operationalSummary(seededSubject);
const seededProviderSummary =
  await services.runs.providerOperationalSummary(seededSubject);
const usageOnlySubject = await services.apiKeys.authenticate(usageOnlyToken);
const adminOnlySubject = await services.apiKeys.authenticate(adminOnlyToken);
const nonAgentSubject = await services.apiKeys.authenticate(nonAgentToken);
await repository.createResourceGrant({
  id: "grant_analytics_authz_agent_read",
  resourceType: "agent",
  resourceId: "agent_default",
  principalType: "user",
  principalId: "user_dev_admin",
  permission: "read",
});

const usageWithoutAdminStatus = await expectedForbiddenStatus(() =>
  services.analytics.summary(usageOnlySubject, {
    jobSummary: seededJobSummary,
    providerSummary: seededProviderSummary,
  }),
);
assertStatusNumber(
  usageWithoutAdminStatus,
  403,
  "usage without admin analytics read",
);

const adminWithoutUsageStatus = await expectedForbiddenStatus(() =>
  services.analytics.summary(adminOnlySubject, {
    jobSummary: seededJobSummary,
    providerSummary: seededProviderSummary,
  }),
);
assertStatusNumber(
  adminWithoutUsageStatus,
  403,
  "admin without usage analytics read",
);

const analyticsSummary = await requestJson<{
  data: {
    evals?: { releaseGate?: { status?: string }; suiteCount?: number };
    redaction?: Record<string, boolean>;
    status?: string;
    usage?: { eventCount?: number };
  };
}>("/api/v1/admin/analytics/summary", analyticsToken);
assertStatus(analyticsSummary.response, 200, "analytics summary");
if (analyticsSummary.body.data?.evals?.releaseGate?.status !== "passed") {
  throw new Error("Expected analytics release gate to pass.");
}
assertFalseFlags(analyticsSummary.body.data.redaction, [
  "rawEvalInputsReturned",
  "rawEvalOutputsReturned",
  "rawJobPayloadsReturned",
  "rawProviderConfigReturned",
  "rawToolInputsReturned",
  "rawUsageMetadataReturned",
]);

const analyticsCsv = await request(
  "/api/v1/admin/analytics/summary.csv",
  analyticsToken,
);
assertStatus(analyticsCsv, 200, "analytics CSV");
const csvText = await analyticsCsv.text();
if (!csvText.includes("eval,org,org_default,suite_count,1")) {
  throw new Error("Analytics CSV did not include aggregate eval evidence.");
}

const evalDeniedStatus = await expectedForbiddenStatus(() =>
  services.evals.releaseCandidateEvidence(nonAgentSubject, "agent_default"),
);
assertStatusNumber(evalDeniedStatus, 403, "eval evidence without agent read");

const evalEvidence = await requestJson<{
  data: {
    gate?: { status?: string };
    redaction?: Record<string, boolean>;
    schema?: string;
  };
}>(
  "/api/v1/agents/agent_default/eval-release-candidate-evidence",
  agentReadToken,
);
assertStatus(evalEvidence.response, 200, "eval release-candidate evidence");
if (
  evalEvidence.body.data?.schema !== "romeo.eval-release-candidate-evidence.v1"
) {
  throw new Error("Eval release-candidate evidence schema mismatch.");
}
if (evalEvidence.body.data?.gate?.status !== "passed") {
  throw new Error("Expected eval release-candidate gate to pass.");
}
assertFalseFlags(evalEvidence.body.data.redaction, [
  "rawEvalInputsReturned",
  "rawEvalOutputsReturned",
  "rawHumanRatingCommentsReturned",
  "rawRubricTermsReturned",
]);

assertNoRawContent("analytics summary", JSON.stringify(analyticsSummary.body));
assertNoRawContent("analytics CSV", csvText);
assertNoRawContent("eval evidence", JSON.stringify(evalEvidence.body));

const evidence = {
  schemaVersion: "romeo.analytics-authz-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "unauthenticated_admin_analytics_denied",
    "usage_scope_without_admin_denied",
    "admin_scope_without_usage_denied",
    "minimal_admin_analytics_json_read",
    "minimal_admin_analytics_csv_read",
    "eval_evidence_requires_agent_read",
    "eval_evidence_redaction_flags",
    "raw_analytics_and_eval_content_absent",
    "api_tokens_not_retained",
  ],
  endpoints: {
    analyticsSummary: "/api/v1/admin/analytics/summary",
    analyticsCsv: "/api/v1/admin/analytics/summary.csv",
    evalReleaseCandidateEvidence:
      "/api/v1/agents/agent_default/eval-release-candidate-evidence",
  },
  authorization: {
    unauthenticatedAnalyticsStatus,
    usageWithoutAdminStatus,
    adminWithoutUsageStatus,
    evalWithoutAgentReadStatus: evalDeniedStatus,
  },
  readback: {
    analyticsStatus: analyticsSummary.body.data.status,
    evalReleaseGateStatus:
      analyticsSummary.body.data.evals?.releaseGate?.status,
    evalSuiteCount: analyticsSummary.body.data.evals?.suiteCount,
    usageEventCount: analyticsSummary.body.data.usage?.eventCount,
    csvBytes: Buffer.byteLength(csvText),
    csvSha256: sha256(csvText),
    evalEvidenceGateStatus: evalEvidence.body.data.gate?.status,
  },
  redaction: {
    rawAnalyticsJsonReturned: false,
    rawAnalyticsCsvReturned: false,
    rawEvalEvidenceReturned: false,
    rawApiTokensReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
for (const token of [
  analyticsToken,
  usageOnlyToken,
  adminOnlyToken,
  agentReadToken,
  nonAgentToken,
]) {
  assertNotContains(serialized, token, "evidence token redaction");
}
assertNoRawContent("persisted evidence", serialized);

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote analytics authorization contract smoke to ${outputPath}`);
}

async function seedAnalyticsData(): Promise<void> {
  await repository.createUsageEvent({
    id: "usage_analytics_authz_smoke",
    orgId: "org_default",
    workspaceId: "workspace_default",
    actorId: "user_default",
    sourceType: "run",
    sourceId: "run_analytics_authz_smoke",
    metric: "tokens.total",
    quantity: 77,
    unit: "token",
    metadata: {
      estimatedCostUsd: 0.42,
      providerId: "provider_openai",
      rawSentinel: rawSentinels.usageMetadata,
    },
    createdAt: now,
  });
  await repository.createBackgroundJob({
    id: "job_analytics_authz_smoke",
    orgId: "org_default",
    type: "tool.operation.dispatch_request",
    status: "failed",
    payload: { rawSentinel: rawSentinels.jobPayload },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  });
  const suite = await apiJson<{
    data: { suite: { id: string } };
  }>("/api/v1/eval-suites", {
    method: "POST",
    body: JSON.stringify({
      agentId: "agent_default",
      name: "Analytics authorization contract",
      cases: [
        {
          input: rawSentinels.evalInput,
          expectedContains: "Romeo OpenAI-compatible response:",
          rubric: { mustNotContain: [rawSentinels.evalExpected] },
        },
      ],
    }),
  });
  await apiJson(`/api/v1/eval-suites/${suite.data.suite.id}/runs`, {
    method: "POST",
  });
}

async function createApiKey(name: string, scopes: Scope[]): Promise<string> {
  const body = await apiJson<{ data: { token: string } }>("/api/v1/api-keys", {
    method: "POST",
    body: JSON.stringify({ name, scopes }),
  });
  return body.data.token;
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await api.request(path, {
    ...init,
    headers,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path} returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

async function request(path: string, token: string): Promise<Response> {
  return api.request(path, { headers: { authorization: `Bearer ${token}` } });
}

async function requestStatus(
  targetApi: RomeoTestApi,
  path: string,
  token?: string,
): Promise<number> {
  try {
    const response = await targetApi.request(path, {
      ...(token === undefined
        ? {}
        : { headers: { authorization: `Bearer ${token}` } }),
    });
    return response.status;
  } catch (error) {
    return statusFromExpectedError(error);
  }
}

async function expectedForbiddenStatus(
  action: () => Promise<unknown>,
): Promise<number> {
  try {
    await action();
    return 200;
  } catch (error) {
    return statusFromExpectedError(error);
  }
}

async function requestJson<T>(
  path: string,
  token: string,
): Promise<{ body: T; response: Response }> {
  const response = await request(path, token);
  return { body: (await response.json()) as T, response };
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  assertStatusNumber(response.status, expected, label);
}

function assertStatusNumber(
  actual: number,
  expected: number,
  label: string,
): void {
  if (actual !== expected)
    throw new Error(`${label} returned ${actual}; expected ${expected}.`);
}

function statusFromExpectedError(error: unknown): number {
  if (typeof error !== "object" || error === null) throw error;
  const candidate = error as { code?: unknown; status?: unknown };
  if (candidate.code === "forbidden") return 403;
  if (candidate.status === 401) return 401;
  throw error;
}

function assertFalseFlags(
  flags: Record<string, boolean> | undefined,
  fields: string[],
): void {
  const missing = fields.filter((field) => flags?.[field] !== false);
  if (missing.length > 0) {
    throw new Error(`Missing false redaction flags: ${missing.join(", ")}.`);
  }
}

function assertNoRawContent(label: string, value: string): void {
  for (const raw of Object.values(rawSentinels)) {
    assertNotContains(value, raw, label);
  }
}

function assertNotContains(value: string, raw: string, label: string): void {
  if (value.includes(raw)) throw new Error(`${label} leaked raw content.`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
