import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { authProviderIds } from "../packages/core/src/domain/auth-providers";
import type { AuthProviderConnectionTestReport } from "../packages/core/src/domain/auth-provider-settings";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver";
import type { LdapClientFactory } from "../packages/core/src/services/ldap-directory-client";

const output = argValue("--output");
const pid = process.pid;
const rawSentinels = {
  activeDirectoryBaseDn: `dc=ad-secret-${pid},dc=example,dc=com`,
  activeDirectoryBindDn: `cn=ad-bind-${pid},ou=secret-service,dc=example,dc=com`,
  activeDirectoryGroup: `secret-ad-group-${pid}`,
  activeDirectorySecretRef: `env://AD_AUTH_PROVIDER_SECRET_${pid}`,
  activeDirectorySecretValue: `RAW_AD_AUTH_PROVIDER_SECRET_${pid}`,
  activeDirectoryUrl: `ldaps://ad-${pid}.identity.example.com`,
  auth0AdminGroup: `secret-auth0-admins-${pid}`,
  auth0ClientId: `auth0-client-${pid}`,
  auth0IssuerUrl: `https://auth0-${pid}.auth0.com`,
  azureAdminGroup: `secret-azure-admins-${pid}`,
  azureClientId: `azure-client-${pid}`,
  azureIssuerUrl: `https://login.microsoftonline.com/secret-tenant-${pid}/v2.0`,
  genericOidcAdminGroup: `secret-generic-oidc-admins-${pid}`,
  genericOidcClientId: `generic-oidc-client-${pid}`,
  genericOidcIssuerUrl: `https://generic-oidc-${pid}.identity.example.com`,
  githubClientId: `github-client-${pid}`,
  githubOrg: `secret-github-org-${pid}`,
  githubSecretRef: `env://GITHUB_AUTH_PROVIDER_SECRET_${pid}`,
  githubSecretValue: `RAW_GITHUB_AUTH_PROVIDER_SECRET_${pid}`,
  githubTeam: `secret-github-org-${pid}/secret-github-team-${pid}`,
  googleAdminGroup: `secret-google-admins-${pid}`,
  googleClientId: `google-client-${pid}`,
  googleIssuerUrl: "https://accounts.google.com",
  keycloakAdminGroup: `secret-keycloak-admins-${pid}`,
  keycloakClientId: `keycloak-client-${pid}`,
  keycloakIssuerUrl: `https://keycloak-${pid}.identity.example.com/realms/secret-realm-${pid}`,
  ldapBaseDn: `dc=secret-${pid},dc=example,dc=com`,
  ldapBindDn: `cn=bind-${pid},ou=secret-service,dc=example,dc=com`,
  ldapGroup: `secret-ldap-group-${pid}`,
  ldapSecretRef: `env://LDAP_AUTH_PROVIDER_SECRET_${pid}`,
  ldapSecretValue: `RAW_LDAP_AUTH_PROVIDER_SECRET_${pid}`,
  ldapUrl: `ldaps://ldap-${pid}.identity.example.com`,
  localManagedSecretValue: `RAW_LOCAL_MANAGED_AUTH_PROVIDER_SECRET_${pid}`,
  samlEntryPoint: `https://saml-${pid}.identity.example.com/sso/secret-path-${pid}`,
  samlGroup: `secret-saml-group-${pid}`,
  samlSecretRef: `env://SAML_AUTH_PROVIDER_CERT_${pid}`,
  samlSecretValue: `RAW_SAML_AUTH_PROVIDER_CERT_${pid}`,
  samlSpEntityId: `https://romeo.example.com/saml/metadata/secret-${pid}`,
  oktaAdminGroup: `secret-okta-admins-${pid}`,
  oktaClientId: `okta-client-${pid}`,
  oktaIssuerUrl: `https://okta-${pid}.okta.com/oauth2/default`,
};

