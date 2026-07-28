import { createHash } from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";
import { ApiError } from "../errors";
import type { OAuth2ProviderLoginConfig } from "./auth-provider-settings-service";
import type { GitHubOAuth2IdentityPolicy } from "./github-oauth2-auth-provider";

export interface OAuth2PkceState {
  clientId: string;
  codeVerifier: string;
  expiresAt: string;
  orgId: string;
  providerId: AuthProviderId;
  redirectUri: string;
  returnTo: string;
  state: string;
  v: 1;
}

export function githubPolicy(
  config: OAuth2ProviderLoginConfig,
): GitHubOAuth2IdentityPolicy {
  return {
    adminTeams: config.adminTeams,
    allowedEmailDomains: config.allowedEmailDomains,
    groupMap: config.groupMap,
    requiredOrganizations: config.requiredOrganizations,
    requiredTeams: config.requiredTeams,
    workspaceTeamMap: config.workspaceTeamMap,
    workspaceTeamPrefix: config.workspaceTeamPrefix,
  };
}

export function authorizationEndpoint(providerId: AuthProviderId): string {
  if (providerId === "github")
    return "https://github.com/login/oauth/authorize";
  throw new ApiError(
    "oauth2_login_not_configured",
    "OAuth2 login is not configured for this authentication provider.",
    409,
    { providerId },
  );
}

export function normalizeAppOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export function normalizeOrgId(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return "org_default";
  if (normalized.length > 120) {
    throw new ApiError(
      "invalid_oauth2_org_id",
      "OAuth2 login organization ID is too long.",
      400,
    );
  }
  return normalized;
}

export function sanitizeReturnTo(value: string | undefined): string {
  if (value === undefined || value.length === 0) return "/";
  if (
    value.length > 500 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\r\n]/u.test(value)
  ) {
    throw new ApiError(
      "invalid_oauth2_return_to",
      "OAuth2 return path must be a relative application path.",
      400,
    );
  }
  return value;
}

export function hashProviderAccountId(
  providerId: AuthProviderId,
  providerAccountId: string,
): string {
  return createHash("sha256")
    .update(`${providerId}\0${providerAccountId}`)
    .digest("hex");
}

export function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function parseJsonState(payload: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    throw new ApiError(
      "oauth2_state_invalid",
      "OAuth2 login state is invalid.",
      400,
    );
  }
}

export function isOAuth2PkceState(value: unknown): value is OAuth2PkceState {
  const candidate = value as Partial<OAuth2PkceState>;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.v === 1 &&
    typeof candidate.clientId === "string" &&
    typeof candidate.codeVerifier === "string" &&
    typeof candidate.orgId === "string" &&
    candidate.providerId === "github" &&
    typeof candidate.redirectUri === "string" &&
    typeof candidate.returnTo === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.expiresAt === "string"
  );
}
