import {
  type Configuration,
  customFetch,
  discovery,
  None,
  type CustomFetch,
} from "openid-client";

export interface OidcDiscoveryMetadata {
  authorizationEndpoint?: string;
  issuer: string;
  jwksUri: string;
  tokenEndpoint?: string;
}

export async function discoverOidcMetadata(input: {
  clientId: string;
  fetchImpl: typeof fetch;
  issuer: string;
  validateEndpoint?: (value: string) => void;
}): Promise<OidcDiscoveryMetadata> {
  return oidcMetadataFromConfiguration(await discoverOidcConfiguration(input));
}

export async function discoverOidcConfiguration(input: {
  clientId: string;
  fetchImpl: typeof fetch;
  issuer: string;
  validateEndpoint?: (value: string) => void;
}): Promise<Configuration> {
  const issuerUrl = new URL(input.issuer);
  const oidcFetch: CustomFetch = (url, options) => {
    const init: RequestInit = {
      headers: options.headers,
      method: options.method,
      redirect: options.redirect,
    };
    if (options.signal !== undefined) init.signal = options.signal;
    if (options.body !== undefined) init.body = options.body as BodyInit;
    return input.fetchImpl(url, init);
  };
  const options: Parameters<typeof discovery>[4] = {
    [customFetch]: oidcFetch,
  };
  const configuration = await discovery(
    issuerUrl,
    input.clientId,
    undefined,
    None(),
    options,
  );
  assertOidcConfigurationMetadata(configuration, input.issuer);
  if (input.validateEndpoint !== undefined) {
    for (const endpoint of oidcMetadataEndpointValues(configuration))
      input.validateEndpoint(endpoint);
  }
  return configuration;
}

export function oidcMetadataFromConfiguration(
  configuration: Configuration,
): OidcDiscoveryMetadata {
  const metadata = configuration.serverMetadata();
  if (metadata.jwks_uri === undefined)
    throw new Error("OIDC discovery document is missing JWKS URI.");
  const result: OidcDiscoveryMetadata = {
    issuer: metadata.issuer,
    jwksUri: metadata.jwks_uri,
  };
  if (metadata.authorization_endpoint !== undefined)
    result.authorizationEndpoint = metadata.authorization_endpoint;
  if (metadata.token_endpoint !== undefined)
    result.tokenEndpoint = metadata.token_endpoint;
  return result;
}

function assertOidcConfigurationMetadata(
  configuration: Configuration,
  expectedIssuer: string,
): void {
  const actualIssuer = configuration
    .serverMetadata()
    .issuer.replace(/\/+$/u, "");
  if (actualIssuer !== expectedIssuer.replace(/\/+$/u, ""))
    throw new Error("oidc_discovery_issuer_mismatch");
}

function oidcMetadataEndpointValues(configuration: Configuration): string[] {
  const metadata = configuration.serverMetadata() as unknown as Record<
    string,
    unknown
  >;
  const direct = Object.entries(metadata).flatMap(([name, value]) =>
    (name.endsWith("_endpoint") ||
      name.endsWith("_jwks_uri") ||
      name === "jwks_uri" ||
      name === "check_session_iframe") &&
    typeof value === "string"
      ? [value]
      : [],
  );
  const mtlsAliases = metadata.mtls_endpoint_aliases;
  if (typeof mtlsAliases !== "object" || mtlsAliases === null) return direct;
  return [
    ...direct,
    ...Object.values(mtlsAliases).filter(
      (value): value is string => typeof value === "string",
    ),
  ];
}