const oidcProviderConfigs = [
  {
    adminGroup: rawSentinels.genericOidcAdminGroup,
    clientId: rawSentinels.genericOidcClientId,
    groupClaim: "groups",
    issuerUrl: rawSentinels.genericOidcIssuerUrl,
    providerId: "generic-oidc",
  },
  {
    adminGroup: rawSentinels.keycloakAdminGroup,
    clientId: rawSentinels.keycloakClientId,
    groupClaim: "groups",
    issuerUrl: rawSentinels.keycloakIssuerUrl,
    providerId: "keycloak",
  },
  {
    adminGroup: rawSentinels.googleAdminGroup,
    clientId: rawSentinels.googleClientId,
    groupClaim: "groups",
    issuerUrl: rawSentinels.googleIssuerUrl,
    providerId: "google",
  },
  {
    adminGroup: rawSentinels.azureAdminGroup,
    clientId: rawSentinels.azureClientId,
    groupClaim: "groups",
    issuerUrl: rawSentinels.azureIssuerUrl,
    providerId: "azure-ad",
  },
  {
    adminGroup: rawSentinels.oktaAdminGroup,
    clientId: rawSentinels.oktaClientId,
    groupClaim: "groups",
    issuerUrl: rawSentinels.oktaIssuerUrl,
    providerId: "okta",
  },
  {
    adminGroup: rawSentinels.auth0AdminGroup,
    clientId: rawSentinels.auth0ClientId,
    groupClaim: "https://romeo.example/groups",
    issuerUrl: rawSentinels.auth0IssuerUrl,
    providerId: "auth0",
  },
] as const;

const repository = new InMemoryRomeoRepository();
const oidcFetches: string[] = [];
const githubFetches: string[] = [];
const ldapBinds: Array<{ dn: string; password: string }> = [];
const ldapSearches: Array<{ baseDn: string; filter: string }> = [];
const ldapClientFactory: LdapClientFactory = () => ({
  async bind(dn, password) {
    ldapBinds.push({ dn, password });
    const ldapMatch =
      dn === rawSentinels.ldapBindDn &&
      password === rawSentinels.ldapSecretValue;
    const activeDirectoryMatch =
      dn === rawSentinels.activeDirectoryBindDn &&
      password === rawSentinels.activeDirectorySecretValue;
    if (!ldapMatch && !activeDirectoryMatch) {
      throw new Error("unexpected LDAP bind input");
    }
  },
  async search(baseDn, options) {
    ldapSearches.push({ baseDn, filter: options.filter });
    return [{ dn: baseDn }];
  },
  async startTls() {},
  async unbind() {},
});
const api = createRomeoApi(repository, {
  env: readEnv({
    DEV_SEEDED_LOGIN: "true",
    MANAGED_SECRET_ENCRYPTION_KEY: "auth-provider-managed-secret-key-32",
  }),
  ldapClientFactory,
  oidcFetch: authProviderFetch,
  secretResolver: new EnvironmentSecretResolver({
    [envVarName(rawSentinels.activeDirectorySecretRef)]:
      rawSentinels.activeDirectorySecretValue,
    [envVarName(rawSentinels.githubSecretRef)]: rawSentinels.githubSecretValue,
    [envVarName(rawSentinels.ldapSecretRef)]: rawSentinels.ldapSecretValue,
    [envVarName(rawSentinels.samlSecretRef)]: rawSentinels.samlSecretValue,
  }),
});

const catalog = await requestJson<{ data: AuthProviderCatalogEntry[] }>(
  "/api/v1/admin/auth-providers/catalog",
);
assertStatus(catalog.response, 200, "auth provider catalog");
assertCatalog(catalog.body.data);
assertNoSensitive("auth provider catalog", JSON.stringify(catalog.body));

const managedSecret = await postJson<{
  data: {
    secretRef: string;
    secretRefScheme: string;
    storageDriver: string;
    valueStored: boolean;
  };
}>("/api/v1/admin/secrets", {
  name: "Keycloak browser client secret",
  purpose: "auth_provider_client_secret",
  scope: "org",
  value: rawSentinels.localManagedSecretValue,
});
assertStatus(managedSecret.response, 201, "managed auth-provider secret");
if (
  managedSecret.body.data.secretRefScheme !== "romeo-secret" ||
  managedSecret.body.data.storageDriver !== "local" ||
  managedSecret.body.data.valueStored !== true
) {
  throw new Error(
    "Managed secret ingestion did not use local encrypted storage.",
  );
}
assertNotContains(
  JSON.stringify(managedSecret.body),
  rawSentinels.localManagedSecretValue,
  "managed auth-provider secret response",
);

