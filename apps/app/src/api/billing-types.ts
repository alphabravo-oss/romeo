export type BillingPlanStatus = 'active' | 'canceled' | 'past_due' | 'trialing'
export type BillingPlanSource = 'external' | 'manual'
export type BillingQuotaMetric = 'run.started' | 'tool.call' | 'storage.byte'
export type BillingQuotaResetInterval = 'none' | 'daily' | 'monthly'

export type ExternalBillingEventType =
  | 'customer.updated'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'subscription.canceled'
  | 'subscription.created'
  | 'subscription.updated'

export interface BillingPlanQuotaTemplate {
  metric: BillingQuotaMetric
  limit: number
  resetInterval: BillingQuotaResetInterval
}

export interface BillingPlan {
  id: string
  orgId: string
  code: string
  name: string
  status: BillingPlanStatus
  source: BillingPlanSource
  quotaTemplates: BillingPlanQuotaTemplate[]
  metadata: Record<string, unknown>
  externalCustomerId?: string
  externalSubscriptionId?: string
  createdAt: string
  updatedAt: string
}

export interface BillingQuotaBucket {
  id: string
  orgId: string
  scopeType: string
  scopeId: string
  metric: BillingQuotaMetric
  limit: number
  used: number
  resetInterval: BillingQuotaResetInterval
  resetAt?: string
  createdAt: string
  updatedAt: string
}

/** Result of applying a plan or syncing an external billing event. */
export interface BillingPlanApplyResult {
  plan: BillingPlan
  quotas: BillingQuotaBucket[]
}

/** Body for POST /api/v1/billing/plan (applyBillingPlanSchema). */
export interface ApplyBillingPlanInput {
  code: string
  name: string
  status: BillingPlanStatus
  source: BillingPlanSource
  quotaTemplates: BillingPlanQuotaTemplate[]
  metadata?: Record<string, unknown>
  externalCustomerId?: string
  externalSubscriptionId?: string
}

/** Body for POST /api/v1/billing/external-events (syncExternalBillingEventSchema). */
export interface SyncExternalBillingEventInput {
  provider: string
  eventType: ExternalBillingEventType
  externalCustomerId?: string
  externalSubscriptionId?: string
  externalInvoiceId?: string
  invoiceStatus?: string
  amountCents?: number
  currency?: string
  occurredAt?: string
  planCode?: string
  planName?: string
  status?: BillingPlanStatus
  quotaTemplates?: BillingPlanQuotaTemplate[]
  metadata?: Record<string, unknown>
}

// --- Entitlements (GET /api/v1/billing/entitlements, POST .../reconcile) ---

export type BillingEntitlementQuotaStatus =
  | 'limit_and_reset_interval_mismatch'
  | 'limit_mismatch'
  | 'matched'
  | 'missing'
  | 'reset_interval_mismatch'

export type BillingEntitlementWarning =
  | 'billing_plan_missing'
  | 'billing_status_not_entitled'
  | 'quota_limit_mismatch'
  | 'quota_missing'
  | 'quota_reset_interval_mismatch'

/** A per-metric expected-vs-actual reconciliation row. */
export interface BillingEntitlementQuotaReport {
  metric: BillingQuotaMetric
  expectedLimit: number
  expectedResetInterval: BillingQuotaResetInterval
  status: BillingEntitlementQuotaStatus
  actualLimit?: number
  actualResetInterval?: BillingQuotaResetInterval
  actualUsed?: number
  quotaBucketId?: string
  resetAt?: string
}

/** GET /api/v1/billing/entitlements. */
export interface BillingEntitlementReport {
  orgId: string
  generatedAt: string
  status: 'attention_required' | 'healthy'
  billingPlanConfigured: boolean
  quotaTemplateCount: number
  unmanagedOrgQuotaCount: number
  warnings: BillingEntitlementWarning[]
  billingPlan?: {
    code: string
    name: string
    source: BillingPlanSource
    status: BillingPlanStatus
    externalCustomerConfigured: boolean
    externalSubscriptionConfigured: boolean
    updatedAt: string
  }
  quotas: BillingEntitlementQuotaReport[]
}

/** POST /api/v1/billing/entitlements/reconcile. */
export interface BillingEntitlementReconciliationResult {
  before: BillingEntitlementReport
  after: BillingEntitlementReport
  actions: {
    createdQuotaIds: string[]
    updatedQuotaIds: string[]
    unchangedQuotaIds: string[]
  }
}

// --- Lifecycle (GET /api/v1/billing/lifecycle, POST .../enforce) ---

export type BillingLifecycleWarning =
  | 'billing_plan_missing'
  | 'cancel_at_reached'
  | 'past_due_grace_expired'
  | 'subscription_period_expired'
  | 'trial_expired'

export type BillingLifecycleRecommendedAction = 'mark_canceled' | 'mark_past_due' | 'none'

export interface BillingLifecycleMetadata {
  cancelAt?: string
  canceledAt?: string
  currentPeriodEndsAt?: string
  pastDueGraceEndsAt?: string
  trialEndsAt?: string
}

/** GET /api/v1/billing/lifecycle. */
export interface BillingLifecycleReport {
  orgId: string
  generatedAt: string
  status: 'attention_required' | 'healthy'
  billingPlanConfigured: boolean
  warnings: BillingLifecycleWarning[]
  recommendedAction: BillingLifecycleRecommendedAction
  lifecycle: BillingLifecycleMetadata
  billingPlan?: {
    code: string
    externalCustomerConfigured: boolean
    externalSubscriptionConfigured: boolean
    name: string
    source: BillingPlanSource
    status: BillingPlanStatus
    updatedAt: string
  }
}

/** POST /api/v1/billing/lifecycle/enforce. */
export interface BillingLifecycleEnforcementResult {
  before: BillingLifecycleReport
  after: BillingLifecycleReport
  action: {
    type: BillingLifecycleRecommendedAction
    statusChanged: boolean
    previousStatus?: BillingPlanStatus
    newStatus?: BillingPlanStatus
  }
}
