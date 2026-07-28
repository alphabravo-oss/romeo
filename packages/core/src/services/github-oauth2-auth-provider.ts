import { Octokit, RequestError } from "octokit";

import { ApiError } from "../errors";

export interface GitHubOAuth2IdentityPolicy {
  adminTeams: string[];
  allowedEmailDomains: string[];
  groupMap: Record<string, string>;
  requiredOrganizations: string[];
  requiredTeams: string[];
  workspaceTeamMap: Record<string, string>;
  workspaceTeamPrefix: string;
}

export interface GitHubOAuth2Identity {
  email: string;
  externalGroupIds: string[];
  isAdmin: boolean;
  name: string;
  providerAccountId: string;
  providerAccountLogin: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

const providerTimeoutMs = 10_000;
const maxProviderResponseBytes = 256 * 1024;

export async function fetchGitHubOAuth2Identity(
  accessToken: string,
  policy: GitHubOAuth2IdentityPolicy,
  fetchImpl: typeof fetch,
): Promise<GitHubOAuth2Identity> {
  const client = createGitHubClient(accessToken, fetchImpl);
  const [profile, emails] = await Promise.all([
    githubRequest(
      () => client.rest.users.getAuthenticated(),
      "github_oauth_profile_lookup_failed",
    ),
    githubRequest(
      () => client.rest.users.listEmailsForAuthenticatedUser(),
      "github_oauth_email_lookup_failed",
    ),
  ]);
  const policyNeedsOrgs =
    policy.requiredOrganizations.length > 0 ||
    Object.keys(policy.groupMap).some((key) => key.startsWith("github:org:"));
  const policyNeedsTeams =
    policy.adminTeams.length > 0 ||
    policy.requiredTeams.length > 0 ||
    Object.keys(policy.groupMap).some((key) =>
      key.startsWith("github:team:"),
    ) ||
    Object.keys(policy.workspaceTeamMap).length > 0 ||
    policy.workspaceTeamPrefix.length > 0;
  const [orgs, teams] = await Promise.all([
    policyNeedsOrgs || policyNeedsTeams
      ? fetchGitHubOrganizations(client)
      : Promise.resolve<string[]>([]),
    policyNeedsTeams ? fetchGitHubTeams(client) : Promise.resolve<string[]>([]),
  ]);

  assertMembershipAllowed(policy, orgs, teams);
  const providerAccountId = String(profile.data.id);
  const email = selectEmail(
    profile.data.email ?? undefined,
    emails.data,
    policy.allowedEmailDomains,
    providerAccountId,
  );
  return {
    email,
    externalGroupIds: mappedGroupIds(policy.groupMap, orgs, teams),
    isAdmin: intersects(teams, policy.adminTeams),
    name: profile.data.name ?? profile.data.login ?? email,
    providerAccountId,
    providerAccountLogin: profile.data.login ?? providerAccountId,
  };
}

function createGitHubClient(accessToken: string, fetchImpl: typeof fetch) {
  return new Octokit({
    auth: accessToken,
    request: {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        boundedProviderFetch(fetchImpl, input, init),
    },
    userAgent: "Romeo",
  });
}

async function fetchGitHubOrganizations(client: Octokit): Promise<string[]> {
  const response = await githubRequest(
    () => client.rest.orgs.listForAuthenticatedUser({ per_page: 100 }),
    "github_oauth_membership_lookup_failed",
  );
  return [
    ...new Set(
      response.data.map((organization) => organization.login.toLowerCase()),
    ),
  ].sort();
}

async function fetchGitHubTeams(client: Octokit): Promise<string[]> {
  const response = await githubRequest(
    () => client.rest.teams.listForAuthenticatedUser({ per_page: 100 }),
    "github_oauth_membership_lookup_failed",
  );
  return [
    ...new Set(
      response.data.map(
        (team) =>
          `${team.organization.login.toLowerCase()}/${team.slug.toLowerCase()}`,
      ),
    ),
  ].sort();
}

async function githubRequest<T>(
  request: () => Promise<T>,
  failureCode: string,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof RequestError) {
      throw new ApiError(
        failureCode,
        "GitHub OAuth provider lookup failed.",
        401,
        { provider: "github", status: error.status },
      );
    }
    throw new ApiError(
      "github_oauth_provider_unreachable",
      "GitHub OAuth provider request failed.",
      502,
    );
  }
}

async function boundedProviderFetch(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    providerTimeoutMs,
  );
  const signal =
    init?.signal == null
      ? timeoutController.signal
      : AbortSignal.any([init.signal, timeoutController.signal]);
  try {
    const response = await fetchImpl(input, { ...init, signal });
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maxProviderResponseBytes
    ) {
      throw providerResponseTooLarge();
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > maxProviderResponseBytes) {
      throw providerResponseTooLarge();
    }
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function providerResponseTooLarge(): ApiError {
  return new ApiError(
    "github_oauth_provider_response_too_large",
    "GitHub OAuth provider response exceeded the configured limit.",
    502,
  );
}

function assertMembershipAllowed(
  policy: GitHubOAuth2IdentityPolicy,
  orgs: string[],
  teams: string[],
): void {
  if (
    policy.requiredOrganizations.length > 0 &&
    !intersects(orgs, policy.requiredOrganizations)
  ) {
    throw new ApiError(
      "github_oauth_membership_denied",
      "GitHub login is not allowed for this account.",
      403,
    );
  }
  if (
    policy.requiredTeams.length > 0 &&
    !intersects(teams, policy.requiredTeams)
  ) {
    throw new ApiError(
      "github_oauth_membership_denied",
      "GitHub login is not allowed for this account.",
      403,
    );
  }
}

function selectEmail(
  profileEmail: string | undefined,
  emails: GitHubEmail[],
  allowedEmailDomains: string[],
  providerAccountId: string,
): string {
  const verified = emails.filter((email) => email.verified);
  const primary = verified.find((email) => email.primary)?.email;
  const candidate = primary ?? verified[0]?.email ?? profileEmail;
  if (candidate === undefined || candidate.length === 0) {
    if (allowedEmailDomains.length > 0) {
      throw new ApiError(
        "github_oauth_email_unavailable",
        "GitHub login requires a verified email for this provider policy.",
        403,
      );
    }
    return `github-${providerAccountId}@github.local.invalid`;
  }
  const normalized = candidate.trim().toLowerCase();
  if (
    allowedEmailDomains.length > 0 &&
    !allowedEmailDomains.includes(emailDomain(normalized))
  ) {
    throw new ApiError(
      "github_oauth_email_domain_denied",
      "GitHub login is not allowed for this email domain.",
      403,
    );
  }
  return normalized;
}

function mappedGroupIds(
  groupMap: Record<string, string>,
  orgs: string[],
  teams: string[],
): string[] {
  const externalKeys = [
    ...orgs.map((org) => `github:org:${org}`),
    ...teams.map((team) => `github:team:${team}`),
  ];
  return [
    ...new Set(
      externalKeys
        .map((key) => groupMap[key] ?? groupMap[key.replace(/^github:/u, "")])
        .filter((value): value is string => value !== undefined),
    ),
  ].sort();
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function emailDomain(value: string): string {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}
