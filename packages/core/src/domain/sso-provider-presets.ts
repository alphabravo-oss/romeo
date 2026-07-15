export const ssoOidcProviderPresetIds = [
  "generic",
  "keycloak",
  "google",
  "github",
  "azure-ad",
  "okta",
  "auth0",
] as const;

export type SsoOidcProviderPresetId = (typeof ssoOidcProviderPresetIds)[number];

export interface SsoOidcProviderPresetSummary {
  id: SsoOidcProviderPresetId;
  name: string;
  recommendedGroupClaim: string;
  issuerHint: string;
  notes: string[];
}

const genericOidcPreset: SsoOidcProviderPresetSummary = {
  id: "generic",
  name: "Generic OIDC",
  recommendedGroupClaim: "groups",
  issuerHint: "https://idp.example.com",
  notes: ["Use any standards-compliant OIDC issuer."],
};

export const ssoOidcProviderPresets: SsoOidcProviderPresetSummary[] = [
  genericOidcPreset,
  {
    id: "keycloak",
    name: "Keycloak",
    recommendedGroupClaim: "groups",
    issuerHint: "https://keycloak.example.com/realms/{realm}",
    notes: [
      "Use the realm issuer URL; Keycloak also remains the bridge for SAML, LDAP, and Active Directory.",
    ],
  },
  {
    id: "google",
    name: "Google",
    recommendedGroupClaim: "groups",
    issuerHint: "https://accounts.google.com",
    notes: ["Group claims require a reviewed Google Workspace claim mapping."],
  },
  {
    id: "github",
    name: "GitHub",
    recommendedGroupClaim: "teams",
    issuerHint:
      "Use the GitHub OAuth2 auth-provider card for first-party login, or Keycloak/another OIDC bridge for brokered organization identity.",
    notes: [
      "This OIDC preset is for brokered GitHub identity. Direct GitHub login uses the implemented OAuth2 provider settings path.",
    ],
  },
  {
    id: "azure-ad",
    name: "Azure AD / Entra ID",
    recommendedGroupClaim: "groups",
    issuerHint: "https://login.microsoftonline.com/{tenant}/v2.0",
    notes: ["Use tenant-specific issuers and map group object IDs explicitly."],
  },
  {
    id: "okta",
    name: "Okta",
    recommendedGroupClaim: "groups",
    issuerHint: "https://{domain}.okta.com/oauth2/{authorizationServer}",
    notes: [
      "Use a custom authorization server when group claims are required.",
    ],
  },
  {
    id: "auth0",
    name: "Auth0",
    recommendedGroupClaim: "https://romeo.example/groups",
    issuerHint: "https://{tenant}.auth0.com",
    notes: ["Use a namespaced custom claim for groups."],
  },
];

const presetIdSet = new Set<string>(ssoOidcProviderPresetIds);

export function isSsoOidcProviderPresetId(
  value: string,
): value is SsoOidcProviderPresetId {
  return presetIdSet.has(value);
}

export function providerPresetById(
  id: SsoOidcProviderPresetId,
): SsoOidcProviderPresetSummary {
  return (
    ssoOidcProviderPresets.find((preset) => preset.id === id) ??
    genericOidcPreset
  );
}

export function detectSsoOidcProviderPreset(
  issuerUrl: string,
): SsoOidcProviderPresetId {
  if (issuerUrl.length === 0) return "generic";
  try {
    const url = new URL(issuerUrl);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (path.includes("/realms/")) return "keycloak";
    if (host === "accounts.google.com") return "google";
    if (host === "token.actions.githubusercontent.com") return "github";
    if (
      host === "login.microsoftonline.com" ||
      host.endsWith(".login.microsoftonline.com")
    )
      return "azure-ad";
    if (
      host.endsWith(".okta.com") ||
      host.endsWith(".okta-emea.com") ||
      host.endsWith(".okta-gov.com")
    )
      return "okta";
    if (host.endsWith(".auth0.com")) return "auth0";
  } catch {
    return "generic";
  }
  return "generic";
}
