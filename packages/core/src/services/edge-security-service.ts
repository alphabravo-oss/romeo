import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import {
  base64LengthLimitFor,
  csvCount,
  edgeSecurityChecks,
  isLocalhost,
} from "./edge-security-checks";
import {
  liveEdgeEvidenceCheck,
  readLiveEdgeEvidence,
} from "./edge-security-live-evidence";
import type { EdgeSecurityPostureReport } from "./edge-security-types";

export * from "./edge-security-types";

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
