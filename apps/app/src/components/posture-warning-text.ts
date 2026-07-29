/**
 * Backend warning codes are snake_case. Sentence-casing them blindly turns
 * "ga_checklist..." into "Ga checklist...", so acronyms are upper-cased from
 * a known list rather than title-cased by position.
 */
const ACRONYMS = new Set([
  "api",
  "ga",
  "ldap",
  "mfa",
  "oidc",
  "rag",
  "saml",
  "scim",
  "sso",
  "tls",
  "url",
]);

export function humanizeWarningCode(code: string): string {
  if (code.length === 0) return "";
  const words = code.split("_").filter((word) => word.length > 0);
  if (words.length === 0) return "";
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}
