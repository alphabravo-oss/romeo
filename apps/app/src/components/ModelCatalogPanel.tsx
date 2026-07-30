import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import { Button, Input, Select, StatusBadge, Switch } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { listModelsPage } from "../features/providers/queries";
import type { BaseModel } from "../features/providers/types";
import { LocalizedTokens } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { BaseModelDetails } from "./BaseModelDetails";
import { createColumnHelper, DataTable } from "./DataTable";
import { PanelStats } from "./PanelStats";
import { CreateManagedModelDialog } from "./CreateManagedModelDialog";
import { useConfirm } from "./ConfirmDialog";
import type {
  ModelCatalogPanelProps,
  ModelSort,
} from "./model-catalog-navigation";

const columnHelper = createColumnHelper<BaseModel>();

export function ModelCatalogPanel({
  availability,
  agents,
  direction,
  isUpdating,
  models,
  onNavigationChange,
  page,
  providers,
  providerId,
  query,
  sort,
  selectedModelId,
  onUpdateModel,
  onUpdatePricing,
  onManagedModelCreated,
  workspaceId,
}: ModelCatalogPanelProps) {
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const pageSize = 50;
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const catalogQuery = useQuery({
    queryKey: [
      "models",
      "catalog",
      query,
      providerId,
      availability,
      sort,
      direction,
      page,
    ],
    queryFn: () =>
      listModelsPage({
        limit: pageSize,
        offset: page * pageSize,
        direction,
        ...(query.trim() === "" ? {} : { query }),
        ...(providerId === "all" ? {} : { providerId }),
        ...(availability === "available" || availability === "unavailable"
          ? { available: availability === "available" }
          : {}),
        ...(availability === "enabled" || availability === "disabled"
          ? { enabled: availability === "enabled" }
          : {}),
        sort,
      }),
    placeholderData: (previous) => previous,
  });
  const catalogModels = catalogQuery.data?.items ?? [];
  const catalogTotal = catalogQuery.data?.total ?? 0;
  const selectedModel = catalogModels.find(
    (model) => model.id === selectedModelId,
  );
  const sorting = useMemo(
    () => [{ id: sort, desc: direction === "desc" }],
    [direction, sort],
  );
  const updateModelWithImpact = useCallback(
    async (
      input:
        | { modelId: string; enabled: boolean }
        | {
            modelId: string;
            capabilities: BaseModel["capabilities"];
            contextWindow: number;
          },
    ) => {
      if ("enabled" in input && !input.enabled) {
        const dependentAgents = agents.filter(
          (agent) => agent.baseModelId === input.modelId,
        );
        if (
          dependentAgents.length > 0 &&
          !(await ask({
            title: t("modelDisableImpactTitle"),
            body: t("modelDisableImpactDescription", {
              agents: dependentAgents.length,
              names: dependentAgents
                .slice(0, 5)
                .map((agent) => agent.name)
                .join(", "),
            }),
            confirmLabel: t("disable"),
            tone: "danger",
          }))
        )
          return;
      }
      await onUpdateModel(input);
    },
    [agents, ask, onUpdateModel, t],
  );
  const updateModelsWithImpact = async (
    modelIds: string[],
    enabled: boolean,
  ) => {
    const dependentAgents = enabled
      ? []
      : agents.filter((agent) => modelIds.includes(agent.baseModelId));
    if (
      dependentAgents.length > 0 &&
      !(await ask({
        title: t("modelDisableImpactTitle"),
        body: t("modelDisableImpactDescription", {
          agents: dependentAgents.length,
          names: dependentAgents
            .slice(0, 5)
            .map((agent) => agent.name)
            .join(", "),
        }),
        confirmLabel: t("disable"),
        tone: "danger",
      }))
    )
      return;
    await Promise.all(
      modelIds.map((modelId) => onUpdateModel({ modelId, enabled })),
    );
  };
  const columns = useMemo(
    () => [
      columnHelper.accessor("displayName", {
        header: t("models"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">
              {row.original.displayName}
            </strong>
            <small className="block truncate text-muted">
              {row.original.name}
            </small>
          </span>
        ),
      }),
      columnHelper.accessor("name", {
        header: t("modelId"),
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("providerId", {
        header: t("provider"),
        enableSorting: false,
        cell: ({ getValue }) =>
          providerById.get(getValue())?.name ?? getValue(),
      }),
      columnHelper.accessor((model) => (model.available === false ? 0 : 1), {
        id: "availability",
        header: t("availability"),
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.available === false ? "danger" : "success"}
          >
            {row.original.available === false
              ? t("unavailable")
              : t("available")}
          </StatusBadge>
        ),
      }),
      columnHelper.accessor("contextWindow", {
        header: t("context"),
        cell: ({ getValue }) => <LocalizedTokens value={getValue()} />,
      }),
      columnHelper.accessor(
        (model) =>
          [
            model.capabilities.toolCalling ? t("tools") : undefined,
            model.capabilities.vision ? t("vision") : undefined,
            model.capabilities.reasoning ? t("reasoning") : undefined,
          ]
            .filter(Boolean)
            .join(", ") || t("chat"),
        {
          id: "capabilities",
          header: t("capabilities"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <span className="text-xs text-muted">{getValue()}</span>
          ),
        },
      ),
      columnHelper.accessor("enabled", {
        header: t("enabled"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={isUpdating}
            label={t("enabled")}
            onCheckedChange={(checked) =>
              void updateModelWithImpact({
                modelId: row.original.id,
                enabled: checked === true,
              })
            }
          />
        ),
      }),
    ],
    [isUpdating, providerById, t, updateModelWithImpact],
  );

  if (selectedModelId) {
    return (
      <div className="grid gap-4">
        <Button
          className="w-fit"
          onClick={() => onNavigationChange({ model: null })}
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          {t("backToBaseModels")}
        </Button>
        <section className="rm-panel p-4">
          {catalogQuery.isLoading ? (
            <div className="rm-empty-state-text" role="status">
              {t("loadingModels")}
            </div>
          ) : selectedModel ? (
            <div className="grid gap-5">
              <div className="rm-card-header">
                <div className="min-w-0">
                  <h2 className="rm-card-title truncate">
                    {selectedModel.displayName}
                  </h2>
                  <p className="truncate text-sm text-muted">
                    {selectedModel.name} ·{" "}
                    {providerById.get(selectedModel.providerId)?.name ??
                      selectedModel.providerId}
                  </p>
                </div>
                <CreateManagedModelDialog
                  defaultBaseModelId={selectedModel.id}
                  models={models}
                  onCreated={onManagedModelCreated}
                  providers={providers}
                  trigger={
                    <Button variant="primary">
                      <Sparkles aria-hidden="true" size={15} />
                      {t("createCuratedModel")}
                    </Button>
                  }
                  workspaceId={workspaceId}
                />
              </div>
              <BaseModelDetails
                dependentAgents={agents.filter(
                  (agent) => agent.baseModelId === selectedModel.id,
                )}
                isUpdating={isUpdating}
                key={`${selectedModel.id}:${selectedModel.capabilitiesSource ?? "detected"}`}
                model={selectedModel}
                provider={providerById.get(selectedModel.providerId)}
                onUpdateModel={updateModelWithImpact}
                onUpdatePricing={onUpdatePricing}
              />
            </div>
          ) : (
            <div className="rm-empty-state-text">{t("baseModelNotFound")}</div>
          )}
        </section>
        {dialog}
      </div>
    );
  }

  return (
    <>
      <section className="rm-panel p-4">
        <div>
          <div className="rm-card-title">{t("models")}</div>
          <p className="text-sm text-muted">{t("modelCatalogDescription")}</p>
        </div>
        <div className="mt-4 grid gap-4">
          <PanelStats
            items={[
              { label: t("discovered"), value: models.length },
              {
                label: t("available"),
                value: models.filter((model) => model.available !== false)
                  .length,
              },
              {
                label: t("enabled"),
                value: models.filter((model) => model.enabled).length,
              },
              {
                label: t("overridden"),
                value: models.filter(
                  (model) => model.capabilitiesSource === "override",
                ).length,
              },
            ]}
          />
          <div className="rm-model-catalog-toolbar">
            <label className="rm-model-search" htmlFor="model-catalog-search">
              <Search aria-hidden="true" size={15} />
              <Input
                aria-label={t("searchModels")}
                id="model-catalog-search"
                name="modelSearch"
                onChange={(event) =>
                  onNavigationChange({
                    model: null,
                    page: 0,
                    query: event.currentTarget.value,
                  })
                }
                placeholder={t("searchModels")}
                value={query}
              />
            </label>
            <Select
              aria-label={t("filterByProvider")}
              onValueChange={(provider) =>
                onNavigationChange({
                  model: null,
                  page: 0,
                  provider,
                })
              }
              options={[
                { label: t("allConnections"), value: "all" },
                ...providers.map((provider) => ({
                  label: provider.name,
                  value: provider.id,
                })),
              ]}
              value={providerId}
            />
            <Select
              aria-label={t("filterByAvailability")}
              onValueChange={(value) =>
                onNavigationChange({
                  availability: value as typeof availability,
                  model: null,
                  page: 0,
                })
              }
              options={[
                { label: t("allAvailability"), value: "all" },
                { label: t("available"), value: "available" },
                { label: t("unavailable"), value: "unavailable" },
                { label: t("enabled"), value: "enabled" },
                { label: t("disabled"), value: "disabled" },
              ]}
              value={availability}
            />
          </div>
          {catalogQuery.isError ? (
            <div className="rm-empty-state-text p-4" role="alert">
              {t("unableToLoadModels")}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={catalogModels}
              empty={
                catalogQuery.isLoading
                  ? t("loadingModels")
                  : t("noMatchingModels")
              }
              enableRowSelection
              getRowId={(model) => model.id}
              manualFiltering
              manualSorting
              minTableWidth={920}
              onRowActivate={(model) => onNavigationChange({ model: model.id })}
              onSortingChange={(updater) => {
                const next =
                  typeof updater === "function" ? updater(sorting) : updater;
                const first = next[0];
                if (!first) {
                  onNavigationChange({
                    direction: "asc",
                    model: null,
                    page: 0,
                    sort: "displayName",
                  });
                  return;
                }
                const nextSort = (
                  [
                    "availability",
                    "contextWindow",
                    "displayName",
                    "enabled",
                    "name",
                  ].includes(first.id)
                    ? first.id
                    : "displayName"
                ) as ModelSort;
                onNavigationChange({
                  direction: first.desc ? "desc" : "asc",
                  model: null,
                  page: 0,
                  sort: nextSort,
                });
              }}
              preferenceKey="admin-base-models"
              rowAriaLabel={(model) =>
                t("openModel", { name: model.displayName })
              }
              searchVisibility="hidden"
              serverPagination={{
                pageSize,
                hasNextPage: (page + 1) * pageSize < catalogTotal,
                isFetching: catalogQuery.isFetching,
                onNextPage: () =>
                  onNavigationChange({ model: null, page: page + 1 }),
                ...(page > 0
                  ? {
                      onPrevPage: () =>
                        onNavigationChange({ model: null, page: page - 1 }),
                    }
                  : {}),
              }}
              sorting={sorting}
              bulkActions={(ids, clearSelection) => (
                <>
                  <Button
                    disabled={isUpdating}
                    onClick={() =>
                      void updateModelsWithImpact(ids, true).then(
                        clearSelection,
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    {t("enableSelected")}
                  </Button>
                  <Button
                    disabled={isUpdating}
                    onClick={() =>
                      void updateModelsWithImpact(ids, false).then(
                        clearSelection,
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    {t("disableSelected")}
                  </Button>
                </>
              )}
            />
          )}
        </div>
      </section>
      {dialog}
    </>
  );
}
