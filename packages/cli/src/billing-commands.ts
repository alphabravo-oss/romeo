import {
  billingApplyPlan,
  billingEnforceLifecycle,
  billingGetEntitlements,
  billingGetLifecycle,
  billingGetPlan,
  billingReconcileEntitlements,
  billingSyncExternalEvent,
  type ApplyBillingPlanRequest,
  type SyncExternalBillingEventRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import {
  csvFlag,
  optionalNonNegativeIntegerFlag,
  requiredFlag,
} from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

type GeneratedBillingQuotaTemplate =
  ApplyBillingPlanRequest["quotaTemplates"][number];
type BillingQuotaTemplate = Omit<
  GeneratedBillingQuotaTemplate,
  "resetInterval"
> & {
  resetInterval: NonNullable<GeneratedBillingQuotaTemplate["resetInterval"]>;
};

interface BillingCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeBillingCommand(
  area: string,
  action: string | undefined,
  context: BillingCommandContext,
): Promise<number> | undefined {
  if (area !== "billing") return undefined;
  const command = billingCommand(action, context);
  return command === undefined ? undefined : result(context, command);
}

function billingCommand(
  action: string | undefined,
  context: BillingCommandContext,
): Promise<unknown> | undefined {
  if (action === "plan") return getPlan(context);
  if (action === "entitlements") return getEntitlements(context);
  if (action === "reconcile-entitlements")
    return reconcileEntitlements(context);
  if (action === "lifecycle") return getLifecycle(context);
  if (action === "enforce-lifecycle") return enforceLifecycle(context);
  if (action === "apply-plan") return applyPlan(context);
  if (action === "sync-external") return syncExternalEvent(context);
  return undefined;
}

function getPlan(context: BillingCommandContext) {
  return billingGetPlan({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function getEntitlements(context: BillingCommandContext) {
  return billingGetEntitlements({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function reconcileEntitlements(context: BillingCommandContext) {
  return billingReconcileEntitlements({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function getLifecycle(context: BillingCommandContext) {
  return billingGetLifecycle({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function enforceLifecycle(context: BillingCommandContext) {
  return billingEnforceLifecycle({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function applyPlan(context: BillingCommandContext) {
  const status = flagValue(context.parsed.flags, "status");
  const source = flagValue(context.parsed.flags, "source");
  const externalCustomerId = flagValue(
    context.parsed.flags,
    "external-customer",
  );
  const externalSubscriptionId = flagValue(
    context.parsed.flags,
    "external-subscription",
  );
  const body = {
    code: requiredFlag(context.parsed, "code"),
    name: requiredFlag(context.parsed, "name"),
    quotaTemplates: billingQuotaTemplates(context.parsed),
    ...(status === undefined ? {} : { status: billingPlanStatus(status) }),
    ...(source === undefined ? {} : { source: billingPlanSource(source) }),
    ...(externalCustomerId === undefined ? {} : { externalCustomerId }),
    ...(externalSubscriptionId === undefined ? {} : { externalSubscriptionId }),
  } satisfies ApplyBillingPlanRequest;
  return billingApplyPlan({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function syncExternalEvent(context: BillingCommandContext) {
  const status = flagValue(context.parsed.flags, "status");
  const externalCustomerId = flagValue(
    context.parsed.flags,
    "external-customer",
  );
  const externalSubscriptionId = flagValue(
    context.parsed.flags,
    "external-subscription",
  );
  const externalInvoiceId = flagValue(context.parsed.flags, "external-invoice");
  const invoiceStatus = flagValue(context.parsed.flags, "invoice-status");
  const amountCents = optionalNonNegativeIntegerFlag(
    context.parsed,
    "amount-cents",
  );
  const currency = flagValue(context.parsed.flags, "currency");
  const occurredAt = requiredFlag(context.parsed, "occurred-at");
  const planCode = flagValue(context.parsed.flags, "plan-code", "code");
  const planName = flagValue(context.parsed.flags, "plan-name", "name");
  const quotaTemplates = billingQuotaTemplates(context.parsed, false);
  const body = {
    provider: requiredFlag(context.parsed, "provider"),
    eventId: requiredFlag(context.parsed, "event-id"),
    eventType: billingExternalEventType(
      requiredFlag(context.parsed, "event", "event-type"),
    ),
    ...(externalCustomerId === undefined ? {} : { externalCustomerId }),
    ...(externalSubscriptionId === undefined ? {} : { externalSubscriptionId }),
    ...(externalInvoiceId === undefined ? {} : { externalInvoiceId }),
    ...(invoiceStatus === undefined ? {} : { invoiceStatus }),
    ...(amountCents === undefined ? {} : { amountCents }),
    ...(currency === undefined ? {} : { currency }),
    occurredAt,
    ...(planCode === undefined ? {} : { planCode }),
    ...(planName === undefined ? {} : { planName }),
    ...(status === undefined ? {} : { status: billingPlanStatus(status) }),
    ...(quotaTemplates.length === 0 ? {} : { quotaTemplates }),
  } satisfies SyncExternalBillingEventRequest;
  return billingSyncExternalEvent({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: BillingCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function billingQuotaTemplates(
  parsed: ParsedArgs,
  required = true,
): BillingQuotaTemplate[] {
  const quotas = csvFlag(parsed, "quota", "quotas");
  if (!required && quotas.length === 0) return [];
  if (quotas.length === 0) throw new CliUsageError("Missing --quota.");
  return quotas.map((quota) => {
    const [metric, limitRaw, resetInterval = "monthly"] = quota.split(":");
    if (!isBillingMetric(metric))
      throw new CliUsageError(
        "--quota metric must be image.generated, image.cost.micro_usd, web.search.request, web.url.fetch, run.started, tool.call, or storage.byte.",
      );
    if (!isResetInterval(resetInterval))
      throw new CliUsageError(
        "--quota reset interval must be none, daily, or monthly.",
      );
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 0)
      throw new CliUsageError("--quota limit must be a non-negative integer.");
    return { metric, limit, resetInterval };
  });
}

function isBillingMetric(
  value: string | undefined,
): value is BillingQuotaTemplate["metric"] {
  return [
    "image.cost.micro_usd",
    "image.generated",
    "web.search.request",
    "web.url.fetch",
    "run.started",
    "tool.call",
    "storage.byte",
  ].includes(value ?? "");
}

function isResetInterval(
  value: string,
): value is NonNullable<BillingQuotaTemplate["resetInterval"]> {
  return value === "none" || value === "daily" || value === "monthly";
}

function billingPlanStatus(
  value: string,
): NonNullable<ApplyBillingPlanRequest["status"]> {
  if (
    value === "active" ||
    value === "canceled" ||
    value === "past_due" ||
    value === "trialing"
  )
    return value;
  throw new CliUsageError(
    "--status must be active, canceled, past_due, or trialing.",
  );
}

function billingPlanSource(
  value: string,
): NonNullable<ApplyBillingPlanRequest["source"]> {
  if (value === "external" || value === "manual") return value;
  throw new CliUsageError("--source must be external or manual.");
}

function billingExternalEventType(
  value: string,
): SyncExternalBillingEventRequest["eventType"] {
  if (
    value === "customer.updated" ||
    value === "invoice.paid" ||
    value === "invoice.payment_failed" ||
    value === "subscription.canceled" ||
    value === "subscription.created" ||
    value === "subscription.updated"
  )
    return value;
  throw new CliUsageError(
    "--event must be a supported billing external event type.",
  );
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: BillingCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
