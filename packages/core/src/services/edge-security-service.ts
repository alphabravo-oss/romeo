import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const liveEdgeEvidenceSchema = "romeo.live-edge-enforcement.v1";
const requiredLiveEdgeChecks = [
  "security_headers_present",
  "waf_or_gateway_probe_blocked",
  "oversized_request_rejected",
  "public_rate_limit_enforced",
  "raw_probe_payload_not_retained",
] as const;
const requiredEdgeHeaders = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "cross-origin-opener-policy",
  "permissions-policy",
] as const;
const liveEdgeRedactionFields = [
  "rawApiKeyReturned",
  "rawHeaderValuesReturned",
  "rawProbePayloadReturned",
  "rawQueryValuesReturned",
  "rawRequestBodiesReturned",
  "rawResponseBodiesReturned",
] as const;

type LiveEdgeInvalidReason = "invalid_json" | "read_failed" | "schema_mismatch";

export interface EdgeSecurityPostureCheck {
  id: string;
  status: "pass" | "warn";
  severity: "info" | "warning";
  message: string;
  details: Record<string, boolean | number | string>;
}

export interface EdgeSecurityPostureReport {
  status: "attention_required" | "ready";
  generatedAt: string;
  orgId: string;
  appOrigin: {
    configured: boolean;
    localhost: boolean;
    scheme: "http" | "https";
  };
  tls: {
    appOriginHttps: boolean;
    hstsEnabled: boolean;
    hstsIncludeSubdomains: boolean;
    hstsMaxAgeSeconds: number;
    hstsPreload: boolean;
    termination: RomeoEnv["EDGE_TLS_TERMINATION"];
  };
  proxy: {
    mode: RomeoEnv["EDGE_TRUSTED_PROXY_MODE"];
    forwardedHeadersTrusted: boolean;
  };
  ingress: {
    allowedOriginRuleCount: number;
    wafMode: RomeoEnv["EDGE_WAF_MODE"];
  };
  limits: {
    files: {
      directUploadMaxBytes: number;
      inlineMaxBytes: number;
      messageAttachmentMaxBytes: number;
      resumableUploadMaxBytes: number;
    };
    rateLimit: {
      authenticatedMax: number;
      authMax: number;
      distributed: boolean;
      driver: RomeoEnv["HTTP_RATE_LIMIT_DRIVER"];
      publicMax: number;
      webhookMax: number;
      windowSeconds: number;
    };
    requestBodyMaxBytes: number;
  };
  headers: {
    contentTypeOptions: "nosniff";
    crossOriginOpenerPolicy: "same-origin";
    frameOptions: "DENY";
    permissionsPolicy: "camera=(), microphone=(), geolocation=()";
    referrerPolicy: "no-referrer";
    strictTransportSecurity: boolean;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
    schemaVersion?: typeof liveEdgeEvidenceSchema;
    generatedAt?: string;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    invalidReason?: LiveEdgeInvalidReason;
    failureCodes: string[];
    target: {
      deployment: "edge" | "unknown";
      originConfigured: boolean;
    };
    checks: {
      total: number;
      requiredTotal: number;
      requiredPresent: number;
      missingRequired: Array<(typeof requiredLiveEdgeChecks)[number]>;
    };
    securityHeaders: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      matchedRequiredCount: number;
      missingRequiredCount: number;
      missingRequired: Array<(typeof requiredEdgeHeaders)[number]>;
      hstsChecked: boolean;
      headerValuesReturned: boolean;
    };
    waf: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      httpStatus?: number;
      expectedStatusCount: number;
      expectedHeaderPresent?: boolean;
      responseBodyReturned: boolean;
    };
    requestBodyLimit: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      bytesSent: number;
      httpStatus?: number;
      expectedStatusCount: number;
      requestBodyReturned: boolean;
      responseBodyReturned: boolean;
    };
    rateLimit: {
      checked: boolean;
      status: "failed" | "passed" | "unknown";
      attempts: number;
      blockedAt?: number;
      expectedStatus?: number;
      expectedStatusObserved: boolean;
      responseBodyReturned: boolean;
    };
    redaction: {
      rawApiKeyReturned: boolean;
      rawHeaderValuesReturned: boolean;
      rawProbePayloadReturned: boolean;
      rawQueryValuesReturned: boolean;
      rawRequestBodiesReturned: boolean;
      rawResponseBodiesReturned: boolean;
    };
  };
  checks: EdgeSecurityPostureCheck[];
  redaction: {
    evidenceFileBodyReturned: false;
    rawAllowedOriginsReturned: false;
    rawAppOriginReturned: false;
    rawEvidencePathReturned: false;
    rawIngressAnnotationsReturned: false;
    rawProxyIpRangesReturned: false;
    rawSecretsReturned: false;
  };
}

