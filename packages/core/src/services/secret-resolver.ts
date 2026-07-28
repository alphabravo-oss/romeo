import {
  VaultSecretResolver,
  type SecretAvailability,
  type SecretResolution,
  type VaultSdkClient,
  type VaultSdkClientFactory,
  type VaultSecretResolverOptions,
} from "@romeo/secrets";

import { parseManagedSecretRef } from "./secret-refs";

export {
  VaultSecretResolver,
  type SecretAvailability,
  type SecretResolution,
  type VaultSdkClient,
  type VaultSdkClientFactory,
  type VaultSecretResolverOptions,
};

export interface SecretResolver {
  check(secretRef: string): Promise<SecretAvailability>;
  resolveValue?(secretRef: string): Promise<SecretResolution>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  constructor(
    private readonly variables: Record<
      string,
      string | undefined
    > = process.env,
  ) {}

  async check(secretRef: string): Promise<SecretAvailability> {
    const resolution = await this.resolveValue(secretRef);
    return resolution.available
      ? { available: true, scheme: resolution.scheme }
      : {
          available: false,
          ...(resolution.failureCode === undefined
            ? {}
            : { failureCode: resolution.failureCode }),
          scheme: resolution.scheme,
        };
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    if (parsed.scheme !== "env") {
      return {
        available: false,
        failureCode: "secret_scheme_unsupported",
        scheme: parsed.scheme,
      };
    }
    const value = this.variables[parsed.path];
    if (value === undefined) {
      return {
        available: false,
        failureCode: "secret_not_found",
        scheme: parsed.scheme,
      };
    }
    if (value.length === 0) {
      return {
        available: false,
        failureCode: "secret_empty",
        scheme: parsed.scheme,
      };
    }
    return { available: true, scheme: parsed.scheme, value };
  }
}

export const disabledSecretResolver: SecretResolver = {
  async check(secretRef) {
    const parsed = parseManagedSecretRef(secretRef);
    return {
      available: false,
      failureCode: "secret_resolver_disabled",
      scheme: parsed.scheme,
    };
  },
};

export class SchemeRoutingSecretResolver implements SecretResolver {
  constructor(
    private readonly routes: Record<string, SecretResolver>,
    private readonly fallback: SecretResolver,
  ) {}

  async check(secretRef: string): Promise<SecretAvailability> {
    const parsed = parseManagedSecretRef(secretRef);
    const resolver = this.routes[parsed.scheme] ?? this.fallback;
    return resolver.check(secretRef);
  }

  async resolveValue(secretRef: string): Promise<SecretResolution> {
    const parsed = parseManagedSecretRef(secretRef);
    const resolver = this.routes[parsed.scheme] ?? this.fallback;
    if (resolver.resolveValue === undefined) {
      return {
        available: false,
        failureCode: "secret_value_resolution_unavailable",
        scheme: parsed.scheme,
      };
    }
    return resolver.resolveValue(secretRef);
  }
}
