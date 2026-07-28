import {
  notificationsCreateChannel,
  notificationsMarkRead,
  notificationsRetryDueDeliveries,
  notificationsUpdatePolicy,
  type CreateNotificationChannelRequest,
  type UpdateNotificationPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function markNotificationRead(notificationId: string) {
  configureBrowserApiClients();
  const response = await notificationsMarkRead({
    path: { notificationId },
    throwOnError: true,
  });
  return response.data.data;
}
export async function createNotificationChannel(
  input: CreateNotificationChannelRequest,
) {
  configureBrowserApiClients();
  const response = await notificationsCreateChannel({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
export async function updateNotificationPolicy(
  input: UpdateNotificationPolicyRequest,
) {
  configureBrowserApiClients();
  const response = await notificationsUpdatePolicy({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
export async function retryDueNotificationDeliveries() {
  configureBrowserApiClients();
  const response = await notificationsRetryDueDeliveries({
    throwOnError: true,
  });
  return response.data.data;
}
