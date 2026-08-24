import type { AuthSubject } from "@romeo/auth";
import type { ProviderKind } from "@romeo/providers";

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