const update = await postPatchJson<AuthProviderSettingsResponse>(
  "/api/v1/admin/auth-providers/settings",
  {
    global: {
      providers: [
        ...oidcProviderConfigs.map((provider) => ({
          providerId: provider.providerId,
          enabled: true,
          orgOverridesAllowed: true,
          allowedEmailDomains: ["example.com"],
          secretRef: managedSecret.body.data.secretRef,
          oidc: {
            issuerUrl: provider.issuerUrl,
            clientId: provider.clientId,
            groupClaim: provider.groupClaim,
            adminGroups: [provider.adminGroup],
            groupMap: {
              [`oidc:group:${provider.adminGroup}`]: "group_admins",
            },
            workspaceGroupPrefix: `${provider.providerId}:workspace:`,
          },
        })),
        {
          providerId: "github",
          enabled: true,
          allowedEmailDomains: ["example.com"],
          secretRef: rawSentinels.githubSecretRef,
          oauth2: {
            clientId: rawSentinels.githubClientId,
            requiredOrganizations: [rawSentinels.githubOrg],
            requiredTeams: [rawSentinels.githubTeam],
            adminTeams: [rawSentinels.githubTeam],
            scopes: ["read:user", "user:email", "read:org"],
          },
        },
        {
          providerId: "ldap",
          enabled: true,
          allowedEmailDomains: ["example.com"],
          secretRef: rawSentinels.ldapSecretRef,
          ldap: {
            url: rawSentinels.ldapUrl,
            baseDn: rawSentinels.ldapBaseDn,
            bindDn: rawSentinels.ldapBindDn,
            userSearchFilter: "(mail={identifier})",
            groupSearchBaseDn: `ou=groups,${rawSentinels.ldapBaseDn}`,
            groupSearchFilter: "(member={userDn})",
            requiredGroups: [rawSentinels.ldapGroup],
            adminGroups: [rawSentinels.ldapGroup],
            groupMap: {
              [`ldap:group:${rawSentinels.ldapGroup}`]: "group_admins",
            },
            startTls: true,
          },
        },
        {
          providerId: "active-directory",
          enabled: true,
          allowedEmailDomains: ["example.com"],
          secretRef: rawSentinels.activeDirectorySecretRef,
          ldap: {
            url: rawSentinels.activeDirectoryUrl,
            baseDn: rawSentinels.activeDirectoryBaseDn,
            bindDn: rawSentinels.activeDirectoryBindDn,
            userSearchFilter: "(userPrincipalName={identifier})",
            groupSearchBaseDn: `ou=groups,${rawSentinels.activeDirectoryBaseDn}`,
            groupSearchFilter: "(member={userDn})",
            requiredGroups: [rawSentinels.activeDirectoryGroup],
            adminGroups: [rawSentinels.activeDirectoryGroup],
            groupMap: {
              [`ldap:group:${rawSentinels.activeDirectoryGroup}`]:
                "group_admins",
            },
            startTls: true,
          },
        },
        {
          providerId: "saml",
          enabled: true,
          allowedEmailDomains: ["example.com"],
          secretRef: rawSentinels.samlSecretRef,
          saml: {
            entryPoint: rawSentinels.samlEntryPoint,
            spEntityId: rawSentinels.samlSpEntityId,
            emailAttribute: "email",
            groupsAttribute: "groups",
            requiredGroups: [rawSentinels.samlGroup],
            adminGroups: [rawSentinels.samlGroup],
            groupMap: {
              [`saml:group:${rawSentinels.samlGroup}`]: "group_admins",
            },
            wantAuthnResponseSigned: true,
          },
        },
      ],
    },
    orgOverride: {
      providers: [
        {
          providerId: "keycloak",
          displayName: "Company SSO",
          allowedEmailDomains: ["engineering.example.com"],
        },
      ],
    },
  },
);
if (update.response.status !== 200) {
  throw new Error(
    `auth provider settings update returned ${update.response.status}: ${JSON.stringify(update.body)}`,
  );
}
assertSettings(update.body.data);
assertNoSensitive("auth provider settings update", JSON.stringify(update.body));

