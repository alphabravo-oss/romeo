import { createRoute, z } from "@hono/zod-openapi";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { QuotaBucketSchema } from "./operational-governance";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
const count = z.number().int().nonnegative();
const status = z.enum(["active", "canceled", "past_due", "trialing"]);
const source = z.enum(["external", "manual"]);
const reset = z.enum(["none", "daily", "monthly"]);
const metric = z.enum([
  "image.cost.micro_usd",
  "image.generated",
  "web.search.request",
  "web.url.fetch",
  "run.started",
  "tool.call",
  "storage.byte",
]);
const lifecycle = z.strictObject({
  cancelAt: time.optional(),
  canceledAt: time.optional(),
  currentPeriodEndsAt: time.optional(),
  pastDueGraceEndsAt: time.optional(),
  trialEndsAt: time.optional(),
});
const quotaTemplate = z.strictObject({
  metric,
  limit: count,
  resetInterval: reset,
});
const quotaTemplateInput = z.strictObject({
  metric,
  limit: count,
  resetInterval: reset.default("monthly"),
});

export const BillingPlanSchema = z
  .strictObject({
    id,
    orgId: id,
    code: z.string(),
    name: z.string(),
    status,
    source,
    quotaTemplates: z.array(quotaTemplate),
    metadata: z.record(z.string(), z.unknown()),
    externalCustomerId: id.optional(),
    externalSubscriptionId: id.optional(),
    createdAt: time,
    updatedAt: time,
  })
  .openapi("BillingPlan");
export const ApplyBillingPlanSchema = z
  .strictObject({
    code: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    status: status.default("active"),
    source: source.default("manual"),
    externalCustomerId: id.optional(),
    externalSubscriptionId: id.optional(),
    quotaTemplates: z
      .array(quotaTemplateInput)
      .min(1)
      .max(25)
      .refine(
        (items) =>
          new Set(items.map((item) => item.metric)).size === items.length,
        { message: "Quota template metrics must be unique." },
      ),
    metadata: z.record(z.string(), z.unknown()).default({}),
    lifecycle: lifecycle.optional(),
  })
  .openapi("ApplyBillingPlanRequest");