export class EdgeSecurityService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<EdgeSecurityPostureReport> {
    assertScope(subject, "admin:read");
    const appOrigin = new URL(this.env.APP_ORIGIN);
    const appOriginHttps = appOrigin.protocol === "https:";
    const localhost = isLocalhost(appOrigin.hostname);
    const allowedOriginRuleCount = csvCount(this.env.EDGE_ALLOWED_ORIGINS);
    const liveEvidence = await readLiveEdgeEvidence(
      this.env.EDGE_ENFORCEMENT_EVIDENCE_PATH,
    );
    const checks = [
      ...edgeSecurityChecks({
        allowedOriginRuleCount,
        appOriginHttps,
        hstsEnabled: this.env.EDGE_HSTS_ENABLED,
        hstsMaxAgeSeconds: this.env.EDGE_HSTS_MAX_AGE_SECONDS,
        localhost,
        fileDirectUploadMaxBytes: this.env.FILE_DIRECT_UPLOAD_MAX_BYTES,
        fileInlineEncodedMaxBytes: base64LengthLimitFor(
          this.env.FILE_INLINE_MAX_BYTES,
        ),
        fileInlineMaxBytes: this.env.FILE_INLINE_MAX_BYTES,
        fileResumableUploadMaxBytes: this.env.FILE_RESUMABLE_UPLOAD_MAX_BYTES,
        messageAttachmentMaxBytes: this.env.MESSAGE_ATTACHMENT_MAX_BYTES,
        proxyMode: this.env.EDGE_TRUSTED_PROXY_MODE,
        rateLimitDriver: this.env.HTTP_RATE_LIMIT_DRIVER,
        requestBodyMaxBytes: this.env.REQUEST_BODY_MAX_BYTES,
        tlsTermination: this.env.EDGE_TLS_TERMINATION,
        wafMode: this.env.EDGE_WAF_MODE,
      }),
      liveEdgeEvidenceCheck(liveEvidence),
    ];

