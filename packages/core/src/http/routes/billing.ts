import {
  applyBillingPlanRoute,
  enforceBillingLifecycleRoute,
  getBillingEntitlementsRoute,
  getBillingLifecycleRoute,
  getBillingPlanRoute,
  reconcileBillingEntitlementsRoute,
  syncExternalBillingEventRoute,
} from "@romeo/contracts";
import { createHash } from "node:crypto";
import type { RomeoApi } from "../context";

export function registerBillingRoutes(app: RomeoApi): void {
  app.openapi(getBillingPlanRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").billing.current(subject);
    return context.json({ data: data ?? null });
  });

  app.openapi(applyBillingPlanRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      code: string;
      name: string;
      status: typeof body.status;
      source: typeof body.source;
      quotaTemplates: typeof body.quotaTemplates;
      metadata: typeof body.metadata;
      externalCustomerId?: string;
      externalSubscriptionId?: string;
      lifecycle?: NonNullable<typeof body.lifecycle>;
    } = {
      subject,
      code: body.code,
      name: body.name,
      status: body.status,
      source: body.source,
      quotaTemplates: body.quotaTemplates,
      metadata: body.metadata,
    };
    if (body.externalCustomerId !== undefined)
      input.externalCustomerId = body.externalCustomerId;
    if (body.externalSubscriptionId !== undefined)
      input.externalSubscriptionId = body.externalSubscriptionId;
    if (body.lifecycle !== undefined) input.lifecycle = body.lifecycle;
    const data = await context.get("services").billing.applyPlan(input);
    return context.json({ data });
  });

  app.openapi(syncExternalBillingEventRoute, async (context) => {
    const subject = context.get("subject");
    const receivedAt = new Date().toISOString();
    const request = context.req.valid("json");
    const event = {
      ...request,
      eventId: request.eventId ?? legacyBillingEventId(request),
      occurredAt: request.occurredAt ?? receivedAt,
    };
    const data = await context
      .get("services")
      .billing.syncExternalEvent({ subject, event });
    return context.json({ data });
  });

  app.openapi(getBillingEntitlementsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .billing.entitlementReport(subject);
    return context.json({ data });
  });

  app.openapi(reconcileBillingEntitlementsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .billing.reconcileEntitlements(subject);
    return context.json({ data });
  });

  app.openapi(getBillingLifecycleRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").billing.lifecycleReport(subject);
    return context.json({ data });
  });

  app.openapi(enforceBillingLifecycleRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .billing.enforceLifecycle(subject);
    return context.json({ data });
  });

  app.post("/api/v1/billing/webhooks/stripe", async (context) => {
    const data = await context.get("services").billing.syncStripeWebhook({
      payload: await context.req.text(),
      signatureHeader: context.req.header("stripe-signature"),
    });
    return context.json({ data });
  });

  app.post("/api/v1/billing/webhooks/generic", async (context) => {
    const data = await context.get("services").billing.syncGenericWebhook({
      payload: await context.req.text(),
      signatureHeader: context.req.header("x-romeo-billing-signature"),
      timestampHeader: context.req.header("x-romeo-billing-timestamp"),
    });
    return context.json({ data });
  });
}

/**
 * Compatibility id for legacy callers that predate explicit provider event
 * ids. Identical semantic payloads collapse to the same receipt even when JSON
 * object key order differs. New integrations should always send eventId.
 */
export function legacyBillingEventId(value: unknown): string {
  return `legacy_${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")
    .slice(0, 48)}`;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
