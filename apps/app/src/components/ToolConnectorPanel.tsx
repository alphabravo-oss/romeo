import { Button, Input, StatusBadge, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Plug from "lucide-react/dist/esm/icons/plug.mjs";
import Upload from "lucide-react/dist/esm/icons/upload.mjs";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import { useMemo, useState } from "react";

import {
  checkToolConnectorAuth,
  importOpenApiTool,
  listToolConnectors,
  updateToolConnector,
} from "../features/tool-connectors";
import type { ToolConnector, ToolConnectorAuthCheck } from "../features/types";
import { PanelState } from "../lib/panel-state";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { AddButton, Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { useConfirm } from "./ConfirmDialog";
import { ToolConnectorDetailsPage } from "./ToolConnectorDetailsPage";

export function ToolConnectorPanel({
  onSelectionChange,
  selectedConnectorId,
}: {
  onSelectionChange: (connectorId: string | null) => void;
  selectedConnectorId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const connectorsQuery = useQuery({
    queryKey: ["toolConnectors"],
    queryFn: listToolConnectors,
  });
  const authCheckMutation = useMutation({ mutationFn: checkToolConnectorAuth });
  const importMutation = useMutation({ mutationFn: importOpenApiTool });
  const connectorMutation = useMutation({ mutationFn: updateToolConnector });
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

  async function handleToggleConnector(connectorId: string, enabled: boolean) {
    const connector = connectors.find((entry) => entry.id === connectorId);
    if (
      !enabled &&
      connector &&
      (connector.dependentAgentCount ?? 0) > 0 &&
      !(await ask({
        title: t("toolDisableImpactTitle"),
        body: t("toolDisableImpactDescription", {
          agents: connector.dependentAgentCount ?? 0,
          operations: connector.dependentOperationCount ?? 0,
        }),
        confirmLabel: t("toolDisable"),
        tone: "danger",
      }))
    )
      return;
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
      toolConnectorColumn.accessor(
        (connector) => connector.dependentAgentCount ?? 0,
        {
          id: "dependentAgents",
          header: t("toolDependentAssistants"),
        },
      ),
      toolConnectorColumn.display({
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: (cell) => (
          <Button
            onClick={() => onSelectionChange(cell.row.original.id)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("toolManage")}
          </Button>
        ),
      }),
    ],
    [onSelectionChange, t],
  );

  const connectors = connectorsQuery.data ?? [];
  const selectedConnector = connectors.find(
    (connector) => connector.id === selectedConnectorId,
  );

  if (selectedConnectorId !== undefined) {
    return (
      <div className="grid gap-3">
        <Button
          className="w-fit"
          onClick={() => onSelectionChange(null)}
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          {t("toolBackToConnectors")}
        </Button>
        <Section>
          {connectorsQuery.isLoading ? (
            <div className="rm-empty" role="status">
              {t("loading")}
            </div>
          ) : selectedConnector ? (
            <ToolConnectorDetailsPage
              authCheck={authChecks[selectedConnector.id]}
              checkingAuth={authCheckMutation.isPending}
              connector={selectedConnector}
              onCheckAuth={handleCheckAuth}
              onToggle={handleToggleConnector}
              updating={connectorMutation.isPending}
            />
          ) : (
            <div className="rm-empty">{t("toolConnectorNotFound")}</div>
          )}
          {error ? (
            <div className="mt-3 text-sm text-red-600">{error}</div>
          ) : null}
        </Section>
        {dialog}
      </div>
    );
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("toolConnectors")}</div>
        {connectors.length > 0 ? (
          <AddButton onClick={() => setAddOpen(true)}>
            {t("toolImportTool")}
          </AddButton>
        ) : null}
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
            <AddButton onClick={() => setAddOpen(true)}>
              {t("toolImportTool")}
            </AddButton>
          }
          emptyDescription={t("toolNoConnectorsDescription")}
          emptyIcon={<Plug aria-hidden size={24} />}
          query={connectorsQuery}
        >
          {(connectors) => (
            <div className="grid gap-4">
              <StatRow
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
                onRowActivate={(connector) => onSelectionChange(connector.id)}
                preferenceKey="admin-tool-connectors"
                rowAriaLabel={(connector) =>
                  t("toolOpenConnector", { name: connector.name })
                }
                searchVisibility="always"
              />
            </div>
          )}
        </PanelState>
      </div>
      {dialog}
    </section>
  );
}

const toolConnectorColumn = createColumnHelper<ToolConnector>();

function humanizeToolValue(value: string): string {
  return value.replaceAll("_", " ");
}
