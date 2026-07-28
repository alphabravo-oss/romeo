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
import type { SecretResolver } from "./secret-resolver";

export interface NotificationDeliveryFactoryOptions {
  fetchImpl?: typeof fetch;
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
  switch (env.NOTIFICATION_DELIVERY_DRIVER) {
    case "configured":
      return new RoutingNotificationDeliverySender({
        email: createConfiguredEmailSender(env, options),
        mobile_push: createFcmSender(env, options),
        pagerduty: createPagerDutySender(env, options),
        slack: createSlackSender(env, options),
        teams: createTeamsSender(env, options),
        webhook: createWebhookSender(options),
      });
    case "fcm-mobile-push":
      return createFcmSender(env, options);
    case "resend-email":
      return createResendSender(env, options);
    case "slack-webhook":
      return createSlackSender(env, options);
    case "smtp-email":
      return createSmtpSender(env, options);
    case "teams-webhook":
      return createTeamsSender(env, options);
    case "pagerduty-events":
      return createPagerDutySender(env, options);
    case "webhook":
      return createWebhookSender(options);
    default:
      return disabledNotificationDeliverySender;
  }
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
  options: Pick<NotificationDeliveryFactoryOptions, "fetchImpl">,
): NotificationDeliverySender {
  return new SlackWebhookNotificationDeliverySender({
    timeoutMs: env.NOTIFICATION_SLACK_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createTeamsSender(
  env: RomeoEnv,
  options: Pick<NotificationDeliveryFactoryOptions, "fetchImpl">,
): NotificationDeliverySender {
  return new TeamsWebhookNotificationDeliverySender({
    timeoutMs: env.NOTIFICATION_TEAMS_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}

function createPagerDutySender(
  env: RomeoEnv,
  options: Pick<
    NotificationDeliveryFactoryOptions,
    "fetchImpl" | "secretResolver"
  >,
): NotificationDeliverySender {
  return new PagerDutyEventsNotificationDeliverySender({
    eventsUrl: env.NOTIFICATION_PAGERDUTY_EVENTS_URL,
    secretResolver: options.secretResolver,
    timeoutMs: env.NOTIFICATION_PAGERDUTY_TIMEOUT_MS,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
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
  options: Pick<NotificationDeliveryFactoryOptions, "fetchImpl" | "signingKey">,
): NotificationDeliverySender {
  return new WebhookNotificationDeliverySender(options);
}
