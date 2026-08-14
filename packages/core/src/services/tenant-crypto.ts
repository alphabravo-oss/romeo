import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type TenantKeyState =
  | "active"
  | "rotating"
  | "disabled"
  | "revoked"
  | "recovery_required";

export interface TenantKey {
  version: number;
  state: TenantKeyState;
  purpose: string;
  orgId: string;
  wrappingKeyId: string;
}

export interface TenantEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  keyVersion: number;
  purpose: string;
  orgId: string;
  resourceId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export type TenantCryptoResult =
  | { outcome: "ok"; envelope?: TenantEnvelope; plaintext?: Buffer }
  | {
      outcome: "unavailable";
      code: "tenant_key_unavailable" | "tenant_key_revoked";
    };

const PLATFORM_KEY_ID = "platform_secret_key";

export function deriveTenantDek(
  wrappingMaterial: Buffer,
  key: Pick<TenantKey, "orgId" | "purpose" | "version">,
): Buffer {
  return createHash("sha256")
    .update(wrappingMaterial)
    .update("\0")
    .update(key.orgId)
    .update("\0")
    .update(key.purpose)
    .update("\0")
    .update(String(key.version))
    .digest();
}

export function sealTenantEnvelope(input: {
  key: TenantKey;
  wrappingMaterial: Buffer;
  plaintext: Buffer;
  resourceId: string;
}): TenantCryptoResult {
  if (input.key.wrappingKeyId === PLATFORM_KEY_ID)
    return { outcome: "unavailable", code: "tenant_key_unavailable" };
  if (input.key.state === "revoked" || input.key.state === "disabled")
    return { outcome: "unavailable", code: "tenant_key_revoked" };
  if (input.key.state !== "active" && input.key.state !== "rotating")
    return { outcome: "unavailable", code: "tenant_key_unavailable" };
  const dek = deriveTenantDek(input.wrappingMaterial, input.key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const aad = tenantAad(input.key, input.resourceId);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
  return {
    outcome: "ok",
    envelope: {
      v: 1,
      alg: "aes-256-gcm",
      keyVersion: input.key.version,
      purpose: input.key.purpose,
      orgId: input.key.orgId,
      resourceId: input.resourceId,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  };
}

export function openTenantEnvelope(input: {
  key: TenantKey;
  wrappingMaterial: Buffer;
  envelope: TenantEnvelope;
}): TenantCryptoResult {
  if (input.key.wrappingKeyId === PLATFORM_KEY_ID)
    return { outcome: "unavailable", code: "tenant_key_unavailable" };
  if (input.key.state === "revoked")
    return { outcome: "unavailable", code: "tenant_key_revoked" };
  if (input.key.state === "disabled" || input.key.state === "recovery_required")
    return { outcome: "unavailable", code: "tenant_key_unavailable" };
  if (
    input.envelope.orgId !== input.key.orgId ||
    input.envelope.purpose !== input.key.purpose ||
    input.envelope.keyVersion !== input.key.version
  )
    return { outcome: "unavailable", code: "tenant_key_unavailable" };
  const dek = deriveTenantDek(input.wrappingMaterial, input.key);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dek,
    Buffer.from(input.envelope.iv, "base64"),
  );
  decipher.setAAD(tenantAad(input.key, input.envelope.resourceId));
  decipher.setAuthTag(Buffer.from(input.envelope.tag, "base64"));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(input.envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return { outcome: "ok", plaintext };
  } catch {
    return { outcome: "unavailable", code: "tenant_key_unavailable" };
  }
}

export function revokeTenantKey(key: TenantKey): TenantKey {
  return { ...key, state: "revoked" };
}

export function canSubstitutePlatformKey(key: TenantKey): false {
  void key;
  return false;
}

function tenantAad(key: Pick<TenantKey, "orgId" | "purpose">, resourceId: string) {
  return Buffer.from(`${key.purpose}\0${key.orgId}\0${resourceId}`, "utf8");
}
