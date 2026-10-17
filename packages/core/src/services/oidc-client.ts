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
import { provisionExternalUser } from "./external-user-provisioning";
import {
  syncExternalGroupMemberships,
  syncMappedWorkspaceMemberships,
} from "./sso-membership-reconciliation";
import {
  discoverOidcConfiguration,
  oidcMetadataFromConfiguration,
} from "./oidc-discovery";
import {
  OidcEgressClient,
  oidcEgressOptionsFromEnv,
  type OidcEgressOptions,
} from "./oidc-egress";
import {
  audienceIncludes,
  tokenKeyId,
  unverifiedJwtAudience,
  unverifiedJwtIssuer,
} from "./oidc-token-hints";

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

export interface OidcRuntimeCache {
  readonly discovery: Map<string, CacheEntry<ResolvedOidcDiscovery>>;
  readonly jwks: Map<string, CacheEntry<JsonWebKey[]>>;
  readonly lastJwksRefresh: Map<string, number>;
}

export function createOidcRuntimeCache(): OidcRuntimeCache {
  return {
    discovery: new Map(),
    jwks: new Map(),
    lastJwksRefresh: new Map(),
  };
}

export interface OidcClientOptions {
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  hostLookup?: OidcEgressOptions["hostLookup"];
  jwksRefreshCooldownMs?: number;
  maxResponseBytes?: number;
  now?: () => number;
  pinnedFetchImpl?: OidcEgressOptions["pinnedFetchImpl"];
  runtimeCache?: OidcRuntimeCache;
  timeoutMs?: number;
}

const defaultCacheTtlMs = 5 * 60 * 1000;
const defaultJwksRefreshCooldownMs = 30 * 1000;
const maxCacheEntries = 128;
const maxCacheTtlMs = 60 * 60 * 1000;
const maxJwksKeys = 100;

