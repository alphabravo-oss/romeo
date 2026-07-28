export {
  VaultSecretWriter,
  type SecretWriteResult,
  type SecretWriter,
  type VaultSdkClient,
  type VaultSdkClientFactory,
  type VaultSecretWriterOptions,
} from "@romeo/secrets";

import type { SecretWriter } from "@romeo/secrets";

export const disabledSecretWriter: SecretWriter = {
  async write(input) {
    const separator = input.secretRef.indexOf("://");
    const scheme =
      separator > 0 ? input.secretRef.slice(0, separator) : "invalid";
    return {
      failureCode: "secret_writer_disabled",
      scheme,
      secretRef: input.secretRef,
      stored: false,
    };
  },
};
