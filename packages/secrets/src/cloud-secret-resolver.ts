import { AwsSecretsManagerResolver } from "./aws-secrets-manager";
import { AzureKeyVaultResolver } from "./azure-key-vault";
import { GcpSecretManagerResolver } from "./gcp-secret-manager";
import { parseManagedSecretRef, unsupported } from "./secret-support";
import type {
  SecretAvailability,
  SecretResolution,
  SecretResolver,
} from "./types";

export class CloudSecretResolver implements SecretResolver {
  constructor(
    private readonly resolvers: {
      aws: AwsSecretsManagerResolver;
      azure: AzureKeyVaultResolver;
      gcp: GcpSecretManagerResolver;
    },
  ) {}

  check(secretRef: string): Promise<SecretAvailability> {
    const resolver = this.resolver(secretRef);
    return resolver === undefined
      ? Promise.resolve(unsupported(parseManagedSecretRef(secretRef).scheme))
      : resolver.check(secretRef);
  }

  resolveValue(secretRef: string): Promise<SecretResolution> {
    const resolver = this.resolver(secretRef);
    return resolver === undefined
      ? Promise.resolve(unsupported(parseManagedSecretRef(secretRef).scheme))
      : resolver.resolveValue(secretRef);
  }

  private resolver(secretRef: string): SecretResolver | undefined {
    const scheme = parseManagedSecretRef(secretRef).scheme;
    if (scheme === "aws-sm") return this.resolvers.aws;
    if (scheme === "azure-kv") return this.resolvers.azure;
    if (scheme === "gcp-sm") return this.resolvers.gcp;
    return undefined;
  }
}
