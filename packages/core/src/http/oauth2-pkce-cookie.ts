export const oauth2PkceCookieName = "romeo_oauth2_pkce";

export function createOAuth2PkceCookie(
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

export function clearOAuth2PkceCookie(secure: boolean): string {
  return cookieValue("", 0, secure);
}

function cookieValue(value: string, maxAge: number, secure: boolean): string {
  return `${oauth2PkceCookieName}=${value}; HttpOnly; Path=/api/v1/auth/oauth2/callback; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
