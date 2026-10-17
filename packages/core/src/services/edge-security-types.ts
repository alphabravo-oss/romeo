import type { RomeoEnv } from "@romeo/config";

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
    desiredWafMode: RomeoEnv["EDGE_WAF_MODE"];
    /** @deprecated Use desiredWafMode. */
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
  checks: EdgeSecurityPostureCheck[];
  redaction: {
    rawAllowedOriginsReturned: false;
    rawAppOriginReturned: false;
    rawIngressAnnotationsReturned: false;
    rawProxyIpRangesReturned: false;
    rawSecretsReturned: false;
  };
}
