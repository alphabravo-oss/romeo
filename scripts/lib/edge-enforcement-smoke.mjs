import { createHash, randomBytes } from "node:crypto";

export const requiredSecurityHeaders = [
  {
    name: "x-content-type-options",
    expectedValue: "nosniff",
  },
  {
    name: "x-frame-options",
    expectedValue: "DENY",
  },
  {
    name: "referrer-policy",
    expectedValue: "no-referrer",
  },
  {
    name: "cross-origin-opener-policy",
    expectedValue: "same-origin",
  },
  {
    name: "permissions-policy",
  },
];

export async function collectEdgeEnforcementEvidence(config) {
  if (config.baseUrl === undefined || config.baseUrl.length === 0) {
    throw new Error("--base-url or ROMEO_BASE_URL is required.");
  }

  const checks = [];
  const headerEvidence = await securityHeaderEvidence(config);
  checks.push("security_headers_present");
  if (config.requireHsts) checks.push("hsts_header_present");

  const postureEvidence =
    config.requireAdminPosture || config.apiKey !== undefined
      ? await adminPostureEvidence(config)
      : { checked: false };
  if (postureEvidence.checked) checks.push("admin_edge_posture_readback");

  const wafEvidence = await wafProbeEvidence(config);
  checks.push("waf_or_gateway_probe_blocked");

  const bodyLimitEvidence = await bodyLimitEvidenceFor(config);
  checks.push("oversized_request_rejected");

  const rateLimitEvidence = await rateLimitEvidenceFor(config);
  checks.push("public_rate_limit_enforced");
  checks.push("raw_probe_payload_not_retained");

  return {
    schemaVersion: "romeo.live-edge-enforcement.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    mode: "live",
    target: {
      deployment: "edge",
      origin: safeOrigin(config.baseUrl),
    },
    checks,
    securityHeaders: headerEvidence,
    adminPosture: postureEvidence,
    waf: wafEvidence,
    requestBodyLimit: bodyLimitEvidence,
    rateLimit: rateLimitEvidence,
    redaction: {
      rawApiKeyReturned: false,
      rawHeaderValuesReturned: false,
      rawProbePayloadReturned: false,
      rawQueryValuesReturned: false,
      rawRequestBodiesReturned: false,
      rawResponseBodiesReturned: false,
    },
  };
}

export function plannedEdgeEnforcementEvidence(config) {
  return {
    schemaVersion: "romeo.live-edge-enforcement.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    mode: "dry-run",
    target: {
      deployment: "edge",
      origin:
        config.baseUrl === undefined || config.baseUrl.length === 0
          ? undefined
          : safeOrigin(config.baseUrl),
    },
    checks: [
      "base_url_required_for_live_mode",
      "security_headers_present",
      "waf_or_gateway_probe_blocked",
      "oversized_request_rejected",
      "public_rate_limit_enforced",
      "raw_probe_payload_not_retained",
    ],
    requiredSecurityHeaders: requiredSecurityHeaders.map((header) => ({
      name: header.name,
      exactValueRequired: header.expectedValue !== undefined,
    })),
    plannedProbes: {
      headerPath: pathShape(config.headerPath),
      wafPath: pathShape(config.wafProbePath),
      bodyLimitPath: pathShape(config.bodyLimitPath),
      rateLimitPath: pathShape(config.rateLimitPath),
      bodyLimitBytes: config.bodyLimitBytes,
      rateLimitAttempts: config.rateLimitAttempts,
      expectedBodyLimitStatuses: config.bodyLimitExpectedStatuses,
      expectedRateLimitStatus: config.rateLimitExpectedStatus,
      expectedWafStatuses: config.wafExpectedStatuses,
    },
    notes: [
      "Dry-run output is planning evidence only and cannot satisfy the live edge enforcement GA gate.",
      "Live mode stores status codes, header names, path shapes, and hashes only; it does not retain raw probe payloads, header values, response bodies, API keys, or query values.",
    ],
  };
}

