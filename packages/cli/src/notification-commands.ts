import {
  notificationsCreateChannel,
  notificationsGetPolicy,
  notificationsList,
  notificationsListChannels,
  notificationsListDeliveries,
  notificationsMarkRead,
  notificationsRetryDueDeliveries,
  notificationsUpdatePolicy,
  type CreateNotificationChannelRequest,
  type UpdateNotificationPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import {
  numberFlag,
  optionalBooleanFlag,
  optionalCsvFlag,
  optionalIntegerFlag,
  requiredFlag,
} from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";
import { runNotificationRetryWorker } from "./notification-worker";

interface NotificationCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeNotificationCommand(
  area: string,
  action: string | undefined,
  context: NotificationCommandContext,
): Promise<number> | undefined {
  if (area === "workers" && action === "notification-retry")
    return notificationRetryWorker(context);
  if (area !== "notifications") return undefined;
  if (action === "list") return result(context, listNotifications(context));
  if (action === "read")
    return result(
      context,
      markNotificationRead(
        context,
        requiredFlag(context.parsed, "notification", "notification-id"),
      ),
    );
  if (action === "channels")
    return result(context, listNotificationChannels(context));
  if (action === "channel-create") return createNotificationChannel(context);
  if (action === "deliveries")
    return result(context, listNotificationDeliveries(context));
  if (action === "retry-due")
    return result(context, retryDueNotifications(context));
  if (action === "policy")
    return result(context, getNotificationPolicy(context));
  if (action === "policy-update") return updateNotificationPolicy(context);
  return undefined;
}

function createNotificationChannel(
  context: NotificationCommandContext,
): Promise<number> {
  const type = flagValue(context.parsed.flags, "type") ?? "webhook";
  const enabledNotificationTypes = optionalCsvFlag(
    context.parsed,
    "enabled-notification-types",
    "notification-types",
  );
  const enabled =
    enabledNotificationTypes === undefined
      ? {}
      : { enabledNotificationTypes: enabledNotificationTypes as never };
  const name = flagValue(context.parsed.flags, "name");
  if (type === "email") {
    return result(
      context,
      createChannel(context, {
        type,
        name: name ?? "Email notifications",
        config: { to: requiredFlag(context.parsed, "to"), ...enabled },
      }),
    );
  }
  if (type === "pagerduty") {
    const severity = flagValue(context.parsed.flags, "severity");
    return result(
      context,
      createChannel(context, {
        type,
        name: name ?? "PagerDuty notifications",
        config: {
          routingKeyRef: requiredFlag(
            context.parsed,
            "routing-key-ref",
            "routing-key",
          ),
          ...(severity === undefined ? {} : { severity: severity as never }),
          ...enabled,
        },
      }),
    );
  }
  if (type === "mobile_push") {
    const platform = flagValue(context.parsed.flags, "platform");
    const collapseKey = flagValue(context.parsed.flags, "collapse-key");
    return result(
      context,
      createChannel(context, {
        type,
        name: name ?? "Mobile push notifications",
        config: {
          tokenRef: requiredFlag(context.parsed, "token-ref", "token"),
          ...(platform === undefined ? {} : { platform: platform as never }),
          ...(collapseKey === undefined ? {} : { collapseKey }),
          ...enabled,
        },
      }),
    );
  }
  if (type === "slack" || type === "teams" || type === "webhook") {
    const defaultNames = {
      slack: "Slack notifications",
      teams: "Teams notifications",
      webhook: "Webhook notifications",
    } as const;
    return result(
      context,
      createChannel(context, {
        type,
        name: name ?? defaultNames[type],
        config: { url: requiredFlag(context.parsed, "url"), ...enabled },
      }),
    );
  }
  throw new CliUsageError(
    "--type must be email, mobile_push, pagerduty, slack, teams, or webhook.",
  );
}

function updateNotificationPolicy(
  context: NotificationCommandContext,
): Promise<number> {
  const update: UpdateNotificationPolicyRequest = {};
  const deliveryEnabled = optionalBooleanFlag(
    context.parsed,
    "delivery-enabled",
  );
  const entries = {
    allowedChannelTypes: optionalCsvFlag(
      context.parsed,
      "allowed-channel-types",
    ),
    allowedWebhookHosts: optionalCsvFlag(
      context.parsed,
      "allowed-webhook-hosts",
    ),
    allowedSlackHosts: optionalCsvFlag(context.parsed, "allowed-slack-hosts"),
    allowedTeamsHosts: optionalCsvFlag(context.parsed, "allowed-teams-hosts"),
    allowedEmailDomains: optionalCsvFlag(
      context.parsed,
      "allowed-email-domains",
    ),
    suppressedNotificationTypes: optionalCsvFlag(
      context.parsed,
      "suppressed-notification-types",
    ),
  };
  if (deliveryEnabled !== undefined) update.deliveryEnabled = deliveryEnabled;
  if (entries.allowedChannelTypes !== undefined)
    update.allowedChannelTypes = entries.allowedChannelTypes as never;
  if (entries.allowedWebhookHosts !== undefined)
    update.allowedWebhookHosts = entries.allowedWebhookHosts;
  if (entries.allowedSlackHosts !== undefined)
    update.allowedSlackHosts = entries.allowedSlackHosts;
  if (entries.allowedTeamsHosts !== undefined)
    update.allowedTeamsHosts = entries.allowedTeamsHosts;
  if (entries.allowedEmailDomains !== undefined)
    update.allowedEmailDomains = entries.allowedEmailDomains;
  if (entries.suppressedNotificationTypes !== undefined)
    update.suppressedNotificationTypes =
      entries.suppressedNotificationTypes as never;
  if (Object.keys(update).length === 0)
    throw new CliUsageError(
      "notifications policy-update requires at least one policy flag.",
    );
  return result(context, updatePolicy(context, update));
}

function notificationRetryWorker(
  context: NotificationCommandContext,
): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  return runNotificationRetryWorker({
    client: {
      notifications: { retryDue: () => retryDueNotifications(context) },
    },
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
  });
}

async function listNotifications(context: NotificationCommandContext) {
  return (
    await notificationsList({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function markNotificationRead(
  context: NotificationCommandContext,
  notificationId: string,
) {
  return (
    await notificationsMarkRead({
      client: generatedClient(context),
      path: { notificationId },
      throwOnError: true,
    })
  ).data.data;
}

async function listNotificationChannels(context: NotificationCommandContext) {
  return (
    await notificationsListChannels({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function createChannel(
  context: NotificationCommandContext,
  body: CreateNotificationChannelRequest,
) {
  return (
    await notificationsCreateChannel({
      body,
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function listNotificationDeliveries(context: NotificationCommandContext) {
  return (
    await notificationsListDeliveries({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function retryDueNotifications(context: NotificationCommandContext) {
  return (
    await notificationsRetryDueDeliveries({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function getNotificationPolicy(context: NotificationCommandContext) {
  return (
    await notificationsGetPolicy({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function updatePolicy(
  context: NotificationCommandContext,
  body: UpdateNotificationPolicyRequest,
) {
  return (
    await notificationsUpdatePolicy({
      body,
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

function generatedClient(
  context: NotificationCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

async function result(
  context: NotificationCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
