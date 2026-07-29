import { Input, Textarea } from "@romeo/ui";

import type { EffectiveAuthProviderSetting } from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import type { AuthProviderProtocolDraft } from "./AuthProviderProtocolFields";

export function AuthProviderLdapFields(props: {
  draft: AuthProviderProtocolDraft;
  group: "connection" | "mapping";
  onChange: <K extends keyof AuthProviderProtocolDraft>(
    key: K,
    value: AuthProviderProtocolDraft[K],
  ) => void;
  setting: EffectiveAuthProviderSetting | null;
}): React.ReactNode {
  const { t } = useLocale();
  const { draft, onChange, setting } = props;

  return props.group === "connection" ? (
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
        onChange={(event) => onChange("ldapBindDn", event.currentTarget.value)}
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
        onChange={(event) => onChange("ldapBaseDn", event.currentTarget.value)}
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
