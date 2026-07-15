export interface OidcJwtVerifierConfig {
  audience: string
  clockToleranceSeconds?: number
  issuer: string
  jwks: JsonWebKey[]
  now?: Date
}

export class OidcJwtVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcJwtVerificationError'
  }
}

export async function verifyOidcJwt(token: string, config: OidcJwtVerifierConfig): Promise<Record<string, unknown>> {
  const { header, payload, signature, signingInput } = parseCompactJwt(token)
  if (header.alg !== 'RS256') throw new OidcJwtVerificationError('OIDC token must use RS256.')
  const key = selectJwk(config.jwks, header.kid)
  const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    toArrayBuffer(signature),
    new TextEncoder().encode(signingInput)
  )
  if (!verified) throw new OidcJwtVerificationError('OIDC token signature is invalid.')

  assertStringClaim(payload.iss, 'iss')
  if (payload.iss !== config.issuer) throw new OidcJwtVerificationError('OIDC token issuer is invalid.')
  if (!audienceMatches(payload.aud, config.audience)) throw new OidcJwtVerificationError('OIDC token audience is invalid.')
  assertTimeClaims(payload, config)
  return payload
}

function parseCompactJwt(token: string): {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: Uint8Array
  signingInput: string
} {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw new OidcJwtVerificationError('OIDC token must be a compact JWT.')
  return {
    header: parseJsonPart(parts[0]!, 'header'),
    payload: parseJsonPart(parts[1]!, 'payload'),
    signature: base64UrlDecode(parts[2]!),
    signingInput: `${parts[0]}.${parts[1]}`
  }
}

function parseJsonPart(part: string, label: string): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OidcJwtVerificationError(`OIDC token ${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function selectJwk(jwks: JsonWebKey[], kid: unknown): JsonWebKey {
  const key = jwks.find((candidate) => candidate.kty === 'RSA' && (kid === undefined || (candidate as JsonWebKey & { kid?: string }).kid === kid))
  if (key === undefined) throw new OidcJwtVerificationError('OIDC signing key was not found.')
  return key
}

function audienceMatches(value: unknown, audience: string): boolean {
  if (typeof value === 'string') return value === audience
  return Array.isArray(value) && value.includes(audience)
}

function assertTimeClaims(payload: Record<string, unknown>, config: OidcJwtVerifierConfig): void {
  const now = Math.floor((config.now?.getTime() ?? Date.now()) / 1000)
  const tolerance = config.clockToleranceSeconds ?? 60
  const exp = numberClaim(payload.exp)
  if (exp === undefined) throw new OidcJwtVerificationError('OIDC token must include exp.')
  if (exp <= now - tolerance) throw new OidcJwtVerificationError('OIDC token has expired.')
  const nbf = numberClaim(payload.nbf)
  if (nbf !== undefined && nbf > now + tolerance) throw new OidcJwtVerificationError('OIDC token is not active yet.')
  const iat = numberClaim(payload.iat)
  if (iat !== undefined && iat > now + tolerance) throw new OidcJwtVerificationError('OIDC token was issued in the future.')
}

function assertStringClaim(value: unknown, claim: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new OidcJwtVerificationError(`OIDC token must include ${claim}.`)
}

function numberClaim(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
