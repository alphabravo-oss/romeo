import { Button, Field, Input, Select, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  createDataConnector,
  getDataConnectorCatalog,
  listDataConnectors,
  listKnowledgeBases,
} from "../features";
import type { DataConnector, DataConnectorType } from "../features/types";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { resolveKnowledgeBaseBinding } from "./data-connector-binding";
import {
  buildDataConnectorConfig,
  connectorConfigHint,
  DataConnectorCatalog,
} from "./DataConnectorCatalog";
import { DataConnectorImportsTab } from "./DataConnectorImportsTab";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";

const col = createColumnHelper<DataConnector>();

export function DataConnectorPanel({
  view,
  workspaceId,
}: {
  view: "catalog" | "imports" | "sources";
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<DataConnectorType>("local_import");
  const [activeConnectorId, setActiveConnectorId] = useState<string>();
  const knowledgeBasesQuery = useQuery({
    queryKey: ["knowledgeBases", workspaceId],
    queryFn: () => listKnowledgeBases(workspaceId!),
    enabled: workspaceId !== undefined,
  });
  const connectorsQuery = useQuery({
    queryKey: ["dataConnectors", workspaceId],
    queryFn: () => listDataConnectors(workspaceId!),
    enabled: workspaceId !== undefined,
  });
  const catalogQuery = useQuery({
    queryKey: ["dataConnectorCatalog"],
    queryFn: getDataConnectorCatalog,
  });
  const connectors = useMemo(
    () => connectorsQuery.data ?? [],
    [connectorsQuery.data],
  );
  const knowledgeBases = useMemo(
    () => knowledgeBasesQuery.data ?? [],
    [knowledgeBasesQuery.data],
  );
  const knowledgeBaseNames = useMemo(
    () => new Map(knowledgeBases.map((base) => [base.id, base.name])),
    [knowledgeBases],
  );
  const activeConnector =
    connectors.find((connector) => connector.id === activeConnectorId) ??
    connectors[0];
  const createMutation = useMutation({ mutationFn: createDataConnector });
  const activeConfigHint = useMemo(
    () => connectorConfigHint(addType, t),
    [addType, t],
  );

  useEffect(() => {
    if (activeConnectorId === undefined && connectors[0])
      setActiveConnectorId(connectors[0].id);
  }, [activeConnectorId, connectors]);

  function openAdd(type: DataConnectorType): void {
    setAddType(type);
    createForm.reset();
    setAddOpen(true);
  }

  const createForm = useForm({
    defaultValues: {
      name: "",
      configText: "",
      knowledgeBaseId: undefined as string | undefined,
    } as {
      name: string;
      configText: string;
      knowledgeBaseId: string | undefined;
    },
    onSubmit: async ({ value }) => {
      if (!workspaceId) return;
      const binding = resolveKnowledgeBaseBinding({
        selectedKnowledgeBaseId: value.knowledgeBaseId,
        availableIds: knowledgeBases.map((base) => base.id),
      });
      if (!binding.ok) return;
      const config = buildDataConnectorConfig(addType, value.configText, t);
      try {
        const connector = await createMutation.mutateAsync({
          workspaceId,
          knowledgeBaseId: binding.knowledgeBaseId,
          type: addType,
          name: value.name,
          config,
        });
        setActiveConnectorId(connector.id);
        await queryClient.invalidateQueries({
          queryKey: ["dataConnectors", workspaceId],
        });
        toast(t("connectorCreated"), "success");
        createForm.reset();
        setAddOpen(false);
      } catch (caught) {
        toast(t("connectorCreateFailed"), "error");
        throw caught;
      }
    },
  });

  const columns = useMemo<ColumnDef<DataConnector, any>[]>(
    () => [
      col.accessor("name", {
        header: t("connectorName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor("type", {
        header: t("connectorType"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor("knowledgeBaseId", {
        header: t("knowledgeBase"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {knowledgeBaseNames.get(c.getValue()) ?? c.getValue()}
          </span>
        ),
      }),
      col.accessor("status", {
        header: t("connectorStatus"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "active" ? "pass" : "fail"}`}
          >
            {c.getValue() === "active"
              ? t("connectorActive")
              : t("connectorDisabled")}
          </span>
        ),
      }),
      col.accessor((row) => row.lastSyncAt, {
        id: "lastSync",
        header: t("connectorLastSync"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue() ? <LocalizedDateTime value={c.getValue()!} /> : "—"}
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            className={
              c.row.original.id === activeConnector?.id ? "selected" : undefined
            }
            onClick={() => setActiveConnectorId(c.row.original.id)}
            type="button"
          >
            {c.row.original.id === activeConnector?.id
              ? t("connectorSelected")
              : t("connectorSelect")}
          </Button>
        ),
      }),
    ],
    [activeConnector?.id, knowledgeBaseNames, t],
  );

  const sourcesTab = (
    <div className="grid gap-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("connectorListTitle")}</div>
        <Button
          variant="primary"
          onClick={() => openAdd("local_import")}
          type="button"
        >
          + {t("connectorAdd")}
        </Button>
      </div>

      <PanelState empty={t("connectorNone")} query={connectorsQuery}>
        {(rows) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: t("connectorTotal"), value: rows.length },
                {
                  label: t("connectorActive"),
                  value: rows.filter((row) => row.status === "active").length,
                },
              ]}
            />
            <DataTable
              columns={columns}
              data={rows}
              empty={t("connectorNone")}
            />
          </div>
        )}
      </PanelState>
    </div>
  );

  const catalogTab = (
    <PanelState query={catalogQuery} empty={t("connectorCatalogEmpty")}>
      {(report) => (
        <DataConnectorCatalog
          canCreate={workspaceId !== undefined}
          onAdd={openAdd}
          report={report}
        />
      )}
    </PanelState>
  );

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("connectorTitle")}</div>
      </div>

      <FormDialog
        open={addOpen}
        title={t("connectorNew")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void createForm.handleSubmit();
          }}
        >
          <label className="text-sm text-muted" htmlFor="connector-name">
            {t("connectorNameLabel")}
          </label>
          <createForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("connectorNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  id="connector-name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  placeholder={t("connectorNamePlaceholder")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </createForm.Field>

          <createForm.Field
            name="knowledgeBaseId"
            validators={{
              onChange: ({ value }: { value: string | undefined }) =>
                value === undefined ? t("required") : undefined,
            }}
          >
            {(field) => (
              <Field label={t("knowledgeBase")} required>
                <Select
                  name="knowledgeBaseId"
                  onValueChange={field.handleChange}
                  options={knowledgeBases.map((base) => ({
                    label: base.name,
                    value: base.id,
                  }))}
                  placeholder={t("knowledgeBase")}
                  {...(field.state.value === undefined
                    ? {}
                    : { value: field.state.value })}
                />
              </Field>
            )}
          </createForm.Field>

          {activeConfigHint ? (
            <>
              <label className="text-sm text-muted" htmlFor="connector-config">
                {activeConfigHint.label}
              </label>
              <createForm.Field
                name="configText"
                validators={{
                  onChange: ({ value }: { value: string }) =>
                    activeConfigHint.required && !value?.trim()
                      ? t("connectorFieldRequired")
                      : undefined,
                }}
              >
                {(field) => (
                  <>
                    <Input
                      name="configText"
                      id="connector-config"
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value)
                      }
                      placeholder={activeConfigHint.placeholder}
                      value={field.state.value}
                    />
                    {field.state.meta.errors.length ? (
                      <div className="rm-composer-error">
                        {field.state.meta.errors.join(", ")}
                      </div>
                    ) : null}
                  </>
                )}
              </createForm.Field>
            </>
          ) : null}

          <createForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                variant="primary"
                disabled={
                  !canSubmit ||
                  isSubmitting ||
                  !workspaceId ||
                  !createForm.state.values.knowledgeBaseId
                }
                type="submit"
              >
                {isSubmitting ? t("connectorCreating") : t("connectorCreate")}
              </Button>
            )}
          </createForm.Subscribe>
        </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          empty={t("dataConnectorNeedsKb")}
          emptyAction={
            <Button asChild variant="primary">
              <Link search={{ section: "knowledge" }} to="/workspace">
                {t("knowledgeAddBase")}
              </Link>
            </Button>
          }
          query={knowledgeBasesQuery}
        >
          {() =>
            view === "sources" ? (
              sourcesTab
            ) : view === "imports" ? (
              <DataConnectorImportsTab connector={activeConnector} />
            ) : (
              catalogTab
            )
          }
        </PanelState>
      </div>
    </section>
  );
}
