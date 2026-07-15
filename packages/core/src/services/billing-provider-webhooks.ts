import { createHmac, timingSafeEqual } from 'node:crypto'

import { ApiError } from '../errors'
import type { ExternalBillingEventInput } from './billing-service'

export interface StripeBillingWebhookInput {
  payload: string
  signatureHeader: string | undefined
  secret: string
  toleranceSeconds: number
  now?: Date
}

export interface GenericBillingWebhookInput {
  payload: string
  signatureHeader: string | undefined
  timestampHeader: string | undefined
  secret: string
  toleranceSeconds: number
  now?: Date
}

export function stripeBillingWebhookEvent(input: StripeBillingWebhookInput): ExternalBillingEventInput {
  verifyStripeSignature(input)
  return stripePayloadToBillingEvent(input.payload)
}

export function genericBillingWebhookEvent(input: GenericBillingWebhookInput): ExternalBillingEventInput {
  verifyGenericSignature(input)
  return genericPayloadToBillingEvent(input.payload)
}

function verifyGenericSignature(input: GenericBillingWebhookInput): void {
  if (input.secret.trim().length === 0) throw new ApiError('billing_webhook_not_configured', 'Generic billing webhooks are not configured.', 503)
  const timestamp = Number(input.timestampHeader)
  const signature = parseGenericSignature(input.signatureHeader)
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (!Number.isInteger(timestamp) || timestamp <= 0 || Math.abs(nowSeconds - timestamp) > input.toleranceSeconds) {
    throw new ApiError('billing_webhook_signature_invalid', 'The billing webhook signature timestamp is invalid.', 401)
  }
  const expected = createHmac('sha256', input.secret).update(`${timestamp}.${input.payload}`).digest('hex')
  if (!constantTimeHexEqual(expected, signature)) {
    throw new ApiError('billing_webhook_signature_invalid', 'The billing webhook signature is invalid.', 401)
  }
}

function parseGenericSignature(header: string | undefined): string {
  if (header === undefined || header.trim().length === 0) {
    throw new ApiError('billing_webhook_signature_missing', 'The billing webhook signature header is required.', 401)
  }
  const value = header.trim().startsWith('v1=') ? header.trim().slice('v1='.length) : header.trim()
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new ApiError('billing_webhook_signature_invalid', 'The billing webhook signature header is invalid.', 401)
  return value
}

function verifyStripeSignature(input: StripeBillingWebhookInput): void {
  if (input.secret.trim().length === 0) throw new ApiError('billing_webhook_not_configured', 'Stripe billing webhooks are not configured.', 503)
  const signature = parseStripeSignature(input.signatureHeader)
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (Math.abs(nowSeconds - signature.timestamp) > input.toleranceSeconds) {
    throw new ApiError('billing_webhook_signature_invalid', 'The billing webhook signature timestamp is outside the allowed window.', 401)
  }
  const expected = createHmac('sha256', input.secret).update(`${signature.timestamp}.${input.payload}`).digest('hex')
  if (!constantTimeHexEqual(expected, signature.v1)) {
    throw new ApiError('billing_webhook_signature_invalid', 'The billing webhook signature is invalid.', 401)
  }
}

function parseStripeSignature(header: string | undefined): { timestamp: number; v1: string } {
  if (header === undefined || header.trim().length === 0) {
    throw new ApiError('billing_webhook_signature_missing', 'The Stripe-Signature header is required.', 401)
  }
  const entries = header.split(',').map((part) => part.trim().split('='))
  const timestamp = Number(entries.find(([key]) => key === 't')?.[1])
  const v1 = entries.find(([key]) => key === 'v1')?.[1] ?? ''
  if (!Number.isInteger(timestamp) || timestamp <= 0 || !/^[a-f0-9]{64}$/i.test(v1)) {
    throw new ApiError('billing_webhook_signature_invalid', 'The Stripe-Signature header is invalid.', 401)
  }
  return { timestamp, v1 }
}

function constantTimeHexEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex')
  const actualBuffer = Buffer.from(actual, 'hex')
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

