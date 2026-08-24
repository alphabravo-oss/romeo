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
  _posture: DataConnectorCatalogRuntimePosture,
  _type: DataConnectorType,
): boolean {
  return false;
}