const settings = await requestJson<AuthProviderSettingsResponse>(
  "/api/v1/admin/auth-providers/settings",
);
assertStatus(settings.response, 200, "auth provider settings readback");
assertSettings(settings.body.data);
assertNoSensitive(
  "auth provider settings readback",
  JSON.stringify(settings.body),
);

const tests = {
  "active-directory": await connectionTest("active-directory"),
  auth0: await connectionTest("auth0"),
  "azure-ad": await connectionTest("azure-ad"),
  "generic-oidc": await connectionTest("generic-oidc"),
  google: await connectionTest("google"),
  keycloak: await connectionTest("keycloak"),
  local: await connectionTest("local"),
  github: await connectionTest("github"),
  ldap: await connectionTest("ldap"),
  okta: await connectionTest("okta"),
  saml: await connectionTest("saml"),
};
for (const [label, result] of Object.entries(tests)) {
  assertStatus(result.response, 200, `${label} connection test`);
  assertNoSensitive(`${label} connection test`, JSON.stringify(result.body));
}
assertConnectionTest(tests.local.body.data, "local", "passed");
for (const provider of oidcProviderConfigs) {
  assertConnectionTest(
    tests[provider.providerId].body.data,
    provider.providerId,
    "passed",
  );
}
assertConnectionTest(tests.github.body.data, "github", "passed");
assertConnectionTest(
  tests["active-directory"].body.data,
  "active-directory",
  "passed",
);
assertConnectionTest(tests.ldap.body.data, "ldap", "passed");
assertConnectionTest(tests.saml.body.data, "saml", "passed");
if (
  oidcFetches.length < oidcProviderConfigs.length * 2 ||
  githubFetches.length !== 1
) {
  throw new Error("Expected stubbed OIDC and GitHub connection-test calls.");
}
if (
  ldapBinds.length !== 2 ||
  ldapSearches.length !== 2 ||
  !ldapBinds.some(
    (bind) =>
      bind.dn === rawSentinels.ldapBindDn &&
      bind.password === rawSentinels.ldapSecretValue,
  ) ||
  !ldapBinds.some(
    (bind) =>
      bind.dn === rawSentinels.activeDirectoryBindDn &&
      bind.password === rawSentinels.activeDirectorySecretValue,
  )
) {
  throw new Error(
    "Expected LDAP and Active Directory connection tests to resolve bind secrets once.",
  );
}

const storedSecretId = managedSecret.body.data.secretRef.replace(
  "romeo-secret://",
  "",
);
const storedSecret = await repository.getSystemSetting(
  `managed_secret.v1:${storedSecretId}`,
);
const auditLogs = await repository.listAuditLogs("org_default");
assertNotContains(
  JSON.stringify(storedSecret),
  rawSentinels.localManagedSecretValue,
  "stored managed secret",
);
assertNoSensitive("auth provider audit logs", JSON.stringify(auditLogs));
assertNotContains(
  JSON.stringify(auditLogs),
  managedSecret.body.data.secretRef,
  "auth provider audit logs",
);

