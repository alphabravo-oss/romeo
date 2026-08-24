import type { RomeoEnv } from "@romeo/config";

import {
  disabledNotificationDeliverySender,
  ResendEmailNotificationDeliverySender,
  RoutingNotificationDeliverySender,
  SlackWebhookNotificationDeliverySender,
  SmtpEmailNotificationDeliverySender,
  WebhookNotificationDeliverySender,
  type NotificationDeliverySender,
  type ResendEmailClientFactory,
  type SmtpSendMail,
} from "./notification-delivery";
import {
  PagerDutyEventsNotificationDeliverySender,
  TeamsWebhookNotificationDeliverySender,
} from "./notification-delivery-enterprise";
import {
  FcmMobilePushNotificationDeliverySender,
  type FcmMessagingClientFactory,
} from "./notification-delivery-mobile";
import type { HardenedWebhookFetchOptions } from "./hardened-webhook-fetch";
import type { SecretResolver } from "./secret-resolver";

export interface NotificationDeliveryFactoryOptions extends HardenedWebhookFetchOptions {
  fcmClientFactory?: FcmMessagingClientFactory;
  resendClientFactory?: ResendEmailClientFactory;
  secretResolver: SecretResolver;
  signingKey: string;
  smtpSendMail?: SmtpSendMail;
}

export function createNotificationDeliverySender(
  env: RomeoEnv,
  options: NotificationDeliveryFactoryOptions,
): NotificationDeliverySender {
  const deliveryOptions: NotificationDeliveryFactoryOptions = {
    ...options,
    ...notificationWebhookNetworkOptionsFromEnv(env),
  };
  switch (env.NOTIFICATION_DELIVERY_DRIVER) {
    case "configured":
      return new RoutingNotificationDeliverySender({
        email: createConfiguredEmailSender(env, deliveryOptions),
        mobile_push: createFcmSender(env, deliveryOptions),
        pagerduty: createPagerDutySender(env, deliveryOptions),
        slack: createSlackSender(env, deliveryOptions),
        teams: createTeamsSender(env, deliveryOptions),
        webhook: createWebhookSender(deliveryOptions),
      });
    case "fcm-mobile-push":
      return createFcmSender(env, deliveryOptions);
    case "resend-email":
      return createResendSender(env, deliveryOptions);
    case "slack-webhook":
      return createSlackSender(env, deliveryOptions);
    case "smtp-email":
      return createSmtpSender(env, deliveryOptions);
    case "teams-webhook":
      return createTeamsSender(env, deliveryOptions);
    case "pagerduty-events":
      return createPagerDutySender(env, deliveryOptions);
    case "webhook":
      return createWebhookSender(deliveryOptions);
    default:
      return disabledNotificationDeliverySender;
  }
}

export function notificationWebhookNetworkOptionsFromEnv(
  env: RomeoEnv,
): Pick<HardenedWebhookFetchOptions, "allowedHosts" | "egressPolicy"> {
  return {
    allowedHosts:
      env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS.length === 0
        ? []
        : env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS.split(","),
    egressPolicy: env.NOTIFICATION_WEBHOOK_EGRESS_POLICY,
  };
}

function createConfiguredEmailSender(
  env: RomeoEnv,
  options: NotificationDeliveryFactoryOptions,
): NotificationDeliverySender {
  return env.NOTIFICATION_EMAIL_DELIVERY_DRIVER === "smtp"
    ? createSmtpSender(env, options)
    : createResendSender(env, options);
}

function createResendSender(
  env: RomeoEnv,
  options: Pick<NotificationDeliveryFactoryOptions, "resendClientFactory">,
): NotificationDeliverySender {
  return new ResendEmailNotificationDeliverySender({
    apiKey: env.NOTIFICATION_RESEND_API_KEY,
    baseUrl: env.NOTIFICATION_RESEND_BASE_URL,
    from: env.NOTIFICATION_EMAIL_FROM,
    timeoutMs: env.NOTIFICATION_RESEND_TIMEOUT_MS,
    ...(options.resendClientFactory === undefined
      ? {}
      : { clientFactory: options.resendClientFactory }),
  });
}

