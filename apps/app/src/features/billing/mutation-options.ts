import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  applyBillingPlan,
  enforceBillingLifecycle,
  reconcileBillingEntitlements,
  syncExternalBillingEvent,
} from "./mutations";
import type {
  BillingEntitlementReport,
  BillingLifecycleReport,
  BillingPlan,
} from "./types";

const billingStateInvalidations = () => [
  { exact: true as const, queryKey: appQueryKeys.billingPlan() },
  { exact: true as const, queryKey: appQueryKeys.quotas() },
  { exact: true as const, queryKey: appQueryKeys.billingEntitlements() },
  { exact: true as const, queryKey: appQueryKeys.billingLifecycle() },
];

export function applyBillingPlanMutationOptions() {
  return serverMutationOptions({
    resource: "billing.plan.apply",
    mutationFn: applyBillingPlan,
    reconcile: (client, result) => {
      client.setQueryData<BillingPlan>(appQueryKeys.billingPlan(), result.plan);
      client.setQueryData(appQueryKeys.quotas(), result.quotas);
    },
    invalidations: billingStateInvalidations,
  });
}

export function syncExternalBillingEventMutationOptions() {
  return serverMutationOptions({
    resource: "billing.externalEvent.sync",
    mutationFn: syncExternalBillingEvent,
    invalidations: billingStateInvalidations,
  });
}

export function reconcileBillingEntitlementsMutationOptions() {
  return serverMutationOptions({
    resource: "billing.entitlements.reconcile",
    mutationFn: reconcileBillingEntitlements,
    reconcile: (client, result) => {
      client.setQueryData<BillingEntitlementReport>(
        appQueryKeys.billingEntitlements(),
        result.after,
      );
    },
    invalidations: billingStateInvalidations,
  });
}

export function enforceBillingLifecycleMutationOptions() {
  return serverMutationOptions({
    resource: "billing.lifecycle.enforce",
    mutationFn: enforceBillingLifecycle,
    reconcile: (client, result) => {
      client.setQueryData<BillingLifecycleReport>(
        appQueryKeys.billingLifecycle(),
        result.after,
      );
    },
    invalidations: billingStateInvalidations,
  });
}
