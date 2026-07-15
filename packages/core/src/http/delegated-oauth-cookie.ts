export const delegatedOAuthCookieName = "romeo_delegated_oauth";

export function createDelegatedOAuthCookie(
  value: string,
  expiresAt: string,
  secure: boolean,
): string {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  return cookieValue(value, maxAge, secure);
}

export function clearDelegatedOAuthCookie(secure: boolean): string {
  return cookieValue("", 0, secure);
}

function cookieValue(value: string, maxAge: number, secure: boolean): string {
  return `${delegatedOAuthCookieName}=${value}; HttpOnly; Path=/api/v1/delegated-oauth/callback; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
