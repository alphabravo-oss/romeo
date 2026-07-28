import type { RomeoEnv } from "@romeo/config";

export const liveEdgeEvidenceSchema = "romeo.live-edge-enforcement.v1";
export const requiredLiveEdgeChecks = [
  "security_headers_present",
  "waf_or_gateway_probe_blocked",
  "oversized_request_rejected",
  "public_rate_limit_enforced",
  "raw_probe_payload_not_retained",
] as const;
export const requiredEdgeHeaders = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "cross-origin-opener-policy",
  "permissions-policy",
] as const;

export type LiveEdgeInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

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
