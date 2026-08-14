import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getNotificationPolicy,
  listNotificationChannels,
  listNotificationDeliveries,
  listNotifications,
} from "./queries";

function notificationOptions<T>(
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

export const notificationsQueryOptions = () =>
  notificationOptions(
    "notifications",
    appQueryKeys.notifications(),
    listNotifications,
    "volatile",
  );
export const notificationChannelsQueryOptions = () =>
  notificationOptions(
    "notificationChannels",
    appQueryKeys.notificationChannels(),
    listNotificationChannels,
  );
export const notificationDeliveriesQueryOptions = () =>
  notificationOptions(
    "notificationDeliveries",
    appQueryKeys.notificationDeliveries(),
    listNotificationDeliveries,
    "volatile",
  );
export const notificationPolicyQueryOptions = () =>
  notificationOptions(
    "notificationPolicy",
    appQueryKeys.notificationPolicy(),
    getNotificationPolicy,
    "stable",
  );
