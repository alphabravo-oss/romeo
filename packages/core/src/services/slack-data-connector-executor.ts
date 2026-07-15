import { createHash } from "node:crypto";

import type { DataConnector, LocalImportSyncItem } from "../domain/entities";
import { ApiError } from "../errors";
import {
  assertConnectorHostAllowed,
  type DataConnectorExecutionResult,
  type DataConnectorExecutor,
  type WebsiteConnectorEgressPolicy,
  type WebsiteConnectorHostLookup,
} from "./data-connector-executors";
import {
  retryConnectorResponse,
  type DataConnectorRetryPolicy,
} from "./data-connector-retry";
import type { SecretResolver } from "./secret-resolver";

interface SlackConnectorConfig {
  apiUrl: URL;
  channelIds: string[];
  latest?: string;
  maxItemsPerChannel: number;
  oldest?: string;
  secretRef: string;
}

interface SlackSecret {
  accessToken?: unknown;
  bearerToken?: unknown;
  botToken?: unknown;
  token?: unknown;
}

export class SlackDataConnectorExecutor implements DataConnectorExecutor {
  private readonly allowedHosts: string[];
  private readonly egressPolicy: WebsiteConnectorEgressPolicy;
  private readonly fetchImpl: typeof fetch;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly maxBytes: number;
  private readonly maxItemsPerChannel: number;
  private readonly retryPolicy: DataConnectorRetryPolicy;
  private readonly secretResolver: SecretResolver | undefined;
  private readonly timeoutMs: number;

  constructor(
    options: {
      allowedHosts?: string[];
      egressPolicy?: WebsiteConnectorEgressPolicy;
      fetchImpl?: typeof fetch;
      hostLookup?: WebsiteConnectorHostLookup;
      maxBytes?: number;
      maxItemsPerChannel?: number;
      retryAttempts?: number;
      retryBackoffMs?: number;
      secretResolver?: SecretResolver;
      timeoutMs?: number;
    } = {},
  ) {
    this.allowedHosts = options.allowedHosts ?? [];
    this.egressPolicy = options.egressPolicy ?? "allow_public";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.hostLookup = options.hostLookup;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxItemsPerChannel = options.maxItemsPerChannel ?? 50;
    this.retryPolicy = {
      retryAttempts: options.retryAttempts ?? 1,
      retryBackoffMs: options.retryBackoffMs ?? 250,
    };
    this.secretResolver = options.secretResolver;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    if (connector.type !== "slack") {
      throw new ApiError(
        "connector_execution_disabled",
        "Connector execution is disabled for this connector type.",
        409,
      );
    }
    const config = readSlackConfig(connector);
    await assertConnectorHostAllowed(config.apiUrl, {
      allowedHosts: this.allowedHosts,
      egressPolicy: this.egressPolicy,
      ...(this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup }),
    });
    const authorization = await this.authorizationHeader(config.secretRef);
    const maxItemsPerChannel = Math.min(
      config.maxItemsPerChannel,
      this.maxItemsPerChannel,
    );
    const items: LocalImportSyncItem[] = [];
    let messageCount = 0;
    let totalBytes = 0;
    for (const channelId of config.channelIds) {
      const messages = await this.fetchChannelMessages({
        authorization,
        channelId,
        config,
        limit: maxItemsPerChannel,
      });
      messageCount += messages.length;
      const content = markdownDocument([
        `# Slack channel ${stableHash(channelId)}`,
        ...messages.map(slackMessageMarkdown),
      ]);
      const sizeBytes = new TextEncoder().encode(content).length;
      totalBytes += sizeBytes;
      items.push({
        fileName: safeFileName(`slack-${stableHash(channelId)}.md`),
        mimeType: "text/markdown",
        content,
        sizeBytes,
      });
    }
    return {
      items,
      summary: {
        connector: "slack",
        apiHost: config.apiUrl.hostname,
        channelCount: config.channelIds.length,
        channelHashes: config.channelIds.map(stableHash),
        ...(config.oldest === undefined
          ? {}
          : { oldestHash: stableHash(config.oldest) }),
        ...(config.latest === undefined
          ? {}
          : { latestHash: stableHash(config.latest) }),
        messageCount,
        totalByteLength: totalBytes,
      },
    };
  }

  private async authorizationHeader(secretRef: string): Promise<string> {
    if (this.secretResolver?.resolveValue === undefined) {
      throw new ApiError(
        "connector_slack_secret_ref_unsupported",
        "Slack connector secret references require a value-capable secret resolver.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "connector_slack_secret_ref_unavailable",
        "Slack connector secret reference is unavailable.",
        409,
        {
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          secretRefScheme: resolution.scheme,
        },
      );
    }
    return `Bearer ${slackToken(resolution.value)}`;
  }

  private async fetchChannelMessages(input: {
    authorization: string;
    channelId: string;
    config: SlackConnectorConfig;
    limit: number;
  }): Promise<Record<string, unknown>[]> {
    const url = slackApiUrl(input.config.apiUrl, "/conversations.history");
    url.searchParams.set("channel", input.channelId);
    url.searchParams.set("limit", String(input.limit));
    if (input.config.oldest !== undefined)
      url.searchParams.set("oldest", input.config.oldest);
    if (input.config.latest !== undefined)
      url.searchParams.set("latest", input.config.latest);

    const payload = await this.fetchJson(
      url,
      input.authorization,
      "Slack connector channel history fetch failed.",
    );
    if (payload.ok !== true) {
      throw new ApiError(
        "connector_fetch_failed",
        "Slack connector channel history fetch failed.",
        502,
        {
          ...(typeof payload.error === "string"
            ? { providerError: payload.error }
            : {}),
        },
      );
    }
    return arrayValue(payload, "messages")
      .filter(isRecord)
      .slice(0, input.limit);
  }

  private async fetchJson(
    url: URL,
    authorization: string,
    errorMessage: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await retryConnectorResponse(
        () =>
          this.fetchImpl(url.toString(), {
            headers: {
              accept: "application/json",
              authorization,
              "user-agent": "RomeoDataConnector/0.1",
            },
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
          }),
        this.retryPolicy,
      );
    } catch {
      throw new ApiError("connector_fetch_failed", errorMessage, 502);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok)
      throw new ApiError("connector_fetch_failed", errorMessage, 502, {
        status: response.status,
      });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Slack connector response exceeds the configured size limit.",
        413,
      );
    }
    const responseBody = await response.arrayBuffer();
    if (responseBody.byteLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Slack connector response exceeds the configured size limit.",
        413,
      );
    }
    try {
      const parsed = JSON.parse(new TextDecoder().decode(responseBody));
      if (!isRecord(parsed)) throw new Error("invalid");
      return parsed;
    } catch {
      throw new ApiError(
        "connector_fetch_failed",
        "Slack connector response is invalid.",
        502,
      );
    }
  }
}

