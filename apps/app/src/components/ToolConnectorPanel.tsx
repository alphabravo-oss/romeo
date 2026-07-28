import { Input, Textarea, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import GlobeLock from "lucide-react/dist/esm/icons/globe-lock.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import Power from "lucide-react/dist/esm/icons/power.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";
import { useState } from "react";

import {
  checkToolConnectorAuth,
  importOpenApiTool,
  listToolConnectors,
  updateToolConnector,
  updateToolConnectorAuth,
  updateToolConnectorNetworkPolicy,
} from "../features/tool-connectors";
import type { ToolConnector, ToolConnectorAuthCheck } from "../features/types";
import { PanelState } from "../lib/panel-state";
import { type MessageKey, useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
import { Tabs } from "./Tabs";
import { ToolOperationList } from "./ToolOperationList";

export function ToolConnectorPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const connectorsQuery = useQuery({
    queryKey: ["toolConnectors"],
    queryFn: listToolConnectors,
  });
  const authCheckMutation = useMutation({ mutationFn: checkToolConnectorAuth });
  const importMutation = useMutation({ mutationFn: importOpenApiTool });
  const connectorMutation = useMutation({ mutationFn: updateToolConnector });
  const authMutation = useMutation({ mutationFn: updateToolConnectorAuth });
  const networkPolicyMutation = useMutation({
    mutationFn: updateToolConnectorNetworkPolicy,
  });
  const [error, setError] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [authChecks, setAuthChecks] = useState<
    Record<string, ToolConnectorAuthCheck>
  >({});

  const importForm = useForm({
    defaultValues: { name: "", specText: "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        const spec = JSON.parse(value.specText) as Record<string, unknown>;
        await importMutation.mutateAsync({ name: value.name, spec });
        await queryClient.invalidateQueries({ queryKey: ["toolConnectors"] });
        toast(t("toolImported"), "success");
        setAddOpen(false);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : t("toolUnableImport"),
        );
        toast(t("toolCouldNotImport"), "error");
      }
    },
  });

  async function handleSetAuthRef(connectorId: string) {
    setError(undefined);
    try {
      await authMutation.mutateAsync({
        connectorId,
        type: "api_key",
        secretRef: `vault://tools/${connectorId}/api-key`,
      });
      await queryClient.invalidateQueries({ queryKey: ["toolConnectors"] });
      toast(t("toolApiKeyRefSet"), "success");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("toolUnableUpdateAuth"),
      );
      toast(t("toolCouldNotUpdateAuth"), "error");
    }
  }

  async function handleSetOAuthRef(connectorId: string) {
    setError(undefined);
    try {
      await authMutation.mutateAsync({
        connectorId,
        type: "oauth2_client_credentials",
        secretRef: `vault://tools/${connectorId}/oauth-client`,
      });
      await queryClient.invalidateQueries({ queryKey: ["toolConnectors"] });
      toast(t("toolOAuthRefSet"), "success");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("toolUnableUpdateAuth"),
      );
      toast(t("toolCouldNotUpdateAuth"), "error");
    }
  }

  async function handleToggleConnector(connectorId: string, enabled: boolean) {
    setError(undefined);
    try {
      await connectorMutation.mutateAsync({ connectorId, enabled });
      await queryClient.invalidateQueries({ queryKey: ["toolConnectors"] });
      toast(
        t(enabled ? "toolConnectorEnabled" : "toolConnectorDisabled"),
        "success",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("toolUnableUpdate"),
      );
      toast(t("toolCouldNotUpdate"), "error");
    }
  }

  async function handleAllowExampleHost(connectorId: string) {
    setError(undefined);
    try {
      await networkPolicyMutation.mutateAsync({
        connectorId,
        mode: "allow_hosts",
        allowedHosts: ["api.example.com"],
      });
      await queryClient.invalidateQueries({ queryKey: ["toolConnectors"] });
      toast(t("toolNetworkPolicyUpdated"), "success");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("toolUnableUpdateNetwork"),
      );
      toast(t("toolCouldNotUpdateNetwork"), "error");
    }
  }

  async function handleCheckAuth(connectorId: string) {
    setError(undefined);
    try {
      const check = await authCheckMutation.mutateAsync(connectorId);
      setAuthChecks((current) => ({ ...current, [connectorId]: check }));
      toast(t("toolAuthChecked"), "success");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("toolUnableCheckAuth"),
      );
      toast(t("toolCouldNotCheckAuth"), "error");
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("toolConnectors")}</div>
        <Button
          variant="primary"
          onClick={() => setAddOpen(true)}
          type="button"
        >
          + {t("toolImportTool")}
        </Button>
      </div>
      <FormDialog
        open={addOpen}
        title={t("toolImportToolConnector")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void importForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="tool-connector-name">
            {t("toolName")}
          </label>
          <importForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("toolNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  id="tool-connector-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("toolConnectorName")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </importForm.Field>
          <label className="text-sm text-muted" htmlFor="openapi-spec">
            {t("toolOpenApiJson")}
          </label>
          <importForm.Field
            name="specText"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("toolOpenApiJsonRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Textarea
                  name="specText"
                  className="min-h-36 font-mono text-xs"
                  id="openapi-spec"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("toolPasteOpenApiJson")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </importForm.Field>
          <importForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                className="inline-flex items-center justify-center gap-2"
                disabled={
                  !canSubmit || isSubmitting || importMutation.isPending
                }
                type="submit"
              >
                <Upload aria-hidden="true" size={16} />
                <span>
                  {importMutation.isPending
                    ? t("toolImporting")
                    : t("toolImportOpenApi")}
                </span>
              </Button>
            )}
          </importForm.Subscribe>
        </form>
      </FormDialog>
      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      <div className="mt-4 grid gap-2 text-sm">
        <PanelState
          empty={t("toolNoConnectors")}
          emptyAction={
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + {t("toolImportTool")}
            </Button>
          }
          query={connectorsQuery}
        >
          {(connectors) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("toolTotalConnectors"), value: connectors.length },
                  {
                    label: t("toolEnabled"),
                    value: connectors.filter((connector) => connector.enabled)
                      .length,
                  },
                ]}
              />
              <div className="grid gap-2">
                {connectors.slice(0, 5).map((connector) => (
                  <div
                    className="rounded-md border border-border p-2"
                    key={connector.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{connector.name}</div>
                      <div className="text-xs text-muted">
                        {t(connector.enabled ? "toolEnabled" : "toolDisabled")}
                      </div>
                    </div>
                    <div className="text-muted">
                      {connector.type} - {connector.approvalPolicy} -{" "}
                      {t(
                        connector.authConfig.configured === true
                          ? "toolAuthRefSet"
                          : "toolNoAuthRef",
                      )}
                    </div>
                    {authChecks[connector.id] !== undefined ? (
                      <div className="text-muted">
                        {authCheckText(authChecks[connector.id]!, t)}
                      </div>
                    ) : null}
                    <div className="text-muted">
                      {networkPolicyText(connector.networkPolicy, t)}
                    </div>
                    <div className="mt-2">
                      <Tabs
                        tabs={[
                          {
                            id: "actions",
                            label: t("toolConnector"),
                            content: (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  className="inline-flex items-center gap-2"
                                  disabled={connectorMutation.isPending}
                                  onClick={() =>
                                    void handleToggleConnector(
                                      connector.id,
                                      !connector.enabled,
                                    )
                                  }
                                  type="button"
                                >
                                  <Power aria-hidden="true" size={16} />
                                  <span>
                                    {t(
                                      connector.enabled
                                        ? "toolDisable"
                                        : "toolEnable",
                                    )}
                                  </span>
                                </Button>
                                <Button
                                  className="inline-flex items-center gap-2"
                                  disabled={authMutation.isPending}
                                  onClick={() =>
                                    void handleSetAuthRef(connector.id)
                                  }
                                  type="button"
                                >
                                  <KeyRound aria-hidden="true" size={16} />
                                  <span>{t("toolSetApiKeyRef")}</span>
                                </Button>
                                {hasOAuthHint(connector) ? (
                                  <Button
                                    className="inline-flex items-center gap-2"
                                    disabled={authMutation.isPending}
                                    onClick={() =>
                                      void handleSetOAuthRef(connector.id)
                                    }
                                    type="button"
                                  >
                                    <KeyRound aria-hidden="true" size={16} />
                                    <span>{t("toolSetOAuthRef")}</span>
                                  </Button>
                                ) : null}
                                <Button
                                  className="inline-flex items-center gap-2"
                                  disabled={authCheckMutation.isPending}
                                  onClick={() =>
                                    void handleCheckAuth(connector.id)
                                  }
                                  type="button"
                                >
                                  <ShieldCheck aria-hidden="true" size={16} />
                                  <span>{t("toolCheckAuth")}</span>
                                </Button>
                                <Button
                                  className="inline-flex items-center gap-2"
                                  disabled={networkPolicyMutation.isPending}
                                  onClick={() =>
                                    void handleAllowExampleHost(connector.id)
                                  }
                                  type="button"
                                >
                                  <GlobeLock aria-hidden="true" size={16} />
                                  <span>{t("toolAllowHost")}</span>
                                </Button>
                              </div>
                            ),
                          },
                          {
                            id: "operations",
                            label: t("toolOperations"),
                            content: (
                              <ToolOperationList connectorId={connector.id} />
                            ),
                          },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </PanelState>
      </div>
    </section>
  );
}

type Translate = (key: MessageKey) => string;

function authCheckText(check: ToolConnectorAuthCheck, t: Translate): string {
  if (!check.configured) return t("toolSecretNotConfigured");
  if (check.available)
    return `${t("toolSecretAvailable")} (${check.secretRefScheme ?? t("toolManaged")})`;
  return `${t("toolSecretUnavailable")}: ${check.failureCode ?? t("toolUnavailable")}`;
}

function networkPolicyText(
  policy: { mode: string; allowedHosts: string[] },
  t: Translate,
): string {
  return policy.mode === "allow_hosts"
    ? `${t("toolNetwork")}: ${policy.allowedHosts.join(", ")}`
    : `${t("toolNetwork")}: ${t("toolNetworkDenyAll")}`;
}

function hasOAuthHint(connector: ToolConnector): boolean {
  const hints = Array.isArray(connector.schema.authHints)
    ? connector.schema.authHints
    : [];
  return hints.some(
    (hint) =>
      typeof hint === "object" &&
      hint !== null &&
      !Array.isArray(hint) &&
      (hint as { type?: unknown }).type === "oauth2_client_credentials",
  );
}
