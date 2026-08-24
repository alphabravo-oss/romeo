import type { RomeoEnv } from "@romeo/config";

import { discoverOidcMetadata } from "./oidc-discovery";
import {
  OidcEgressClient,
  oidcEgressOptionsFromEnv,
  type OidcEgressOptions,
} from "./oidc-egress";
import {
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
  egressOptions?: OidcEgressOptions;
  env: RomeoEnv;
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
    const egress = new OidcEgressClient(issuer, {
      ...oidcEgressOptionsFromEnv(input.env),
      ...input.egressOptions,
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    });
    const discovery = await fetchDiscovery({
      clientId: input.config.clientId,
      egress,
      issuer,
    });
    const jwksKeyCount = await fetchJwks({
      egress,
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
  egress: OidcEgressClient;
  issuer: string;
}): Promise<{ jwksUri: string }> {
  try {
    return await discoverOidcMetadata({
      clientId: input.clientId,
      fetchImpl: input.egress.fetch,
      issuer: input.issuer,
      validateEndpoint: (value) => input.egress.assertMetadataEndpoint(value),
    });
  } catch {
    throw new Error("oidc_discovery_failed");
  }
}

async function fetchJwks(input: {
  egress: OidcEgressClient;
  jwksUri: string;
}): Promise<number> {
  let jwks: { keys?: unknown };
  try {
    jwks = (await input.egress.fetchJson(input.jwksUri)) as { keys?: unknown };
  } catch {
    throw new Error("oidc_jwks_http_failed");
  }
  if (
    !Array.isArray(jwks.keys) ||
    jwks.keys.length === 0 ||
    jwks.keys.length > 100
  ) {
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
