import { Input, Textarea } from "@romeo/ui";

import type { EffectiveAuthProviderSetting } from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";

export interface AuthProviderProtocolDraft {
  issuerUrl: string;
  clientId: string;
  groupClaim: string;
  adminGroups: string;
  workspaceGroupPrefix: string;
  oauth2AdminTeams: string;
  oauth2RequiredOrganizations: string;
  oauth2RequiredTeams: string;
  oauth2Scopes: string;
  oauth2WorkspaceTeamPrefix: string;
  samlEntryPoint: string;
  samlIdpIssuer: string;
  samlSpEntityId: string;
  samlEmailAttribute: string;
  samlNameAttribute: string;
  samlGroupsAttribute: string;
  samlAdminGroups: string;
  samlSignedResponse: boolean;
  ldapUrl: string;
  ldapBindDn: string;
  ldapBaseDn: string;
  ldapUserSearchFilter: string;
  ldapUserIdAttribute: string;
  ldapEmailAttribute: string;
  ldapNameAttribute: string;
  ldapGroupSearchBaseDn: string;
  ldapGroupSearchFilter: string;
  ldapAdminGroups: string;
  ldapStartTls: boolean;
}

export function AuthProviderProtocolFields(props: {
  draft: AuthProviderProtocolDraft;
  group: "connection" | "mapping";
  onChange: <K extends keyof AuthProviderProtocolDraft>(
    key: K,
    value: AuthProviderProtocolDraft[K],
  ) => void;
  protocol: string;
  setting: EffectiveAuthProviderSetting | null;
}): React.ReactNode {
  const { t } = useLocale();
  const { draft, group, onChange, setting } = props;

  if (props.protocol === "oidc") {
    return group === "connection" ? (
      <>
        <label className="text-sm text-muted" htmlFor="ap-issuer">
          {t("authIssuerUrl")}
        </label>
        <Input
          id="ap-issuer"
          name="ap-issuer"
          onChange={(event) => onChange("issuerUrl", event.currentTarget.value)}
          placeholder={
            setting?.oidc?.issuerConfigured
              ? t("authConfiguredLeaveBlank")
              : "https://issuer.example.com"
          }
          value={draft.issuerUrl}
        />

        <label className="text-sm text-muted" htmlFor="ap-client-id">
          {t("authClientId")}
        </label>
        <Input
          id="ap-client-id"
          name="ap-client-id"
          onChange={(event) => onChange("clientId", event.currentTarget.value)}
          placeholder={
            setting?.oidc?.clientIdConfigured
              ? t("authConfiguredLeaveBlank")
              : "client-id"
          }
          value={draft.clientId}
        />
      </>
    ) : (
      <>
        <label className="text-sm text-muted" htmlFor="ap-group-claim">
          {t("authGroupClaim")}
        </label>
        <Input
          id="ap-group-claim"
          name="ap-group-claim"
          onChange={(event) =>
            onChange("groupClaim", event.currentTarget.value)
          }
          placeholder="groups"
          value={draft.groupClaim}
        />

        <label className="text-sm text-muted" htmlFor="ap-admin-groups">
          {t("authAdminGroups")}
        </label>
        <Textarea
          id="ap-admin-groups"
          name="ap-admin-groups"
          onChange={(event) =>
            onChange("adminGroups", event.currentTarget.value)
          }
          placeholder="platform-admins"
          rows={2}
          value={draft.adminGroups}
        />

        <label className="text-sm text-muted" htmlFor="ap-ws-prefix">
          {t("authWorkspaceGroupPrefix")}
        </label>
        <Input
          id="ap-ws-prefix"
          name="ap-ws-prefix"
          onChange={(event) =>
            onChange("workspaceGroupPrefix", event.currentTarget.value)
          }
          placeholder="workspace-"
          value={draft.workspaceGroupPrefix}
        />
      </>
    );
  }

  if (props.protocol === "oauth2") {
    return group === "connection" ? (
      <>
        <label className="text-sm text-muted" htmlFor="ap-oauth2-client-id">
          {t("authClientId")}
        </label>
        <Input
          id="ap-oauth2-client-id"
          name="ap-oauth2-client-id"
          onChange={(event) => onChange("clientId", event.currentTarget.value)}
          placeholder={
            setting?.oauth2?.clientIdConfigured
              ? t("authConfiguredLeaveBlank")
              : "client-id"
          }
          value={draft.clientId}
        />

        <label className="text-sm text-muted" htmlFor="ap-oauth2-scopes">
          {t("authOAuthScopes")}
        </label>
        <Textarea
          id="ap-oauth2-scopes"
          name="ap-oauth2-scopes"
          onChange={(event) =>
            onChange("oauth2Scopes", event.currentTarget.value)
          }
          rows={2}
          value={draft.oauth2Scopes}
        />
      </>
    ) : (
      <>
        <label className="text-sm text-muted" htmlFor="ap-oauth2-admin-teams">
          {t("authAdminTeams")}
        </label>
        <Textarea
          id="ap-oauth2-admin-teams"
          name="ap-oauth2-admin-teams"
          onChange={(event) =>
            onChange("oauth2AdminTeams", event.currentTarget.value)
          }
          rows={2}
          value={draft.oauth2AdminTeams}
        />

        <label className="text-sm text-muted" htmlFor="ap-oauth2-orgs">
          {t("authRequiredOrganizations")}
        </label>
        <Textarea
          id="ap-oauth2-orgs"
          name="ap-oauth2-orgs"
          onChange={(event) =>
            onChange("oauth2RequiredOrganizations", event.currentTarget.value)
          }
          rows={2}
          value={draft.oauth2RequiredOrganizations}
        />

        <label className="text-sm text-muted" htmlFor="ap-oauth2-teams">
          {t("authRequiredTeams")}
        </label>
        <Textarea
          id="ap-oauth2-teams"
          name="ap-oauth2-teams"
          onChange={(event) =>
            onChange("oauth2RequiredTeams", event.currentTarget.value)
          }
          rows={2}
          value={draft.oauth2RequiredTeams}
        />

        <label className="text-sm text-muted" htmlFor="ap-oauth2-prefix">
          {t("authWorkspaceTeamPrefix")}
        </label>
        <Input
          id="ap-oauth2-prefix"
          name="ap-oauth2-prefix"
          onChange={(event) =>
            onChange("oauth2WorkspaceTeamPrefix", event.currentTarget.value)
          }
          value={draft.oauth2WorkspaceTeamPrefix}
        />
      </>
    );
  }

  if (props.protocol === "saml") {
    return group === "connection" ? (
      <>
        <label className="text-sm text-muted" htmlFor="ap-saml-entrypoint">
          {t("authIdpSsoUrl")}
        </label>
        <Input
          id="ap-saml-entrypoint"
          name="ap-saml-entrypoint"
          onChange={(event) =>
            onChange("samlEntryPoint", event.currentTarget.value)
          }
          placeholder={
            setting?.saml?.entryPointConfigured
              ? t("authConfiguredLeaveBlank")
              : "https://idp.example.com/sso"
          }
          value={draft.samlEntryPoint}
        />

        <label className="text-sm text-muted" htmlFor="ap-saml-issuer">
          {t("authIdpIssuerEntityId")}
        </label>
        <Input
          id="ap-saml-issuer"
          name="ap-saml-issuer"
          onChange={(event) =>
            onChange("samlIdpIssuer", event.currentTarget.value)
          }
          placeholder={
            setting?.saml?.idpIssuerConfigured
              ? t("authConfiguredLeaveBlank")
              : "https://idp.example.com/metadata"
          }
          value={draft.samlIdpIssuer}
        />

        <label className="text-sm text-muted" htmlFor="ap-saml-sp">
          {t("authServiceProviderEntityId")}
        </label>
        <Input
          id="ap-saml-sp"
          name="ap-saml-sp"
          onChange={(event) =>
            onChange("samlSpEntityId", event.currentTarget.value)
          }
          placeholder={
            setting?.saml?.spEntityIdConfigured
              ? t("authConfiguredLeaveBlank")
              : "romeo"
          }
          value={draft.samlSpEntityId}
        />

        <label className="inline-flex items-center gap-2 text-sm">
          <Input
            checked={draft.samlSignedResponse}
            name="ap-saml-signed-response"
            onChange={(event) =>
              onChange("samlSignedResponse", event.currentTarget.checked)
            }
            type="checkbox"
          />
          {t("authRequireSignedSamlResponse")}
        </label>
        <span className="text-xs text-muted">
          {t("authIdpCertificateGuidance")}
        </span>
      </>
    ) : (
      <>
        <label className="text-sm text-muted" htmlFor="ap-saml-email">
          {t("authEmailAttribute")}
        </label>
        <Input
          id="ap-saml-email"
          name="ap-saml-email"
          onChange={(event) =>
            onChange("samlEmailAttribute", event.currentTarget.value)
          }
          placeholder="email"
          value={draft.samlEmailAttribute}
        />

        <label className="text-sm text-muted" htmlFor="ap-saml-name">
          {t("authNameAttribute")}
        </label>
        <Input
          id="ap-saml-name"
          name="ap-saml-name"
          onChange={(event) =>
            onChange("samlNameAttribute", event.currentTarget.value)
          }
          placeholder="displayName"
          value={draft.samlNameAttribute}
        />

        <label className="text-sm text-muted" htmlFor="ap-saml-groups">
          {t("authGroupsAttribute")}
        </label>
        <Input
          id="ap-saml-groups"
          name="ap-saml-groups"
          onChange={(event) =>
            onChange("samlGroupsAttribute", event.currentTarget.value)
          }
          placeholder="groups"
          value={draft.samlGroupsAttribute}
        />

        <label className="text-sm text-muted" htmlFor="ap-saml-admins">
          {t("authAdminGroups")}
        </label>
        <Textarea
          className="rm-textarea"
          id="ap-saml-admins"
          name="ap-saml-admins"
          onChange={(event) =>
            onChange("samlAdminGroups", event.currentTarget.value)
          }
          rows={2}
          value={draft.samlAdminGroups}
        />
      </>
    );
  }

  if (props.protocol === "ldap") {
    return group === "connection" ? (
      <>
        <label className="text-sm text-muted" htmlFor="ap-ldap-url">
          {t("authServerUrl")}
        </label>
        <Input
          id="ap-ldap-url"
          name="ap-ldap-url"
          onChange={(event) => onChange("ldapUrl", event.currentTarget.value)}
          placeholder={
            setting?.ldap?.urlConfigured
              ? t("authConfiguredLeaveBlank")
              : "ldaps://ldap.example.com:636"
          }
          value={draft.ldapUrl}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-binddn">
          {t("authBindDn")}
        </label>
        <Input
          id="ap-ldap-binddn"
          name="ap-ldap-binddn"
          onChange={(event) =>
            onChange("ldapBindDn", event.currentTarget.value)
          }
          placeholder={
            setting?.ldap?.bindDnConfigured
              ? t("authConfiguredLeaveBlank")
              : "cn=service,dc=example,dc=com"
          }
          value={draft.ldapBindDn}
        />
        <span className="text-xs text-muted">
          {t("authBindPasswordGuidance")}
        </span>

        <label className="text-sm text-muted" htmlFor="ap-ldap-basedn">
          {t("authBaseDn")}
        </label>
        <Input
          id="ap-ldap-basedn"
          name="ap-ldap-basedn"
          onChange={(event) =>
            onChange("ldapBaseDn", event.currentTarget.value)
          }
          placeholder={
            setting?.ldap?.baseDnConfigured
              ? t("authConfiguredLeaveBlank")
              : "ou=people,dc=example,dc=com"
          }
          value={draft.ldapBaseDn}
        />

        <label className="inline-flex items-center gap-2 text-sm">
          <Input
            checked={draft.ldapStartTls}
            name="ap-ldap-start-tls"
            onChange={(event) =>
              onChange("ldapStartTls", event.currentTarget.checked)
            }
            type="checkbox"
          />
          {t("authUseStartTls")}
        </label>
      </>
    ) : (
      <>
        <label className="text-sm text-muted" htmlFor="ap-ldap-userfilter">
          {t("authUserSearchFilter")}
        </label>
        <Input
          id="ap-ldap-userfilter"
          name="ap-ldap-userfilter"
          onChange={(event) =>
            onChange("ldapUserSearchFilter", event.currentTarget.value)
          }
          placeholder={
            setting?.ldap?.userSearchFilterConfigured
              ? t("authConfiguredLeaveBlank")
              : "(uid={{username}})"
          }
          value={draft.ldapUserSearchFilter}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-userid">
          {t("authUserIdAttribute")}
        </label>
        <Input
          id="ap-ldap-userid"
          name="ap-ldap-userid"
          onChange={(event) =>
            onChange("ldapUserIdAttribute", event.currentTarget.value)
          }
          placeholder="uid"
          value={draft.ldapUserIdAttribute}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-email">
          {t("authEmailAttribute")}
        </label>
        <Input
          id="ap-ldap-email"
          name="ap-ldap-email"
          onChange={(event) =>
            onChange("ldapEmailAttribute", event.currentTarget.value)
          }
          placeholder="mail"
          value={draft.ldapEmailAttribute}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-name">
          {t("authNameAttribute")}
        </label>
        <Input
          id="ap-ldap-name"
          name="ap-ldap-name"
          onChange={(event) =>
            onChange("ldapNameAttribute", event.currentTarget.value)
          }
          placeholder="cn"
          value={draft.ldapNameAttribute}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-groupbase">
          {t("authGroupSearchBaseDn")}
        </label>
        <Input
          id="ap-ldap-groupbase"
          name="ap-ldap-groupbase"
          onChange={(event) =>
            onChange("ldapGroupSearchBaseDn", event.currentTarget.value)
          }
          placeholder={
            setting?.ldap?.groupSearchConfigured
              ? t("authConfiguredLeaveBlank")
              : "ou=groups,dc=example,dc=com"
          }
          value={draft.ldapGroupSearchBaseDn}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-groupfilter">
          {t("authGroupSearchFilter")}
        </label>
        <Input
          id="ap-ldap-groupfilter"
          name="ap-ldap-groupfilter"
          onChange={(event) =>
            onChange("ldapGroupSearchFilter", event.currentTarget.value)
          }
          placeholder="(member={{dn}})"
          value={draft.ldapGroupSearchFilter}
        />

        <label className="text-sm text-muted" htmlFor="ap-ldap-admins">
          {t("authAdminGroups")}
        </label>
        <Textarea
          className="rm-textarea"
          id="ap-ldap-admins"
          name="ap-ldap-admins"
          onChange={(event) =>
            onChange("ldapAdminGroups", event.currentTarget.value)
          }
          rows={2}
          value={draft.ldapAdminGroups}
        />
      </>
    );
  }

  return null;
}