export function parseStatusList(raw, fallback) {
  if (raw === undefined || raw.length === 0) return fallback;
  const values = raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value));
  if (values.length === 0) {
    throw new Error("Expected status list must contain at least one integer.");
  }
  return values;
}

export function positiveInteger(raw, fallback, label) {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export function safeOrigin(value) {
  return new URL(value).origin;
}

export function redactOutput(value, secrets) {
  let redacted = value;
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted
    .replaceAll(/Bearer\s+\S+/gu, "Bearer [redacted]")
    .replaceAll(/romeo_edge_probe=[^&\s"]+/gu, "romeo_edge_probe=[redacted]");
}

async function securityHeaderEvidence(config) {
  const response = await request(config, config.headerPath, {
    method: "GET",
    expectedStatuses: [200],
  });
  const matched = [];
  const missing = [];
  for (const header of requiredSecurityHeaders) {
    const actual = response.headerValues.get(header.name);
    if (
      actual !== undefined &&
      (header.expectedValue === undefined ||
        actual.toLowerCase() === header.expectedValue.toLowerCase())
    ) {
      matched.push(header.name);
    } else {
      missing.push(header.name);
    }
  }
  if (config.requireHsts) {
    const hsts = response.headerValues.get("strict-transport-security");
    if (hsts !== undefined && hsts.length > 0) {
      matched.push("strict-transport-security");
    } else {
      missing.push("strict-transport-security");
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Security headers missing or mismatched: ${missing.join(", ")}`,
    );
  }
  return {
    status: "passed",
    path: pathShape(config.headerPath),
    httpStatus: response.status,
    matched,
    missing,
    headerValuesReturned: false,
  };
}

async function adminPostureEvidence(config) {
  if (config.apiKey === undefined || config.apiKey.length === 0) {
    if (config.requireAdminPosture) {
      throw new Error(
        "--api-key or ROMEO_API_KEY is required with --require-admin-posture.",
      );
    }
    return { checked: false };
  }
  const response = await request(
    config,
    "/api/v1/admin/edge-security/posture",
    {
      method: "GET",
      token: config.apiKey,
      expectedStatuses: [200],
      acceptJson: true,
    },
  );
  const body = response.json;
  const redaction = body?.redaction ?? {};
  const requiredRedactionFlags = [
    "rawAllowedOriginsReturned",
    "rawAppOriginReturned",
    "rawIngressAnnotationsReturned",
    "rawProxyIpRangesReturned",
    "rawSecretsReturned",
  ];
  const failingRedaction = requiredRedactionFlags.filter(
    (field) => redaction[field] !== false,
  );
  if (failingRedaction.length > 0) {
    throw new Error(
      `Admin edge posture redaction flags failed: ${failingRedaction.join(", ")}`,
    );
  }
  if (config.requireWafBlockMode && body?.ingress?.wafMode !== "block") {
    throw new Error("Admin edge posture does not report WAF block mode.");
  }
  return {
    checked: true,
    status: "passed",
    reportStatus: body?.status,
    wafMode: body?.ingress?.wafMode,
    rateLimitDriver: body?.limits?.rateLimit?.driver,
    distributedRateLimit: body?.limits?.rateLimit?.distributed === true,
    warningCount: Array.isArray(body?.checks)
      ? body.checks.filter((check) => check.status === "warn").length
      : undefined,
    redaction: Object.fromEntries(
      requiredRedactionFlags.map((field) => [
        field,
        redaction[field] === false,
      ]),
    ),
  };
}

async function wafProbeEvidence(config) {
  const response = await request(config, config.wafProbePath, {
    method: "GET",
    expectedStatuses: config.wafExpectedStatuses,
    extraHeaders:
      config.wafProbeHeaderName === undefined
        ? undefined
        : { [config.wafProbeHeaderName]: config.wafProbeHeaderValue },
  });
  const requiredHeader =
    config.wafExpectedHeader === undefined
      ? undefined
      : config.wafExpectedHeader.toLowerCase();
  const requiredHeaderPresent =
    requiredHeader === undefined
      ? undefined
      : response.headerNames.includes(requiredHeader);
  if (requiredHeaderPresent === false) {
    throw new Error(
      `Expected WAF block header was not present: ${requiredHeader}`,
    );
  }
  return {
    status: "passed",
    method: "GET",
    path: pathShape(config.wafProbePath),
    pathSha256: sha256String(config.wafProbePath),
    httpStatus: response.status,
    expectedStatuses: config.wafExpectedStatuses,
    expectedHeaderPresent: requiredHeaderPresent,
    responseBodyReturned: false,
  };
}

async function bodyLimitEvidenceFor(config) {
  const body = makeBody(config.bodyLimitBytes);
  const response = await request(config, config.bodyLimitPath, {
    method: "POST",
    expectedStatuses: config.bodyLimitExpectedStatuses,
    body,
    extraHeaders: {
      "content-type": "application/json",
    },
  });
  return {
    status: "passed",
    method: "POST",
    path: pathShape(config.bodyLimitPath),
    bytesSent: Buffer.byteLength(body),
    httpStatus: response.status,
    expectedStatuses: config.bodyLimitExpectedStatuses,
    requestBodyReturned: false,
    responseBodyReturned: false,
  };
}

async function rateLimitEvidenceFor(config) {
  const statuses = [];
  let blockedAt;
  for (let attempt = 1; attempt <= config.rateLimitAttempts; attempt += 1) {
    const response = await request(config, config.rateLimitPath, {
      method: "GET",
    });
    statuses.push(response.status);
    if (response.status === config.rateLimitExpectedStatus) {
      blockedAt = attempt;
      break;
    }
  }
  if (blockedAt === undefined) {
    throw new Error(
      `Rate limit did not return expected HTTP ${config.rateLimitExpectedStatus}.`,
    );
  }
  return {
    status: "passed",
    method: "GET",
    path: pathShape(config.rateLimitPath),
    attempts: statuses.length,
    blockedAt,
    expectedStatus: config.rateLimitExpectedStatus,
    statuses,
    responseBodyReturned: false,
  };
}

async function request(config, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(
      new URL(path, normalizedBaseUrl(config.baseUrl)),
      {
        method: options.method ?? "GET",
        headers: requestHeaders(options),
        body: options.body,
        signal: controller.signal,
      },
    );
    const text = await response.text();
    const json =
      options.acceptJson && text.length > 0 ? JSON.parse(text) : undefined;
    const acceptedStatuses =
      options.expectedStatuses ?? options.allowedFailureStatuses;
    if (
      acceptedStatuses !== undefined &&
      !acceptedStatuses.includes(response.status)
    ) {
      throw new Error(
        `Expected HTTP ${acceptedStatuses.join(",")} but received ${response.status}.`,
      );
    }
    return {
      status: response.status,
      headerNames: [...response.headers.keys()].map((name) =>
        name.toLowerCase(),
      ),
      headerValues: lowercaseHeaderValues(response.headers),
      json,
      bodyBytes: Buffer.byteLength(text),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function requestHeaders(options) {
  const headers = {
    accept: options.acceptJson ? "application/json" : "*/*",
    ...(options.extraHeaders ?? {}),
  };
  if (options.token !== undefined && options.token.length > 0) {
    headers.authorization = `Bearer ${options.token}`;
  }
  return headers;
}

function lowercaseHeaderValues(headers) {
  const values = new Map();
  for (const [name, value] of headers.entries()) {
    values.set(name.toLowerCase(), value);
  }
  return values;
}

function normalizedBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function pathShape(value) {
  const url = new URL(value, "https://romeo.invalid");
  return {
    pathname: url.pathname,
    queryParameterCount: [...url.searchParams.keys()].length,
  };
}

function makeBody(bytes) {
  const sentinel = `romeo-edge-body-${randomBytes(16).toString("hex")}`;
  const overhead = JSON.stringify({ probe: "" }).length;
  const payloadSize = Math.max(1, bytes - overhead);
  return JSON.stringify({ probe: `${sentinel}:${"x".repeat(payloadSize)}` });
}

function sha256String(value) {
  return createHash("sha256").update(value).digest("hex");
}
