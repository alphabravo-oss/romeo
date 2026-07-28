import type { RomeoEnv } from "@romeo/config";

import type {
  EdgeSecurityPostureCheck,
  EdgeSecurityPostureReport,
} from "./edge-security-types";

export function edgeSecurityChecks(input: {
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

export function pass(
  id: string,
  message: string,
  details: EdgeSecurityPostureCheck["details"],
): EdgeSecurityPostureCheck {
  return { id, status: "pass", severity: "info", message, details };
}

export function warn(
  id: string,
  message: string,
  details: EdgeSecurityPostureCheck["details"],
): EdgeSecurityPostureCheck {
  return { id, status: "warn", severity: "warning", message, details };
}

export function csvCount(value: string): number {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
}

export function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export function base64LengthLimitFor(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 1024;
}