    return {
      status: checks.some((check) => check.status === "warn")
        ? "attention_required"
        : "ready",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      appOrigin: {
        configured: true,
        localhost,
        scheme: appOriginHttps ? "https" : "http",
      },
      tls: {
        appOriginHttps,
        hstsEnabled: this.env.EDGE_HSTS_ENABLED,
        hstsIncludeSubdomains: this.env.EDGE_HSTS_INCLUDE_SUBDOMAINS,
        hstsMaxAgeSeconds: this.env.EDGE_HSTS_MAX_AGE_SECONDS,
        hstsPreload: this.env.EDGE_HSTS_PRELOAD,
        termination: this.env.EDGE_TLS_TERMINATION,
      },
      proxy: {
        mode: this.env.EDGE_TRUSTED_PROXY_MODE,
        forwardedHeadersTrusted:
          this.env.EDGE_TRUSTED_PROXY_MODE === "trusted_proxy",
      },
      ingress: {
        allowedOriginRuleCount,
        wafMode: this.env.EDGE_WAF_MODE,
      },
      limits: {
        files: {
          directUploadMaxBytes: this.env.FILE_DIRECT_UPLOAD_MAX_BYTES,
          inlineMaxBytes: this.env.FILE_INLINE_MAX_BYTES,
          messageAttachmentMaxBytes: this.env.MESSAGE_ATTACHMENT_MAX_BYTES,
          resumableUploadMaxBytes: this.env.FILE_RESUMABLE_UPLOAD_MAX_BYTES,
        },
        rateLimit: {
          authenticatedMax: this.env.HTTP_RATE_LIMIT_AUTHENTICATED_MAX,
          authMax: this.env.HTTP_RATE_LIMIT_AUTH_MAX,
          distributed: this.env.HTTP_RATE_LIMIT_DRIVER === "valkey",
          driver: this.env.HTTP_RATE_LIMIT_DRIVER,
          publicMax: this.env.HTTP_RATE_LIMIT_PUBLIC_MAX,
          webhookMax: this.env.HTTP_RATE_LIMIT_WEBHOOK_MAX,
          windowSeconds: this.env.HTTP_RATE_LIMIT_WINDOW_SECONDS,
        },
        requestBodyMaxBytes: this.env.REQUEST_BODY_MAX_BYTES,
      },
      headers: {
        contentTypeOptions: "nosniff",
        crossOriginOpenerPolicy: "same-origin",
        frameOptions: "DENY",
        permissionsPolicy: "camera=(), microphone=(), geolocation=()",
        referrerPolicy: "no-referrer",
        strictTransportSecurity:
          this.env.EDGE_HSTS_ENABLED && this.env.EDGE_HSTS_MAX_AGE_SECONDS > 0,
      },
      liveEvidence,
      checks,
      redaction: {
        evidenceFileBodyReturned: false,
        rawAllowedOriginsReturned: false,
        rawAppOriginReturned: false,
        rawEvidencePathReturned: false,
        rawIngressAnnotationsReturned: false,
        rawProxyIpRangesReturned: false,
        rawSecretsReturned: false,
      },
    };
  }
}

