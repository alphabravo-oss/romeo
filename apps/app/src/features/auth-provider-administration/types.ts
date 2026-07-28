import type {
  AuthProviderCatalogEntry,
  AuthProviderSettingsReport,
  CreateManagedSecretRequest,
  DeprovisionSsoOidcUserRequest,
  TestAuthProviderConnectionRequest,
  UpdateAuthProviderSettingsRequest,
} from "@romeo/api-client/generated/sdk";

export type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderSettingsReport,
  CreateManagedSecretRequest,
  DeprovisionSsoOidcUserRequest,
  ManagedSecretReference,
  SsoOidcDeprovisionResult,
  TestAuthProviderConnectionRequest,
  UpdateAuthProviderSettingsRequest,
} from "@romeo/api-client/generated/sdk";

export type AuthProviderId = AuthProviderCatalogEntry["id"];
export type AuthProviderProtocol = AuthProviderCatalogEntry["protocol"];
export type AuthProviderGlobalPatch = NonNullable<
  UpdateAuthProviderSettingsRequest["global"]
>["providers"][number];
export type AuthProviderOrgOverridePatch = NonNullable<
  UpdateAuthProviderSettingsRequest["orgOverride"]
>["providers"][number];
export type AuthProviderSettingSummary =
  AuthProviderSettingsReport["global"]["providers"][number];
export type AuthProviderOrgOverrideSummary =
  AuthProviderSettingsReport["orgOverride"]["providers"][number];
export type EffectiveAuthProviderSetting =
  AuthProviderSettingsReport["effective"]["providers"][number];
export type AuthProviderConnectionTestRequest =
  TestAuthProviderConnectionRequest;
export type CreateManagedSecretInput = CreateManagedSecretRequest;
export type DeprovisionSsoOidcUserInput = DeprovisionSsoOidcUserRequest;
