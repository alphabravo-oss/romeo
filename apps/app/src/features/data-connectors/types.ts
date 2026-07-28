export type {
  CreateDataConnectorRequest,
  DataConnector,
  DataConnectorCatalogReport,
  DataConnectorPostureReport,
  DataConnectorSync,
  DataConnectorType,
  SyncDataConnectorRequest,
} from "@romeo/api-client/generated/sdk";

export type DataConnectorCatalogItem =
  import("@romeo/api-client/generated/sdk").DataConnectorCatalogReport["connectors"][number];
export type DataConnectorCredentialSource =
  DataConnectorCatalogItem["credentialSources"][number];
export type DataConnectorImplementationStatus =
  DataConnectorCatalogItem["implementationStatus"];
export type DataConnectorSyncMode = DataConnectorCatalogItem["syncMode"];
export type DataConnectorExecutionBoundary =
  DataConnectorCatalogItem["executionBoundary"];
export type DataConnectorEgressPolicy = DataConnectorCatalogItem["egress"];
export type DataConnectorLimitPolicy = DataConnectorCatalogItem["limits"];
export type DataConnectorCatalogEntry = Omit<
  DataConnectorCatalogItem,
  "runtime"
>;

export type CreateDataConnectorInput =
  import("@romeo/api-client/generated/sdk").CreateDataConnectorRequest;
