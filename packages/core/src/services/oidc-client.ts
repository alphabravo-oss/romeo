import {
  mapOidcClaimsToSubject,
  verifyOidcJwt,
  type OidcMappedSubject,
  type Scope,
} from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { createHash } from "node:crypto";
import type { Configuration as OpenidClientConfiguration } from "openid-client";

import type { RomeoRepository } from "../domain/repository";
import {
  normalizeIssuer,
  oidcConfigStatus,
  resolveSsoOidcConfig,
  type ResolvedSsoOidcConfig,
} from "./sso-config";
import { createUserAuthSubject } from "./auth-subject";
import {
  provisionExternalUser,
  syncExternalGroupMemberships,
} from "./external-user-provisioning";
import {
  discoverOidcConfiguration,
  oidcMetadataFromConfiguration,
} from "./oidc-discovery";

export interface OidcDiscoveryDocument {
  authorizationEndpoint?: string;
  issuer: string;
  jwksUri: string;
  tokenEndpoint?: string;
}

export interface ResolvedOidcClientConfig {
  config: ResolvedSsoOidcConfig;
  discovery: OidcDiscoveryDocument;
  openidClientConfiguration: OpenidClientConfiguration;
  orgId: string;
}

interface ResolvedOidcDiscovery extends OidcDiscoveryDocument {
  configuration: OpenidClientConfiguration;
}

export class OidcClient {
  private readonly discoveryCache = new Map<
    string,
    Promise<ResolvedOidcDiscovery>
  >();
  private readonly jwksCache = new Map<string, Promise<JsonWebKey[]>>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    options: { fetchImpl?: typeof fetch } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async configured(orgId = "org_default"): Promise<ResolvedOidcClientConfig> {
    const config = await resolveSsoOidcConfig(this.repository, this.env, orgId);
    return this.configuredWithConfig(orgId, config);
  }

  async configuredWithConfig(
    orgId: string,
    config: ResolvedSsoOidcConfig,
  ): Promise<ResolvedOidcClientConfig> {
    const status = oidcConfigStatus(config);
    if (!status.bearerTokenAuthEnabled)
      throw new Error("OIDC authentication is not configured.");
    const discovery = await this.discovery(
      normalizeIssuer(config.issuerUrl),
      config.clientId,
    );
    return {
      config,
      discovery,
      openidClientConfiguration: discovery.configuration,
      orgId,
    };
  }

  async authenticateJwt(
    token: string,
    options: { expectedNonce?: string; orgId?: string } = {},
  ): Promise<OidcMappedSubject> {
    const { config, discovery, orgId } = await this.configured(options.orgId);
    const claims = await verifyOidcJwt(token, {
      issuer: discovery.issuer,
      audience: config.clientId,
      jwks: await this.jwks(discovery),
      clockToleranceSeconds: 60,
    });
    if (
      options.expectedNonce !== undefined &&
      claims.nonce !== options.expectedNonce
    )
      throw new Error("OIDC token nonce is invalid.");
    return this.mapAndProvision(config, discovery, orgId, claims);
  }

  async authenticateJwtWithConfig(
    token: string,
    input: {
      config: ResolvedSsoOidcConfig;
      expectedNonce?: string;
      orgId: string;
    },
  ): Promise<OidcMappedSubject> {
    const { config, discovery, orgId } = await this.configuredWithConfig(
      input.orgId,
      input.config,
    );
    const claims = await verifyOidcJwt(token, {
      issuer: discovery.issuer,
      audience: config.clientId,
      jwks: await this.jwks(discovery),
      clockToleranceSeconds: 60,
    });
    if (
      input.expectedNonce !== undefined &&
      claims.nonce !== input.expectedNonce
    )
      throw new Error("OIDC token nonce is invalid.");
    return this.mapAndProvision(config, discovery, orgId, claims);
  }

  private discovery(
    issuer: string,
    clientId: string,
  ): Promise<ResolvedOidcDiscovery> {
    const existing = this.discoveryCache.get(issuer);
    if (existing !== undefined) return existing;
    const promise = this.fetchDiscovery(issuer, clientId);
    this.discoveryCache.set(issuer, promise);
    return promise;
  }

  private jwks(discovery: OidcDiscoveryDocument): Promise<JsonWebKey[]> {
    const existing = this.jwksCache.get(discovery.jwksUri);
    if (existing !== undefined) return existing;
    const promise = this.fetchJwks(discovery.jwksUri);
    this.jwksCache.set(discovery.jwksUri, promise);
    return promise;
  }

  private async fetchDiscovery(
    issuer: string,
    clientId: string,
  ): Promise<ResolvedOidcDiscovery> {
    const configuration = await discoverOidcConfiguration({
      clientId,
      fetchImpl: this.fetchImpl,
      issuer,
    });
    return {
      ...oidcMetadataFromConfiguration(configuration),
      configuration,
    };
  }

  private async fetchJwks(jwksUri: string): Promise<JsonWebKey[]> {
    const response = await this.fetchImpl(jwksUri, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("OIDC JWKS fetch failed.");
    const jwks = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(jwks.keys))
      throw new Error("OIDC JWKS document is invalid.");
    return jwks.keys.filter(
      (key): key is JsonWebKey => typeof key === "object" && key !== null,
    );
  }

  private async mapAndProvision(
    config: ResolvedSsoOidcConfig,
    discovery: OidcDiscoveryDocument,
    orgId: string,
    claims: Record<string, unknown>,
  ): Promise<OidcMappedSubject> {
    const workspaces = await this.repository.listWorkspaces(orgId);
    const subject = mapOidcClaimsToSubject(claims, {
      orgId,
      userId: oidcUserId(discovery.issuer, String(claims.sub)),
      defaultWorkspaceIds: workspaces.map((workspace) => workspace.id),
      clientId: config.clientId,
      groupClaim: config.groupClaim,
      adminGroups: config.adminGroups,
      groupMap: config.groupMap,
      workspaceGroupMap: config.workspaceGroupMap,
      workspaceGroupPrefix: config.workspaceGroupPrefix,
      defaultScopes: defaultOidcScopes,
    });
    const user = await provisionOidcUser(this.repository, subject, claims);
    await syncExternalGroupMemberships(this.repository, {
      groupIds: subject.groupIds,
      orgId,
      userId: subject.id,
    });
    return {
      ...(await createUserAuthSubject(this.repository, user, {
        externalGroupIds: subject.groupIds,
        forceAdmin: subject.isAdmin === true,
        sessionScopes: defaultOidcScopes,
      })),
      oidc: subject.oidc,
    };
  }
}

const defaultOidcScopes: Scope[] = [
  "me:read",
  "organizations:read",
  "workspaces:read",
];

export function oidcUserId(issuer: string, subject: string): string {
  return `user_oidc_${createHash("sha256").update(`${issuer}\0${subject}`).digest("hex").slice(0, 24)}`;
}

async function provisionOidcUser(
  repository: RomeoRepository,
  subject: OidcMappedSubject,
  claims: Record<string, unknown>,
): ReturnType<typeof provisionExternalUser> {
  const fallbackEmail = `${subject.id}@oidc.local.invalid`;
  const email = stringClaim(claims.email) ?? fallbackEmail;
  const name = stringClaim(claims.name) ?? email;
  return provisionExternalUser(repository, {
    email,
    name,
    orgId: subject.orgId,
    providerLabel: "OIDC",
    userId: subject.id,
  });
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
