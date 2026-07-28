import { Client as NotionClient } from "@notionhq/client";
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
import type { SecretResolver } from "./secret-resolver";

interface NotionConnectorConfig {
  apiUrl: URL;
  apiVersion: string;
  maxBlocksPerPage: number;
  maxItems: number;
  query: string;
  secretRef: string;
}

interface NotionSecret {
  accessToken?: unknown;
  bearerToken?: unknown;
  token?: unknown;
}

export class NotionDataConnectorExecutor implements DataConnectorExecutor {
  private readonly allowedHosts: string[];
  private readonly egressPolicy: WebsiteConnectorEgressPolicy;
  private readonly fetchImpl: typeof fetch;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly maxBlocksPerPage: number;
  private readonly maxBytes: number;
  private readonly maxItems: number;
  private readonly retry: {
    maxRetries: number;
    initialRetryDelayMs: number;
    maxRetryDelayMs: number;
  };
  private readonly secretResolver: SecretResolver | undefined;
  private readonly timeoutMs: number;

  constructor(
    options: {
      allowedHosts?: string[];
      egressPolicy?: WebsiteConnectorEgressPolicy;
      fetchImpl?: typeof fetch;
      hostLookup?: WebsiteConnectorHostLookup;
      maxBlocksPerPage?: number;
      maxBytes?: number;
      maxItems?: number;
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
    this.maxBlocksPerPage = options.maxBlocksPerPage ?? 25;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxItems = options.maxItems ?? 50;
    const retryBackoffMs = options.retryBackoffMs ?? 250;
    this.retry = {
      maxRetries: options.retryAttempts ?? 1,
      initialRetryDelayMs: retryBackoffMs,
      maxRetryDelayMs: retryBackoffMs * 4,
    };
    this.secretResolver = options.secretResolver;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    if (connector.type !== "notion") {
      throw new ApiError(
        "connector_execution_disabled",
        "Connector execution is disabled for this connector type.",
        409,
      );
    }
    const config = readNotionConfig(connector);
    await assertConnectorHostAllowed(config.apiUrl, {
      allowedHosts: this.allowedHosts,
      egressPolicy: this.egressPolicy,
      ...(this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup }),
    });
    const token = await this.token(config.secretRef);
    const client = new NotionClient({
      auth: token,
      baseUrl: config.apiUrl.toString().replace(/\/+$/u, ""),
      notionVersion: config.apiVersion,
      timeoutMs: this.timeoutMs,
      retry: this.retry,
      fetch: (url, init) => this.boundedFetch(url, init),
    });
    const maxItems = Math.min(config.maxItems, this.maxItems);
    const searchPayload = await this.notionRequest(
      () =>
        client.search({
          filter: { property: "object", value: "page" },
          page_size: maxItems,
          query: config.query,
        }),
      "Notion connector search failed.",
    );
    const pages = searchPayload.results.slice(0, maxItems);
    const items: LocalImportSyncItem[] = [];
    let totalBytes = 0;
    let blockCount = 0;
    for (const page of pages) {
      if (!isRecord(page)) continue;
      const pageRecord = page as unknown as Record<string, unknown>;
      const id =
        stringValue(pageRecord.id) ?? stableHash(JSON.stringify(pageRecord));
      const title = notionPageTitle(pageRecord) ?? `Notion page ${id}`;
      const blocks = await this.fetchPageBlocks(client, config, id);
      blockCount += blocks.length;
      const content = markdownDocument([
        `# ${title}`,
        labeledValue("URL", stringValue(pageRecord.url)),
        labeledValue("Created", stringValue(pageRecord.created_time)),
        labeledValue("Updated", stringValue(pageRecord.last_edited_time)),
        ...blocks,
      ]);
      const sizeBytes = new TextEncoder().encode(content).length;
      if (sizeBytes > this.maxBytes) {
        throw new ApiError(
          "connector_response_too_large",
          "Notion connector response exceeds the configured size limit.",
          413,
        );
      }
      totalBytes += sizeBytes;
      items.push({
        fileName: safeFileName(`notion-${id}-${title}.md`),
        mimeType: "text/markdown",
        content,
        sizeBytes,
      });
    }
    return {
      items,
      summary: {
        connector: "notion",
        apiHost: config.apiUrl.hostname,
        apiVersion: config.apiVersion,
        queryHash: stableHash(config.query),
        pageCount: items.length,
        blockCount,
        totalByteLength: totalBytes,
      },
    };
  }

