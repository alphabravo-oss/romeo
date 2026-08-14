import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getBillingEntitlements,
  getBillingLifecycle,
  getBillingPlan,
} from "./queries";

function simpleOptions<T>(
  resource: string,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  profile: "interactive" | "stable" | "volatile" = "interactive",
) {
  return queryOptions({
    ...serverQueryPolicy(profile, resource),
    queryKey,
    queryFn: ({ signal }) => abortableQuery(signal, queryFn),
  });
}

export const billingEntitlementsQueryOptions = () =>
  simpleOptions(
    "billingEntitlements",
    appQueryKeys.billingEntitlements(),
    getBillingEntitlements,
    "stable",
  );
export const billingLifecycleQueryOptions = () =>
  simpleOptions(
    "billingLifecycle",
    appQueryKeys.billingLifecycle(),
    getBillingLifecycle,
  );
export const billingPlanQueryOptions = () =>
  simpleOptions(
    "billingPlan",
    appQueryKeys.billingPlan(),
    getBillingPlan,
    "stable",
  );
