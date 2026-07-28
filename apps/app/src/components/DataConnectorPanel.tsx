import { Button, Field, Input, Select, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  createDataConnector,
  getDataConnectorCatalog,
  listDataConnectors,
  listDataConnectorSyncs,
  listKnowledgeBases,
  syncLocalDataConnector,
} from "../features";
import type { DataConnector, DataConnectorType } from "../features/types";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { DataConnectorSyncHistory } from "./DataConnectorSyncHistory";
import { resolveKnowledgeBaseBinding } from "./data-connector-binding";
import {
  buildDataConnectorConfig,
  connectorConfigHint,
  DataConnectorCatalog,
  mimeTypeFor,
} from "./DataConnectorCatalog";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
import { Tabs } from "./Tabs";

const col = createColumnHelper<DataConnector>();

export function DataConnectorPanel({
  workspaceId,
}: {
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
  const syncsQuery = useQuery({
    queryKey: ["dataConnectorSyncs", activeConnector?.id],
    queryFn: () => listDataConnectorSyncs(activeConnector!.id),
    enabled: activeConnector !== undefined,
  });
  const createMutation = useMutation({ mutationFn: createDataConnector });
  const syncMutation = useMutation({ mutationFn: syncLocalDataConnector });
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

  const syncForm = useForm({
    defaultValues: {
      fileName: "",
      content: "",
    },
    onSubmit: async ({ value }) => {
      if (!activeConnector) return;
      try {
        await syncMutation.mutateAsync({
          connectorId: activeConnector.id,
          fileName: value.fileName,
          mimeType: mimeTypeFor(value.fileName),
          content: value.content,
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["dataConnectorSyncs", activeConnector.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["knowledgeSources", activeConnector.knowledgeBaseId],
          }),
          queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
          queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
          queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
        ]);
        toast(t("connectorSynced"), "success");
      } catch (caught) {
        toast(t("connectorSyncFailed"), "error");
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
          <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
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
        <div
          className="rm-card-title"
          style={{ margin: 0, padding: 0, border: "none" }}
        >
          {t("connectorListTitle")}
        </div>
        <Button
          variant="primary"
          onClick={() => openAdd("local_import")}
          type="button"
        >
          + {t("connectorAdd")}
        </Button>
      </div>

      <PanelState
        empty={t("connectorNone")}
        emptyAction={
          <Button
            variant="primary"
            onClick={() => openAdd("local_import")}
            type="button"
          >
            + {t("connectorAdd")}
          </Button>
        }
        query={connectorsQuery}
      >
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

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void syncForm.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="connector-file-name">
          {t("connectorSourceFile")}
        </label>
        <syncForm.Field
          name="fileName"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("connectorSourceFileRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Input
                name="fileName"
                id="connector-file-name"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("connectorSourceFilePlaceholder")}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </syncForm.Field>
        <label
          className="text-sm text-muted"
          htmlFor="connector-source-content"
        >
          {t("connectorSourceText")}
        </label>
        <syncForm.Field
          name="content"
          validators={{
            onChange: ({ value }: { value: string }) =>
              !value?.trim() ? t("connectorSourceTextRequired") : undefined,
          }}
        >
          {(field) => (
            <>
              <Textarea
                name="content"
                className="min-h-24"
                id="connector-source-content"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("connectorSourceTextPlaceholder")}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">
                  {field.state.meta.errors.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </syncForm.Field>
        <syncForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              disabled={!canSubmit || isSubmitting || !activeConnector}
              type="submit"
            >
              {isSubmitting
                ? t("connectorSyncing")
                : t("connectorSyncLocalText")}
            </Button>
          )}
        </syncForm.Subscribe>
      </form>

      <DataConnectorSyncHistory syncs={syncsQuery.data ?? []} />
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
        <div
          className="rm-card-title"
          style={{ margin: 0, padding: 0, border: "none" }}
        >
          {t("connectorTitle")}
        </div>
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
          {() => (
            <Tabs
              tabs={[
                {
                  id: "sources",
                  label: t("connectorSourcesTab"),
                  content: sourcesTab,
                },
                {
                  id: "catalog",
                  label: t("connectorCatalogTab"),
                  content: catalogTab,
                },
              ]}
            />
          )}
        </PanelState>
      </div>
    </section>
  );
}
