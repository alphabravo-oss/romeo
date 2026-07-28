import {
  webIngestUrls,
  webSearch,
  webUpdateConfiguration,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  WebSearchConfiguration,
  WebSearchResult,
  WebUrlIngestResult,
} from "./types";

export async function updateWebSearchConfiguration(
  input: Parameters<typeof webUpdateConfiguration>[0]["body"],
): Promise<WebSearchConfiguration> {
  configureBrowserApiClients();
  const response = await webUpdateConfiguration({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  configureBrowserApiClients();
  const response = await webSearch({
    body: { query },
    throwOnError: true,
  });
  return response.data.data;
}

export async function ingestWebUrls(
  input: Parameters<typeof webIngestUrls>[0]["body"],
): Promise<WebUrlIngestResult[]> {
  configureBrowserApiClients();
  const response = await webIngestUrls({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
