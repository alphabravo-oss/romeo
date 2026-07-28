import type { DataConnector } from "../domain/entities";
import { ApiError } from "../errors";

export function readConnectorUrl(connector: DataConnector): URL {
  const value = connector.config.url;
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      "Website connector requires a URL.",
      400,
    );
  return new URL(value);
}

interface S3ConnectorConfig {
  bucket: string;
  maxItems: number;
  prefix: string;
  region: string;
  secretRef?: string;
}

export function readS3Config(connector: DataConnector): S3ConnectorConfig {
  const { bucket, prefix, region, maxItems, secretRef } = connector.config;
  if (
    typeof bucket !== "string" ||
    typeof prefix !== "string" ||
    typeof region !== "string"
  )
    throw new ApiError(
      "invalid_connector_config",
      "S3 connector requires bucket, prefix, and region.",
      400,
    );
  return {
    bucket,
    prefix,
    region,
    maxItems:
      typeof maxItems === "number" && Number.isInteger(maxItems)
        ? maxItems
        : 50,
    ...(typeof secretRef === "string" ? { secretRef } : {}),
  };
}

export function normalizeTextMimeType(
  contentType: string | null,
  message: string,
): string {
  const mimeType =
    contentType?.split(";")[0]?.trim().toLowerCase() || "text/plain";
  if (
    ["text/html", "text/plain", "text/markdown", "text/csv"].includes(mimeType)
  )
    return mimeType;
  throw new ApiError("connector_response_unsupported", message, 415);
}

export function normalizeFeedMimeType(
  contentType: string | null,
  message: string,
): string {
  const mimeType =
    contentType?.split(";")[0]?.trim().toLowerCase() || "application/rss+xml";
  if (
    [
      "application/rss+xml",
      "application/atom+xml",
      "application/xml",
      "text/xml",
    ].includes(mimeType)
  )
    return mimeType;
  throw new ApiError("connector_response_unsupported", message, 415);
}

export function mimeTypeFromKey(key: string): string {
  if (key.endsWith(".md") || key.endsWith(".markdown")) return "text/markdown";
  if (key.endsWith(".html") || key.endsWith(".htm")) return "text/html";
  if (key.endsWith(".csv")) return "text/csv";
  if (key.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

export function websiteFileName(url: URL, mimeType: string): string {
  const rawName = url.pathname.split("/").filter(Boolean).at(-1) ?? "index";
  const safeBase =
    rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "index";
  if (safeBase.includes(".")) return safeBase;
  if (mimeType === "text/html") return `${safeBase}.html`;
  if (mimeType === "text/markdown") return `${safeBase}.md`;
  return `${safeBase}.txt`;
}

export function s3FileName(key: string, prefix: string): string {
  const relative = key.slice(prefix.length).replace(/^\/+/, "");
  const rawName =
    relative.split("/").filter(Boolean).join("__") ||
    key.split("/").filter(Boolean).at(-1) ||
    "object.txt";
  return rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "object.txt";
}

export function rssFileName(url: URL): string {
  const rawName = url.pathname.split("/").filter(Boolean).at(-1) ?? "feed";
  const safeBase =
    rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "feed";
  return `${safeBase}.md`;
}
