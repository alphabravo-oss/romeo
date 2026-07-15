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

const githubApiVersion = "2022-11-28";
const githubUserUrl = "https://api.github.com/user";
const githubEmailsUrl = "https://api.github.com/user/emails";
const githubOrgsUrl = "https://api.github.com/user/orgs?per_page=100";
const githubTeamsUrl = "https://api.github.com/user/teams?per_page=100";
const providerTimeoutMs = 10_000;
const maxProviderResponseBytes = 256 * 1024;

export async function fetchGitHubOAuth2Identity(
  accessToken: string,
  policy: GitHubOAuth2IdentityPolicy,
  fetchImpl: typeof fetch,
): Promise<GitHubOAuth2Identity> {
  const [profile, emails] = await Promise.all([
    fetchGitHubUser(accessToken, fetchImpl),
    fetchGitHubEmails(accessToken, fetchImpl),
  ]);
  const policyNeedsOrgs =
    policy.requiredOrganizations.length > 0 ||
    Object.keys(policy.groupMap).some((key) => key.startsWith("github:org:"));
  const policyNeedsTeams =
    policy.adminTeams.length > 0 ||
    policy.requiredTeams.length > 0 ||
    Object.keys(policy.groupMap).some((key) => key.startsWith("github:team:")) ||
    Object.keys(policy.workspaceTeamMap).length > 0 ||
    policy.workspaceTeamPrefix.length > 0;
  const [orgs, teams] = await Promise.all([
    policyNeedsOrgs || policyNeedsTeams
      ? fetchGitHubOrganizations(accessToken, fetchImpl)
      : Promise.resolve<string[]>([]),
    policyNeedsTeams
      ? fetchGitHubTeams(accessToken, fetchImpl)
      : Promise.resolve<string[]>([]),
  ]);

  assertMembershipAllowed(policy, orgs, teams);
  const email = selectEmail(
    profile.email,
    emails,
    policy.allowedEmailDomains,
    profile.id,
  );
  return {
    email,
    externalGroupIds: mappedGroupIds(policy.groupMap, orgs, teams),
    isAdmin: intersects(teams, policy.adminTeams),
    name: profile.name ?? profile.login ?? email,
    providerAccountId: profile.id,
    providerAccountLogin: profile.login ?? profile.id,
  };
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

async function fetchGitHubUser(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ email?: string; id: string; login?: string; name?: string }> {
  const payload = await fetchJson(githubUserUrl, accessToken, fetchImpl, {
    failureCode: "github_oauth_profile_lookup_failed",
  });
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ApiError(
      "github_oauth_profile_lookup_failed",
      "GitHub account lookup did not return a profile object.",
      401,
    );
  }
  const record = payload as Record<string, unknown>;
  const rawId = record.id;
  if (
    (typeof rawId !== "number" && typeof rawId !== "string") ||
    String(rawId).length === 0
  ) {
    throw new ApiError(
      "github_oauth_profile_lookup_failed",
      "GitHub account lookup did not return an account id.",
      401,
    );
  }
  const email = stringField(record, "email");
  const login = stringField(record, "login");
  const name = stringField(record, "name");
  return {
    id: String(rawId),
    ...(email === undefined ? {} : { email }),
    ...(login === undefined ? {} : { login }),
    ...(name === undefined ? {} : { name }),
  };
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function fetchGitHubEmails(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<GitHubEmail[]> {
  const payload = await fetchJson(githubEmailsUrl, accessToken, fetchImpl, {
    failureCode: "github_oauth_email_lookup_failed",
  });
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : undefined,
    )
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => ({
      email: stringField(item, "email") ?? "",
      primary: item.primary === true,
      verified: item.verified === true,
    }))
    .filter((item) => item.email.length > 0);
}

async function fetchGitHubOrganizations(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const payload = await fetchJson(githubOrgsUrl, accessToken, fetchImpl, {
    failureCode: "github_oauth_membership_lookup_failed",
  });
  if (!Array.isArray(payload)) return [];
  return [
    ...new Set(
      payload
        .map((item) =>
          typeof item === "object" && item !== null && !Array.isArray(item)
            ? stringField(item as Record<string, unknown>, "login")
            : undefined,
        )
        .filter((login): login is string => login !== undefined)
        .map((login) => login.toLowerCase()),
    ),
  ].sort();
}

async function fetchGitHubTeams(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const payload = await fetchJson(githubTeamsUrl, accessToken, fetchImpl, {
    failureCode: "github_oauth_membership_lookup_failed",
  });
  if (!Array.isArray(payload)) return [];
  return [
    ...new Set(
      payload
        .map((item) =>
          typeof item === "object" && item !== null && !Array.isArray(item)
            ? githubTeamKey(item as Record<string, unknown>)
            : undefined,
        )
        .filter((team): team is string => team !== undefined),
    ),
  ].sort();
}

function githubTeamKey(item: Record<string, unknown>): string | undefined {
  const slug = stringField(item, "slug")?.toLowerCase();
  const organization =
    typeof item.organization === "object" &&
    item.organization !== null &&
    !Array.isArray(item.organization)
      ? stringField(item.organization as Record<string, unknown>, "login")
      : undefined;
  if (slug === undefined || organization === undefined) return undefined;
  return `${organization.toLowerCase()}/${slug}`;
}

async function fetchJson(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  options: { failureCode: string },
): Promise<unknown> {
  const response = await fetchProvider(url, fetchImpl, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "Romeo",
      "x-github-api-version": githubApiVersion,
    },
  });
  if (!response.ok) {
    throw new ApiError(
      options.failureCode,
      "GitHub OAuth provider lookup failed.",
      401,
      { provider: "github", status: response.status },
    );
  }
  return readProviderPayload(response);
}

async function fetchProvider(
  url: string,
  fetchImpl: typeof fetch,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError(
      "github_oauth_provider_unreachable",
      "GitHub OAuth provider request failed.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderPayload(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > maxProviderResponseBytes) {
    throw new ApiError(
      "github_oauth_provider_response_too_large",
      "GitHub OAuth provider response exceeded the configured limit.",
      502,
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxProviderResponseBytes) {
    throw new ApiError(
      "github_oauth_provider_response_too_large",
      "GitHub OAuth provider response exceeded the configured limit.",
      502,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(
      "github_oauth_provider_response_invalid",
      "GitHub OAuth provider response was not valid JSON.",
      502,
    );
  }
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function emailDomain(value: string): string {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}

function stringField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const item = value[field];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}
