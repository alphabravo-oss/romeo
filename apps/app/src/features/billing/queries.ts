import {
  billingGetEntitlements,
  billingGetLifecycle,
  billingGetPlan,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getBillingPlan() {
  configureBrowserApiClients();
  const response = await billingGetPlan({ throwOnError: true });
  return response.data.data;
}

export async function getBillingEntitlements() {
  configureBrowserApiClients();
  const response = await billingGetEntitlements({ throwOnError: true });
  return response.data.data;
}

export async function getBillingLifecycle() {
  configureBrowserApiClients();
  const response = await billingGetLifecycle({ throwOnError: true });
  return response.data.data;
}
