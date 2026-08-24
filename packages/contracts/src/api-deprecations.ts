export type ApiDeprecationMethod =
  | "delete"
  | "get"
  | "head"
  | "options"
  | "patch"
  | "post"
  | "put"
  | "trace";

export interface ApiDeprecationDefinition {
  deprecatedAt: string;
  documentationUrl: string;
  method: ApiDeprecationMethod;
  operationId: string;
  path: `/api/v1${string}`;
  replacementOperationId: string | null;
  sinceVersion: string;
  sunsetAt: string;
  telemetryMetric: "romeo_api_deprecated_requests_total";
  zeroUsageDaysRequired: number;
}

/**
 * Sole runtime/OpenAPI registry for active API deprecations. Entries remain
 * here until the operation is removed; historical evidence then remains in
 * docs/api/deprecation-ledger.json only.
 */
const retiredWorkflowDeprecation = {
  deprecatedAt: "2026-08-23T00:00:00.000Z",
  documentationUrl: "https://docs.romeo.ai/api/workflow-retirement",
  replacementOperationId: null,
  sinceVersion: "0.1.0",
  sunsetAt: "2027-02-23T00:00:00.000Z",
  telemetryMetric: "romeo_api_deprecated_requests_total",
  zeroUsageDaysRequired: 90,
} as const;

export const apiDeprecationRegistry = [
  {
    deprecatedAt: "2026-08-23T00:00:00.000Z",
    documentationUrl:
      "https://docs.romeo.ai/api/content-policy-approval-authority",
    method: "post",
    operationId: "contentPolicy.approvals.request",
    path: "/api/v1/admin/content-policy/approvals",
    replacementOperationId: null,
    sinceVersion: "0.1.0",
    sunsetAt: "2027-02-23T00:00:00.000Z",
    telemetryMetric: "romeo_api_deprecated_requests_total",
    zeroUsageDaysRequired: 90,
  },
  {
    ...retiredWorkflowDeprecation,
    method: "get",
    operationId: "workflows.listTemplates",
    path: "/api/v1/workflow-templates",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "post",
    operationId: "workflows.createFromTemplate",
    path: "/api/v1/workflow-templates/{templateId}/create",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "get",
    operationId: "workflows.list",
    path: "/api/v1/workflows",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "post",
    operationId: "workflows.create",
    path: "/api/v1/workflows",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "post",
    operationId: "workflows.runDueSchedules",
    path: "/api/v1/workflows/schedules/run-due",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "get",
    operationId: "workflows.listRuns",
    path: "/api/v1/workflows/{workflowId}/runs",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "post",
    operationId: "workflows.startRun",
    path: "/api/v1/workflows/{workflowId}/runs",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "post",
    operationId: "workflows.approveRun",
    path: "/api/v1/workflow-runs/{workflowRunId}/approve",
  },
  {
    ...retiredWorkflowDeprecation,
    method: "post",
    operationId: "workflows.resumeRun",
    path: "/api/v1/workflow-runs/{workflowRunId}/resume",
  },
] as const satisfies readonly ApiDeprecationDefinition[];

export function applyApiDeprecationsToOpenApiDocument(
  document: Record<string, unknown>,
  definitions: readonly ApiDeprecationDefinition[] = apiDeprecationRegistry,
): void {
  if (definitions.length === 0) return;
  const paths = asRecord(document.paths);
  for (const definition of definitions) {
    const pathItem = asRecord(paths[definition.path]);
    const operation = asRecord(pathItem[definition.method]);
    if (operation.operationId !== definition.operationId) {
      throw new Error(
        `API deprecation registry does not match ${definition.method.toUpperCase()} ${definition.path}.`,
      );
    }
    operation.deprecated = true;
    operation["x-romeo-deprecation"] = metadataFor(definition);
    const responses = asRecord(operation.responses);
    for (const [status, value] of Object.entries(responses)) {
      if (!/^2\d\d$/u.test(status)) continue;
      const response = asRecord(value);
      const headers = asRecord(response.headers);
      headers.Deprecation ??= header(
        "RFC 9745 structured deprecation date for this operation.",
      );
      headers.Sunset ??= header(
        "RFC 8594 HTTP-date after which this operation may be removed.",
      );
      headers.Link ??= header(
        "Migration documentation and optional successor-version links.",
      );
      response.headers = headers;
    }
  }
}

function metadataFor(definition: ApiDeprecationDefinition) {
  return {
    deprecatedAt: definition.deprecatedAt,
    documentationUrl: definition.documentationUrl,
    replacementOperationId: definition.replacementOperationId,
    sinceVersion: definition.sinceVersion,
    sunsetAt: definition.sunsetAt,
    telemetryMetric: definition.telemetryMetric,
    zeroUsageDaysRequired: definition.zeroUsageDaysRequired,
  };
}

function header(description: string) {
  return { description, schema: { type: "string" } };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}
