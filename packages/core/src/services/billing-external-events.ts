import type { AuthSubject } from "@romeo/auth";

import type { BillingPlan, BillingPlanQuotaTemplate } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { BillingLifecycleInput } from "./billing-lifecycle";
import { ensureSystemAuditActor } from "./system-audit-actor";

export interface ExternalBillingEventInput {
  eventId: string;
  amountCents?: number | undefined;
  currency?: string | undefined;
  eventType:
    | "customer.updated"
    | "invoice.paid"
    | "invoice.payment_failed"
    | "subscription.canceled"
    | "subscription.created"
    | "subscription.updated";
  externalCustomerId?: string | undefined;
  externalInvoiceId?: string | undefined;
  externalSubscriptionId?: string | undefined;
  invoiceStatus?: string | undefined;
  lifecycle?: BillingLifecycleInput | undefined;
  metadata?: Record<string, unknown> | undefined;
  occurredAt: string;
  planCode?: string | undefined;
  planName?: string | undefined;
  provider: string;
  quotaTemplates?: BillingPlanQuotaTemplate[] | undefined;
  status?: BillingPlan["status"] | undefined;
}

export async function billingWebhookSubject(
  repository: RomeoRepository,
  orgId: string,
): Promise<AuthSubject> {
  const actor = await ensureSystemAuditActor(repository, {
    kind: "billing_webhook",
    name: "Romeo system billing webhook",
    orgId,
  });
  return {
    id: actor.id,
    type: "service_account",
    orgId,
    workspaceIds: [],
    groupIds: [],
    scopes: ["admin:write"],
    isAdmin: true,
  };
}

export function statusFromExternalEvent(
  eventType: ExternalBillingEventInput["eventType"],
  fallback: BillingPlan["status"] | undefined,
): BillingPlan["status"] {
  if (eventType === "subscription.canceled") return "canceled";
  if (eventType === "invoice.payment_failed") return "past_due";
  if (
    eventType === "subscription.created" ||
    eventType === "subscription.updated" ||
    eventType === "invoice.paid"
  ) {
    if (eventType === "invoice.paid" && fallback === "canceled")
      return "canceled";
    return fallback === "trialing" ? "trialing" : "active";
  }
  return fallback ?? "active";
}

export function externalBillingMetadata(
  existing: Record<string, unknown>,
  event: ExternalBillingEventInput,
): Record<string, unknown> {
  return {
    ...existing,
    billingProvider: event.provider,
    lastExternalEventType: event.eventType,
    lastExternalEventAt: event.occurredAt,
    lastExternalEventId: event.eventId,
    ...(event.externalInvoiceId === undefined
      ? {}
      : {
          lastInvoice: {
            externalInvoiceId: event.externalInvoiceId,
            ...(event.invoiceStatus === undefined
              ? {}
              : { status: event.invoiceStatus }),
            ...(event.amountCents === undefined
              ? {}
              : { amountCents: event.amountCents }),
            ...(event.currency === undefined
              ? {}
              : { currency: event.currency }),
          },
        }),
    ...(event.metadata === undefined
      ? {}
      : {
          externalMetadataKeys: Object.keys(event.metadata).sort().slice(0, 25),
        }),
  };
}
