// Mirrors packages/core/src/domain/abuse-controls.ts (report + update request) and
// packages/core/src/services/edge-security-service.ts (posture report).

export type BillingStatus = 'active' | 'canceled' | 'past_due' | 'trialing'

export type AbuseControlAction =
  | 'connector.sync'
  | 'file.upload'
  | 'knowledge.ingest'
  | 'run.start'
  | 'tool.dispatch'
  | 'tool.execute'
  | 'worker.enqueue'

export type AbuseControlBlockReason =
  | 'billing_plan_missing'
  | 'billing_status_blocked'
  | 'connector_kill_switch'
  | 'org_suspended'
  | 'provider_kill_switch'
  | 'tool_kill_switch'
  | 'worker_class_kill_switch'

export interface AbuseControlEntitlements {
  enforceBillingStatus: boolean
  denyWhenBillingPlanMissing: boolean
  allowedBillingStatuses: BillingStatus[]
}

export interface AbuseControlKillSwitches {
  connectorIds: string[]
  providerIds: string[]
  toolIds: string[]
  workerClasses: string[]
}

export interface AbuseControlSuspension {
  suspended: boolean
  reasonCode?: string
  suspendedAt?: string
  suspendedBy?: string
}

export interface AbuseControlPolicyReport {
  orgId: string
  source: 'default' | 'org'
  generatedAt: string
  suspension: AbuseControlSuspension
  entitlements: AbuseControlEntitlements
  killSwitches: AbuseControlKillSwitches
  enforcement: {
    billingPlanConfigured: boolean
    billingPlanCode?: string
    billingStatus?: BillingStatus
    costWorkBlocked: boolean
    defaultBlockReasons: AbuseControlBlockReason[]
    activeKillSwitchCount: number
  }
  updatedAt?: string
  updatedBy?: string
}

// PATCH body — every field optional; `reasonCode: null` clears the code.
export interface UpdateAbuseControlPolicyRequest {
  suspension?: {
    suspended?: boolean
    reasonCode?: string | null
  }
  entitlements?: {
    enforceBillingStatus?: boolean
    denyWhenBillingPlanMissing?: boolean
    allowedBillingStatuses?: BillingStatus[]
  }
  killSwitches?: {
    connectorIds?: string[]
    providerIds?: string[]
    toolIds?: string[]
    workerClasses?: string[]
  }
}

// --- Edge security posture -------------------------------------------------

export type EdgeTlsTermination = 'app' | 'ingress' | 'external_lb'
export type EdgeTrustedProxyMode = 'direct' | 'trusted_proxy'
export type EdgeWafMode = 'disabled' | 'monitor' | 'block'
export type HttpRateLimitDriver = 'disabled' | 'memory' | 'valkey'

export interface EdgeSecurityPostureCheck {
  id: string
  status: 'pass' | 'warn'
  severity: 'info' | 'warning'
  message: string
  details: Record<string, boolean | number | string>
}

export interface EdgeSecurityPostureReport {
  status: 'attention_required' | 'ready'
  generatedAt: string
  orgId: string
  appOrigin: {
    configured: boolean
    localhost: boolean
    scheme: 'http' | 'https'
  }
  tls: {
    appOriginHttps: boolean
    hstsEnabled: boolean
    hstsIncludeSubdomains: boolean
    hstsMaxAgeSeconds: number
    hstsPreload: boolean
    termination: EdgeTlsTermination
  }
  proxy: {
    mode: EdgeTrustedProxyMode
    forwardedHeadersTrusted: boolean
  }
  ingress: {
    allowedOriginRuleCount: number
    wafMode: EdgeWafMode
  }
  limits: {
    files: {
      directUploadMaxBytes: number
      inlineMaxBytes: number
      messageAttachmentMaxBytes: number
      resumableUploadMaxBytes: number
    }
    rateLimit: {
      authenticatedMax: number
      authMax: number
      distributed: boolean
      driver: HttpRateLimitDriver
      publicMax: number
      webhookMax: number
      windowSeconds: number
    }
    requestBodyMaxBytes: number
  }
  headers: {
    contentTypeOptions: 'nosniff'
    crossOriginOpenerPolicy: 'same-origin'
    frameOptions: 'DENY'
    permissionsPolicy: 'camera=(), microphone=(), geolocation=()'
    referrerPolicy: 'no-referrer'
    strictTransportSecurity: boolean
  }
  checks: EdgeSecurityPostureCheck[]
  redaction: {
    rawAllowedOriginsReturned: false
    rawAppOriginReturned: false
    rawIngressAnnotationsReturned: false
    rawProxyIpRangesReturned: false
    rawSecretsReturned: false
  }
}
