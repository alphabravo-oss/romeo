export const sessionCookieName = 'romeo_session'

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')
    if (rawName === name) return rawValue.join('=')
  }
  return undefined
}

export function createSessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  return cookieValue(token, maxAge, secure)
}

export function clearSessionCookie(secure: boolean): string {
  return cookieValue('', 0, secure)
}

function cookieValue(value: string, maxAge: number, secure: boolean): string {
  return `${sessionCookieName}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}