function createSmtpSender(
  env: RomeoEnv,
  options: Pick<NotificationDeliveryFactoryOptions, "smtpSendMail">,
): NotificationDeliverySender {
  return new SmtpEmailNotificationDeliverySender({
    from: env.NOTIFICATION_EMAIL_FROM,
    host: env.NOTIFICATION_SMTP_HOST,
    password: env.NOTIFICATION_SMTP_PASSWORD,
    port: env.NOTIFICATION_SMTP_PORT,
    secure: env.NOTIFICATION_SMTP_SECURE,
    timeoutMs: env.NOTIFICATION_SMTP_TIMEOUT_MS,
    user: env.NOTIFICATION_SMTP_USER,
    ...(options.smtpSendMail === undefined
      ? {}
      : { sendMail: options.smtpSendMail }),
  });
}

function createSlackSender(
  env: RomeoEnv,
  options: NotificationDeliveryFactoryOptions,
): NotificationDeliverySender {
  return new SlackWebhookNotificationDeliverySender({
    ...webhookNetworkOptions(options),
    timeoutMs: env.NOTIFICATION_SLACK_TIMEOUT_MS,
  });
}

function createTeamsSender(
  env: RomeoEnv,
  options: NotificationDeliveryFactoryOptions,
): NotificationDeliverySender {
  return new TeamsWebhookNotificationDeliverySender({
    ...webhookNetworkOptions(options),
    timeoutMs: env.NOTIFICATION_TEAMS_TIMEOUT_MS,
  });
}

function createPagerDutySender(
  env: RomeoEnv,
  options: NotificationDeliveryFactoryOptions,
): NotificationDeliverySender {
  return new PagerDutyEventsNotificationDeliverySender({
    ...webhookNetworkOptions(options),
    eventsUrl: env.NOTIFICATION_PAGERDUTY_EVENTS_URL,
    secretResolver: options.secretResolver,
    timeoutMs: env.NOTIFICATION_PAGERDUTY_TIMEOUT_MS,
  });
}

function createFcmSender(
  env: RomeoEnv,
  options: Pick<
    NotificationDeliveryFactoryOptions,
    "fcmClientFactory" | "secretResolver"
  >,
): NotificationDeliverySender {
  return new FcmMobilePushNotificationDeliverySender({
    projectId: env.NOTIFICATION_FCM_PROJECT_ID,
    secretResolver: options.secretResolver,
    serviceAccountRef: env.NOTIFICATION_FCM_SERVICE_ACCOUNT_REF,
    timeoutMs: env.NOTIFICATION_FCM_TIMEOUT_MS,
    ...(options.fcmClientFactory === undefined
      ? {}
      : { clientFactory: options.fcmClientFactory }),
  });
}

function createWebhookSender(
  options: NotificationDeliveryFactoryOptions,
): NotificationDeliverySender {
  return new WebhookNotificationDeliverySender({
    ...webhookNetworkOptions(options),
    signingKey: options.signingKey,
  });
}

function webhookNetworkOptions(
  options: NotificationDeliveryFactoryOptions,
): HardenedWebhookFetchOptions {
  return {
    ...(options.allowedHosts === undefined
      ? {}
      : { allowedHosts: options.allowedHosts }),
    ...(options.egressPolicy === undefined
      ? {}
      : { egressPolicy: options.egressPolicy }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(options.hostLookup === undefined
      ? {}
      : { hostLookup: options.hostLookup }),
    ...(options.maxRedirects === undefined
      ? {}
      : { maxRedirects: options.maxRedirects }),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
    ...(options.pinnedFetchImpl === undefined
      ? {}
      : { pinnedFetchImpl: options.pinnedFetchImpl }),
  };
}
