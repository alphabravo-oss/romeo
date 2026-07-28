export interface ProviderCardEntry {
  id: string;
  protocol: "oidc" | "oauth2" | "saml" | "ldap" | "local";
  status: "implemented" | "planned";
}

export function canTestProvider(entry: ProviderCardEntry): boolean {
  return entry.status !== "planned";
}

export function canDeprovisionProvider(entry: ProviderCardEntry): boolean {
  return (
    entry.status !== "planned" &&
    entry.protocol === "oidc" &&
    entry.id !== "local"
  );
}
