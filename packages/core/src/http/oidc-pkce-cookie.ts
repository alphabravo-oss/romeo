export const oidcPkceCookieName = 'romeo_oidc_pkce'

export function createOidcPkceCookie(value: string, expiresAt: string, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  return cookieValue(value, maxAge, secure)
}

export function clearOidcPkceCookie(secure: boolean): string {
  return cookieValue('', 0, secure)
}

function cookieValue(value: string, maxAge: number, secure: boolean): string {
  return `${oidcPkceCookieName}=${value}; HttpOnly; Path=/api/v1/auth/oidc/callback; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}