export const SyncExternalBillingEventSchema = z
  .strictObject({
    eventId: id,
    provider: z.string().min(1).max(80),
    eventType: z.enum([
      "customer.updated",
      "invoice.paid",
      "invoice.payment_failed",
      "subscription.canceled",
      "subscription.created",
      "subscription.updated",
    ]),
    externalCustomerId: id.optional(),
    externalSubscriptionId: id.optional(),
    externalInvoiceId: id.optional(),
    invoiceStatus: z.string().min(1).max(80).optional(),
    lifecycle: lifecycle.optional(),
    amountCents: count.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    occurredAt: time,
    planCode: z.string().min(1).max(120).optional(),
    planName: z.string().min(1).max(200).optional(),
    status: status.optional(),
    quotaTemplates: z.array(quotaTemplateInput).min(1).max(25).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("SyncExternalBillingEventRequest");
export const BillingPlanApplyResultSchema = z
  .strictObject({ plan: BillingPlanSchema, quotas: z.array(QuotaBucketSchema) })
  .openapi("BillingPlanApplyResult");

const planPosture = z.strictObject({
  code: z.string(),
  name: z.string(),
  source,
  status,
  externalCustomerConfigured: z.boolean(),
  externalSubscriptionConfigured: z.boolean(),
  updatedAt: time,
});
const entitlementQuota = z.strictObject({
  metric,
  expectedLimit: count,
  expectedResetInterval: reset,
  status: z.enum([
    "limit_and_reset_interval_mismatch",
    "limit_mismatch",
    "matched",
    "missing",
    "reset_interval_mismatch",
  ]),
  actualLimit: count.optional(),
  actualResetInterval: reset.optional(),
  actualUsed: z.number().nonnegative().optional(),
  quotaBucketId: id.optional(),
  resetAt: time.optional(),
});
export const BillingEntitlementReportSchema = z
  .strictObject({
    orgId: id,
    generatedAt: time,
    status: z.enum(["attention_required", "healthy"]),
    billingPlanConfigured: z.boolean(),
    quotaTemplateCount: count,
    unmanagedOrgQuotaCount: count,
    warnings: z.array(
      z.enum([
        "billing_plan_missing",
        "billing_status_not_entitled",
        "quota_limit_mismatch",
        "quota_missing",
        "quota_reset_interval_mismatch",
      ]),
    ),
    billingPlan: planPosture.optional(),
    quotas: z.array(entitlementQuota),
  })
  .openapi("BillingEntitlementReport");
export const BillingEntitlementReconciliationResultSchema = z
  .strictObject({
    before: BillingEntitlementReportSchema,
    after: BillingEntitlementReportSchema,
    actions: z.strictObject({
      createdQuotaIds: z.array(id),
      updatedQuotaIds: z.array(id),
      unchangedQuotaIds: z.array(id),
    }),
  })
  .openapi("BillingEntitlementReconciliationResult");
const action = z.enum(["mark_canceled", "mark_past_due", "none"]);
export const BillingLifecycleReportSchema = z
  .strictObject({
    orgId: id,
    generatedAt: time,
    status: z.enum(["attention_required", "healthy"]),
    billingPlanConfigured: z.boolean(),
    warnings: z.array(
      z.enum([
        "billing_plan_missing",
        "cancel_at_reached",
        "past_due_grace_expired",
        "subscription_period_expired",
        "trial_expired",
      ]),
    ),
    recommendedAction: action,
    lifecycle,
    billingPlan: planPosture.optional(),
  })
  .openapi("BillingLifecycleReport");
export const BillingLifecycleEnforcementResultSchema = z
  .strictObject({
    before: BillingLifecycleReportSchema,
    after: BillingLifecycleReportSchema,
    action: z.strictObject({
      type: action,
      statusChanged: z.boolean(),
      previousStatus: status.optional(),
      newStatus: status.optional(),
    }),
  })
  .openapi("BillingLifecycleEnforcementResult");

const meta = { tags: ["Billing"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const result = jsonResponse(
  "Billing plan result",
  dataEnvelope(BillingPlanApplyResultSchema),
);
export const getBillingPlanRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/billing/plan",
  operationId: "billing.getPlan",
  summary: "Get plan",
  responses: {
    200: jsonResponse(
      "Billing plan",
      dataEnvelope(z.union([BillingPlanSchema, z.null()])),
    ),
    ...errors,
  },
});
export const applyBillingPlanRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/billing/plan",
  operationId: "billing.applyPlan",
  summary: "Apply plan",
  request: { body: body(ApplyBillingPlanSchema) },
  responses: { 200: result, ...errors },
});
export const syncExternalBillingEventRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/billing/external-events",
  operationId: "billing.syncExternalEvent",
  summary: "Sync external event",
  request: { body: body(SyncExternalBillingEventSchema) },
  responses: { 200: result, ...errors },
});
export const getBillingEntitlementsRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/billing/entitlements",
  operationId: "billing.getEntitlements",
  summary: "Get entitlements",
  responses: {
    200: jsonResponse(
      "Billing entitlements",
      dataEnvelope(BillingEntitlementReportSchema),
    ),
    ...errors,
  },
});
export const reconcileBillingEntitlementsRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/billing/entitlements/reconcile",
  operationId: "billing.reconcileEntitlements",
  summary: "Reconcile entitlements",
  responses: {
    200: jsonResponse(
      "Reconciled entitlements",
      dataEnvelope(BillingEntitlementReconciliationResultSchema),
    ),
    ...errors,
  },
});
export const getBillingLifecycleRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/billing/lifecycle",
  operationId: "billing.getLifecycle",
  summary: "Get lifecycle",
  responses: {
    200: jsonResponse(
      "Billing lifecycle",
      dataEnvelope(BillingLifecycleReportSchema),
    ),
    ...errors,
  },
});
export const enforceBillingLifecycleRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/billing/lifecycle/enforce",
  operationId: "billing.enforceLifecycle",
  summary: "Enforce lifecycle",
  responses: {
    200: jsonResponse(
      "Billing lifecycle enforcement",
      dataEnvelope(BillingLifecycleEnforcementResultSchema),
    ),
    ...errors,
  },
});
const webhookResponses = { 200: result, ...errors };
export const stripeBillingWebhookRoute = createRoute({
  method: "post",
  path: "/api/v1/billing/webhooks/stripe",
  operationId: "billing.receiveStripeWebhook",
  summary: "Receive stripe webhook",
  tags: ["Billing webhooks"],
  security: [],
  request: { body: body(z.string()) },
  responses: webhookResponses,
});
export const genericBillingWebhookRoute = createRoute({
  method: "post",
  path: "/api/v1/billing/webhooks/generic",
  operationId: "billing.receiveGenericWebhook",
  summary: "Receive generic webhook",
  tags: ["Billing webhooks"],
  security: [],
  request: { body: body(z.string()) },
  responses: webhookResponses,
});
export const billingRoutes = [
  getBillingPlanRoute,
  applyBillingPlanRoute,
  syncExternalBillingEventRoute,
  getBillingEntitlementsRoute,
  reconcileBillingEntitlementsRoute,
  getBillingLifecycleRoute,
  enforceBillingLifecycleRoute,
  stripeBillingWebhookRoute,
  genericBillingWebhookRoute,
] as const;