function stripePayloadToBillingEvent(payload: string): ExternalBillingEventInput {
  const event = parseJsonRecord(payload, 'Stripe billing webhook payload must be valid JSON.')
  const type = stringValue(event.type)
  const object = parseJsonRecord(parseJsonRecord(event.data, 'Stripe billing webhook data is invalid.').object, 'Stripe billing webhook object is invalid.')
  const metadata = jsonRecord(object.metadata)
  const eventType = stripeEventType(type)
  return {
    provider: 'stripe',
    eventType,
    externalCustomerId: stripeCustomerId(eventType, object),
    externalSubscriptionId: stripeSubscriptionId(eventType, object),
    externalInvoiceId: eventType.startsWith('invoice.') ? stringValue(object.id) : undefined,
    invoiceStatus: eventType.startsWith('invoice.') ? boundedString(object.status, 80) : undefined,
    amountCents: eventType.startsWith('invoice.') ? invoiceAmountCents(object) : undefined,
    currency: uppercaseCurrency(object.currency),
    occurredAt: stripeOccurredAt(event.created),
    planCode: boundedString(metadata.romeo_plan_code, 120),
    planName: boundedString(metadata.romeo_plan_name, 200),
    status: subscriptionStatus(eventType, object),
    lifecycle: stripeLifecycle(object),
    metadata: {
      stripeEventType: type,
      stripeObjectType: stringValue(object.object) ?? 'unknown',
      stripeMetadataKeyCount: Object.keys(metadata).length
    }
  }
}

function genericPayloadToBillingEvent(payload: string): ExternalBillingEventInput {
  const event = parseJsonRecord(payload, 'Generic billing webhook payload must be valid JSON.')
  const provider = boundedString(event.provider, 80)
  const eventType = genericEventType(event.eventType)
  if (provider === undefined) throw new ApiError('billing_webhook_payload_invalid', 'Generic billing webhook provider is required.', 400)
  return {
    provider,
    eventType,
    externalCustomerId: boundedString(event.externalCustomerId, 200),
    externalSubscriptionId: boundedString(event.externalSubscriptionId, 200),
    externalInvoiceId: boundedString(event.externalInvoiceId, 200),
    invoiceStatus: boundedString(event.invoiceStatus, 80),
    amountCents: nonNegativeInteger(event.amountCents),
    currency: uppercaseCurrency(event.currency),
    occurredAt: isoTimestamp(event.occurredAt),
    planCode: boundedString(event.planCode, 120),
    planName: boundedString(event.planName, 200),
    status: billingStatus(event.status),
    quotaTemplates: quotaTemplates(event.quotaTemplates),
    lifecycle: billingLifecycle(event.lifecycle),
    metadata: jsonRecord(event.metadata)
  }
}

function genericEventType(value: unknown): ExternalBillingEventInput['eventType'] {
  if (
    value === 'customer.updated' ||
    value === 'invoice.paid' ||
    value === 'invoice.payment_failed' ||
    value === 'subscription.canceled' ||
    value === 'subscription.created' ||
    value === 'subscription.updated'
  ) {
    return value
  }
  throw new ApiError('billing_webhook_event_unsupported', 'The billing webhook event type is not supported.', 400)
}

function parseJsonRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (isRecord(parsed)) return parsed
    } catch {
      throw new ApiError('billing_webhook_payload_invalid', message, 400)
    }
  }
  if (isRecord(value)) return value
  throw new ApiError('billing_webhook_payload_invalid', message, 400)
}

function stripeEventType(type: string | undefined): ExternalBillingEventInput['eventType'] {
  if (type === 'customer.updated') return 'customer.updated'
  if (type === 'invoice.paid') return 'invoice.paid'
  if (type === 'invoice.payment_failed') return 'invoice.payment_failed'
  if (type === 'customer.subscription.created') return 'subscription.created'
  if (type === 'customer.subscription.updated') return 'subscription.updated'
  if (type === 'customer.subscription.deleted') return 'subscription.canceled'
  throw new ApiError('billing_webhook_event_unsupported', 'The Stripe billing webhook event type is not supported.', 400)
}

function stripeCustomerId(eventType: ExternalBillingEventInput['eventType'], object: Record<string, unknown>): string | undefined {
  if (eventType === 'customer.updated') return stringValue(object.id)
  return stringValue(object.customer)
}

