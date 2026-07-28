export interface SecretAvailability {
  available: boolean;
  failureCode?: string;
  scheme: string;
}

export interface SecretResolution extends SecretAvailability {
  value?: string;
}

export interface SecretResolver {
  check(secretRef: string): Promise<SecretAvailability>;
  resolveValue(secretRef: string): Promise<SecretResolution>;
}

export interface SecretWriteResult {
  failureCode?: string;
  scheme: string;
  secretRef: string;
  stored: boolean;
}

export interface SecretWriter {
  write(input: {
    secretRef: string;
    value: string;
  }): Promise<SecretWriteResult>;
}
