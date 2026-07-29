import { Button, Input, Textarea } from "@romeo/ui";
import React, { useState } from "react";

import { createManagedSecret } from "../features/auth-provider-administration";
import type {
  AuthProviderCatalogEntry,
  AuthProviderGlobalPatch,
  AuthProviderOrgOverridePatch,
  EffectiveAuthProviderSetting,
} from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { linesToArray } from "./auth-provider-lines";
import { AuthProviderProtocolFields } from "./AuthProviderProtocolFields";
import { FormDialog } from "./FormDialog";
import { SettingsSection } from "./SettingsSection";

export function ConfigureDialog(props: {
  entry: AuthProviderCatalogEntry;
  scope: "global" | "org";
  setting: EffectiveAuthProviderSetting | null;
  saving: boolean;
  onClose: () => void;
  onSave: (
    providers: Array<AuthProviderGlobalPatch | AuthProviderOrgOverridePatch>,
  ) => void;
}): React.ReactNode {
  const { t } = useLocale();
  const { entry, setting, saving, onClose, onSave } = props;
  const showOidc = entry.protocol === "oidc";
  const showOAuth2 = entry.protocol === "oauth2";
  const showSaml = entry.protocol === "saml";
  const showLdap = entry.protocol === "ldap";
  const isLocal = entry.id === "local";

  const [displayName, setDisplayName] = useState(
    setting?.displayName ?? entry.name,
  );
  const [loginOrder, setLoginOrder] = useState(
    String(setting?.loginOrder ?? 0),
  );
  const [domains, setDomains] = useState(
    (setting?.allowedEmailDomains ?? []).join("\n"),
  );
  const [secretRef, setSecretRef] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [issuerUrl, setIssuerUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [groupClaim, setGroupClaim] = useState(setting?.oidc?.groupClaim ?? "");
  const [adminGroups, setAdminGroups] = useState("");
  const [workspaceGroupPrefix, setWorkspaceGroupPrefix] = useState("");
  const [oauth2AdminTeams, setOauth2AdminTeams] = useState("");
  const [oauth2RequiredOrganizations, setOauth2RequiredOrganizations] =
    useState("");
  const [oauth2RequiredTeams, setOauth2RequiredTeams] = useState("");
  const [oauth2Scopes, setOauth2Scopes] = useState("");
  const [oauth2WorkspaceTeamPrefix, setOauth2WorkspaceTeamPrefix] =
    useState("");
  // SAML — attributes prefill from the summary; endpoints stay blank ("leave blank to keep").
  const [samlEntryPoint, setSamlEntryPoint] = useState("");
  const [samlIdpIssuer, setSamlIdpIssuer] = useState("");
  const [samlSpEntityId, setSamlSpEntityId] = useState("");
  const [samlEmailAttribute, setSamlEmailAttribute] = useState(
    setting?.saml?.emailAttribute ?? "",
  );
  const [samlNameAttribute, setSamlNameAttribute] = useState(
    setting?.saml?.nameAttribute ?? "",
  );
  const [samlGroupsAttribute, setSamlGroupsAttribute] = useState(
    setting?.saml?.groupsAttribute ?? "",
  );
  const [samlAdminGroups, setSamlAdminGroups] = useState("");
  const [samlSignedResponse, setSamlSignedResponse] = useState(
    setting?.saml?.signedResponseRequired ?? false,
  );
  // LDAP — the summary only exposes booleans/counts, so endpoints/DNs use "leave blank to keep".
  const [ldapUrl, setLdapUrl] = useState("");
  const [ldapBindDn, setLdapBindDn] = useState("");
  const [ldapBaseDn, setLdapBaseDn] = useState("");
  const [ldapUserSearchFilter, setLdapUserSearchFilter] = useState("");
  const [ldapUserIdAttribute, setLdapUserIdAttribute] = useState("");
  const [ldapEmailAttribute, setLdapEmailAttribute] = useState("");
  const [ldapNameAttribute, setLdapNameAttribute] = useState("");
  const [ldapGroupSearchBaseDn, setLdapGroupSearchBaseDn] = useState("");
  const [ldapGroupSearchFilter, setLdapGroupSearchFilter] = useState("");
  const [ldapAdminGroups, setLdapAdminGroups] = useState("");
  const [ldapStartTls, setLdapStartTls] = useState(
    setting?.ldap?.startTls ?? false,
  );

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    // Build a patch with only changed/filled fields so we never clear values.
    const patch: AuthProviderGlobalPatch = { providerId: entry.id };
    if (displayName.trim().length > 0) patch.displayName = displayName.trim();
    const order = Number(loginOrder);
    if (Number.isFinite(order)) patch.loginOrder = order;
    patch.allowedEmailDomains = linesToArray(domains);

    // Secret: a pasted client secret is stored via the managed-secret vault and
    // we save the returned ref; otherwise use a ref the admin entered directly.
    if (clientSecret.trim().length > 0) {
      try {
        const managed = await createManagedSecret({
          purpose: "auth_provider_client_secret",
          value: clientSecret.trim(),
          scope: props.scope === "org" ? "org" : "global",
        });
        patch.secretRef = managed.secretRef;
      } catch {
        toast(t("authCouldNotStoreClientSecret"), "error");
        return;
      }
    } else if (secretRef.trim().length > 0) {
      patch.secretRef = secretRef.trim();
    }

    if (showOidc) {
      const oidc: NonNullable<AuthProviderGlobalPatch["oidc"]> = {};
      if (issuerUrl.trim().length > 0) oidc.issuerUrl = issuerUrl.trim();
      if (clientId.trim().length > 0) oidc.clientId = clientId.trim();
      if (groupClaim.trim().length > 0) oidc.groupClaim = groupClaim.trim();
      const admins = linesToArray(adminGroups);
      if (admins.length > 0) oidc.adminGroups = admins;
      if (workspaceGroupPrefix.trim().length > 0)
        oidc.workspaceGroupPrefix = workspaceGroupPrefix.trim();
      if (Object.keys(oidc).length > 0) patch.oidc = oidc;
    }

    if (showOAuth2) {
      const oauth2: NonNullable<AuthProviderGlobalPatch["oauth2"]> = {};
      if (clientId.trim().length > 0) oauth2.clientId = clientId.trim();
      const adminTeams = linesToArray(oauth2AdminTeams);
      if (adminTeams.length > 0) oauth2.adminTeams = adminTeams;
      const requiredOrganizations = linesToArray(oauth2RequiredOrganizations);
      if (requiredOrganizations.length > 0)
        oauth2.requiredOrganizations = requiredOrganizations;
      const requiredTeams = linesToArray(oauth2RequiredTeams);
      if (requiredTeams.length > 0) oauth2.requiredTeams = requiredTeams;
      const scopes = linesToArray(oauth2Scopes);
      if (scopes.length > 0) oauth2.scopes = scopes;
      if (oauth2WorkspaceTeamPrefix.trim().length > 0)
        oauth2.workspaceTeamPrefix = oauth2WorkspaceTeamPrefix.trim();
      if (Object.keys(oauth2).length > 0) patch.oauth2 = oauth2;
    }

    if (showSaml) {
      const saml: NonNullable<AuthProviderGlobalPatch["saml"]> = {};
      if (samlEntryPoint.trim().length > 0)
        saml.entryPoint = samlEntryPoint.trim();
      if (samlIdpIssuer.trim().length > 0)
        saml.idpIssuer = samlIdpIssuer.trim();
      if (samlSpEntityId.trim().length > 0)
        saml.spEntityId = samlSpEntityId.trim();
      if (samlEmailAttribute.trim().length > 0)
        saml.emailAttribute = samlEmailAttribute.trim();
      if (samlNameAttribute.trim().length > 0)
        saml.nameAttribute = samlNameAttribute.trim();
      if (samlGroupsAttribute.trim().length > 0)
        saml.groupsAttribute = samlGroupsAttribute.trim();
      const samlAdmins = linesToArray(samlAdminGroups);
      if (samlAdmins.length > 0) saml.adminGroups = samlAdmins;
      saml.wantAuthnResponseSigned = samlSignedResponse;
      if (Object.keys(saml).length > 0) patch.saml = saml;
    }

    if (showLdap) {
      const ldap: NonNullable<AuthProviderGlobalPatch["ldap"]> = {};
      if (ldapUrl.trim().length > 0) ldap.url = ldapUrl.trim();
      if (ldapBindDn.trim().length > 0) ldap.bindDn = ldapBindDn.trim();
      if (ldapBaseDn.trim().length > 0) ldap.baseDn = ldapBaseDn.trim();
      if (ldapUserSearchFilter.trim().length > 0)
        ldap.userSearchFilter = ldapUserSearchFilter.trim();
      if (ldapUserIdAttribute.trim().length > 0)
        ldap.userIdAttribute = ldapUserIdAttribute.trim();
      if (ldapEmailAttribute.trim().length > 0)
        ldap.emailAttribute = ldapEmailAttribute.trim();
      if (ldapNameAttribute.trim().length > 0)
        ldap.nameAttribute = ldapNameAttribute.trim();
      if (ldapGroupSearchBaseDn.trim().length > 0)
        ldap.groupSearchBaseDn = ldapGroupSearchBaseDn.trim();
      if (ldapGroupSearchFilter.trim().length > 0)
        ldap.groupSearchFilter = ldapGroupSearchFilter.trim();
      const ldapAdmins = linesToArray(ldapAdminGroups);
      if (ldapAdmins.length > 0) ldap.adminGroups = ldapAdmins;
      ldap.startTls = ldapStartTls;
      if (Object.keys(ldap).length > 0) patch.ldap = ldap;
    }

    onSave([patch]);
  }

  return (
    <FormDialog
      open
      title={`${t("authConfigure")} ${entry.name}`}
      onClose={onClose}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => void handleSubmit(event)}
      >
        {isLocal ? null : (
          <SettingsSection
            description={t("authConnectionSectionDescription")}
            title={t("authConnectionSection")}
          >
            <AuthProviderProtocolFields
              draft={{
                issuerUrl,
                clientId,
                groupClaim,
                adminGroups,
                workspaceGroupPrefix,
                oauth2AdminTeams,
                oauth2RequiredOrganizations,
                oauth2RequiredTeams,
                oauth2Scopes,
                oauth2WorkspaceTeamPrefix,
                samlEntryPoint,
                samlIdpIssuer,
                samlSpEntityId,
                samlEmailAttribute,
                samlNameAttribute,
                samlGroupsAttribute,
                samlAdminGroups,
                samlSignedResponse,
                ldapUrl,
                ldapBindDn,
                ldapBaseDn,
                ldapUserSearchFilter,
                ldapUserIdAttribute,
                ldapEmailAttribute,
                ldapNameAttribute,
                ldapGroupSearchBaseDn,
                ldapGroupSearchFilter,
                ldapAdminGroups,
                ldapStartTls,
              }}
              group="connection"
              onChange={(key, value) => {
                const setters = {
                  issuerUrl: setIssuerUrl,
                  clientId: setClientId,
                  groupClaim: setGroupClaim,
                  adminGroups: setAdminGroups,
                  workspaceGroupPrefix: setWorkspaceGroupPrefix,
                  oauth2AdminTeams: setOauth2AdminTeams,
                  oauth2RequiredOrganizations: setOauth2RequiredOrganizations,
                  oauth2RequiredTeams: setOauth2RequiredTeams,
                  oauth2Scopes: setOauth2Scopes,
                  oauth2WorkspaceTeamPrefix: setOauth2WorkspaceTeamPrefix,
                  samlEntryPoint: setSamlEntryPoint,
                  samlIdpIssuer: setSamlIdpIssuer,
                  samlSpEntityId: setSamlSpEntityId,
                  samlEmailAttribute: setSamlEmailAttribute,
                  samlNameAttribute: setSamlNameAttribute,
                  samlGroupsAttribute: setSamlGroupsAttribute,
                  samlAdminGroups: setSamlAdminGroups,
                  samlSignedResponse: setSamlSignedResponse,
                  ldapUrl: setLdapUrl,
                  ldapBindDn: setLdapBindDn,
                  ldapBaseDn: setLdapBaseDn,
                  ldapUserSearchFilter: setLdapUserSearchFilter,
                  ldapUserIdAttribute: setLdapUserIdAttribute,
                  ldapEmailAttribute: setLdapEmailAttribute,
                  ldapNameAttribute: setLdapNameAttribute,
                  ldapGroupSearchBaseDn: setLdapGroupSearchBaseDn,
                  ldapGroupSearchFilter: setLdapGroupSearchFilter,
                  ldapAdminGroups: setLdapAdminGroups,
                  ldapStartTls: setLdapStartTls,
                };
                setters[key](value as never);
              }}
              protocol={entry.protocol}
              setting={setting}
            />
            <label className="text-sm text-muted" htmlFor="ap-client-secret">
              {t("authClientSecret")}
            </label>
            <Input
              name="ap-client-secret"
              autoComplete="off"
              id="ap-client-secret"
              onChange={(event) => setClientSecret(event.currentTarget.value)}
              placeholder={t("authPasteClientSecret")}
              type="password"
              value={clientSecret}
            />
            <span className="text-xs text-muted">
              {t("authSecretStoredGuidance")}
            </span>

            <details className="rm-settings-advanced">
              <summary>{t("authAdvancedSecretReference")}</summary>
              <label className="text-sm text-muted" htmlFor="ap-secret-ref">
                {t("authAdvancedSecretReference")}
              </label>
              <Input
                name="ap-secret-ref"
                id="ap-secret-ref"
                onChange={(event) => setSecretRef(event.currentTarget.value)}
                placeholder="romeo-secret://… or vault://…"
                value={secretRef}
              />
              <span className="text-xs text-muted">
                {t("authExistingSecretReferenceGuidance")}
              </span>
            </details>
          </SettingsSection>
        )}

        <SettingsSection
          description={t("authMappingSectionDescription")}
          title={t("authMappingSection")}
        >
          <label className="text-sm text-muted" htmlFor="ap-domains">
            {t("authAllowedEmailDomains")}
          </label>
          <Textarea
            name="ap-domains"
            className="rm-textarea"
            id="ap-domains"
            onChange={(event) => setDomains(event.currentTarget.value)}
            placeholder={"example.com\nsub.example.com"}
            rows={3}
            value={domains}
          />

          <AuthProviderProtocolFields
            draft={{
              issuerUrl,
              clientId,
              groupClaim,
              adminGroups,
              workspaceGroupPrefix,
              oauth2AdminTeams,
              oauth2RequiredOrganizations,
              oauth2RequiredTeams,
              oauth2Scopes,
              oauth2WorkspaceTeamPrefix,
              samlEntryPoint,
              samlIdpIssuer,
              samlSpEntityId,
              samlEmailAttribute,
              samlNameAttribute,
              samlGroupsAttribute,
              samlAdminGroups,
              samlSignedResponse,
              ldapUrl,
              ldapBindDn,
              ldapBaseDn,
              ldapUserSearchFilter,
              ldapUserIdAttribute,
              ldapEmailAttribute,
              ldapNameAttribute,
              ldapGroupSearchBaseDn,
              ldapGroupSearchFilter,
              ldapAdminGroups,
              ldapStartTls,
            }}
            group="mapping"
            onChange={(key, value) => {
              const setters = {
                issuerUrl: setIssuerUrl,
                clientId: setClientId,
                groupClaim: setGroupClaim,
                adminGroups: setAdminGroups,
                workspaceGroupPrefix: setWorkspaceGroupPrefix,
                oauth2AdminTeams: setOauth2AdminTeams,
                oauth2RequiredOrganizations: setOauth2RequiredOrganizations,
                oauth2RequiredTeams: setOauth2RequiredTeams,
                oauth2Scopes: setOauth2Scopes,
                oauth2WorkspaceTeamPrefix: setOauth2WorkspaceTeamPrefix,
                samlEntryPoint: setSamlEntryPoint,
                samlIdpIssuer: setSamlIdpIssuer,
                samlSpEntityId: setSamlSpEntityId,
                samlEmailAttribute: setSamlEmailAttribute,
                samlNameAttribute: setSamlNameAttribute,
                samlGroupsAttribute: setSamlGroupsAttribute,
                samlAdminGroups: setSamlAdminGroups,
                samlSignedResponse: setSamlSignedResponse,
                ldapUrl: setLdapUrl,
                ldapBindDn: setLdapBindDn,
                ldapBaseDn: setLdapBaseDn,
                ldapUserSearchFilter: setLdapUserSearchFilter,
                ldapUserIdAttribute: setLdapUserIdAttribute,
                ldapEmailAttribute: setLdapEmailAttribute,
                ldapNameAttribute: setLdapNameAttribute,
                ldapGroupSearchBaseDn: setLdapGroupSearchBaseDn,
                ldapGroupSearchFilter: setLdapGroupSearchFilter,
                ldapAdminGroups: setLdapAdminGroups,
                ldapStartTls: setLdapStartTls,
              };
              setters[key](value as never);
            }}
            protocol={entry.protocol}
            setting={setting}
          />
        </SettingsSection>

        <SettingsSection
          description={t("authPresentationSectionDescription")}
          title={t("authPresentationSection")}
        >
          <label className="text-sm text-muted" htmlFor="ap-display-name">
            {t("authDisplayName")}
          </label>
          <Input
            name="ap-display-name"
            id="ap-display-name"
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            placeholder={entry.name}
            value={displayName}
          />

          <label className="text-sm text-muted" htmlFor="ap-login-order">
            {t("authLoginOrder")}
          </label>
          <Input
            name="ap-login-order"
            id="ap-login-order"
            onChange={(event) => setLoginOrder(event.currentTarget.value)}
            type="number"
            value={loginOrder}
          />
        </SettingsSection>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button">
            {t("authCancel")}
          </Button>
          <Button variant="primary" disabled={saving} type="submit">
            {saving ? t("authSaving") : t("authSave")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
