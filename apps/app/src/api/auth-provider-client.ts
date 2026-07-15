import { apiJson } from "./http";
import type { Envelope } from "./types";
import type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderConnectionTestRequest,
  AuthProviderSettingsReport,
  CreateManagedSecretRequest,
  DeprovisionSsoOidcUserRequest,
  DeprovisionSsoOidcUserResult,
  DirectorySyncRequest,
  DirectorySyncResult,
  ManagedSecretReference,
  UpdateAuthProviderSettingsRequest,
} from "./auth-provider-types";

export async function getAuthProviderCatalog(): Promise<
  AuthProviderCatalogEntry[]
> {
  const response = await apiJson<Envelope<AuthProviderCatalogEntry[]>>(
    "/api/v1/admin/auth-providers/catalog",
  );
  return response.data;
}

export async function getAuthProviderSettings(): Promise<AuthProviderSettingsReport> {
  const response = await apiJson<Envelope<AuthProviderSettingsReport>>(
    "/api/v1/admin/auth-providers/settings",
  );
  return response.data;
}

export async function updateAuthProviderSettings(
  input: UpdateAuthProviderSettingsRequest,
): Promise<AuthProviderSettingsReport> {
  const response = await apiJson<Envelope<AuthProviderSettingsReport>>(
    "/api/v1/admin/auth-providers/settings",
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function testAuthProviderConnection(
  input: AuthProviderConnectionTestRequest,
): Promise<AuthProviderConnectionTestReport> {
  const response = await apiJson<Envelope<AuthProviderConnectionTestReport>>(
    "/api/v1/admin/auth-providers/settings/test",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function createManagedSecret(
  input: CreateManagedSecretRequest,
): Promise<ManagedSecretReference> {
  const response = await apiJson<Envelope<ManagedSecretReference>>(
    "/api/v1/admin/secrets",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function triggerDirectorySync(
  input: DirectorySyncRequest,
): Promise<DirectorySyncResult> {
  const response = await apiJson<Envelope<DirectorySyncResult>>(
    "/api/v1/admin/directory-sync",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function deprovisionSsoOidcUser(
  input: DeprovisionSsoOidcUserRequest,
): Promise<DeprovisionSsoOidcUserResult> {
  const response = await apiJson<Envelope<DeprovisionSsoOidcUserResult>>(
    "/api/v1/admin/sso/oidc/deprovision",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}
