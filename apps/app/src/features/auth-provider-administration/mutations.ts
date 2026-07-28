import {
  authProviderAdministrationCreateManagedSecret,
  authProviderAdministrationDeprovisionOidcUser,
  authProviderAdministrationTestConnection,
  authProviderAdministrationUpdateSettings,
  type CreateManagedSecretRequest,
  type DeprovisionSsoOidcUserRequest,
  type TestAuthProviderConnectionRequest,
  type UpdateAuthProviderSettingsRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function updateAuthProviderSettings(
  input: UpdateAuthProviderSettingsRequest,
) {
  configureBrowserApiClients();
  const response = await authProviderAdministrationUpdateSettings({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function testAuthProviderConnection(
  input: TestAuthProviderConnectionRequest,
) {
  configureBrowserApiClients();
  const response = await authProviderAdministrationTestConnection({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createManagedSecret(input: CreateManagedSecretRequest) {
  configureBrowserApiClients();
  const response = await authProviderAdministrationCreateManagedSecret({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deprovisionSsoOidcUser(
  input: DeprovisionSsoOidcUserRequest,
) {
  configureBrowserApiClients();
  const response = await authProviderAdministrationDeprovisionOidcUser({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