async function readLiveEdgeEvidence(
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

function liveEdgeEvidenceCheck(
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

function edgeSecurityChecks(input: {
  allowedOriginRuleCount: number;
  appOriginHttps: boolean;
  fileDirectUploadMaxBytes: number;
  fileInlineEncodedMaxBytes: number;
  fileInlineMaxBytes: number;
  fileResumableUploadMaxBytes: number;
  hstsEnabled: boolean;
  hstsMaxAgeSeconds: number;
  localhost: boolean;
  messageAttachmentMaxBytes: number;
  proxyMode: RomeoEnv["EDGE_TRUSTED_PROXY_MODE"];
  rateLimitDriver: RomeoEnv["HTTP_RATE_LIMIT_DRIVER"];
  requestBodyMaxBytes: number;
  tlsTermination: RomeoEnv["EDGE_TLS_TERMINATION"];
  wafMode: RomeoEnv["EDGE_WAF_MODE"];
}): EdgeSecurityPostureCheck[] {
  const checks: EdgeSecurityPostureCheck[] = [];
  checks.push(
    input.rateLimitDriver === "valkey"
      ? pass(
          "request_rate_limit",
          "Distributed HTTP rate limiting is configured.",
          {
            distributed: true,
            driver: input.rateLimitDriver,
          },
        )
      : warn(
          "request_rate_limit",
          "HTTP rate limiting is not using distributed counters.",
          {
            distributed: false,
            driver: input.rateLimitDriver,
            required:
              "HTTP_RATE_LIMIT_DRIVER=valkey for multi-replica production",
          },
        ),
  );
  checks.push(
    pass("request_body_limit", "API request body limits are configured.", {
      requestBodyMaxBytes: input.requestBodyMaxBytes,
    }),
  );
  checks.push(
    input.fileInlineEncodedMaxBytes <= input.requestBodyMaxBytes
      ? pass(
          "file_size_limits",
          "File and attachment size limits are configured.",
          {
            directUploadMaxBytes: input.fileDirectUploadMaxBytes,
            inlineMaxBytes: input.fileInlineMaxBytes,
            messageAttachmentMaxBytes: input.messageAttachmentMaxBytes,
            resumableUploadMaxBytes: input.fileResumableUploadMaxBytes,
          },
        )
      : warn(
          "file_size_limits",
          "Inline file limit can exceed the configured API request-body envelope.",
          {
            inlineEncodedMaxBytes: input.fileInlineEncodedMaxBytes,
            inlineMaxBytes: input.fileInlineMaxBytes,
            messageAttachmentMaxBytes: input.messageAttachmentMaxBytes,
            resumableUploadMaxBytes: input.fileResumableUploadMaxBytes,
            requestBodyMaxBytes: input.requestBodyMaxBytes,
            required:
              "REQUEST_BODY_MAX_BYTES must cover base64 inline upload overhead",
          },
        ),
  );
  checks.push(
    input.appOriginHttps || input.localhost
      ? pass("app_origin_tls", "APP_ORIGIN uses an HTTPS or local origin.", {
          appOriginHttps: input.appOriginHttps,
          localhost: input.localhost,
        })
      : warn("app_origin_tls", "APP_ORIGIN is not HTTPS.", {
          appOriginHttps: input.appOriginHttps,
          localhost: input.localhost,
          required: "APP_ORIGIN=https://...",
        }),
  );
  checks.push(
    input.hstsEnabled && input.hstsMaxAgeSeconds > 0
      ? pass("hsts", "HSTS response headers are enabled.", {
          hstsMaxAgeSeconds: input.hstsMaxAgeSeconds,
        })
      : warn("hsts", "HSTS response headers are not enabled.", {
          hstsEnabled: input.hstsEnabled,
          hstsMaxAgeSeconds: input.hstsMaxAgeSeconds,
          required: "EDGE_HSTS_ENABLED=true and EDGE_HSTS_MAX_AGE_SECONDS>0",
        }),
  );
  checks.push(
    input.tlsTermination === "app" || input.proxyMode === "trusted_proxy"
      ? pass(
          "trusted_proxy",
          "Trusted proxy posture matches TLS termination.",
          {
            proxyMode: input.proxyMode,
            tlsTermination: input.tlsTermination,
          },
        )
      : warn(
          "trusted_proxy",
          "Ingress or external load-balancer TLS termination should trust forwarded headers only from the configured proxy layer.",
          {
            proxyMode: input.proxyMode,
            tlsTermination: input.tlsTermination,
            required: "EDGE_TRUSTED_PROXY_MODE=trusted_proxy",
          },
        ),
  );
  checks.push(
    input.wafMode === "block"
      ? pass("waf", "Ingress WAF policy is configured for blocking mode.", {
          wafMode: input.wafMode,
        })
      : warn("waf", "Ingress WAF policy is not in blocking mode.", {
          wafMode: input.wafMode,
          required: "EDGE_WAF_MODE=block after monitor-mode burn-in",
        }),
  );
  checks.push(
    input.allowedOriginRuleCount > 0
      ? pass("allowed_origins", "Allowed browser origins are explicitly set.", {
          allowedOriginRuleCount: input.allowedOriginRuleCount,
        })
      : warn("allowed_origins", "Allowed browser origins are not explicit.", {
          allowedOriginRuleCount: input.allowedOriginRuleCount,
          required: "EDGE_ALLOWED_ORIGINS=https://app.example.com",
        }),
  );
  return checks;
}

function pass(
  id: string,
  message: string,
  details: EdgeSecurityPostureCheck["details"],
): EdgeSecurityPostureCheck {
  return { id, status: "pass", severity: "info", message, details };
}

function warn(
  id: string,
  message: string,
  details: EdgeSecurityPostureCheck["details"],
): EdgeSecurityPostureCheck {
  return { id, status: "warn", severity: "warning", message, details };
}

function csvCount(value: string): number {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function base64LengthLimitFor(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 1024;
}