  private async fetchPageBlocks(
    client: NotionClient,
    config: NotionConnectorConfig,
    pageId: string,
  ): Promise<string[]> {
    const limit = Math.min(config.maxBlocksPerPage, this.maxBlocksPerPage);
    const payload = await this.notionRequest(
      () => client.blocks.children.list({ block_id: pageId, page_size: limit }),
      "Notion connector block fetch failed.",
    );
    return payload.results.slice(0, limit).flatMap((block) => {
      const text = notionBlockMarkdown(block);
      return text === undefined ? [] : [text];
    });
  }

  private async token(secretRef: string): Promise<string> {
    if (this.secretResolver?.resolveValue === undefined) {
      throw new ApiError(
        "connector_notion_secret_ref_unsupported",
        "Notion connector secret references require a value-capable secret resolver.",
        409,
      );
    }
    const resolution = await this.secretResolver.resolveValue(secretRef);
    if (!resolution.available || resolution.value === undefined) {
      throw new ApiError(
        "connector_notion_secret_ref_unavailable",
        "Notion connector secret reference is unavailable.",
        409,
        {
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          secretRefScheme: resolution.scheme,
        },
      );
    }
    return notionToken(resolution.value);
  }

  private async notionRequest<T>(
    request: () => Promise<T>,
    errorMessage: string,
  ): Promise<T> {
    try {
      return await request();
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw new ApiError("connector_fetch_failed", errorMessage, 502);
    }
  }

  private async boundedFetch(
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await this.fetchImpl(url, init);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Notion connector response exceeds the configured size limit.",
        413,
      );
    }
    const responseBody = await response.arrayBuffer();
    if (responseBody.byteLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Notion connector response exceeds the configured size limit.",
        413,
      );
    }
    return new Response(responseBody, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

function readNotionConfig(connector: DataConnector): NotionConnectorConfig {
  return {
    apiUrl: new URL(stringConfig(connector, "apiUrl")),
    apiVersion: stringConfig(connector, "apiVersion"),
    maxBlocksPerPage: numberConfig(connector, "maxBlocksPerPage", 25),
    maxItems: numberConfig(connector, "maxItems", 25),
    query: stringConfig(connector, "query"),
    secretRef: stringConfig(connector, "secretRef"),
  };
}

function notionToken(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      for (const key of ["token", "bearerToken", "accessToken"]) {
        const candidate = parsed[key];
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
      "connector_notion_secret_ref_invalid",
      "Notion connector secret must contain a token.",
      400,
    );
  }
  return trimmed.replace(/^Bearer\s+/iu, "");
}

function notionPageTitle(page: Record<string, unknown>): string | undefined {
  const properties = isRecord(page.properties) ? page.properties : {};
  for (const property of Object.values(properties)) {
    if (!isRecord(property) || property.type !== "title") continue;
    const text = richTextPlain(property.title);
    if (text.length > 0) return text;
  }
  return undefined;
}

function notionBlockMarkdown(block: unknown): string | undefined {
  if (!isRecord(block)) return undefined;
  const type = stringValue(block.type);
  if (type === undefined) return undefined;
  const payload = isRecord(block[type]) ? block[type] : {};
  if (type === "child_page")
    return `## ${stringValue(payload.title) ?? "Child page"}`;
  const text = richTextPlain(payload.rich_text);
  if (text.length === 0) return undefined;
  if (type === "heading_1") return `# ${text}`;
  if (type === "heading_2") return `## ${text}`;
  if (type === "heading_3") return `### ${text}`;
  if (type === "bulleted_list_item") return `- ${text}`;
  if (type === "numbered_list_item") return `1. ${text}`;
  if (type === "to_do")
    return `${payload.checked === true ? "[x]" : "[ ]"} ${text}`;
  if (type === "quote") return `> ${text}`;
  if (type === "code") return `\`\`\`\n${text}\n\`\`\``;
  return text;
}

function richTextPlain(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      if (typeof item.plain_text === "string") return [item.plain_text];
      const text = isRecord(item.text) ? item.text : {};
      return typeof text.content === "string" ? [text.content] : [];
    })
    .join("")
    .trim();
}

function stringConfig(connector: DataConnector, key: string): string {
  const value = connector.config[key];
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      `Notion connector requires ${key}.`,
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
    value.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 140) || "notion-source.md"
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
