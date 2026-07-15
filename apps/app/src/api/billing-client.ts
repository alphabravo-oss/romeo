import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  ApplyBillingPlanInput,
  BillingEntitlementReconciliationResult,
  BillingEntitlementReport,
  BillingLifecycleEnforcementResult,
  BillingLifecycleReport,
  BillingPlan,
  BillingPlanApplyResult,
  SyncExternalBillingEventInput
} from './billing-types'

export async function getBillingPlan(): Promise<BillingPlan | null> {
  const response = await apiJson<Envelope<BillingPlan | null>>('/api/v1/billing/plan')
  return response.data
}

export async function applyBillingPlan(input: ApplyBillingPlanInput): Promise<BillingPlanApplyResult> {
  const response = await apiJson<Envelope<BillingPlanApplyResult>>('/api/v1/billing/plan', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function syncExternalBillingEvent(
  input: SyncExternalBillingEventInput
): Promise<BillingPlanApplyResult> {
  const response = await apiJson<Envelope<BillingPlanApplyResult>>('/api/v1/billing/external-events', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function getBillingEntitlements(): Promise<BillingEntitlementReport> {
  const response = await apiJson<Envelope<BillingEntitlementReport>>('/api/v1/billing/entitlements')
  return response.data
}

export async function reconcileBillingEntitlements(): Promise<BillingEntitlementReconciliationResult> {
  const response = await apiJson<Envelope<BillingEntitlementReconciliationResult>>(
    '/api/v1/billing/entitlements/reconcile',
    { method: 'POST' }
  )
  return response.data
}

export async function getBillingLifecycle(): Promise<BillingLifecycleReport> {
  const response = await apiJson<Envelope<BillingLifecycleReport>>('/api/v1/billing/lifecycle')
  return response.data
}

export async function enforceBillingLifecycle(): Promise<BillingLifecycleEnforcementResult> {
  const response = await apiJson<Envelope<BillingLifecycleEnforcementResult>>(
    '/api/v1/billing/lifecycle/enforce',
    { method: 'POST' }
  )
  return response.data
}
