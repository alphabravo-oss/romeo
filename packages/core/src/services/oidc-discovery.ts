import {
  allowInsecureRequests,
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
  fetchImpl?: typeof fetch;
  issuer: string;
}): Promise<OidcDiscoveryMetadata> {
  return oidcMetadataFromConfiguration(await discoverOidcConfiguration(input));
}

export async function discoverOidcConfiguration(input: {
  clientId: string;
  fetchImpl?: typeof fetch;
  issuer: string;
}): Promise<Configuration> {
  const issuerUrl = new URL(input.issuer);
  const fetchImpl = input.fetchImpl ?? fetch;
  const oidcFetch: CustomFetch = (url, options) => {
    const init: RequestInit = {
      headers: options.headers,
      method: options.method,
      redirect: options.redirect,
    };
    if (options.signal !== undefined) init.signal = options.signal;
    if (options.body !== undefined) init.body = options.body as BodyInit;
    return fetchImpl(url, init);
  };
  const options: Parameters<typeof discovery>[4] = {
    [customFetch]: oidcFetch,
    ...(isLocalHttpIssuer(issuerUrl)
      ? { execute: [allowInsecureRequests] }
      : {}),
  };
  return discovery(issuerUrl, input.clientId, undefined, None(), options);
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

function isLocalHttpIssuer(issuer: URL): boolean {
  return (
    issuer.protocol === "http:" &&
    (issuer.hostname === "localhost" ||
      issuer.hostname === "127.0.0.1" ||
      issuer.hostname === "::1")
  );
}
