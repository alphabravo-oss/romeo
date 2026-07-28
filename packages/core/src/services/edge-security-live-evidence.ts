import { readFile } from "node:fs/promises";

import {
  liveEdgeEvidenceSchema,
  requiredEdgeHeaders,
  requiredLiveEdgeChecks,
  type EdgeSecurityPostureCheck,
  type EdgeSecurityPostureReport,
  type LiveEdgeInvalidReason,
} from "./edge-security-types";
import { pass, warn } from "./edge-security-checks";

const liveEdgeRedactionFields = [
  "rawApiKeyReturned",
  "rawHeaderValuesReturned",
  "rawProbePayloadReturned",
  "rawQueryValuesReturned",
  "rawRequestBodiesReturned",
  "rawResponseBodiesReturned",
] as const;

export async function readLiveEdgeEvidence(
  evidencePath: string,
): Promise<EdgeSecurityPostureReport["liveEvidence"]> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) return emptyLiveEvidence();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configuredPath, "utf8"));
  } catch (error) {
    return invalidLiveEvidence(
      error instanceof SyntaxError ? "invalid_json" : "read_failed",
    );
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== liveEdgeEvidenceSchema) {
    return invalidLiveEvidence("schema_mismatch");
  }
  return summarizeLiveEdgeEvidence(parsed);
}

function emptyLiveEvidence(): EdgeSecurityPostureReport["liveEvidence"] {
  return {
    configured: false,
    source: "not_configured",
    status: "not_configured",
    failureCodes: [],
    target: { deployment: "unknown", originConfigured: false },
    checks: liveEdgeChecks([]),
    securityHeaders: emptySecurityHeaders(),
    waf: emptyWaf(),
    requestBodyLimit: emptyRequestBodyLimit(),
    rateLimit: emptyRateLimit(),
    redaction: liveEdgeRedaction(),
  };
}

function invalidLiveEvidence(
  invalidReason: LiveEdgeInvalidReason,
): EdgeSecurityPostureReport["liveEvidence"] {
  return {
    ...emptyLiveEvidence(),
    configured: true,
    source: "configured_file",
    status: "invalid",
    invalidReason,
    failureCodes: [invalidReason],
  };
}

function summarizeLiveEdgeEvidence(
  data: Record<string, unknown>,
): EdgeSecurityPostureReport["liveEvidence"] {
  const checks = liveEdgeChecks(data.checks);
  const target = liveEdgeTarget(data.target);
  const securityHeaders = liveSecurityHeaders(data.securityHeaders);
  const waf = liveWaf(data.waf);
  const requestBodyLimit = liveRequestBodyLimit(data.requestBodyLimit);
  const rateLimit = liveRateLimit(data.rateLimit);
  const redaction = liveEdgeRedaction(data.redaction);
  const redactionConfigured = isRecord(data.redaction);
  const evidenceStatus = statusValue(data.status);
  const mode = modeValue(data.mode);
  const failureCodes = liveEdgeFailureCodes({
    checks,
    evidenceStatus,
    mode,
    rateLimit,
    redaction,
    redactionConfigured,
    requestBodyLimit,
    securityHeaders,
    target,
    waf,
  });
  const status =
    evidenceStatus === "planned" || mode === "dry-run"
      ? "planned"
      : failureCodes.length > 0
        ? "failed"
        : "satisfied";
  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: liveEdgeEvidenceSchema,
    ...(typeof data.generatedAt === "string"
      ? { generatedAt: data.generatedAt }
      : {}),
    evidenceStatus,
    mode,
    failureCodes,
    target,
    checks,
    securityHeaders,
    waf,
    requestBodyLimit,
    rateLimit,
    redaction,
  };
}

