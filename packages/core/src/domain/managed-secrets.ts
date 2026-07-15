export type ManagedSecretScope = "global" | "org";
export type ManagedSecretStorageDriver = "local" | "vault";

export type ManagedSecretPurpose =
  | "auth_provider_client_secret"
  | "data_connector_credential"
  | "model_provider_credential"
  | "tool_connector_credential";

export interface CreateManagedSecretRequest {
  name?: string | undefined;
  orgId?: string | undefined;
  purpose: ManagedSecretPurpose;
  scope?: ManagedSecretScope | undefined;
  storageDriver?: ManagedSecretStorageDriver | undefined;
  targetSecretRef?: string | undefined;
  value: string;
}

export interface ManagedSecretReference {
  createdAt: string;
  nameConfigured: boolean;
  orgId?: string;
  purpose: ManagedSecretPurpose;
  scope: ManagedSecretScope;
  secretRef: string;
  secretRefScheme: "romeo-secret" | "vault";
  storageDriver: ManagedSecretStorageDriver;
  valueStored: true;
}
