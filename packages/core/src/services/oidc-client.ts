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
import { createId } from "../ids";
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

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const defaultCacheTtlMs = 5 * 60 * 1000;
const defaultJwksRefreshCooldownMs = 30 * 1000;

export class OidcClient {
  private readonly discoveryCache = new Map<
    string,
    CacheEntry<ResolvedOidcDiscovery>
  >();
  private readonly jwksCache = new Map<string, CacheEntry<JsonWebKey[]>>();
  private readonly lastJwksRefresh = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly jwksRefreshCooldownMs: number;
  private readonly now: () => number;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    options: {
      cacheTtlMs?: number;
      fetchImpl?: typeof fetch;
      jwksRefreshCooldownMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? defaultCacheTtlMs;
    this.jwksRefreshCooldownMs =
      options.jwksRefreshCooldownMs ?? defaultJwksRefreshCooldownMs;
    this.now = options.now ?? Date.now;
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
    const claims = await this.verifyClaims(token, config, discovery);
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
    const claims = await this.verifyClaims(token, config, discovery);
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
    // openid-client Configuration objects embed the client ID. Reusing a
    // configuration across tenants that share an issuer can therefore send
    // one tenant's client ID in another tenant's authorization flow.
    const cacheKey = `${issuer}\u0000${clientId}`;
    const existing = this.discoveryCache.get(cacheKey);
    if (existing !== undefined && existing.expiresAt > this.now())
      return existing.promise;
    this.discoveryCache.delete(cacheKey);
    const promise = this.fetchDiscovery(issuer, clientId);
    const entry = { expiresAt: this.now() + this.cacheTtlMs, promise };
    this.discoveryCache.set(cacheKey, entry);
    void promise.catch(() => {
      if (this.discoveryCache.get(cacheKey) === entry)
        this.discoveryCache.delete(cacheKey);
    });
    return promise;
  }

  private jwks(
    discovery: OidcDiscoveryDocument,
    forceRefresh = false,
  ): Promise<JsonWebKey[]> {
    const existing = this.jwksCache.get(discovery.jwksUri);
    if (
      !forceRefresh &&
      existing !== undefined &&
      existing.expiresAt > this.now()
    )
      return existing.promise;
    const promise = this.fetchJwks(discovery.jwksUri);
    const entry = { expiresAt: this.now() + this.cacheTtlMs, promise };
    this.jwksCache.set(discovery.jwksUri, entry);
    void promise.catch(() => {
      if (this.jwksCache.get(discovery.jwksUri) === entry)
        this.jwksCache.delete(discovery.jwksUri);
    });
    return promise;
  }

  private async verifyClaims(
    token: string,
    config: ResolvedSsoOidcConfig,
    discovery: OidcDiscoveryDocument,
  ): Promise<Record<string, unknown>> {
    let jwks = await this.jwks(discovery);
    const kid = tokenKeyId(token);
    if (
      kid !== undefined &&
      !jwks.some((key) => (key as { kid?: unknown }).kid === kid) &&
      this.canRefreshJwks(discovery.jwksUri)
    ) {
      this.lastJwksRefresh.set(discovery.jwksUri, this.now());
      jwks = await this.jwks(discovery, true);
    }
    return verifyOidcJwt(token, {
      issuer: discovery.issuer,
      audience: config.clientId,
      jwks,
      clockToleranceSeconds: 60,
    });
  }

  private canRefreshJwks(jwksUri: string): boolean {
    const last = this.lastJwksRefresh.get(jwksUri);
    return (
      last === undefined || this.now() - last >= this.jwksRefreshCooldownMs
    );
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
    const subject = mapOidcClaimsToSubject(claims, {
      orgId,
      userId: oidcUserId(discovery.issuer, String(claims.sub)),
      defaultWorkspaceIds: [],
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
    await persistMappedWorkspaceMemberships(this.repository, {
      orgId,
      userId: subject.id,
      workspaceIds: subject.workspaceIds,
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

function tokenKeyId(token: string): string | undefined {
  try {
    const encoded = token.split(".")[0];
    if (encoded === undefined) return undefined;
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString()) as {
      kid?: unknown;
    };
    return typeof parsed.kid === "string" && parsed.kid.length <= 300
      ? parsed.kid
      : undefined;
  } catch {
    return undefined;
  }
}

const defaultOidcScopes: Scope[] = [
  "me:read",
  "organizations:read",
  "workspaces:read",
];

async function persistMappedWorkspaceMemberships(
  repository: RomeoRepository,
  input: { orgId: string; userId: string; workspaceIds: string[] },
): Promise<void> {
  if (input.workspaceIds.length === 0) return;
  const [workspaces, grants] = await Promise.all([
    repository.listWorkspaces(input.orgId),
    repository.listResourceGrants(input.orgId),
  ]);
  const knownWorkspaceIds = new Set(
    workspaces.map((workspace) => workspace.id),
  );
  for (const workspaceId of input.workspaceIds) {
    if (!knownWorkspaceIds.has(workspaceId)) continue;
    const exists = grants.some(
      (grant) =>
        grant.resourceType === "workspace" &&
        grant.resourceId === workspaceId &&
        grant.principalType === "user" &&
        grant.principalId === input.userId &&
        grant.permission === "read",
    );
    if (exists) continue;
    await repository.createResourceGrant({
      id: createId("grant"),
      resourceType: "workspace",
      resourceId: workspaceId,
      principalType: "user",
      principalId: input.userId,
      permission: "read",
    });
  }
}

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
