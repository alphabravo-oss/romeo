import { describe, expect, it } from "vitest";

import { ManagedModelPreferenceVault } from "./managed-model-preference-vault";

const currentKey = "current-managed-model-key-material-at-least-32-chars";
const previousKey = "previous-managed-model-key-material-at-least-32-chars";
const context = "org_1:agent_1:user:user_1";

describe("ManagedModelPreferenceVault", () => {
  it("encrypts custom instructions without retaining plaintext", () => {
    const vault = new ManagedModelPreferenceVault({
      encryptionKey: currentKey,
    });
    const encoded = vault.encode("Private writing preference", context);

    expect(encoded).not.toContain("Private writing preference");
    expect(JSON.parse(encoded)).toMatchObject({ alg: "A256GCM", v: 1 });
    expect(vault.decode(encoded, context)).toBe("Private writing preference");
  });

  it("reads previous-key ciphertext during rolling key rotation", () => {
    const oldVault = new ManagedModelPreferenceVault({
      encryptionKey: previousKey,
    });
    const rotatedVault = new ManagedModelPreferenceVault({
      encryptionKey: currentKey,
      previousEncryptionKey: previousKey,
    });

    expect(
      rotatedVault.decode(oldVault.encode("Rotate me", context), context),
    ).toBe("Rotate me");
  });

  it("binds ciphertext to its tenant, model, and principal context", () => {
    const vault = new ManagedModelPreferenceVault({
      encryptionKey: currentKey,
    });
    const encoded = vault.encode("Do not swap me", context);

    expect(() =>
      vault.decode(encoded, "org_2:agent_1:user:user_1"),
    ).toThrowError(
      expect.objectContaining({
        code: "managed_model_preferences_decryption_failed",
      }),
    );
  });

  it("rejects malformed storage envelopes", () => {
    const vault = new ManagedModelPreferenceVault({
      encryptionKey: currentKey,
    });

    expect(() => vault.decode("not-json", context)).toThrowError(
      expect.objectContaining({
        code: "managed_model_preferences_envelope_invalid",
      }),
    );
  });
});