function readSlackConfig(connector: DataConnector): SlackConnectorConfig {
  return {
    apiUrl: new URL(stringConfig(connector, "apiUrl")),
    channelIds: arrayConfig(connector, "channelIds"),
    maxItemsPerChannel: numberConfig(connector, "maxItemsPerChannel", 50),
    ...(typeof connector.config.oldest === "string"
      ? { oldest: connector.config.oldest }
      : {}),
    ...(typeof connector.config.latest === "string"
      ? { latest: connector.config.latest }
      : {}),
    secretRef: stringConfig(connector, "secretRef"),
  };
}

function slackApiUrl(baseUrl: URL, path: string): URL {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${basePath}${path}`;
  url.search = "";
  url.hash = "";
  return url;
}

function slackToken(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      for (const key of ["token", "botToken", "bearerToken", "accessToken"]) {
        const candidate = parsed[key as keyof SlackSecret];
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate.trim().replace(/^Bearer\s+/iu, "");
        }
      }
    }
  } catch {
    // Raw token values are allowed when the secret backend stores only the token.
  }
  if (trimmed.length === 0) {
    throw new ApiError(
      "connector_slack_secret_ref_invalid",
      "Slack connector secret must contain a token.",
      400,
    );
  }
  return trimmed.replace(/^Bearer\s+/iu, "");
}

function slackMessageMarkdown(message: Record<string, unknown>): string {
  return markdownDocument([
    `## ${stringValue(message.ts) ?? stableHash(JSON.stringify(message))}`,
    labeledValue("User", stringValue(message.user)),
    labeledValue("Thread", stringValue(message.thread_ts)),
    decodeSlackText(stringValue(message.text) ?? ""),
  ]);
}

function decodeSlackText(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .trim();
}

function stringConfig(connector: DataConnector, key: string): string {
  const value = connector.config[key];
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      `Slack connector requires ${key}.`,
      400,
    );
  return value;
}

function arrayConfig(connector: DataConnector, key: string): string[] {
  const value = connector.config[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new ApiError(
      "invalid_connector_config",
      `Slack connector requires ${key}.`,
      400,
    );
  return value;
}

function numberConfig(
  connector: DataConnector,
  key: string,
  fallback: number,
): number {
  const value = connector.config[key];
  return Number.isInteger(value) ? Number(value) : fallback;
}

function arrayValue(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function labeledValue(
  label: string,
  value: string | undefined,
): string | undefined {
  return value === undefined || value.trim().length === 0
    ? undefined
    : `${label}: ${value}`;
}

function markdownDocument(parts: Array<string | undefined>): string {
  return parts
    .map((part) => (part === undefined ? "" : part.trim()))
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function safeFileName(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 140) || "slack-source.md"
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
