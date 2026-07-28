export type {
  SecretRewrapExecuteRequest as SecretRewrapExecuteInput,
  SecretRewrapPreviewRequest as SecretRewrapPreviewInput,
  SecretRewrapReport,
  SsoConnectionTestReport,
  SsoOidcProviderPreset,
  SsoSettingsReport,
  UpdateSsoSettingsRequest as UpdateSsoSettingsInput,
} from "@romeo/api-client/generated/sdk";

import type { SsoOidcProviderPreset } from "@romeo/api-client/generated/sdk";

export type SsoOidcProviderPresetId = SsoOidcProviderPreset["id"];
