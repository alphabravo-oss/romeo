import { discoverOidcMetadata } from "./oidc-discovery";
import {
  assertTrustedMetadataUrl,
  normalizeIssuer,
  oidcConfigStatus,
  safeHost,
  type ResolvedSsoOidcConfig,
} from "./sso-config";

export interface OidcConnectionTestReport {
  generatedAt: string;
  status: "disabled" | "failed" | "partial" | "passed";
  issuerHost?: string;
  checks: OidcConnectionTestCheck[];
  notes: string[];
}

export interface OidcConnectionTestCheck {
  id: "configuration" | "discovery" | "jwks";
  status: "fail" | "pass" | "skip";
  code: string;
}

export async function testOidcConnection(input: {
  config: ResolvedSsoOidcConfig;
  fetchImpl?: typeof fetch | undefined;
}): Promise<OidcConnectionTestReport> {
  const status = oidcConfigStatus(input.config);
  const issuerHost = safeHost(input.config.issuerUrl);
  const generatedAt = new Date().toISOString();
  if (!status.issuerConfigured && !status.clientIdConfigured) {
    return {
      generatedAt,
      status: "disabled",
      ...(issuerHost === undefined ? {} : { issuerHost }),
      checks: [
        { id: "configuration", status: "skip", code: "oidc_not_configured" },
        { id: "discovery", status: "skip", code: "oidc_not_configured" },
        { id: "jwks", status: "skip", code: "oidc_not_configured" },
      ],
      notes: ["OIDC is not configured."],
    };
  }
  if (!status.bearerTokenAuthEnabled) {
    return {
      generatedAt,
      status: "partial",
      ...(issuerHost === undefined ? {} : { issuerHost }),
      checks: [
        { id: "configuration", status: "fail", code: "oidc_config_partial" },
        { id: "discovery", status: "skip", code: "oidc_config_partial" },
        { id: "jwks", status: "skip", code: "oidc_config_partial" },
      ],
      notes: [
        "OIDC configuration is incomplete; set both issuer URL and client ID before testing the connection.",
      ],
    };
  }

  const issuer = normalizeIssuer(input.config.issuerUrl);
  try {
    assertTrustedMetadataUrl(issuer);
    const discovery = await fetchDiscovery({
      clientId: input.config.clientId,
      fetchImpl: input.fetchImpl,
      issuer,
    });
    const jwksKeyCount = await fetchJwks({
      fetchImpl: input.fetchImpl,
      jwksUri: discovery.jwksUri,
    });
    return {
      generatedAt,
      status: "passed",
      ...(issuerHost === undefined ? {} : { issuerHost }),
      checks: [
        { id: "configuration", status: "pass", code: "oidc_config_complete" },
        { id: "discovery", status: "pass", code: "oidc_discovery_reachable" },
        { id: "jwks", status: "pass", code: "oidc_jwks_reachable" },
      ],
      notes: [
        `OIDC discovery and JWKS are reachable with ${jwksKeyCount} signing key(s).`,
      ],
    };
  } catch (error) {
    const code = oidcTestErrorCode(error);
    const discoveryPassed = code.startsWith("oidc_jwks_");
    return {
      generatedAt,
      status: "failed",
      ...(issuerHost === undefined ? {} : { issuerHost }),
      checks: [
        { id: "configuration", status: "pass", code: "oidc_config_complete" },
        {
          id: "discovery",
          status: discoveryPassed ? "pass" : "fail",
          code: discoveryPassed ? "oidc_discovery_reachable" : code,
        },
        {
          id: "jwks",
          status: discoveryPassed ? "fail" : "skip",
          code: discoveryPassed ? code : "oidc_discovery_failed",
        },
      ],
      notes: ["OIDC connection test failed before token verification."],
    };
  }
}

async function fetchDiscovery(input: {
  clientId: string;
  fetchImpl?: typeof fetch | undefined;
  issuer: string;
}): Promise<{ jwksUri: string }> {
  try {
    return await discoverOidcMetadata(
      input.fetchImpl === undefined
        ? { clientId: input.clientId, issuer: input.issuer }
        : {
            clientId: input.clientId,
            fetchImpl: input.fetchImpl,
            issuer: input.issuer,
          },
    );
  } catch {
    throw new Error("oidc_discovery_failed");
  }
}

async function fetchJwks(input: {
  fetchImpl?: typeof fetch | undefined;
  jwksUri: string;
}): Promise<number> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.jwksUri, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("oidc_jwks_http_failed");
  const jwks = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error("oidc_jwks_invalid");
  }
  const usableKeyCount = jwks.keys.filter(
    (key) => typeof key === "object" && key !== null,
  ).length;
  if (usableKeyCount === 0) throw new Error("oidc_jwks_invalid");
  return usableKeyCount;
}

function oidcTestErrorCode(error: unknown): string {
  if (error instanceof Error && /^oidc_[a-z_]+$/u.test(error.message)) {
    return error.message;
  }
  return "oidc_connection_failed";
}
