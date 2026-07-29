import type {
  BillingPlanStatus,
  ExternalBillingEventType,
} from "../features/billing";
import type { MessageKey } from "../lib/i18n";
import type { BillingQuotaMetric } from "./billing-plan-payload";

export function billingPlanStatusKey(status: BillingPlanStatus): MessageKey {
  switch (status) {
    case "active":
      return "billingStatusActive";
    case "canceled":
      return "billingStatusCanceled";
    case "past_due":
      return "billingStatusPastDue";
    case "trialing":
      return "billingStatusTrialing";
  }
}

export function billingMetricKey(metric: BillingQuotaMetric): MessageKey {
  switch (metric) {
    case "image.cost.micro_usd":
      return "quotaMetricImageCost";
    case "image.generated":
      return "quotaMetricImagesGenerated";
    case "run.started":
      return "quotaMetricRunsStarted";
    case "storage.byte":
      return "quotaMetricStorageBytes";
    case "tool.call":
      return "quotaMetricToolCalls";
    case "web.search.request":
      return "quotaMetricWebSearches";
    case "web.url.fetch":
      return "quotaMetricWebFetches";
  }
}

export function billingEventTypeKey(
  type: ExternalBillingEventType,
): MessageKey {
  switch (type) {
    case "customer.updated":
      return "billingEventCustomerUpdated";
    case "invoice.paid":
      return "billingEventInvoicePaid";
    case "invoice.payment_failed":
      return "billingEventInvoicePaymentFailed";
    case "subscription.canceled":
      return "billingEventSubscriptionCanceled";
    case "subscription.created":
      return "billingEventSubscriptionCreated";
    case "subscription.updated":
      return "billingEventSubscriptionUpdated";
  }
}
