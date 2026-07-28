import type { RomeoEnv } from "@romeo/config";
import { lookup } from "node:dns/promises";

import { AtlassianDataConnectorExecutor } from "./atlassian-data-connector-executor";
import type { DelegatedOAuthService } from "./delegated-oauth-service";
import {
  disabledDataConnectorExecutor,
  S3DataConnectorExecutor,
  WebsiteDataConnectorExecutor,
  type DataConnectorExecutor,
  type WebsiteConnectorHostAddress,
} from "./data-connector-executors";
import {
  GitHubDataConnectorExecutor,
  RoutingDataConnectorExecutor,
} from "./github-data-connector-executor";
import { LinearDataConnectorExecutor } from "./linear-data-connector-executor";
import { NotionDataConnectorExecutor } from "./notion-data-connector-executor";
import { S3HttpConnectorReader } from "./s3-data-connector-reader";
import type { SecretResolver } from "./secret-resolver";
import { SlackDataConnectorExecutor } from "./slack-data-connector-executor";

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
      hostLookup: lookupWebsiteConnectorHost,
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
      token: env.DATA_CONNECTOR_GITHUB_TOKEN,
    });
  const s3Executor = () =>
    new S3DataConnectorExecutor(
      new S3HttpConnectorReader({
        accessKeyId: env.S3_ACCESS_KEY_ID,
        endpoint: env.S3_ENDPOINT,
        secretResolver,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
        timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
      }),
      { maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES },
    );
  const governedExecutorOptions = {
    allowedHosts: parseCsvEnvironmentList(
      env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS,
    ),
    egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
    maxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
    hostLookup: lookupWebsiteConnectorHost,
    retryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
    retryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
    secretResolver,
    timeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
  };
  const atlassianExecutor = () =>
    new AtlassianDataConnectorExecutor(governedExecutorOptions);
  const notionExecutor = () =>
    new NotionDataConnectorExecutor(governedExecutorOptions);
  const linearExecutor = () =>
    new LinearDataConnectorExecutor(governedExecutorOptions);
  const slackExecutor = () =>
    new SlackDataConnectorExecutor(governedExecutorOptions);

  switch (env.DATA_CONNECTOR_EXECUTION_DRIVER) {
    case "website-fetch":
      return websiteExecutor();
    case "github-fetch":
      return githubExecutor();
    case "s3-fetch":
      return s3Executor();
    case "atlassian-fetch":
      return atlassianExecutor();
    case "notion-fetch":
      return notionExecutor();
    case "linear-fetch":
      return linearExecutor();
    case "slack-fetch":
      return slackExecutor();
    case "managed-fetch":
      return new RoutingDataConnectorExecutor({
        confluence: atlassianExecutor(),
        github: githubExecutor(),
        jira: atlassianExecutor(),
        linear: linearExecutor(),
        notion: notionExecutor(),
        rss: websiteExecutor(),
        s3: s3Executor(),
        slack: slackExecutor(),
        website: websiteExecutor(),
      });
    default:
      return disabledDataConnectorExecutor;
  }
}

async function lookupWebsiteConnectorHost(
  hostname: string,
): Promise<WebsiteConnectorHostAddress[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
}

export function parseCsvEnvironmentList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
