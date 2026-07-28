import {
  webhooksCreate,
  webhooksDisable,
  webhooksList,
  webhooksListDeliveries,
  webhooksListDeliveriesPage,
  webhooksRetryDueDeliveries,
  webhooksTest,
  type CreateWebhookSubscriptionRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import { numberFlag, optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";
import { runWebhookRetryWorker } from "./webhook-worker";

interface WebhookCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeWebhookCommand(
  area: string,
  action: string | undefined,
  context: WebhookCommandContext,
): Promise<number> | undefined {
  if (area === "workers" && action === "webhook-retry")
    return webhookRetryWorker(context);
  if (area !== "webhooks") return undefined;
  if (action === "list") return result(context, listWebhooks(context));
  if (action === "create") return createWebhook(context);
  if (action === "disable")
    return result(
      context,
      disableWebhook(
        context,
        requiredFlag(context.parsed, "webhook", "webhook-id"),
      ),
    );
  if (action === "deliveries")
    return result(
      context,
      listWebhookDeliveries(
        context,
        flagValue(context.parsed.flags, "webhook", "webhook-id"),
      ),
    );
  if (action === "retry-due") return result(context, retryDueWebhooks(context));
  if (action === "test")
    return result(
      context,
      testWebhook(
        context,
        requiredFlag(context.parsed, "webhook", "webhook-id"),
      ),
    );
  return undefined;
}

function createWebhook(context: WebhookCommandContext): Promise<number> {
  const body: CreateWebhookSubscriptionRequest = {
    url: requiredFlag(context.parsed, "url"),
    eventTypes: requiredFlag(context.parsed, "events")
      .split(",")
      .map((event) => event.trim())
      .filter((event) => event.length > 0) as never,
  };
  return result(context, createWebhookSubscription(context, body));
}

function webhookRetryWorker(context: WebhookCommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  return runWebhookRetryWorker({
    client: { webhooks: { retryDue: () => retryDueWebhooks(context) } },
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
  });
}

async function listWebhooks(context: WebhookCommandContext) {
  return (
    await webhooksList({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function createWebhookSubscription(
  context: WebhookCommandContext,
  body: CreateWebhookSubscriptionRequest,
) {
  return (
    await webhooksCreate({
      body,
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

async function disableWebhook(
  context: WebhookCommandContext,
  webhookId: string,
) {
  return (
    await webhooksDisable({
      client: generatedClient(context),
      path: { webhookId },
      throwOnError: true,
    })
  ).data.data;
}

async function listWebhookDeliveries(
  context: WebhookCommandContext,
  webhookId?: string,
) {
  const client = generatedClient(context);
  if (webhookId === undefined)
    return (
      await webhooksListDeliveriesPage({
        client,
        throwOnError: true,
      })
    ).data.data;
  return (
    await webhooksListDeliveries({
      client,
      path: { webhookId },
      throwOnError: true,
    })
  ).data.data;
}

async function testWebhook(context: WebhookCommandContext, webhookId: string) {
  return (
    await webhooksTest({
      client: generatedClient(context),
      path: { webhookId },
      throwOnError: true,
    })
  ).data.data;
}

async function retryDueWebhooks(context: WebhookCommandContext) {
  return (
    await webhooksRetryDueDeliveries({
      client: generatedClient(context),
      throwOnError: true,
    })
  ).data.data;
}

function generatedClient(context: WebhookCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

async function result(
  context: WebhookCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
