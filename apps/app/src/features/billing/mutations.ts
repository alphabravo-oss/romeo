import {
  billingApplyPlan,
  billingEnforceLifecycle,
  billingReconcileEntitlements,
  billingSyncExternalEvent,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  ApplyBillingPlanInput,
  SyncExternalBillingEventInput,
} from "./types";

export async function applyBillingPlan(input: ApplyBillingPlanInput) {
  configureBrowserApiClients();
  const response = await billingApplyPlan({ body: input, throwOnError: true });
  return response.data.data;
}

export async function syncExternalBillingEvent(
  input: SyncExternalBillingEventInput,
) {
  configureBrowserApiClients();
  const response = await billingSyncExternalEvent({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function reconcileBillingEntitlements() {
  configureBrowserApiClients();
  const response = await billingReconcileEntitlements({ throwOnError: true });
  return response.data.data;
}

export async function enforceBillingLifecycle() {
  configureBrowserApiClients();
  const response = await billingEnforceLifecycle({ throwOnError: true });
  return response.data.data;
}
