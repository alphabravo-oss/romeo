import {
  RomeoApiClient,
  type RomeoClientOptions,
} from "@romeo/api-client";

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
    nonEmpty(flagValue(parsed.flags, "api-key")) ??
    nonEmpty(env.ROMEO_API_KEY);
  return apiKey === undefined ? { baseUrl } : { baseUrl, apiKey };
}

export function createClient(config: CliConfig): RomeoApiClient {
  const options: RomeoClientOptions =
    config.apiKey === undefined
      ? { baseUrl: config.baseUrl }
      : { baseUrl: config.baseUrl, apiKey: config.apiKey };
  return new RomeoApiClient(options);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
