import {
  createGeneratedClient,
  type GeneratedApiClient,
} from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";

export interface CliConfig {
  baseUrl: string;
  apiKey?: string;
}

export function resolveConfig(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
): CliConfig {
  const baseUrl =
    nonEmpty(flagValue(parsed.flags, "base-url")) ??
    nonEmpty(env.ROMEO_BASE_URL) ??
    "http://127.0.0.1:3000";
  const apiKey =
    nonEmpty(flagValue(parsed.flags, "api-key")) ?? nonEmpty(env.ROMEO_API_KEY);
  return apiKey === undefined ? { baseUrl } : { baseUrl, apiKey };
}

export function createGeneratedApiClient(
  config: CliConfig,
): GeneratedApiClient {
  return createGeneratedClient(clientOptions(config));
}

function clientOptions(config: CliConfig): {
  apiKey?: string;
  baseUrl: string;
} {
  return config.apiKey === undefined
    ? { baseUrl: config.baseUrl }
    : { baseUrl: config.baseUrl, apiKey: config.apiKey };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
