/**
 * Reads routing/key-selection hints before signature verification. Callers may
 * use these values only to choose an organization or candidate key; verified
 * claims must always come from the JWT verifier.
 */
export function unverifiedJwtIssuer(token: string): string | undefined {
  const issuer = unverifiedJwtPayload(token)?.iss;
  return typeof issuer === "string" && issuer.length > 0 ? issuer : undefined;
}

export function unverifiedJwtAudience(token: string): string[] {
  const audience = unverifiedJwtPayload(token)?.aud;
  if (typeof audience === "string" && audience.length > 0) return [audience];
  if (!Array.isArray(audience)) return [];
  return audience.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function audienceIncludes(
  audience: string[],
  clientId: string,
): boolean {
  return clientId.length > 0 && audience.includes(clientId);
}

export function tokenKeyId(token: string): string | undefined {
  try {
    const encoded = token.split(".")[0];
    if (encoded === undefined) return undefined;
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString()) as {
      kid?: unknown;
    };
    return typeof parsed.kid === "string" && parsed.kid.length <= 300
      ? parsed.kid
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when a JWT carries ID-token markers. A bearer credential must be an
 * access token: ID tokens are minted for the client itself, so accepting
 * them would let anything that obtained a user's ID token call the API.
 * RFC 9068 access tokens (`typ: at+jwt`) are always treated as access tokens.
 */
export function unverifiedJwtIsIdToken(token: string): boolean {
  const header = unverifiedJwtSegment(token, 0);
  const typ = typeof header?.typ === "string" ? header.typ.toLowerCase() : "";
  if (typ === "at+jwt" || typ === "application/at+jwt") return false;
  const payload = unverifiedJwtSegment(token, 1);
  if (payload === undefined) return false;
  return (
    payload.nonce !== undefined ||
    payload.at_hash !== undefined ||
    payload.c_hash !== undefined ||
    payload.token_use === "id" ||
    (typeof payload.typ === "string" && payload.typ.toLowerCase() === "id")
  );
}

function unverifiedJwtPayload(
  token: string,
): Record<string, unknown> | undefined {
  return unverifiedJwtSegment(token, 1);
}

function unverifiedJwtSegment(
  token: string,
  index: 0 | 1,
): Record<string, unknown> | undefined {
  try {
    const encoded = token.split(".")[index];
    if (encoded === undefined) return undefined;
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString());
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