function liveEdgeChecks(
  value: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["checks"] {
  const present = new Set(
    (Array.isArray(value) ? value : []).filter(
      (item): item is string => typeof item === "string",
    ),
  );
  const missingRequired = requiredLiveEdgeChecks.filter(
    (check) => !present.has(check),
  );
  return {
    total: present.size,
    requiredTotal: requiredLiveEdgeChecks.length,
    requiredPresent: requiredLiveEdgeChecks.length - missingRequired.length,
    missingRequired,
  };
}

function liveEdgeTarget(
  value: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["target"] {
  if (!isRecord(value)) {
    return { deployment: "unknown", originConfigured: false };
  }
  return {
    deployment: value.deployment === "edge" ? "edge" : "unknown",
    originConfigured:
      typeof value.origin === "string" && value.origin.length > 0,
  };
}

function liveSecurityHeaders(
  value: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["securityHeaders"] {
  if (!isRecord(value)) return emptySecurityHeaders();
  const matched = new Set(
    Array.isArray(value.matched)
      ? value.matched.filter((item): item is string => typeof item === "string")
      : [],
  );
  const missing = requiredEdgeHeaders.filter((header) => !matched.has(header));
  return {
    checked: true,
    status: value.status === "passed" ? "passed" : "failed",
    matchedRequiredCount: requiredEdgeHeaders.length - missing.length,
    missingRequiredCount: missing.length,
    missingRequired: missing,
    hstsChecked: matched.has("strict-transport-security"),
    headerValuesReturned: value.headerValuesReturned === true,
  };
}

function emptySecurityHeaders(): EdgeSecurityPostureReport["liveEvidence"]["securityHeaders"] {
  return {
    checked: false,
    status: "unknown",
    matchedRequiredCount: 0,
    missingRequiredCount: requiredEdgeHeaders.length,
    missingRequired: [...requiredEdgeHeaders],
    hstsChecked: false,
    headerValuesReturned: false,
  };
}

function liveWaf(
  value: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["waf"] {
  if (!isRecord(value)) return emptyWaf();
  return {
    checked: true,
    status: value.status === "passed" ? "passed" : "failed",
    ...(typeof value.httpStatus === "number"
      ? { httpStatus: value.httpStatus }
      : {}),
    expectedStatusCount: arrayLength(value.expectedStatuses),
    ...(typeof value.expectedHeaderPresent === "boolean"
      ? { expectedHeaderPresent: value.expectedHeaderPresent }
      : {}),
    responseBodyReturned: value.responseBodyReturned === true,
  };
}

function emptyWaf(): EdgeSecurityPostureReport["liveEvidence"]["waf"] {
  return {
    checked: false,
    status: "unknown",
    expectedStatusCount: 0,
    responseBodyReturned: false,
  };
}

function liveRequestBodyLimit(
  value: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["requestBodyLimit"] {
  if (!isRecord(value)) return emptyRequestBodyLimit();
  return {
    checked: true,
    status: value.status === "passed" ? "passed" : "failed",
    bytesSent: numberValue(value.bytesSent),
    ...(typeof value.httpStatus === "number"
      ? { httpStatus: value.httpStatus }
      : {}),
    expectedStatusCount: arrayLength(value.expectedStatuses),
    requestBodyReturned: value.requestBodyReturned === true,
    responseBodyReturned: value.responseBodyReturned === true,
  };
}

function emptyRequestBodyLimit(): EdgeSecurityPostureReport["liveEvidence"]["requestBodyLimit"] {
  return {
    checked: false,
    status: "unknown",
    bytesSent: 0,
    expectedStatusCount: 0,
    requestBodyReturned: false,
    responseBodyReturned: false,
  };
}

function liveRateLimit(
  value: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["rateLimit"] {
  if (!isRecord(value)) return emptyRateLimit();
  const expectedStatus =
    typeof value.expectedStatus === "number" ? value.expectedStatus : undefined;
  const statuses = Array.isArray(value.statuses)
    ? value.statuses.filter((item): item is number => typeof item === "number")
    : [];
  return {
    checked: true,
    status: value.status === "passed" ? "passed" : "failed",
    attempts: numberValue(value.attempts),
    ...(typeof value.blockedAt === "number"
      ? { blockedAt: value.blockedAt }
      : {}),
    ...(expectedStatus === undefined ? {} : { expectedStatus }),
    expectedStatusObserved:
      expectedStatus !== undefined && statuses.at(-1) === expectedStatus,
    responseBodyReturned: value.responseBodyReturned === true,
  };
}

function emptyRateLimit(): EdgeSecurityPostureReport["liveEvidence"]["rateLimit"] {
  return {
    checked: false,
    status: "unknown",
    attempts: 0,
    expectedStatusObserved: false,
    responseBodyReturned: false,
  };
}

function liveEdgeRedaction(
  value?: unknown,
): EdgeSecurityPostureReport["liveEvidence"]["redaction"] {
  if (!isRecord(value)) {
    return {
      rawApiKeyReturned: false,
      rawHeaderValuesReturned: false,
      rawProbePayloadReturned: false,
      rawQueryValuesReturned: false,
      rawRequestBodiesReturned: false,
      rawResponseBodiesReturned: false,
    };
  }
  return {
    rawApiKeyReturned: value.rawApiKeyReturned === true,
    rawHeaderValuesReturned: value.rawHeaderValuesReturned === true,
    rawProbePayloadReturned: value.rawProbePayloadReturned === true,
    rawQueryValuesReturned: value.rawQueryValuesReturned === true,
    rawRequestBodiesReturned: value.rawRequestBodiesReturned === true,
    rawResponseBodiesReturned: value.rawResponseBodiesReturned === true,
  };
}

function liveEdgeFailureCodes(input: {
  checks: EdgeSecurityPostureReport["liveEvidence"]["checks"];
  evidenceStatus: EdgeSecurityPostureReport["liveEvidence"]["evidenceStatus"];
  mode: EdgeSecurityPostureReport["liveEvidence"]["mode"];
  rateLimit: EdgeSecurityPostureReport["liveEvidence"]["rateLimit"];
  redaction: EdgeSecurityPostureReport["liveEvidence"]["redaction"];
  redactionConfigured: boolean;
  requestBodyLimit: EdgeSecurityPostureReport["liveEvidence"]["requestBodyLimit"];
  securityHeaders: EdgeSecurityPostureReport["liveEvidence"]["securityHeaders"];
  target: EdgeSecurityPostureReport["liveEvidence"]["target"];
  waf: EdgeSecurityPostureReport["liveEvidence"]["waf"];
}): string[] {
  const failureCodes: string[] = [];
  if (input.mode !== "live") failureCodes.push("edge_enforcement_not_live");
  if (input.evidenceStatus !== "passed")
    failureCodes.push("edge_enforcement_evidence_not_passed");
  if (input.target.deployment !== "edge")
    failureCodes.push("edge_enforcement_wrong_target");
  for (const check of input.checks.missingRequired) {
    failureCodes.push(`edge_enforcement_missing_check:${check}`);
  }
  if (input.securityHeaders.status !== "passed")
    failureCodes.push("edge_security_headers_missing");
  for (const header of input.securityHeaders.missingRequired) {
    failureCodes.push(`edge_header_not_matched:${header}`);
  }
  if (input.waf.status !== "passed") failureCodes.push("edge_waf_not_passed");
  if (
    input.waf.httpStatus !== undefined &&
    ![403, 406, 429].includes(input.waf.httpStatus)
  ) {
    failureCodes.push("edge_waf_unexpected_status");
  }
  if (input.requestBodyLimit.status !== "passed")
    failureCodes.push("edge_body_limit_not_passed");
  if (
    input.requestBodyLimit.httpStatus !== undefined &&
    ![413, 429].includes(input.requestBodyLimit.httpStatus)
  ) {
    failureCodes.push("edge_body_limit_unexpected_status");
  }
  if (input.rateLimit.status !== "passed")
    failureCodes.push("edge_rate_limit_not_passed");
  if (!input.rateLimit.expectedStatusObserved) {
    failureCodes.push("edge_rate_limit_expected_status_missing");
  }
  if (!input.redactionConfigured || liveEdgeRedactionFailed(input.redaction)) {
    failureCodes.push("edge_redaction_missing");
  }
  if (input.securityHeaders.headerValuesReturned) {
    failureCodes.push("edge_redaction_missing_security_header_values");
  }
  if (input.waf.responseBodyReturned) {
    failureCodes.push("edge_redaction_missing_waf_response_body");
  }
  if (input.requestBodyLimit.requestBodyReturned) {
    failureCodes.push("edge_redaction_missing_body_limit_request_body");
  }
  if (input.requestBodyLimit.responseBodyReturned) {
    failureCodes.push("edge_redaction_missing_body_limit_response_body");
  }
  if (input.rateLimit.responseBodyReturned) {
    failureCodes.push("edge_redaction_missing_rate_limit_response_body");
  }
  if (
    input.securityHeaders.headerValuesReturned ||
    input.waf.responseBodyReturned ||
    input.requestBodyLimit.requestBodyReturned ||
    input.requestBodyLimit.responseBodyReturned ||
    input.rateLimit.responseBodyReturned
  ) {
    failureCodes.push("edge_redaction_missing");
  }
  return [...new Set(failureCodes)];
}

export function liveEdgeEvidenceCheck(
  liveEvidence: EdgeSecurityPostureReport["liveEvidence"],
): EdgeSecurityPostureCheck {
  if (liveEvidence.status === "satisfied") {
    return pass(
      "live_edge_enforcement_evidence",
      "Live edge enforcement evidence is mounted and passed.",
      {
        configured: true,
        requiredPresent: liveEvidence.checks.requiredPresent,
      },
    );
  }
  return warn(
    "live_edge_enforcement_evidence",
    "Live edge enforcement evidence is not satisfied.",
    {
      configured: liveEvidence.configured,
      failureCount: liveEvidence.failureCodes.length,
      status: liveEvidence.status,
    },
  );
}

function liveEdgeRedactionFailed(
  redaction: EdgeSecurityPostureReport["liveEvidence"]["redaction"],
): boolean {
  return liveEdgeRedactionFields.some((field) => redaction[field] !== false);
}

function statusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