function stripeSubscriptionId(eventType: ExternalBillingEventInput['eventType'], object: Record<string, unknown>): string | undefined {
  if (eventType.startsWith('subscription.')) return stringValue(object.id)
  return stringValue(object.subscription)
}

function subscriptionStatus(eventType: ExternalBillingEventInput['eventType'], object: Record<string, unknown>): ExternalBillingEventInput['status'] | undefined {
  if (eventType === 'subscription.canceled') return 'canceled'
  if (eventType === 'subscription.created' || eventType === 'subscription.updated') {
    const status = stringValue(object.status)
    if (status === 'trialing') return 'trialing'
    if (status === 'past_due' || status === 'unpaid') return 'past_due'
    if (status === 'canceled' || status === 'incomplete_expired') return 'canceled'
    if (status !== undefined) return 'active'
  }
  return undefined
}

function invoiceAmountCents(object: Record<string, unknown>): number | undefined {
  return numberValue(object.amount_paid) ?? numberValue(object.amount_due) ?? numberValue(object.total)
}

function stripeOccurredAt(created: unknown): string | undefined {
  const seconds = numberValue(created)
  if (seconds === undefined) return undefined
  return new Date(seconds * 1000).toISOString()
}

function stripeLifecycle(object: Record<string, unknown>): ExternalBillingEventInput['lifecycle'] | undefined {
  return compactLifecycle({
    cancelAt: unixSecondsToIso(object.cancel_at),
    canceledAt: unixSecondsToIso(object.canceled_at),
    currentPeriodEndsAt: unixSecondsToIso(object.current_period_end),
    trialEndsAt: unixSecondsToIso(object.trial_end)
  })
}

function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = numberValue(value)
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString()
}

function uppercaseCurrency(value: unknown): string | undefined {
  const currency = stringValue(value)?.toUpperCase()
  return currency !== undefined && /^[A-Z]{3}$/.test(currency) ? currency : undefined
}

function boundedString(value: unknown, max: number): string | undefined {
  const text = stringValue(value)?.trim()
  if (text === undefined || text.length === 0 || text.length > max) return undefined
  return text
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return undefined
  return new Date(time).toISOString()
}

function billingStatus(value: unknown): ExternalBillingEventInput['status'] | undefined {
  if (value === 'active' || value === 'canceled' || value === 'past_due' || value === 'trialing') return value
  return undefined
}

function billingLifecycle(value: unknown): ExternalBillingEventInput['lifecycle'] | undefined {
  if (!isRecord(value)) return undefined
  return compactLifecycle({
    cancelAt: isoTimestamp(value.cancelAt),
    canceledAt: isoTimestamp(value.canceledAt),
    currentPeriodEndsAt: isoTimestamp(value.currentPeriodEndsAt),
    pastDueGraceEndsAt: isoTimestamp(value.pastDueGraceEndsAt),
    trialEndsAt: isoTimestamp(value.trialEndsAt)
  })
}

function compactLifecycle(value: NonNullable<ExternalBillingEventInput['lifecycle']>): ExternalBillingEventInput['lifecycle'] | undefined {
  const output = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
  return Object.keys(output).length === 0 ? undefined : output
}

function quotaTemplates(value: unknown): ExternalBillingEventInput['quotaTemplates'] | undefined {
  if (!Array.isArray(value)) return undefined
  const templates = value
    .slice(0, 25)
    .map((item) => (isRecord(item) ? quotaTemplate(item) : undefined))
    .filter((item): item is NonNullable<ExternalBillingEventInput['quotaTemplates']>[number] => item !== undefined)
  return templates.length === 0 ? undefined : templates
}

function quotaTemplate(value: Record<string, unknown>): NonNullable<ExternalBillingEventInput['quotaTemplates']>[number] | undefined {
  const metric = value.metric
  const resetInterval = value.resetInterval ?? 'monthly'
  const limit = value.limit
  if (metric !== 'run.started' && metric !== 'tool.call' && metric !== 'storage.byte') return undefined
  if (resetInterval !== 'none' && resetInterval !== 'daily' && resetInterval !== 'monthly') return undefined
  if (!Number.isInteger(limit) || Number(limit) < 0) return undefined
  return { metric, limit: Number(limit), resetInterval }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
