import { Button, Input, Sheet, StatusBadge, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Power from "lucide-react/dist/esm/icons/power.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";
import { useMemo, useState } from "react";

import {
  checkToolConnectorAuth,
  importOpenApiTool,
  listToolConnectors,
  updateToolConnector,
} from "../features/tool-connectors";
import type { ToolConnector, ToolConnectorAuthCheck } from "../features/types";
import { PanelState } from "../lib/panel-state";
import { type MessageKey, useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
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
  const [error, setError] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>();
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

  const columns = useMemo<ColumnDef<ToolConnector, any>[]>(
    () => [
      toolConnectorColumn.accessor("name", {
        header: t("toolName"),
        cell: (cell) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="truncate font-medium">{cell.getValue()}</span>
            <span className="truncate text-xs text-muted">
              {cell.row.original.description}
            </span>
          </div>
        ),
      }),
      toolConnectorColumn.accessor("type", {
        header: t("toolType"),
        cell: (cell) => <span translate="no">{cell.getValue()}</span>,
      }),
      toolConnectorColumn.accessor("riskLevel", {
        header: t("toolRisk"),
        cell: (cell) => (
          <StatusBadge
            tone={
              cell.getValue() === "critical" || cell.getValue() === "high"
                ? "warning"
                : "neutral"
            }
          >
            {humanizeToolValue(cell.getValue())}
          </StatusBadge>
        ),
      }),
      toolConnectorColumn.accessor("approvalPolicy", {
        header: t("toolConnectorApproval"),
        cell: (cell) => humanizeToolValue(cell.getValue()),
      }),
      toolConnectorColumn.accessor("enabled", {
        header: t("toolStatus"),
        cell: (cell) => (
          <StatusBadge tone={cell.getValue() ? "success" : "neutral"}>
            {t(cell.getValue() ? "toolEnabled" : "toolDisabled")}
          </StatusBadge>
        ),
      }),
      toolConnectorColumn.display({
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: (cell) => (
          <Button
            onClick={() => setSelectedConnectorId(cell.row.original.id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("toolManage")}
          </Button>
        ),
      }),
    ],
    [t],
  );

  const connectors = connectorsQuery.data ?? [];
  const selectedConnector = connectors.find(
    (connector) => connector.id === selectedConnectorId,
  );

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
      <ToolConnectorDetailsSheet
        authCheck={selectedConnector && authChecks[selectedConnector.id]}
        checkingAuth={authCheckMutation.isPending}
        connector={selectedConnector}
        onCheckAuth={handleCheckAuth}
        onClose={() => setSelectedConnectorId(undefined)}
        onToggle={handleToggleConnector}
        updating={connectorMutation.isPending}
      />
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
              <DataTable
                columns={columns}
                data={connectors}
                empty={t("toolNoConnectors")}
                getRowId={(connector) => connector.id}
                minTableWidth={760}
              />
            </div>
          )}
        </PanelState>
      </div>
    </section>
  );
}

type Translate = (key: MessageKey) => string;
const toolConnectorColumn = createColumnHelper<ToolConnector>();

function ToolConnectorDetailsSheet({
  authCheck,
  checkingAuth,
  connector,
  onCheckAuth,
  onClose,
  onToggle,
  updating,
}: {
  authCheck: ToolConnectorAuthCheck | undefined;
  checkingAuth: boolean;
  connector: ToolConnector | undefined;
  onCheckAuth: (connectorId: string) => Promise<void>;
  onClose: () => void;
  onToggle: (connectorId: string, enabled: boolean) => Promise<void>;
  updating: boolean;
}) {
  const { t } = useLocale();
  return (
    <Sheet
      closeLabel={t("close")}
      description={t("toolManageDescription")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={connector !== undefined}
      title={connector?.name ?? t("toolConnector")}
    >
      {connector ? (
        <div className="grid gap-5">
          <div className="rm-model-meta-grid">
            <span>
              <small>{t("toolType")}</small>
              <span translate="no">{connector.type}</span>
            </span>
            <span>
              <small>{t("toolStatus")}</small>
              <StatusBadge tone={connector.enabled ? "success" : "neutral"}>
                {t(connector.enabled ? "toolEnabled" : "toolDisabled")}
              </StatusBadge>
            </span>
            <span>
              <small>{t("toolRisk")}</small>
              {humanizeToolValue(connector.riskLevel)}
            </span>
            <span>
              <small>{t("toolConnectorApproval")}</small>
              {humanizeToolValue(connector.approvalPolicy)}
            </span>
            <span>
              <small>{t("toolVisibility")}</small>
              {humanizeToolValue(connector.visibility)}
            </span>
            <span>
              <small>{t("toolAuth")}</small>
              {t(
                connector.authConfig.configured === true
                  ? "toolAuthRefSet"
                  : "toolNoAuthRef",
              )}
            </span>
          </div>
          {connector.description ? (
            <p className="text-sm text-muted">{connector.description}</p>
          ) : null}
          <div className="text-sm text-muted">
            {networkPolicyText(connector.networkPolicy, t)}
          </div>
          {authCheck ? (
            <div className="text-sm text-muted">
              {authCheckText(authCheck, t)}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={updating}
              onClick={() => void onToggle(connector.id, !connector.enabled)}
              type="button"
            >
              <Power aria-hidden="true" size={16} />
              {t(connector.enabled ? "toolDisable" : "toolEnable")}
            </Button>
            <Button
              disabled={checkingAuth}
              onClick={() => void onCheckAuth(connector.id)}
              type="button"
            >
              <ShieldCheck aria-hidden="true" size={16} />
              {t("toolCheckAuth")}
            </Button>
          </div>
          <div className="border-t border-border pt-4">
            <ToolOperationList connectorId={connector.id} />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

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

function humanizeToolValue(value: string): string {
  return value.replaceAll("_", " ");
}
