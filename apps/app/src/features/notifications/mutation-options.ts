import type {
  CreateNotificationChannelRequest,
  NotificationDeliveryChannel,
  NotificationPolicyReport,
  UpdateNotificationPolicyRequest,
  UserNotification,
} from "@romeo/api-client/generated/sdk";

import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  createNotificationChannel,
  markNotificationRead,
  updateNotificationPolicy,
} from "./mutations";

export function createNotificationChannelMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "notifications.channel.create",
    mutationFn: (input: CreateNotificationChannelRequest) =>
      createNotificationChannel(input),
    reconcile: (client, channel: NotificationDeliveryChannel) => {
      client.setQueryData<NotificationDeliveryChannel[]>(
        appQueryKeys.notificationChannels(),
        (current) =>
          current === undefined
            ? current
            : [channel, ...current.filter(({ id }) => id !== channel.id)],
      );
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.notificationChannels() },
    ],
  });
}

export function markNotificationReadMutationOptions() {
  return serverMutationOptions<
    UserNotification,
    Error,
    string,
    UserNotification[] | undefined
  >({
    resource: "notifications.read",
    mutationFn: markNotificationRead,
    optimistic: {
      snapshot: async (client) => {
        const queryKey = appQueryKeys.notifications();
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<UserNotification[]>(queryKey);
      },
      update: (client, notificationId) => {
        client.setQueryData<UserNotification[]>(
          appQueryKeys.notifications(),
          (current) =>
            current?.map((notification) =>
              notification.id === notificationId
                ? {
                    ...notification,
                    readAt: notification.readAt ?? new Date().toISOString(),
                  }
                : notification,
            ),
        );
      },
      rollback: (client, snapshot) => {
        const queryKey = appQueryKeys.notifications();
        if (snapshot === undefined) {
          client.removeQueries({ exact: true, queryKey });
        } else {
          client.setQueryData(queryKey, snapshot);
        }
      },
    },
    reconcile: (client, notification) => {
      client.setQueryData<UserNotification[]>(
        appQueryKeys.notifications(),
        (current) =>
          current?.map((item) =>
            item.id === notification.id ? notification : item,
          ),
      );
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.notifications() },
    ],
  });
}

export function updateNotificationPolicyMutationOptions() {
  return serverMutationOptions({
    resource: "notifications.policy.update",
    mutationFn: (input: UpdateNotificationPolicyRequest) =>
      updateNotificationPolicy(input),
    reconcile: (client, report: NotificationPolicyReport) => {
      client.setQueryData(appQueryKeys.notificationPolicy(), report);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.notificationPolicy() },
    ],
  });
}