export class OidcClient {
  private readonly discoveryCache: OidcRuntimeCache["discovery"];
  private readonly jwksCache: OidcRuntimeCache["jwks"];
  private readonly lastJwksRefresh: OidcRuntimeCache["lastJwksRefresh"];
  private readonly cacheTtlMs: number;
  private readonly egressOptions: OidcEgressOptions;
  private readonly jwksRefreshCooldownMs: number;
  private readonly now: () => number;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    options: OidcClientOptions = {},
  ) {
    const runtimeCache = options.runtimeCache ?? createOidcRuntimeCache();
    this.discoveryCache = runtimeCache.discovery;
    this.jwksCache = runtimeCache.jwks;
    this.lastJwksRefresh = runtimeCache.lastJwksRefresh;
    this.egressOptions = {
      ...oidcEgressOptionsFromEnv(env),
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      ...(options.hostLookup === undefined
        ? {}
        : { hostLookup: options.hostLookup }),
      ...(options.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: options.maxResponseBytes }),
      ...(options.pinnedFetchImpl === undefined
        ? {}
        : { pinnedFetchImpl: options.pinnedFetchImpl }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    };
    this.cacheTtlMs = Math.max(
      1,
      Math.min(
        options.cacheTtlMs ?? env.OIDC_CACHE_TTL_MS ?? defaultCacheTtlMs,
        maxCacheTtlMs,
      ),
    );
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
    const orgId =
      options.orgId ?? (await this.resolveBearerOrganizationId(token));
    const { config, discovery } = await this.configured(orgId);
    const claims = await this.verifyClaims(token, config, discovery);
    if (
      options.expectedNonce !== undefined &&
      claims.nonce !== options.expectedNonce
    )
      throw new Error("OIDC token nonce is invalid.");
    return this.mapAndProvision(config, discovery, orgId, claims, false);
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
    // Interactive browser login: reconcile SSO-granted memberships.
    return this.mapAndProvision(config, discovery, orgId, claims, true);
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
    this.pruneCache(this.discoveryCache);
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
    const cacheKey = this.jwksCacheKey(discovery);
    const existing = this.jwksCache.get(cacheKey);
    if (
      !forceRefresh &&
      existing !== undefined &&
      existing.expiresAt > this.now()
    )
      return existing.promise;
    const promise = this.fetchJwks(discovery);
    const entry = { expiresAt: this.now() + this.cacheTtlMs, promise };
    this.pruneCache(this.jwksCache);
    this.jwksCache.set(cacheKey, entry);
    void promise.catch(() => {
      if (this.jwksCache.get(cacheKey) === entry)
        this.jwksCache.delete(cacheKey);
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
    const jwksCacheKey = this.jwksCacheKey(discovery);
    if (
      kid !== undefined &&
      !jwks.some((key) => (key as { kid?: unknown }).kid === kid) &&
      this.canRefreshJwks(jwksCacheKey)
    ) {
      this.pruneJwksRefreshes();
      this.lastJwksRefresh.set(jwksCacheKey, this.now());
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
    this.pruneJwksRefreshes();
    const last = this.lastJwksRefresh.get(jwksUri);
    return (
      last === undefined || this.now() - last >= this.jwksRefreshCooldownMs
    );
  }

  private async fetchDiscovery(
    issuer: string,
    clientId: string,
  ): Promise<ResolvedOidcDiscovery> {
    const egress = this.egress(issuer);
    const configuration = await discoverOidcConfiguration({
      clientId,
      fetchImpl: egress.fetch,
      issuer,
      validateEndpoint: (value) => egress.assertMetadataEndpoint(value),
    });
    return {
      ...oidcMetadataFromConfiguration(configuration),
      configuration,
    };
  }

  private async fetchJwks(
    discovery: OidcDiscoveryDocument,
  ): Promise<JsonWebKey[]> {
    const egress = this.egress(discovery.issuer);
    egress.assertMetadataEndpoint(discovery.jwksUri);
    const jwks = (await egress.fetchJson(discovery.jwksUri)) as {
      keys?: unknown;
    };
    if (
      !Array.isArray(jwks.keys) ||
      jwks.keys.length === 0 ||
      jwks.keys.length > maxJwksKeys
    )
      throw new Error("OIDC JWKS document is invalid.");
    const keys = jwks.keys.filter(
      (key): key is JsonWebKey => typeof key === "object" && key !== null,
    );
    if (keys.length === 0) throw new Error("OIDC JWKS document is invalid.");
    return keys;
  }

  private egress(issuer: string): OidcEgressClient {
    return new OidcEgressClient(issuer, this.egressOptions);
  }

  private jwksCacheKey(discovery: OidcDiscoveryDocument): string {
    return `${discovery.issuer}\u0000${discovery.jwksUri}`;
  }

  private pruneCache<T>(cache: Map<string, CacheEntry<T>>): void {
    const now = this.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  private pruneJwksRefreshes(): void {
    const oldestUseful = this.now() - this.jwksRefreshCooldownMs;
    for (const [key, refreshedAt] of this.lastJwksRefresh) {
      if (refreshedAt <= oldestUseful) this.lastJwksRefresh.delete(key);
    }
    while (this.lastJwksRefresh.size >= maxCacheEntries) {
      const oldest = this.lastJwksRefresh.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) break;
      this.lastJwksRefresh.delete(oldest);
    }
  }

  private async mapAndProvision(
    config: ResolvedSsoOidcConfig,
    discovery: OidcDiscoveryDocument,
    orgId: string,
    claims: Record<string, unknown>,
    revokeUnasserted: boolean,
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
    const source = { kind: "oidc", providerKey: discovery.issuer } as const;
    await syncExternalGroupMemberships(this.repository, {
      groupIds: subject.groupIds,
      orgId,
      revokeUnasserted,
      source,
      userId: subject.id,
    });
    await syncMappedWorkspaceMemberships(this.repository, {
      orgId,
      revokeUnasserted,
      source,
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

  private async resolveBearerOrganizationId(token: string): Promise<string> {
    if (this.env.TENANCY_MODE !== "multi") return "org_default";
    const issuer = unverifiedJwtIssuer(token);
    const audience = unverifiedJwtAudience(token);
    if (issuer === undefined) {
      throw new Error("OIDC token issuer is missing.");
    }
    const organizations = await this.repository.listAllOrganizations();
    const matches: string[] = [];
    for (const organization of organizations) {
      const settings = await this.repository.getSsoOidcSettings(
        organization.id,
      );
      if (settings === undefined || !settings.enabled) continue;
      if (normalizeIssuer(settings.issuerUrl) !== normalizeIssuer(issuer))
        continue;
      if (!audienceIncludes(audience, settings.clientId)) continue;
      matches.push(organization.id);
    }
    if (matches.length === 1) return matches[0]!;
    throw new Error("OIDC organization could not be resolved.");
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
