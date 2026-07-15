import { errorResponse, jsonContent, success } from './helpers'

export const billingPaths = {
  '/billing/plan': {
    get: {
      summary: 'Get the current organization billing plan',
      responses: { 200: success('Billing plan'), 403: errorResponse }
    },
    post: {
      summary: 'Apply a billing plan and org quota templates',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/ApplyBillingPlanRequest' }) },
      responses: { 200: success('Billing plan apply result'), 400: errorResponse, 403: errorResponse }
    }
  },
  '/billing/external-events': {
    post: {
      summary: 'Sync a sanitized external billing lifecycle event',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/SyncExternalBillingEventRequest' }) },
      responses: { 200: success('Billing plan apply result'), 400: errorResponse, 403: errorResponse }
    }
  },
  '/billing/entitlements': {
    get: {
      summary: 'Get billing entitlement and quota reconciliation status',
      responses: { 200: success('Billing entitlement report', { $ref: '#/components/schemas/BillingEntitlementReport' }), 403: errorResponse }
    }
  },
  '/billing/entitlements/reconcile': {
    post: {
      summary: 'Reconcile org quotas to the current billing entitlement templates',
      responses: { 200: success('Billing entitlement reconciliation result', { $ref: '#/components/schemas/BillingEntitlementReconciliationResult' }), 403: errorResponse }
    }
  },
  '/billing/lifecycle': {
    get: {
      summary: 'Get billing lifecycle deadline posture',
      responses: { 200: success('Billing lifecycle report', { $ref: '#/components/schemas/BillingLifecycleReport' }), 403: errorResponse }
    }
  },
  '/billing/lifecycle/enforce': {
    post: {
      summary: 'Enforce due billing lifecycle status transitions',
      responses: { 200: success('Billing lifecycle enforcement result', { $ref: '#/components/schemas/BillingLifecycleEnforcementResult' }), 403: errorResponse }
    }
  },
  '/billing/webhooks/stripe': {
    post: {
      summary: 'Receive a signed Stripe billing webhook',
      requestBody: { required: true, content: jsonContent({ description: 'Raw Stripe webhook event payload' }) },
      responses: { 200: success('Billing plan apply result'), 400: errorResponse, 401: errorResponse, 503: errorResponse }
    }
  },
  '/billing/webhooks/generic': {
    post: {
      summary: 'Receive a signed generic billing webhook',
      requestBody: { required: true, content: jsonContent({ description: 'Sanitized external billing lifecycle event payload' }) },
      responses: { 200: success('Billing plan apply result'), 400: errorResponse, 401: errorResponse, 503: errorResponse }
    }
  }
}
