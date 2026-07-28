import type { DataConnectorType } from "../domain/data-connectors";
import type {
  DelegatedOAuthConnection,
  DelegatedOAuthProviderId,
} from "../domain/delegated-oauth";
import type { DelegatedOAuthStoredToken } from "./delegated-oauth-token-vault";

export interface DelegatedOAuthProviderDefinition {
  authorizationUrl: string;
  connectorTypes: DataConnectorType[];
  displayName: string;
  id: DelegatedOAuthProviderId;
  tokenUrl: string;
}

export interface DelegatedOAuthState {
  codeVerifier: string;
  connectorType: DataConnectorType;
  expiresAt: string;
  nonce: string;
  orgId: string;
  providerId: DelegatedOAuthProviderId;
  redirectUri: string;
  returnTo: string;
  scopes: string[];
  state: string;
  userId: string;
  v: 1;
  workspaceId: string;
}

export interface DelegatedOAuthUsableToken {
  connection: DelegatedOAuthConnection;
  token: DelegatedOAuthStoredToken;
}

export interface ProviderRevocationResult {
  errorCode?: string;
  status: "failed" | "skipped" | "succeeded";
}
