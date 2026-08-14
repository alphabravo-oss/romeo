import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@romeo/ui";
import { useState } from "react";

import {
  authProviderCatalogQueryOptions,
  authProviderSettingsQueryOptions,
  deprovisionSsoOidcUserMutationOptions,
  testAuthProviderConnectionMutationOptions,
  updateAuthProviderSettingsMutationOptions,
} from "../features/auth-provider-administration";
import type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderGlobalPatch,
  AuthProviderId,
  AuthProviderOrgOverridePatch,
  EffectiveAuthProviderSetting,
  UpdateAuthProviderSettingsRequest,
} from "../features/auth-provider-administration";
import { PanelState } from "../lib/panel-state";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { bootstrapQueryOptions } from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";
import { Section } from "./console";
import { AuthDirectorySyncDialog } from "./AuthDirectorySyncDialog";
import { ConfigureDialog } from "./AuthProviderConfigureDialog";
import { DeprovisionDialog } from "./AuthProviderDeprovisionDialog";
import { AuthProviderSplitView } from "./AuthProviderSplitView";
import { useConfirm } from "./ConfirmDialog";

type Scope = "global" | "org";

export function AuthProvidersPanel(): React.ReactNode {
  const apiClient = useRouterApiClient();
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const [scope, setScope] = useState<Scope>("global");
  const [configuring, setConfiguring] =
    useState<AuthProviderCatalogEntry | null>(null);
  const [deprovisioning, setDeprovisioning] =
    useState<AuthProviderCatalogEntry | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, AuthProviderConnectionTestReport>
  >({});
  const [syncOpen, setSyncOpen] = useState(false);
  const catalogQuery = useQuery(authProviderCatalogQueryOptions());
  const settingsQuery = useQuery(authProviderSettingsQueryOptions());
  // Deploy-time tenancy (from /me). Single-tenant hides the org-scope switcher.
  const bootstrapQuery = useQuery(bootstrapQueryOptions(apiClient));
  const isMultiTenant =
    bootstrapQuery.data?.deployment?.tenancyMode === "multi";

  const updateMutation = useMutation(
    updateAuthProviderSettingsMutationOptions(),
  );
  const testMutation = useMutation(testAuthProviderConnectionMutationOptions());
  const deprovisionMutation = useMutation(
    deprovisionSsoOidcUserMutationOptions(),
  );

  /** Wrap a providers[] patch array in the right scope envelope. */
  function envelope(
    providers: Array<AuthProviderGlobalPatch | AuthProviderOrgOverridePatch>,
    extra?: Pick<
      UpdateAuthProviderSettingsRequest,
      "confirmDisableLocalFallback"
    >,
  ): UpdateAuthProviderSettingsRequest {
    if (isMultiTenant && scope === "org") {
      return {
        ...extra,
        orgOverride: { providers: providers as AuthProviderOrgOverridePatch[] },
      };
    }
    return {
      ...extra,
      global: { providers: providers as AuthProviderGlobalPatch[] },
    };
  }

  async function persist(
    providers: Array<AuthProviderGlobalPatch | AuthProviderOrgOverridePatch>,
    extra?: Pick<
      UpdateAuthProviderSettingsRequest,
      "confirmDisableLocalFallback"
    >,
  ): Promise<boolean> {
    try {
      await updateMutation.mutateAsync(envelope(providers, extra));
      toast(t("authProvidersUpdated"), "success");
      return true;
    } catch {
      toast(t("authCouldNotUpdateProviders"), "error");
      return false;
    }
  }

  async function handleToggle(
    entry: AuthProviderCatalogEntry,
    next: boolean,
  ): Promise<void> {
    // Disabling the local provider removes the password/MFA fallback — guard it.
    if (entry.id === "local" && !next) {
      const confirmed = await ask({
        title: t("authDisableLocalFallbackTitle"),
        body: t("authDisableLocalFallbackBody"),
        confirmLabel: t("authDisableLocalLogin"),
        tone: "danger",
      });
      if (!confirmed) return;
      await persist([{ providerId: entry.id, enabled: next }], {
        confirmDisableLocalFallback: true,
      });
      return;
    }
    await persist([{ providerId: entry.id, enabled: next }]);
  }

  async function handleTest(entry: AuthProviderCatalogEntry): Promise<void> {
    try {
      const report = await testMutation.mutateAsync({ providerId: entry.id });
      setTestResults((prev) => ({ ...prev, [entry.id]: report }));
    } catch {
      toast(t("authConnectionTestFailed"), "error");
    }
  }

  function openDirectorySync(): void {
    setSyncOpen(true);
  }

  // Deprovisioning disables the mapped user for an OIDC subject — destructive.
  async function handleDeprovision(
    entry: AuthProviderCatalogEntry,
    oidcSubject: string,
  ): Promise<void> {
    const subject = oidcSubject.trim();
    if (subject.length === 0) return;
    const confirmed = await ask({
      title: `${t("authDeprovisionOidcUserFrom")} ${entry.name}?`,
      body: `${t("authUserMappedToSubject")} "${subject}" ${t("authWillBeDisabledCannotUndo")}`,
      confirmLabel: t("authDeprovision"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      const result = await deprovisionMutation.mutateAsync({
        oidcSubject: subject,
        confirmOidcSubject: subject,
      });
      setDeprovisioning(null);
      toast(
        result.status === "already_disabled"
          ? t("authOidcUserAlreadyDisabled")
          : t("authOidcUserDeprovisioned"),
        "success",
      );
    } catch {
      toast(t("authCouldNotDeprovisionOidcUser"), "error");
    }
  }

  return (
    <Section
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={openDirectorySync} type="button">
            {t("authSyncDirectory")}
          </Button>
          {isMultiTenant ? (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t("authConfigurationScope")}
            >
              <Button
                aria-pressed={scope === "global"}
                className={scope === "global" ? "selected" : undefined}
                onClick={() => setScope("global")}
                type="button"
              >
                {t("authGlobal")}
              </Button>
              <Button
                aria-pressed={scope === "org"}
                className={scope === "org" ? "selected" : undefined}
                onClick={() => setScope("org")}
                type="button"
              >
                {t("authThisOrganization")}
              </Button>
            </div>
          ) : null}
        </div>
      }
      title={t("authProviders")}
    >
      <PanelState query={catalogQuery} empty={t("authNoProvidersInCatalog")}>
        {(catalog) => (
          <PanelState query={settingsQuery} empty={t("authNoProviderSettings")}>
            {(settings) => {
              const effectiveById = new Map<
                AuthProviderId,
                EffectiveAuthProviderSetting
              >(settings.effective.providers.map((p) => [p.providerId, p]));

              return (
                <AuthProviderSplitView
                  busy={updateMutation.isPending}
                  catalog={catalog}
                  deprovisioning={deprovisionMutation.isPending}
                  effectiveById={effectiveById}
                  onConfigure={setConfiguring}
                  onDeprovision={setDeprovisioning}
                  onTest={(entry) => void handleTest(entry)}
                  onToggle={(entry, enabled) =>
                    void handleToggle(entry, enabled)
                  }
                  testing={testMutation.isPending}
                  testResults={testResults}
                />
              );
            }}
          </PanelState>
        )}
      </PanelState>

      {configuring ? (
        <ConfigureDialog
          entry={configuring}
          scope={scope}
          setting={
            settingsQuery.data?.effective.providers.find(
              (p) => p.providerId === configuring.id,
            ) ?? null
          }
          saving={updateMutation.isPending}
          onClose={() => setConfiguring(null)}
          onSave={async (providers) => {
            const ok = await persist(providers);
            if (ok) setConfiguring(null);
          }}
        />
      ) : null}

      {deprovisioning ? (
        <DeprovisionDialog
          entry={deprovisioning}
          busy={deprovisionMutation.isPending}
          onClose={() => setDeprovisioning(null)}
          onSubmit={(oidcSubject) =>
            void handleDeprovision(deprovisioning, oidcSubject)
          }
        />
      ) : null}

      {syncOpen ? (
        <AuthDirectorySyncDialog onClose={() => setSyncOpen(false)} />
      ) : null}

      {dialog}
    </Section>
  );
}

/**
 * Collects the OIDC subject to deprovision. Submitting hands the subject up to
 * the panel, which raises a destructive confirm (useConfirm) before calling the
 * deprovision endpoint. confirmOidcSubject is set to the same subject there.
 */
