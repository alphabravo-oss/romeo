import type { AuthSubject } from "@romeo/auth";
import type { ProviderKind } from "@romeo/providers";

import type { ProviderCatalogSyncOptions } from "./provider-catalog-sync";
import type { ProviderNetworkPolicy } from "./provider-network-policy";
import type { SecretResolver } from "./secret-resolver";

export interface CreateProviderInput {
  auth?: string;
  baseUrl: string;
  credentialRef?: string;
  deployment?: string;
  modelIds?: string[];
  name: string;
  project?: string;
  region?: string;
  subject: AuthSubject;
  target?: string;
  type: ProviderKind;
}

export interface UpdateProviderInput {
  auth?: string;
  baseUrl?: string;
  credentialRef?: string;
  deployment?: string;
  enabled?: boolean;
  modelIds?: string[];
  name?: string;
  project?: string;
  providerId: string;
  region?: string;
  subject: AuthSubject;
  target?: string;
}

export interface ProviderServiceOptions {
  catalogSync?: Omit<
    ProviderCatalogSyncOptions,
    "fetchImpl" | "secretResolver"
  >;
  fetchImpl?: typeof fetch;
  /** Rejects base URLs the request-time provider egress policy always blocks. */
  networkPolicy?: ProviderNetworkPolicy;
  secretResolver?: SecretResolver;
}
