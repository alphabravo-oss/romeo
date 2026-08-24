import type { RomeoEnv } from "@romeo/config";

import { parseCsvEnvironmentList } from "./data-connector-executor-factory";

export function dataConnectorRuntimePosture(env: RomeoEnv) {
  return {
    executionDriver: env.DATA_CONNECTOR_EXECUTION_DRIVER,
    egressPolicy: env.DATA_CONNECTOR_EGRESS_POLICY,
    allowedHostRuleCount: parseCsvEnvironmentList(
      env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS,
    ).length,
    fetchMaxBytes: env.DATA_CONNECTOR_FETCH_MAX_BYTES,
    fetchRetryAttempts: env.DATA_CONNECTOR_FETCH_RETRY_ATTEMPTS,
    fetchRetryBackoffMs: env.DATA_CONNECTOR_FETCH_RETRY_BACKOFF_MS,
    fetchTimeoutMs: env.DATA_CONNECTOR_FETCH_TIMEOUT_MS,
    liveEvidencePath: env.DATA_CONNECTOR_LIVE_EVIDENCE_PATH,
    workerEnabled: env.DATA_CONNECTOR_WORKER_ENABLED,
    networkPolicyConfigured: env.DATA_CONNECTOR_NETWORK_POLICY_ENABLED,
    secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    managedSecretConfigured:
      env.MANAGED_SECRET_ENCRYPTION_KEY.trim().length >= 32,
    githubDeploymentTokenConfigured:
      env.DATA_CONNECTOR_GITHUB_TOKEN.trim().length > 0,
    delegatedOAuthGithubConfigured:
      env.DELEGATED_OAUTH_GITHUB_CLIENT_ID.trim().length > 0 &&
      env.DELEGATED_OAUTH_GITHUB_CLIENT_SECRET.trim().length > 0 &&
      env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY.trim().length >= 32,
    s3EndpointConfigured: env.S3_ENDPOINT.trim().length > 0,
    s3DeploymentCredentialsConfigured:
      env.S3_ACCESS_KEY_ID.trim().length > 0 &&
      env.S3_SECRET_ACCESS_KEY.trim().length > 0,
  };
}
