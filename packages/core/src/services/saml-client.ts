import {
  SAML,
  ValidateInResponseTo,
  type CacheItem,
  type CacheProvider,
  type Profile,
} from "@node-saml/node-saml";

export interface SamlClientConfig {
  acceptedClockSkewMs: number;
  callbackUrl: string;
  entryPoint: string;
  idpCert: string;
  idpIssuer: string;
  maxAssertionAgeMs: number;
  requestId: string;
  requestIdExpirationPeriodMs: number;
  requestInstant: string;
  spEntityId: string;
  wantAuthnResponseSigned: boolean;
}

export interface SamlValidatedProfile {
  attributes: Record<string, unknown>;
  issuer?: string;
  nameID: string;
}

export interface SamlClient {
  getAuthorizeUrl(relayState: string): Promise<string>;
  generateServiceProviderMetadata(): string;
  validatePostResponse(input: {
    relayState?: string;
    samlResponse: string;
  }): Promise<SamlValidatedProfile>;
}

export type SamlClientFactory = (config: SamlClientConfig) => SamlClient;

export const defaultSamlClientFactory: SamlClientFactory = (config) =>
  new NodeSamlClient(config);

class NodeSamlClient implements SamlClient {
  private readonly client: SAML;

  constructor(config: SamlClientConfig) {
    this.client = new SAML({
      acceptedClockSkewMs: config.acceptedClockSkewMs,
      audience: config.spEntityId,
      callbackUrl: config.callbackUrl,
      entryPoint: config.entryPoint,
      generateUniqueId: () => config.requestId,
      idpCert: config.idpCert,
      ...(config.idpIssuer.length === 0 ? {} : { idpIssuer: config.idpIssuer }),
      issuer: config.spEntityId,
      maxAssertionAgeMs: config.maxAssertionAgeMs,
      requestIdExpirationPeriodMs: config.requestIdExpirationPeriodMs,
      cacheProvider: new SingleRequestSamlCacheProvider({
        requestId: config.requestId,
        requestInstant: config.requestInstant,
      }),
      validateInResponseTo: ValidateInResponseTo.always,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: config.wantAuthnResponseSigned,
    });
  }

  async getAuthorizeUrl(relayState: string): Promise<string> {
    return this.client.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  generateServiceProviderMetadata(): string {
    return this.client.generateServiceProviderMetadata(null, null);
  }

  async validatePostResponse(input: {
    relayState?: string;
    samlResponse: string;
  }): Promise<SamlValidatedProfile> {
    const result = await this.client.validatePostResponseAsync({
      SAMLResponse: input.samlResponse,
      ...(input.relayState === undefined
        ? {}
        : { RelayState: input.relayState }),
    });
    if (result.loggedOut || result.profile === null) {
      throw new Error("SAML response did not contain a login profile.");
    }
    return profileToValidatedProfile(result.profile);
  }
}

class SingleRequestSamlCacheProvider implements CacheProvider {
  private value: string;
  private removed = false;

  constructor(
    private readonly input: { requestId: string; requestInstant: string },
  ) {
    this.value = input.requestInstant;
  }

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    if (key !== this.input.requestId) return null;
    this.value = value;
    this.removed = false;
    return { value, createdAt: Date.now() };
  }

  async getAsync(key: string): Promise<string | null> {
    if (this.removed || key !== this.input.requestId) return null;
    return this.value;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (key !== this.input.requestId) return null;
    this.removed = true;
    return this.value;
  }
}

function profileToValidatedProfile(profile: Profile): SamlValidatedProfile {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value === "function") continue;
    attributes[key] = value;
  }
  return {
    attributes,
    ...(typeof profile.issuer === "string" ? { issuer: profile.issuer } : {}),
    nameID: profile.nameID,
  };
}
