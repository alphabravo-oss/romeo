import type { RomeoEnv } from "@romeo/config";

import type { DelegatedOAuthService } from "./delegated-oauth-service";
import {
  disabledDataConnectorExecutor,
  S3DataConnectorExecutor,
  WebsiteDataConnectorExecutor,
  type DataConnectorExecutor,
} from "./data-connector-executors";
import { lookupNetworkHost } from "./data-connector-network-policy";
import {
  GitHubDataConnectorExecutor,
  RoutingDataConnectorExecutor,
} from "./github-data-connector-executor";
import { S3HttpConnectorReader } from "./s3-data-connector-reader";
import type { SecretResolver } from "./secret-resolver";

export function createDataConnectorExecutor(
  env: RomeoEnv,
  secretResolver: SecretResolver,
  delegatedOAuth: DelegatedOAuthService,
): DataConnectorExecutor {
  const websiteExecutor = () =>
    new WebsiteDataConnectorExecutor({
      allowedHosts: parseCsvEnvironmentList(
        env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS,
      ),
      egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      hostLookup: lookupNetworkHost,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  const githubExecutor = () =>
    new GitHubDataConnectorExecutor({
      delegatedOAuthCredentials: delegatedOAuth,
      maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
      retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
      retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
      secretResolver,
      timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    });
  const s3Executor = () =>
    new S3DataConnectorExecutor(
      new S3HttpConnectorReader({
        endpoint: env.S3_ENDPOINT,
        secretResolver,
        retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
        timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
      }),
      { maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES },
    );

  switch (env.DATA_CONNECTOR_EXECUTION_DRIVER) {
    case "website-fetch":
      return websiteExecutor();
    case "github-fetch":
      return githubExecutor();
    case "s3-fetch":
      return s3Executor();
    case "managed-fetch":
      return new RoutingDataConnectorExecutor({
        github: githubExecutor(),
        rss: websiteExecutor(),
        s3: s3Executor(),
        website: websiteExecutor(),
      });
    default:
      return disabledDataConnectorExecutor;
  }
}

export function parseCsvEnvironmentList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
