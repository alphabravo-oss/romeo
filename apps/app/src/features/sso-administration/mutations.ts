import {
  ssoAdministrationExecuteSecretRewrap,
  ssoAdministrationPreviewSecretRewrap,
  ssoAdministrationTestSettings,
  ssoAdministrationUpdateSettings,
  type SecretRewrapExecuteRequest,
  type SecretRewrapPreviewRequest,
  type UpdateSsoSettingsRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function updateSsoSettings(input: UpdateSsoSettingsRequest) {
  configureBrowserApiClients();
  const response = await ssoAdministrationUpdateSettings({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function testSsoSettings() {
  configureBrowserApiClients();
  const response = await ssoAdministrationTestSettings({
    throwOnError: true,
  });
  return response.data.data;
}

export async function previewSecretRewrap(
  input: SecretRewrapPreviewRequest = {},
) {
  configureBrowserApiClients();
  const response = await ssoAdministrationPreviewSecretRewrap({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function executeSecretRewrap(input: SecretRewrapExecuteRequest) {
  configureBrowserApiClients();
  const response = await ssoAdministrationExecuteSecretRewrap({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
