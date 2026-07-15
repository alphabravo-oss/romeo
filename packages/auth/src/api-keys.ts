export function createApiKeyToken(): string {
  return tokenWithPrefix('rmk')
}

export function createRefreshToken(): string {
  return tokenWithPrefix('rmr')
}

export function createSessionToken(): string {
  return tokenWithPrefix('rms')
}

function tokenWithPrefix(prefix: string): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `${prefix}_${toHex(bytes)}`
}

export async function hashApiKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return toHex(new Uint8Array(digest))
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
