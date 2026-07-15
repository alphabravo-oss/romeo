export const authProviderIds = [
  "local",
  "generic-oidc",
  "keycloak",
  "google",
  "github",
  "azure-ad",
  "okta",
  "auth0",
  "ldap",
  "active-directory",
  "saml",
] as const;

export type AuthProviderId = (typeof authProviderIds)[number];

export interface AuthProviderCatalogEntry {
  id: AuthProviderId;
  name: string;
  protocol: "ldap" | "local" | "oauth2" | "oidc" | "saml";
  configurationScopes: Array<"global" | "org">;
  runtimePackage: string | null;
  status: "implemented" | "planned";
  supportsJitProvisioning: boolean;
  supportsLocalFallback: boolean;
  supportsMfaDelegation: boolean;
  notes: string[];
}

export const authProviderCatalog: AuthProviderCatalogEntry[] = [
  {
    id: "local",
    name: "Local Email and Password",
    protocol: "local",
    configurationScopes: ["global", "org"],
    runtimePackage: "@node-rs/argon2 + otplib",
    status: "implemented",
    supportsJitProvisioning: false,
    supportsLocalFallback: true,
    supportsMfaDelegation: false,
    notes: [
      "Uses Argon2id password hashes, legacy scrypt verification, and local TOTP factors.",
    ],
  },
  {
    id: "generic-oidc",
    name: "Generic OIDC",
    protocol: "oidc",
    configurationScopes: ["global", "org"],
    runtimePackage: "openid-client",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: ["Use any standards-compliant OpenID Connect issuer."],
  },
  {
    id: "keycloak",
    name: "Keycloak",
    protocol: "oidc",
    configurationScopes: ["global", "org"],
    runtimePackage: "openid-client",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: ["Use the realm issuer URL and map groups or client roles."],
  },
  {
    id: "google",
    name: "Google Workspace",
    protocol: "oidc",
    configurationScopes: ["global", "org"],
    runtimePackage: "openid-client",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: ["Workspace group claims require configured claim mapping."],
  },
  {
    id: "github",
    name: "GitHub",
    protocol: "oauth2",
    configurationScopes: ["global", "org"],
    runtimePackage: "oauth4webapi",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: [
      "Uses authorization code with PKCE, verified email lookup, and optional org/team membership policy.",
    ],
  },
  {
    id: "azure-ad",
    name: "Microsoft Entra ID / Azure AD",
    protocol: "oidc",
    configurationScopes: ["global", "org"],
    runtimePackage: "openid-client",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: ["Use tenant-specific issuers and explicit group ID mapping."],
  },
  {
    id: "okta",
    name: "Okta",
    protocol: "oidc",
    configurationScopes: ["global", "org"],
    runtimePackage: "openid-client",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: [
      "Use a custom authorization server when group claims are required.",
    ],
  },
  {
    id: "auth0",
    name: "Auth0",
    protocol: "oidc",
    configurationScopes: ["global", "org"],
    runtimePackage: "openid-client",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: ["Use namespaced custom claims for groups."],
  },
  {
    id: "ldap",
    name: "LDAP",
    protocol: "ldap",
    configurationScopes: ["global", "org"],
    runtimePackage: "ldapts",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: false,
    notes: [
      "Uses bounded service bind/search, StartTLS or LDAPS, and group filters.",
    ],
  },
  {
    id: "active-directory",
    name: "Active Directory",
    protocol: "ldap",
    configurationScopes: ["global", "org"],
    runtimePackage: "ldapts",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: false,
    notes: [
      "AD uses LDAP with domain-specific user and group mapping defaults.",
    ],
  },
  {
    id: "saml",
    name: "SAML 2.0",
    protocol: "saml",
    configurationScopes: ["global", "org"],
    runtimePackage: "@node-saml/node-saml",
    status: "implemented",
    supportsJitProvisioning: true,
    supportsLocalFallback: true,
    supportsMfaDelegation: true,
    notes: [
      "Uses SP-initiated HTTP-Redirect login, HTTP-POST ACS validation, and signed assertions.",
    ],
  },
];
