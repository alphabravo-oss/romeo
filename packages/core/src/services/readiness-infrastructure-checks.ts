import type { RomeoEnv } from "@romeo/config";

import type { ToolConnector } from "../domain/entities";
import type { RomeoRepositoryRuntime } from "../domain/repository";
import { analyzePostgresConnectionSecurity } from "./postgres-connection-security";
import { fail, pass, warn, type ReadinessCheck } from "./readiness-result";

export function repositoryPersistenceCheck(
  runtime: RomeoRepositoryRuntime,
): ReadinessCheck {
  if (!runtime.durable) {
    return fail(
      "repository_persistence",
      "critical",
      "Durable repository persistence is not configured.",
      {
        driver: runtime.driver,
        storageScope: runtime.storageScope,
        required: "Postgres-backed RomeoRepository",
      },
    );
  }
  return pass(
    "repository_persistence",
    "Durable repository persistence is configured.",
    {
      driver: runtime.driver,
      storageScope: runtime.storageScope,
    },
  );
}

export function databaseUrlCheck(env: RomeoEnv): ReadinessCheck {
  const value = env.DATABASE_URL.trim();
  if (value.length === 0) {
    return fail("database_url", "critical", "Database URL is missing.", {
      required: "DATABASE_URL",
    });
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return fail(
        "database_url",
        "critical",
        "Database URL must use the Postgres protocol.",
        {
          protocol: url.protocol.replace(":", ""),
          required: "postgres or postgresql",
        },
      );
    }
    return pass("database_url", "Database URL is configured.", {
      protocol: url.protocol.replace(":", ""),
      hostConfigured: url.host.length > 0,
      databaseConfigured: url.pathname.length > 1,
    });
  } catch {
    return fail(
      "database_url",
      "critical",
      "Database URL is not a valid URL.",
      { required: "valid Postgres DATABASE_URL" },
    );
  }
}

export function postgresConnectionSecurityCheck(env: RomeoEnv): ReadinessCheck {
  const connectionSecurity = analyzePostgresConnectionSecurity(
    env.DATABASE_URL,
  );
  const details = {
    hostCategory: connectionSecurity.hostCategory,
    hostedPostgresTlsRecommended:
      connectionSecurity.hostedPostgresTlsRecommended,
    sslmodeSource: connectionSecurity.sslmodeSource,
    tlsConfigured: connectionSecurity.tlsConfigured,
    tlsMode: connectionSecurity.tlsMode,
    tlsVerification: connectionSecurity.tlsVerification,
    warningCodes: connectionSecurity.warningCodes,
    requiredForHostedPostgres: "sslmode=verify-full or provider equivalent",
  };
  if (!connectionSecurity.databaseUrlValid) {
    return warn(
      "postgres_connection_security",
      "Postgres connection security could not be evaluated.",
      details,
    );
  }
  if (connectionSecurity.warningCodes.length > 0) {
    return warn(
      "postgres_connection_security",
      "Remote Postgres connections should require provider TLS verification.",
      details,
    );
  }
  return pass(
    "postgres_connection_security",
    "Postgres connection security posture is configured.",
    details,
  );
}

export function toolOperationExecutionCheck(
  env: RomeoEnv,
  connectors: ToolConnector[],
): ReadinessCheck {
  if (env.TOOL_OPERATION_EXECUTION_DRIVER === "disabled") {
    return pass(
      "tool_operation_execution",
      "Imported tool operation execution is disabled.",
      { driver: env.TOOL_OPERATION_EXECUTION_DRIVER },
    );
  }
  const enabledOpenApiConnectors = connectors.filter(
    (connector) => connector.type === "openapi" && connector.enabled,
  );
  const authConnectorCount = enabledOpenApiConnectors.filter(
    requiresConnectorAuth,
  ).length;
  const missingNetworkPolicyCount = enabledOpenApiConnectors.filter(
    (connector) =>
      connector.networkPolicy.mode !== "allow_hosts" ||
      connector.networkPolicy.allowedHosts.length === 0,
  ).length;
  if (authConnectorCount > 0 && env.SECRET_RESOLVER_DRIVER === "disabled") {
    return fail(
      "tool_operation_execution",
      "critical",
      "Tool operation execution has auth-enabled connectors but secret resolution is disabled.",
      {
        authConnectorCount,
        required: "SECRET_RESOLVER_DRIVER",
      },
    );
  }
  if (missingNetworkPolicyCount > 0) {
    return fail(
      "tool_operation_execution",
      "critical",
      "Tool operation execution has enabled connectors without host allowlists.",
      {
        missingNetworkPolicyCount,
        required: "tool connector network policy",
      },
    );
  }
  return pass(
    "tool_operation_execution",
    "Tool operation execution posture is explicit.",
    {
      driver: env.TOOL_OPERATION_EXECUTION_DRIVER,
      enabledOpenApiConnectorCount: enabledOpenApiConnectors.length,
      secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    },
  );
}

function requiresConnectorAuth(connector: ToolConnector): boolean {
  return (
    typeof connector.authConfig.type === "string" &&
    connector.authConfig.type !== "none" &&
    connector.authConfig.configured === true
  );
}

export function connectorEgressCheck(env: RomeoEnv): ReadinessCheck {
  const enabled = connectorDriverRequiresHostAllowlist(
    env.DATA_CONNECTOR_EXECUTION_DRIVER,
  );
  const hasAllowlist = env.DATA_CONNECTOR_FETCH_ALLOWED_HOSTS.trim().length > 0;
  if (!enabled) {
    return pass(
      "connector_egress_policy",
      "Connector egress policy is inactive while host-based connector execution is disabled.",
      {
        driver: env.DATA_CONNECTOR_EXECUTION_DRIVER,
      },
    );
  }
  if (
    env.DATA_CONNECTOR_EGRESS_POLICY === "require_allowlist" &&
    !hasAllowlist
  ) {
    return fail(
      "connector_egress_policy",
      "critical",
      "Connector egress policy requires a host allowlist.",
      {
        required: "DATA_CONNECTOR_FETCH_ALLOWED_HOSTS",
      },
    );
  }
  if (!hasAllowlist) {
    return warn(
      "connector_egress_policy",
      "Outbound connector execution allows public hosts without a host allowlist.",
      {
        policy: env.DATA_CONNECTOR_EGRESS_POLICY,
        recommended: "DATA_CONNECTOR_EGRESS_POLICY=require_allowlist",
      },
    );
  }
  return pass(
    "connector_egress_policy",
    "Connector egress host allowlist is configured.",
    {
      policy: env.DATA_CONNECTOR_EGRESS_POLICY,
    },
  );
}

function connectorDriverRequiresHostAllowlist(driver: string): boolean {
  return (
    driver === "website-fetch" ||
    driver === "atlassian-fetch" ||
    driver === "notion-fetch" ||
    driver === "linear-fetch" ||
    driver === "slack-fetch" ||
    driver === "managed-fetch"
  );
}
