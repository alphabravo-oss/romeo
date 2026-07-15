export const samlStateCookieName = "romeo_saml_state";

export function createSamlStateCookie(
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

export function clearSamlStateCookie(secure: boolean): string {
  return cookieValue("", 0, secure);
}

function cookieValue(value: string, maxAge: number, secure: boolean): string {
  return `${samlStateCookieName}=${value}; HttpOnly; Path=/api/v1/auth/saml/callback; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