const checkCodes = Object.fromEntries(
  Object.entries(tests).map(([providerId, result]) => [
    providerId,
    result.body.data.checks.map((check) => check.code).sort(),
  ]),
);
const evidence = {
  schemaVersion: "romeo.auth-provider-acceptance-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "auth_provider_catalog_covers_enterprise_provider_ids",
    "per_provider_oidc_oauth2_ldap_saml_settings_persist",
    "local_managed_secret_ingestion_uses_encrypted_reference",
    "provider_settings_return_sanitized_connection_summaries",
    "provider_connection_tests_return_metadata_only",
    "oidc_connection_test_uses_stubbed_discovery_and_jwks",
    "github_connection_test_uses_stubbed_api_meta",
    "ldap_connection_test_resolves_secret_inside_runtime_boundary",
    "saml_connection_test_checks_config_and_secret_posture",
    "auth_provider_audit_logs_exclude_raw_identity_config",
  ],
  endpoints: {
    catalog: "/api/v1/admin/auth-providers/catalog",
    settings: "/api/v1/admin/auth-providers/settings",
    settingsTest: "/api/v1/admin/auth-providers/settings/test",
    secrets: "/api/v1/admin/secrets",
  },
  catalog: {
    providerCount: catalog.body.data.length,
    providerIds: catalog.body.data.map((provider) => provider.id).sort(),
    providerIdsSha256: sha256(
      catalog.body.data
        .map((provider) => provider.id)
        .sort()
        .join(","),
    ),
    implementedCount: catalog.body.data.filter(
      (provider) => provider.status === "implemented",
    ).length,
    protocolCounts: countBy(
      catalog.body.data.map((provider) => provider.protocol),
    ),
    runtimePackages: [
      ...new Set(catalog.body.data.map((provider) => provider.runtimePackage)),
    ].sort(),
  },
  settings: {
    enabledProviderIds: settings.body.data.effective.providers
      .filter((provider) => provider.enabled)
      .map((provider) => provider.providerId)
      .sort(),
    secretRefConfiguredCount: settings.body.data.effective.providers.filter(
      (provider) => provider.secretRefConfigured,
    ).length,
    connectionSummaryCount: settings.body.data.effective.providers.filter(
      (provider) =>
        provider.oidc !== undefined ||
        provider.oauth2 !== undefined ||
        provider.ldap !== undefined ||
        provider.saml !== undefined,
    ).length,
  },
  connectionTests: {
    statuses: Object.fromEntries(
      Object.entries(tests).map(([providerId, result]) => [
        providerId,
        result.body.data.status,
      ]),
    ),
    checkCodes,
    oidcFetchCount: oidcFetches.length,
    githubFetchCount: githubFetches.length,
    ldapBindCount: ldapBinds.length,
    ldapSearchCount: ldapSearches.length,
  },
  managedSecrets: {
    localSecretResponseScheme: managedSecret.body.data.secretRefScheme,
    localSecretStoredEncrypted: true,
    localSecretValueReturned: false,
  },
  redaction: {
    rawIssuerPathsReturned: false,
    rawClientIdsReturned: false,
    rawSecretRefsReturned: false,
    rawSecretValuesReturned: false,
    rawDirectoryDnsReturned: false,
    rawIdentityGroupsReturned: false,
    rawProviderResponsesReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoSensitive("auth provider acceptance evidence", serialized);
assertNotContains(
  serialized,
  managedSecret.body.data.secretRef,
  "auth provider acceptance evidence",
);

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote auth provider acceptance contract smoke to ${outputPath}`);
}

interface AuthProviderCatalogEntry {
  id: string;
  protocol: string;
  runtimePackage: string | null;
  status: string;
}

interface AuthProviderSettingsResponse {
  data: {
    effective: { providers: AuthProviderSetting[] };
    global: { providers: AuthProviderSetting[] };
    orgOverride: { providers: AuthProviderSetting[] };
  };
}

interface AuthProviderSetting {
  enabled: boolean;
  ldap?: unknown;
  oauth2?: unknown;
  oidc?: unknown;
  providerId: string;
  saml?: unknown;
  secretRefConfigured: boolean;
  secretRefScheme?: string;
}

interface ConnectionTestResponse {
  data: AuthProviderConnectionTestReport;
}

async function authProviderFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = String(input);
  if (url.startsWith("https://api.github.com/meta")) {
    githubFetches.push(url);
    return jsonResponse({ verifiable_password_authentication: false });
  }
  if (url.includes(".well-known/openid-configuration")) {
    oidcFetches.push(url);
    const issuer = issuerFromDiscoveryUrl(url);
    if (issuer === undefined) {
      return new Response("invalid discovery URL", { status: 400 });
    }
    return jsonResponse({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    });
  }
  if (url.endsWith("/jwks")) {
    oidcFetches.push(url);
    return jsonResponse({
      keys: [
        {
          e: "AQAB",
          kid: "auth-provider-acceptance-key",
          kty: "RSA",
          n: "00",
          use: "sig",
        },
      ],
    });
  }
  return new Response("not found", { status: 404 });
}

function issuerFromDiscoveryUrl(value: string): string | undefined {
  const marker = "/.well-known/openid-configuration";
  const index = value.indexOf(marker);
  if (index < 0) return undefined;
  const before = value.slice(0, index);
  const after = value.slice(index + marker.length);
  if (after.length > 0) return `${before}${after}`;
  return before;
}

async function requestJson<T>(
  path: string,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path);
  return { body: (await response.json()) as T, response };
}

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { body: (await response.json()) as T, response };
}

async function postPatchJson<T>(
  path: string,
  body: unknown,
): Promise<{ body: T; response: Response }> {
  const response = await api.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { body: (await response.json()) as T, response };
}

async function connectionTest(providerId: string): Promise<{
  body: ConnectionTestResponse;
  response: Response;
}> {
  return postJson<ConnectionTestResponse>(
    "/api/v1/admin/auth-providers/settings/test",
    { providerId },
  );
}

function assertCatalog(catalog: AuthProviderCatalogEntry[]): void {
  const actual = catalog.map((provider) => provider.id).sort();
  const expected = [...authProviderIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Auth provider catalog mismatch: ${actual.join(", ")}`);
  }
  const unimplemented = catalog.filter(
    (provider) => provider.status !== "implemented",
  );
  if (unimplemented.length > 0) {
    throw new Error(
      `Auth provider catalog has unimplemented providers: ${unimplemented
        .map((provider) => provider.id)
        .join(", ")}`,
    );
  }
  for (const provider of authProviderIds) {
    const entry = catalog.find((item) => item.id === provider);
    if (entry === undefined || entry.runtimePackage === undefined) {
      throw new Error(`Auth provider ${provider} missing runtime package.`);
    }
  }
}

