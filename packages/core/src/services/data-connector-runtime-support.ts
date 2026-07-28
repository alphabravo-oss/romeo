import type { RomeoEnv } from "@romeo/config";

import type { DataConnectorType } from "../domain/entities";
import type { DataConnectorCatalogRuntimePosture } from "./data-connector-contracts";

export function connectorDriverSupports(
  driver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"],
  type: DataConnectorType,
): boolean {
  if (type === "local_import") return true;
  if (driver === "managed-fetch") return true;
  if (driver === "website-fetch") return type === "website" || type === "rss";
  if (driver === "github-fetch") return type === "github";
  if (driver === "s3-fetch") return type === "s3";
  if (driver === "atlassian-fetch") {
    return type === "confluence" || type === "jira";
  }
  if (driver === "notion-fetch") return type === "notion";
  if (driver === "linear-fetch") return type === "linear";
  if (driver === "slack-fetch") return type === "slack";
  return false;
}

export function connectorSecretRefsSupported(
  posture: DataConnectorCatalogRuntimePosture,
): boolean {
  return (
    posture.managedSecretConfigured ||
    posture.secretResolverDriver !== "disabled"
  );
}

export function deploymentCredentialConfigured(
  posture: DataConnectorCatalogRuntimePosture,
  type: DataConnectorType,
): boolean {
  if (type === "github") return posture.githubDeploymentTokenConfigured;
  if (type === "s3") return posture.s3DeploymentCredentialsConfigured;
  return false;
}
