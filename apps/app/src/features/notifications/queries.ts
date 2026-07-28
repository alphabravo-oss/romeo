import {
  notificationsGetPolicy,
  notificationsList,
  notificationsListChannels,
  notificationsListDeliveries,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listNotifications() {
  configureBrowserApiClients();
  const response = await notificationsList({ throwOnError: true });
  return response.data.data;
}
export async function listNotificationChannels() {
  configureBrowserApiClients();
  const response = await notificationsListChannels({ throwOnError: true });
  return response.data.data;
}
export async function listNotificationDeliveries() {
  configureBrowserApiClients();
  const response = await notificationsListDeliveries({ throwOnError: true });
  return response.data.data;
}
export async function getNotificationPolicy() {
  configureBrowserApiClients();
  const response = await notificationsGetPolicy({ throwOnError: true });
  return response.data.data;
}
