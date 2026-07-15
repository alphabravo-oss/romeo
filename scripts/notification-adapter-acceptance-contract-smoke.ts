import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  UserNotification,
} from "../packages/core/src/domain/entities";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import {
  SlackWebhookNotificationDeliverySender,
  maxNotificationAttempts,
} from "../packages/core/src/services/notification-delivery";
import type { SecretResolver } from "../packages/core/src/services/secret-resolver";

type Api = ReturnType<typeof createRomeoApi>;

const output = argValue("--output");
const pid = process.pid;
const rawSentinels = {
  commentBody: `RAW_NOTIFICATION_COMMENT_BODY_${pid}`,
  webhookUrl: `https://webhook.acceptance.example/hook/RAW_WEBHOOK_${pid}`,
  slackUrl: `https://hooks.slack.com/services/RAW_SLACK_${pid}`,
  teamsUrl: `https://teams.acceptance.example/hook/RAW_TEAMS_${pid}`,
  retrySuccessUrl: `https://webhook.acceptance.example/hook/RAW_RETRY_SUCCESS_${pid}`,
  retryDeadLetterUrl: `https://webhook.acceptance.example/hook/RAW_RETRY_DEADLETTER_${pid}`,
  emailAddress: `Target+RAW_EMAIL_${pid}@example.com`,
  smtpUser: `RAW_SMTP_USER_${pid}`,
  smtpPassword: `RAW_SMTP_PASSWORD_${pid}`,
  pagerDutyRoutingKey: `RAW_PAGERDUTY_ROUTING_KEY_${pid}`,
  fcmDeviceToken: `RAW_FCM_DEVICE_TOKEN_${pid}`.padEnd(32, "X"),
  fcmAccessToken: `RAW_FCM_ACCESS_TOKEN_${pid}`,
  signingKey: `RAW_NOTIFICATION_SIGNING_KEY_${pid}`.padEnd(32, "S"),
  providerFailureBody: `RAW_NOTIFICATION_PROVIDER_FAILURE_${pid}`,
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const fcmPrivateKey = privateKey.export({ format: "pem", type: "pkcs8" });
const fcmServiceAccountJson = JSON.stringify({
  client_email: "firebase-adminsdk@romeo-acceptance.iam.gserviceaccount.com",
  private_key: fcmPrivateKey,
  project_id: "romeo-acceptance",
});

const disabledRepository = new InMemoryRomeoRepository();
const disabledApi = createApi(disabledRepository, {
  NOTIFICATION_DELIVERY_DRIVER: "disabled",
});
await createChannel(disabledApi, "webhook", "Disabled webhook", {
  url: rawSentinels.webhookUrl,
});
await createMentionComment(disabledApi);
const disabledDeliveries = await listDeliveries(disabledApi);
const disabledDelivery = disabledDeliveries[0];
if (
  disabledDeliveries.length !== 1 ||
  disabledDelivery?.status !== "disabled" ||
  disabledDelivery.errorCode !== "delivery_adapter_not_configured"
) {
  throw new Error("Disabled notification sender did not fail closed.");
}
assertNoRawContent(
  "disabled delivery readback",
  JSON.stringify(disabledDeliveries),
);

const configuredState = {
  commentBodyInProviderPayloads: false,
  fcmAccessTokenSeen: false,
  fcmDeviceTokenSeen: false,
  fetchRequestCount: 0,
  pagerDutyRoutingKeySeen: false,
  providerResponseBodiesReturned: false,
  requestTypes: [] as string[],
  secretResolveCount: 0,
  smtpSendMailCount: 0,
};
const configuredRepository = new InMemoryRomeoRepository();
const configuredApi = createApi(
  configuredRepository,
  {
    NOTIFICATION_DELIVERY_DRIVER: "configured",
    NOTIFICATION_EMAIL_DELIVERY_DRIVER: "smtp",
    NOTIFICATION_EMAIL_FROM: "notify@romeo.example",
    NOTIFICATION_FCM_PROJECT_ID: "romeo-acceptance",
    NOTIFICATION_FCM_SERVICE_ACCOUNT_REF:
      "env://ROMEO_ACCEPTANCE_FCM_SERVICE_ACCOUNT_JSON",
    NOTIFICATION_SMTP_HOST: "smtp.acceptance.example",
    NOTIFICATION_SMTP_PASSWORD: rawSentinels.smtpPassword,
    NOTIFICATION_SMTP_USER: rawSentinels.smtpUser,
    WEBHOOK_SIGNING_KEY: rawSentinels.signingKey,
  },
  {
    notificationSmtpSendMail: async (message) => {
      configuredState.smtpSendMailCount += 1;
      if (message.to !== rawSentinels.emailAddress.toLowerCase()) {
        throw new Error("SMTP recipient was not normalized.");
      }
      if (message.text.includes(rawSentinels.commentBody)) {
        configuredState.commentBodyInProviderPayloads = true;
      }
      return {
        messageId: `RAW_SMTP_MESSAGE_ID_${pid}`,
        response: rawSentinels.providerFailureBody,
      };
    },
    secretResolver: secretResolver((secretRef) => {
      configuredState.secretResolveCount += 1;
      if (secretRef === "env://ROMEO_ACCEPTANCE_PAGERDUTY_ROUTING_KEY") {
        return rawSentinels.pagerDutyRoutingKey;
      }
      if (secretRef === "env://ROMEO_ACCEPTANCE_FCM_DEVICE_TOKEN") {
        return JSON.stringify({ token: rawSentinels.fcmDeviceToken });
      }
      if (secretRef === "env://ROMEO_ACCEPTANCE_FCM_SERVICE_ACCOUNT_JSON") {
        return fcmServiceAccountJson;
      }
      return undefined;
    }),
    webhookFetch: async (input, init) =>
      configuredFetch(configuredState, input, init),
  },
);
const configuredChannels = [
  await createChannel(configuredApi, "webhook", "Product webhook", {
    url: rawSentinels.webhookUrl,
  }),
  await createChannel(configuredApi, "slack", "Slack", {
    url: rawSentinels.slackUrl,
  }),
  await createChannel(configuredApi, "teams", "Teams", {
    url: rawSentinels.teamsUrl,
  }),
  await createChannel(configuredApi, "email", "Email", {
    to: rawSentinels.emailAddress,
  }),
  await createChannel(configuredApi, "pagerduty", "PagerDuty", {
    routingKeyRef: "env://ROMEO_ACCEPTANCE_PAGERDUTY_ROUTING_KEY",
    severity: "warning",
  }),
  await createChannel(configuredApi, "mobile_push", "Mobile push", {
    tokenRef: "env://ROMEO_ACCEPTANCE_FCM_DEVICE_TOKEN",
    platform: "ios",
  }),
];
await assertChannelReadbackRedactionAndInternalConfig(
  configuredChannels,
  configuredRepository,
);
await createMentionComment(configuredApi);
const configuredNotifications = await listNotifications(configuredApi);
const configuredDeliveries = await listDeliveries(configuredApi);
const sentByProvider = deliveryCountsByProvider(configuredDeliveries);
if (
  configuredNotifications.length !== 1 ||
  configuredDeliveries.length !== configuredChannels.length ||
  configuredDeliveries.some((delivery) => delivery.status !== "sent") ||
  sentByProvider.smtp !== 1 ||
  sentByProvider.webhook !== 1 ||
  sentByProvider.slack !== 1 ||
  sentByProvider.teams !== 1 ||
  sentByProvider.pagerduty !== 1 ||
  sentByProvider.fcm !== 1 ||
  configuredState.smtpSendMailCount !== 1 ||
  configuredState.pagerDutyRoutingKeySeen !== true ||
  configuredState.fcmDeviceTokenSeen !== true ||
  configuredState.fcmAccessTokenSeen !== true ||
  configuredState.commentBodyInProviderPayloads !== false
) {
  throw new Error("Configured notification adapter routing was incomplete.");
}
assertNoRawContent(
  "configured notification and delivery readback",
  JSON.stringify({
    notifications: configuredNotifications,
    deliveries: configuredDeliveries,
  }),
);

const fetchCountBeforeSuppression = configuredState.fetchRequestCount;
await patchJson(configuredApi, "/api/v1/admin/notification-policy", {
  suppressedNotificationTypes: ["chat_mention"],
});
await createMentionComment(configuredApi);
const suppressedDeliveries = (await listDeliveries(configuredApi)).filter(
  (delivery) =>
    delivery.status === "disabled" &&
    delivery.errorCode === "notification_type_suppressed_by_policy",
);
if (
  suppressedDeliveries.length !== configuredChannels.length ||
  configuredState.fetchRequestCount !== fetchCountBeforeSuppression ||
  suppressedDeliveries.some(
    (delivery) => delivery.metadata.policyBlocked !== true,
  )
) {
  throw new Error(
    "Notification policy suppression did not create safe ledgers.",
  );
}
assertNoRawContent(
  "policy-suppressed delivery readback",
  JSON.stringify(suppressedDeliveries),
);

const retryState = { deadLetterAttempts: 0, successAttempts: 0 };
const retryRepository = new InMemoryRomeoRepository();
const retryApi = createApi(
  retryRepository,
  { NOTIFICATION_DELIVERY_DRIVER: "webhook" },
  {
    webhookFetch: async (input) => {
      const url = String(input);
      if (url === rawSentinels.retrySuccessUrl) {
        retryState.successAttempts += 1;
        return retryState.successAttempts === 1
          ? new Response(rawSentinels.providerFailureBody, { status: 503 })
          : new Response(null, { status: 204 });
      }
      if (url === rawSentinels.retryDeadLetterUrl) {
        retryState.deadLetterAttempts += 1;
        return new Response(rawSentinels.providerFailureBody, { status: 503 });
      }
      return new Response(null, { status: 404 });
    },
  },
);
await createChannel(retryApi, "webhook", "Retry success", {
  url: rawSentinels.retrySuccessUrl,
});
await createChannel(retryApi, "webhook", "Retry dead letter", {
  url: rawSentinels.retryDeadLetterUrl,
});
await createMentionComment(retryApi);
await forceFailedDeliveriesDue(retryRepository);
await retryDue(retryApi);
await forceFailedDeliveriesDue(retryRepository);
await retryDue(retryApi);
await forceFailedDeliveriesDue(retryRepository);
await retryDue(retryApi);
await forceFailedDeliveriesDue(retryRepository);
await retryDue(retryApi);
const retryDeliveries = await listDeliveries(retryApi);
const retrySucceeded = retryDeliveries.find(
  (delivery) => delivery.status === "sent" && delivery.attemptCount === 2,
);
const deadLettered = retryDeliveries.find(
  (delivery) =>
    delivery.status === "failed" &&
    delivery.attemptCount === maxNotificationAttempts &&
    readRecord(delivery.metadata.deadLetter)?.reason ===
      "max_attempts_exhausted",
);
if (
  retrySucceeded === undefined ||
  retrySucceeded.errorCode !== undefined ||
  retrySucceeded.metadata.nextAttemptAt !== undefined ||
  retrySucceeded.metadata.deadLetter !== undefined ||
  deadLettered === undefined
) {
  throw new Error(
    "Notification retry lifecycle did not clear/dead-letter safely.",
  );
}
assertNoRawContent("retry delivery readback", JSON.stringify(retryDeliveries));

const isolationFetchState = { called: false };
const isolationDelivery = await new SlackWebhookNotificationDeliverySender({
  fetchImpl: async () => {
    isolationFetchState.called = true;
    return new Response(null, { status: 200 });
  },
}).createDelivery({
  repository: new InMemoryRomeoRepository(),
  notification: notificationFixture(),
  channel: channelFixture("webhook", { url: rawSentinels.webhookUrl }),
});
if (
  isolationFetchState.called ||
  isolationDelivery.status !== "failed" ||
  isolationDelivery.errorCode !== "notification_channel_type_unsupported"
) {
  throw new Error(
    "Notification sender did not isolate channel type before egress.",
  );
}
assertNoRawContent(
  "channel isolation readback",
  JSON.stringify(isolationDelivery),
);

const evidence = {
  schemaVersion: "romeo.notification-adapter-acceptance-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "disabled_sender_fails_closed",
    "configured_adapter_routes_mixed_channel_types",
    "secret_backed_channels_resolve_at_send_time",
    "provider_payloads_use_id_only_notification_context",
    "policy_suppression_creates_disabled_ledgers",
    "retry_due_success_clears_retry_state",
    "retry_due_exhaustion_dead_letters_metadata_only",
    "channel_type_isolation_blocks_wrong_adapter_egress",
    "channel_readback_redacts_destinations_and_secret_refs",
    "delivery_evidence_omits_destinations_bodies_and_secrets",
  ],
  channelLifecycle: {
    createdChannelTypes: configuredChannels
      .map((channel) => channel.type)
      .sort(),
    redactedConfigReadbackVerified: true,
    internalConfigRetainedForDelivery: true,
    disabledStatus: disabledDelivery?.status,
    disabledErrorCode: disabledDelivery?.errorCode,
    policySuppressedDeliveryCount: suppressedDeliveries.length,
    policySuppressionAttemptedEgress: false,
  },
  adapterRouting: {
    deliveryCount: configuredDeliveries.length,
    fetchRequestCount: configuredState.fetchRequestCount,
    providerCounts: sentByProvider,
    smtpSendMailCount: configuredState.smtpSendMailCount,
    secretResolutionCount: configuredState.secretResolveCount,
    pagerDutyRoutingKeyResolved: configuredState.pagerDutyRoutingKeySeen,
    fcmDeviceTokenResolved: configuredState.fcmDeviceTokenSeen,
    fcmAccessTokenUsed: configuredState.fcmAccessTokenSeen,
    idOnlyProviderPayloads: true,
    commentBodyInProviderPayloads:
      configuredState.commentBodyInProviderPayloads,
  },
  retry: {
    successStatus: retrySucceeded.status,
    successAttemptCount: retrySucceeded.attemptCount,
    successClearedError: retrySucceeded.errorCode === undefined,
    successClearedRetryState:
      retrySucceeded.metadata.nextAttemptAt === undefined &&
      retrySucceeded.metadata.deadLetter === undefined,
    deadLetterStatus: deadLettered.status,
    deadLetterAttemptCount: deadLettered.attemptCount,
    deadLetterReason: readRecord(deadLettered.metadata.deadLetter)?.reason,
    rawProviderFailureReturned: false,
  },
  channelTypeIsolation: {
    fetchAttempted: isolationFetchState.called,
    status: isolationDelivery.status,
    errorCode: isolationDelivery.errorCode,
  },
  redaction: {
    rawCommentBodyReturned: false,
    rawDestinationReturned: false,
    rawWebhookUrlsReturned: false,
    rawEmailReturned: false,
    rawSecretRefsReturned: false,
    rawSecretValuesReturned: false,
    rawProviderResponseReturned: false,
    rawSmtpCredentialsReturned: false,
    rawFcmCredentialsReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoRawContent("notification acceptance evidence", serialized, [
  ...Object.values(rawSentinels),
  String(fcmPrivateKey),
  fcmServiceAccountJson,
]);

if (output === undefined) {
  process.stdout.write(serialized);
} else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote notification acceptance smoke evidence to ${outputPath}`);
}

function createApi(
  repository: InMemoryRomeoRepository,
  envOverrides: Record<string, string> = {},
  options: Omit<NonNullable<Parameters<typeof createRomeoApi>[1]>, "env"> = {},
): Api {
  return createRomeoApi(repository, {
    ...options,
    env: readEnv({ DEV_SEEDED_LOGIN: "true", ...envOverrides }),
  });
}

async function createChannel(
  api: Api,
  type: string,
  name: string,
  config: Record<string, unknown>,
): Promise<NotificationDeliveryChannel> {
  const { body, response } = await postJson<{
    data: NotificationDeliveryChannel;
  }>(api, "/api/v1/notification-channels", { type, name, config });
  assertStatus(response, 201, `create ${type} channel`);
  return body.data;
}

async function createMentionComment(api: Api): Promise<void> {
  const { body, response } = await postJson<{
    data: { id: string; body: string; mentionedUserIds: string[] };
  }>(api, "/api/v1/chats/chat_welcome/comments", {
    body: `@user_dev_admin ${rawSentinels.commentBody}`,
  });
  assertStatus(response, 201, "create mention comment");
  if (!body.data.mentionedUserIds.includes("user_dev_admin")) {
    throw new Error("Mention comment did not resolve seeded user.");
  }
}

async function listNotifications(api: Api): Promise<UserNotification[]> {
  const { body, response } = await requestJson<{ data: UserNotification[] }>(
    api,
    "/api/v1/notifications",
  );
  assertStatus(response, 200, "list notifications");
  return body.data;
}

async function listDeliveries(api: Api): Promise<NotificationDelivery[]> {
  const { body, response } = await requestJson<{
    data: NotificationDelivery[];
  }>(api, "/api/v1/notification-deliveries");
  assertStatus(response, 200, "list notification deliveries");
  return body.data;
}

async function retryDue(api: Api): Promise<void> {
  const { body, response } = await postJson<{
    data: { deliveries: NotificationDelivery[] };
  }>(api, "/api/v1/notification-deliveries/retry-due", {});
  assertStatus(response, 202, "retry due notification deliveries");
  assertNoRawContent("retry due response", JSON.stringify(body));
}

async function forceFailedDeliveriesDue(
  repository: InMemoryRomeoRepository,
): Promise<void> {
  const deliveries = await repository.listNotificationDeliveries(
    "org_default",
    "user_dev_admin",
  );
  await Promise.all(
    deliveries
      .filter((delivery) => delivery.status === "failed")
      .map((delivery) =>
        repository.updateNotificationDelivery({
          ...delivery,
          metadata: {
            ...delivery.metadata,
            nextAttemptAt: "2000-01-01T00:00:00.000Z",
          },
        }),
      ),
  );
}

async function requestJson<T>(
  api: Api,
  path: string,
  input: RequestInit = {},
): Promise<{ body: T; response: Response }> {
  const headers = new Headers(input.headers);
  if (input.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await api.request(path, { ...input, headers });
  return { body: (await response.json()) as T, response };
}

async function postJson<T>(
  api: Api,
  path: string,
  body: unknown,
): Promise<{ body: T; response: Response }> {
  return requestJson<T>(api, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchJson<T>(
  api: Api,
  path: string,
  body: unknown,
): Promise<{ body: T; response: Response }> {
  return requestJson<T>(api, path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function configuredFetch(
  state: typeof configuredState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Response | Promise<Response> {
  state.fetchRequestCount += 1;
  const url = String(input);
  const body = String(init?.body ?? "");
  if (body.includes(rawSentinels.commentBody)) {
    state.commentBodyInProviderPayloads = true;
  }
  if (url === "https://oauth2.googleapis.com/token") {
    state.requestTypes.push("fcm_token");
    return jsonResponse({
      access_token: rawSentinels.fcmAccessToken,
      expires_in: 3600,
    });
  }
  if (
    url ===
    "https://fcm.googleapis.com/v1/projects/romeo-acceptance/messages:send"
  ) {
    state.requestTypes.push("fcm_send");
    state.fcmAccessTokenSeen =
      headerValue(init?.headers, "authorization") ===
      `Bearer ${rawSentinels.fcmAccessToken}`;
    state.fcmDeviceTokenSeen = body.includes(rawSentinels.fcmDeviceToken);
    return jsonResponse({ name: "projects/redacted/messages/redacted" });
  }
  if (url === "https://events.pagerduty.com/v2/enqueue") {
    state.requestTypes.push("pagerduty");
    state.pagerDutyRoutingKeySeen = body.includes(
      rawSentinels.pagerDutyRoutingKey,
    );
    return new Response(null, { status: 202 });
  }
  if (url === rawSentinels.webhookUrl) {
    state.requestTypes.push("webhook");
    return new Response(null, { status: 204 });
  }
  if (url === rawSentinels.slackUrl) {
    state.requestTypes.push("slack");
    return new Response(null, { status: 200 });
  }
  if (url === rawSentinels.teamsUrl) {
    state.requestTypes.push("teams");
    return new Response(null, { status: 200 });
  }
  state.providerResponseBodiesReturned = true;
  return new Response(rawSentinels.providerFailureBody, { status: 404 });
}

function secretResolver(resolve: (secretRef: string) => string | undefined) {
  const resolver: SecretResolver = {
    async check(secretRef) {
      const value = resolve(secretRef);
      return value === undefined
        ? { available: false, failureCode: "secret_not_found", scheme: "env" }
        : { available: true, scheme: "env" };
    },
    async resolveValue(secretRef) {
      const value = resolve(secretRef);
      return value === undefined
        ? { available: false, failureCode: "secret_not_found", scheme: "env" }
        : { available: true, scheme: "env", value };
    },
  };
  return resolver;
}

function deliveryCountsByProvider(
  deliveries: NotificationDelivery[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const delivery of deliveries) {
    const provider = String(delivery.metadata.provider ?? "webhook");
    counts[provider] = (counts[provider] ?? 0) + 1;
  }
  return counts;
}

async function assertChannelReadbackRedactionAndInternalConfig(
  channels: NotificationDeliveryChannel[],
  repository: InMemoryRomeoRepository,
): Promise<void> {
  const email = channels.find((channel) => channel.type === "email");
  const pagerDuty = channels.find((channel) => channel.type === "pagerduty");
  const mobilePush = channels.find((channel) => channel.type === "mobile_push");
  if (
    email === undefined ||
    pagerDuty === undefined ||
    mobilePush === undefined ||
    email.config.toDomain !== "example.com" ||
    email.config.to !== undefined ||
    pagerDuty.config.routingKeyRefScheme !== "env" ||
    pagerDuty.config.routingKeyRef !== undefined ||
    pagerDuty.config.severity !== "warning" ||
    mobilePush.config.tokenRefScheme !== "env" ||
    mobilePush.config.tokenRef !== undefined ||
    mobilePush.config.platform !== "ios"
  ) {
    throw new Error("Notification channel readback was not redacted.");
  }
  assertNoRawContent(
    "notification channel public readback",
    JSON.stringify(channels),
    [
      rawSentinels.emailAddress,
      rawSentinels.webhookUrl,
      rawSentinels.slackUrl,
      rawSentinels.teamsUrl,
      "ROMEO_ACCEPTANCE_PAGERDUTY_ROUTING_KEY",
      "ROMEO_ACCEPTANCE_FCM_DEVICE_TOKEN",
    ],
  );
  const stored = await repository.listNotificationDeliveryChannels(
    "org_default",
    "user_dev_admin",
  );
  const storedEmail = stored.find((channel) => channel.type === "email");
  const storedPagerDuty = stored.find(
    (channel) => channel.type === "pagerduty",
  );
  const storedMobilePush = stored.find(
    (channel) => channel.type === "mobile_push",
  );
  if (
    storedEmail?.config.to !== rawSentinels.emailAddress.toLowerCase() ||
    storedPagerDuty?.config.routingKeyRef !==
      "env://ROMEO_ACCEPTANCE_PAGERDUTY_ROUTING_KEY" ||
    storedMobilePush?.config.tokenRef !==
      "env://ROMEO_ACCEPTANCE_FCM_DEVICE_TOKEN"
  ) {
    throw new Error("Notification channel internal config was not retained.");
  }
}

function notificationFixture(): UserNotification {
  return {
    id: "notification_acceptance",
    orgId: "org_default",
    userId: "user_dev_admin",
    type: "chat_mention",
    actorId: "user_dev_admin",
    resourceType: "chat",
    resourceId: "chat_welcome",
    metadata: { chatId: "chat_welcome", commentId: "comment_acceptance" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function channelFixture(
  type: NotificationDeliveryChannel["type"],
  config: Record<string, unknown>,
): NotificationDeliveryChannel {
  return {
    id: "notification_channel_acceptance",
    orgId: "org_default",
    userId: "user_dev_admin",
    type,
    name: "acceptance",
    config,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`,
    );
  }
}

function assertNoRawContent(
  label: string,
  value: string,
  rawValues: string[] = Object.values(rawSentinels),
): void {
  for (const raw of rawValues) {
    if (raw.length > 0 && value.includes(raw)) {
      throw new Error(`${label} leaked raw notification content.`);
    }
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headerValue(
  headers: HeadersInit | undefined,
  key: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(key) ?? undefined;
  if (Array.isArray(headers)) {
    const match = headers.find(
      ([name]) => name.toLowerCase() === key.toLowerCase(),
    );
    return match?.[1];
  }
  return headers[key];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
