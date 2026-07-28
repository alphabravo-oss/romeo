import type { CreatedUserSession } from "./session-service";

export interface SamlStartResult {
  authorizationUrl: string;
  expiresAt: string;
  providerId: "saml";
  stateCookie: string;
}

export interface SamlCallbackResult extends CreatedUserSession {
  returnTo: string;
}

export interface SamlStateCookie {
  entryPointHash: string;
  expiresAt: string;
  orgId: string;
  providerId: "saml";
  relayState: string;
  requestId: string;
  requestInstant: string;
  returnTo: string;
  spEntityIdHash: string;
  v: 1;
}

export interface SamlRequestLedger {
  requests: Record<string, SamlRequestRecord>;
  version: 1;
}

export interface SamlRequestRecord {
  consumedAt?: string;
  expiresAt: string;
  orgId: string;
  providerId: "saml";
  relayStateHash: string;
  requestInstant: string;
}

export interface SamlIdentity {
  email: string;
  externalGroupIds: string[];
  groups: string[];
  isAdmin: boolean;
  name: string;
  subject: string;
}
