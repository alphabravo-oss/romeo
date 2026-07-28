import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@romeo/ui";
import { useState } from "react";

import {
  deprovisionSsoOidcUser,
  getAuthProviderCatalog,
  getAuthProviderSettings,
  testAuthProviderConnection,
  updateAuthProviderSettings,
} from "../features/auth-provider-administration";
import { getBootstrap } from "../features/identity";
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
import { authProviderIcon } from "./AuthProviderIcons";
import { AuthDirectorySyncDialog } from "./AuthDirectorySyncDialog";
import { ConfigureDialog } from "./AuthProviderConfigureDialog";
import { DeprovisionDialog } from "./AuthProviderDeprovisionDialog";
import { useConfirm } from "./ConfirmDialog";
import {
  canDeprovisionProvider,
  canTestProvider,
} from "./auth-provider-card-actions";
import { PanelStats } from "./PanelStats";

type Scope = "global" | "org";

const SETTINGS_KEY = ["authProviderSettings"] as const;
const CATALOG_KEY = ["authProviderCatalog"] as const;

export function AuthProvidersPanel(): React.ReactNode {
  const { t } = useLocale();
  const queryClient = useQueryClient();
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
  const catalogQuery = useQuery({
    queryKey: CATALOG_KEY,
    queryFn: getAuthProviderCatalog,
  });
  const settingsQuery = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: getAuthProviderSettings,
  });
  // Deploy-time tenancy (from /me). Single-tenant hides the org-scope switcher.
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
  });
  const isMultiTenant =
    bootstrapQuery.data?.deployment?.tenancyMode === "multi";

  const updateMutation = useMutation({
    mutationFn: updateAuthProviderSettings,
  });
  const testMutation = useMutation({ mutationFn: testAuthProviderConnection });
  const deprovisionMutation = useMutation({
    mutationFn: deprovisionSsoOidcUser,
  });

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
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
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
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div
          className="rm-card-title"
          style={{ margin: 0, padding: 0, border: "none" }}
        >
          {t("authProviders")}
        </div>
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
      </div>

      <PanelState query={catalogQuery} empty={t("authNoProvidersInCatalog")}>
        {(catalog) => (
          <PanelState query={settingsQuery} empty={t("authNoProviderSettings")}>
            {(settings) => {
              const effectiveById = new Map<
                AuthProviderId,
                EffectiveAuthProviderSetting
              >(settings.effective.providers.map((p) => [p.providerId, p]));
              const effective = settings.effective.providers;
              const busy = updateMutation.isPending;

              return (
                <div className="grid gap-4">
                  <PanelStats
                    items={[
                      { label: t("authTotal"), value: catalog.length },
                      {
                        label: t("authEnabled"),
                        value: effective.filter((p) => p.enabled).length,
                      },
                      {
                        label: t("authConfigured"),
                        value: effective.filter(
                          (p) =>
                            p.oidc?.issuerConfigured || p.secretRefConfigured,
                        ).length,
                      },
                    ]}
                  />

                  <div
                    className="grid gap-3"
                    style={{
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(260px, 1fr))",
                    }}
                  >
                    {catalog.map((entry) => {
                      const setting = effectiveById.get(entry.id);
                      const planned = entry.status === "planned";
                      const enabled = setting?.enabled ?? false;
                      const source = setting?.source ?? "default";
                      const test = testResults[entry.id];
                      const canTest = canTestProvider(entry);
                      const canDeprovision = canDeprovisionProvider(entry);

                      return (
                        <div
                          className="rm-panel"
                          key={entry.id}
                          style={{ padding: 14, opacity: planned ? 0.75 : 1 }}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              style={{
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              {authProviderIcon(entry.id)}
                            </div>
                            <div className="min-w-0" style={{ flex: 1 }}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">
                                  {entry.name}
                                </span>
                                {planned ? (
                                  <span
                                    className="rm-status"
                                    style={{ color: "var(--rm-muted)" }}
                                  >
                                    {t("authComingSoon")}
                                  </span>
                                ) : (
                                  <span
                                    className={`rm-status ${enabled ? "pass" : "fail"}`}
                                  >
                                    {enabled ? t("authOn") : t("authOff")}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span
                                  className="rm-status rm-mono"
                                  style={{ fontSize: 11 }}
                                >
                                  {entry.protocol}
                                </span>
                                <span
                                  className="rm-status"
                                  style={{
                                    fontSize: 11,
                                    color: "var(--rm-muted)",
                                  }}
                                >
                                  {source}
                                </span>
                              </div>
                            </div>
                          </div>

                          {setting?.disabledReason ? (
                            <div className="text-xs text-muted mt-2">
                              {setting.disabledReason}
                            </div>
                          ) : null}

                          {entry.id === "local" ? (
                            <div className="text-xs text-muted mt-2">
                              {t("authLocalProviderGuidance")}
                            </div>
                          ) : null}

                          {test ? (
                            <div className="mt-2 grid gap-1 rounded-md border border-border p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted">
                                  {t("authConnection")}
                                </span>
                                <span
                                  className={`rm-status ${
                                    test.status === "passed"
                                      ? "pass"
                                      : test.status === "partial"
                                        ? "warn"
                                        : "fail"
                                  }`}
                                >
                                  {test.status}
                                </span>
                              </div>
                              {test.checks.map((check) => (
                                <div
                                  className="flex items-center justify-between text-xs"
                                  key={check.id}
                                >
                                  <span className="text-muted">{check.id}</span>
                                  <span
                                    className={`rm-status ${
                                      check.status === "pass"
                                        ? "pass"
                                        : check.status === "skip"
                                          ? "warn"
                                          : "fail"
                                    }`}
                                  >
                                    {check.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <Button
                              variant={enabled ? "default" : "primary"}
                              disabled={planned || busy}
                              onClick={() => void handleToggle(entry, !enabled)}
                              type="button"
                            >
                              {enabled ? t("authDisable") : t("authEnable")}
                            </Button>
                            <Button
                              disabled={planned}
                              onClick={() => setConfiguring(entry)}
                              type="button"
                            >
                              {t("authConfigure")}
                            </Button>
                            {canTest ? (
                              <Button
                                disabled={testMutation.isPending}
                                onClick={() => void handleTest(entry)}
                                type="button"
                              >
                                {testMutation.isPending
                                  ? t("authTesting")
                                  : t("authTest")}
                              </Button>
                            ) : null}
                            {canDeprovision ? (
                              <Button
                                variant="danger"
                                disabled={deprovisionMutation.isPending}
                                onClick={() => setDeprovisioning(entry)}
                                type="button"
                              >
                                {t("authDeprovision")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
    </section>
  );
}

/**
 * Collects the OIDC subject to deprovision. Submitting hands the subject up to
 * the panel, which raises a destructive confirm (useConfirm) before calling the
 * deprovision endpoint. confirmOidcSubject is set to the same subject there.
 */