function assertSettings(settings: AuthProviderSettingsResponse["data"]): void {
  const effective = settings.effective.providers;
  const expected = [
    "active-directory",
    "auth0",
    "azure-ad",
    "generic-oidc",
    "github",
    "google",
    "keycloak",
    "ldap",
    "local",
    "okta",
    "saml",
  ];
  const enabled = effective
    .filter((provider) => provider.enabled)
    .map((provider) => provider.providerId)
    .sort();
  for (const providerId of expected) {
    if (!enabled.includes(providerId)) {
      throw new Error(`Expected ${providerId} to be enabled.`);
    }
  }
  for (const provider of oidcProviderConfigs) {
    assertProviderSummary(
      effective,
      provider.providerId,
      "oidc",
      "romeo-secret",
    );
  }
  assertProviderSummary(effective, "github", "oauth2", "env");
  assertProviderSummary(effective, "active-directory", "ldap", "env");
  assertProviderSummary(effective, "ldap", "ldap", "env");
  assertProviderSummary(effective, "saml", "saml", "env");
}

function assertProviderSummary(
  providers: AuthProviderSetting[],
  providerId: string,
  connectionKey: "ldap" | "oauth2" | "oidc" | "saml",
  secretScheme: string,
): void {
  const provider = providers.find((item) => item.providerId === providerId);
  if (provider === undefined) throw new Error(`${providerId} summary missing.`);
  if (provider[connectionKey] === undefined) {
    throw new Error(`${providerId} ${connectionKey} summary missing.`);
  }
  if (
    provider.secretRefConfigured !== true ||
    provider.secretRefScheme !== secretScheme
  ) {
    throw new Error(`${providerId} secret posture mismatch.`);
  }
}

function assertConnectionTest(
  report: AuthProviderConnectionTestReport,
  providerId: string,
  status: AuthProviderConnectionTestReport["status"],
): void {
  if (report.providerId !== providerId || report.status !== status) {
    throw new Error(
      `${providerId} connection test returned ${report.status}; expected ${status}.`,
    );
  }
  if (report.checks.length === 0) {
    throw new Error(`${providerId} connection test returned no checks.`);
  }
  if (report.checks.some((check) => check.status === "fail")) {
    throw new Error(`${providerId} connection test returned a failed check.`);
  }
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`,
    );
  }
}

function assertNoSensitive(label: string, value: string): void {
  for (const raw of Object.values(rawSentinels)) {
    assertNotContains(value, raw, label);
  }
}

function assertNotContains(value: string, raw: string, label: string): void {
  if (value.includes(raw)) throw new Error(`${label} leaked raw content.`);
}

function countBy(values: Array<string | null>): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function envVarName(secretRef: string): string {
  return secretRef.replace(/^env:\/\//u, "");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
