import { Octokit } from "octokit";

import type { AuthProviderConnectionTestReport } from "../domain/auth-provider-settings";
import type { SecretResolver } from "./secret-resolver";

type ConnectionCheck = AuthProviderConnectionTestReport["checks"][number];

export async function checkLdapSecret(
  enabled: boolean,
  secretRef: string | undefined,
  resolver: SecretResolver | undefined,
): Promise<ConnectionCheck> {
  return checkSecret({
    enabled,
    secretRef,
    resolver,
    missingCode: "ldap_bind_secret_ref_missing",
    availableCode: "ldap_bind_secret_available",
    unavailableCode: "ldap_bind_secret_unavailable",
  });
}

export async function checkSamlSecret(
  enabled: boolean,
  secretRef: string | undefined,
  resolver: SecretResolver | undefined,
): Promise<ConnectionCheck> {
  return checkSecret({
    enabled,
    secretRef,
    resolver,
    missingCode: "saml_idp_certificate_ref_missing",
    availableCode: "saml_idp_certificate_available",
    unavailableCode: "saml_idp_certificate_unavailable",
  });
}

export async function checkOAuth2Secret(
  enabled: boolean,
  secretRef: string | undefined,
  resolver: SecretResolver | undefined,
): Promise<ConnectionCheck> {
  return checkSecret({
    enabled,
    secretRef,
    resolver,
    missingCode: "oauth2_client_secret_ref_missing",
    availableCode: "oauth2_client_secret_available",
    unavailableCode: "oauth2_client_secret_unavailable",
  });
}

async function checkSecret(input: {
  enabled: boolean;
  secretRef: string | undefined;
  resolver: SecretResolver | undefined;
  missingCode: string;
  availableCode: string;
  unavailableCode: string;
}): Promise<ConnectionCheck> {
  if (!input.enabled) {
    return { id: "secret", status: "skip", code: "auth_provider_disabled" };
  }
  if (input.secretRef === undefined) {
    return { id: "secret", status: "fail", code: input.missingCode };
  }
  if (input.resolver === undefined) {
    return {
      id: "secret",
      status: "skip",
      code: "secret_resolver_not_available",
    };
  }
  const check = await input.resolver.check(input.secretRef);
  return {
    id: "secret",
    status: check.available ? "pass" : "fail",
    code: check.available
      ? input.availableCode
      : (check.failureCode ?? input.unavailableCode),
  };
}

export async function checkGithubApi(
  enabled: boolean,
  fetchImpl: typeof fetch,
): Promise<ConnectionCheck> {
  if (!enabled) {
    return { id: "api", status: "skip", code: "auth_provider_disabled" };
  }
  try {
    const client = new Octokit({
      request: { fetch: fetchImpl },
      userAgent: "Romeo",
    });
    await client.request("GET /meta", {
      headers: { "x-github-api-version": "2022-11-28" },
    });
    return { id: "api", status: "pass", code: "github_api_reachable" };
  } catch {
    return { id: "api", status: "fail", code: "github_api_unreachable" };
  }
}
