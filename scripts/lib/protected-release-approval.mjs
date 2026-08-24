import { createPublicKey, verify } from "node:crypto";

export const approvalAttestationSchema =
  "romeo.protected-environment-approval-attestation.v1";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function verifyProtectedApprovalAttestation({
  attestation,
  trustedPublicKeyPem,
}) {
  if (attestation?.schemaVersion !== approvalAttestationSchema)
    throw new Error("Protected approval attestation schema is invalid.");
  if (attestation.signature?.algorithm !== "ed25519")
    throw new Error("Protected approval must use Ed25519.");
  if (
    typeof attestation.signature?.keyId !== "string" ||
    attestation.signature.keyId.length < 3
  )
    throw new Error("Protected approval keyId is missing.");
  const encoded = attestation.signature?.value;
  if (typeof encoded !== "string" || encoded.length === 0)
    throw new Error("Protected approval signature is missing.");
  const signature = Buffer.from(encoded, "base64url");
  const valid = verify(
    null,
    Buffer.from(canonicalJson(attestation.payload)),
    createPublicKey(trustedPublicKeyPem),
    signature,
  );
  if (!valid) throw new Error("Protected approval signature is invalid.");
  return attestation.payload;
}

export function normalizedArtifactDigests(artifacts) {
  return Object.fromEntries(
    (Array.isArray(artifacts) ? artifacts : [])
      .map((artifact) => [artifact?.name, artifact?.sha256])
      .filter(
        ([name, digest]) =>
          typeof name === "string" &&
          typeof digest === "string" &&
          /^[a-f0-9]{64}$/u.test(digest),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
