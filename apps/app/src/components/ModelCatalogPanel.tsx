import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import { Button, Select } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { BaseModel } from "../features/providers/types";
import { useLocale } from "../lib/i18n";
import { appHref } from "../lib/app-href";
import { modelConfigIssues } from "../lib/model-config-attention";
import {
  resolveModelCatalogRouteState,
  updateModelCatalogRouteState,
} from "../lib/model-catalog-route-state";
import { Section, StatRow } from "./console";
import { BaseModelDetails } from "./BaseModelDetails";
import { DataTable } from "./DataTable";
import { CreateManagedModelDialog } from "./CreateManagedModelDialog";
import { useConfirm } from "./ConfirmDialog";
import { ModelCatalogDiagnostics } from "./ModelCatalogDiagnostics";
import { RoutedTableSearchInput } from "./RoutedTableSearchInput";
import type {
  ModelCatalogPanelProps,
  ModelCatalogNavigationUpdate,
  ModelSort,
} from "./model-catalog-navigation";
import { useModelCatalogColumns } from "./model-catalog-columns";
import {
  modelCatalogQueryOptions,
  modelCatalogRequest,
} from "./model-catalog-query";

export function ModelCatalogPanel({
  agents,
  isUpdating,
  models,
  providers,
  routeSearch,
  onUpdateModel,
  onUpdatePricing,
  onManagedModelCreated,
  workspaceId,
}: ModelCatalogPanelProps) {
  const navigate = useNavigate({ from: "/admin" });
  const { availability, direction, page, providerId, query, sort } =
    resolveModelCatalogRouteState(routeSearch);
  const selectedModelId = routeSearch.model;
  const onNavigationChange = useCallback(
    (next: ModelCatalogNavigationUpdate) =>
      void navigate({
        search: (previous) => {
          const {
            availability: _availability,
            direction: _direction,
            page: _page,
            provider: _provider,
            query: _query,
            sort: _sort,
            model: previousModel,
            ...rest
          } = previous;
          const model = next.model === undefined ? previousModel : next.model;
          return {
            ...rest,
            section: "providers",
            view: "base-models",
            table: updateModelCatalogRouteState(previous, next),
            ...(model ? { model } : {}),
          };
        },
      }),
    [navigate],
  );
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const commitSearch = useCallback(
    (nextQuery: string) =>
      onNavigationChange({ model: null, page: 0, query: nextQuery }),
    [onNavigationChange],
  );
  const catalogRequest = modelCatalogRequest({
    availability,
    direction,
    page,
    providerId,
    query,
    sort,
  });
  const pageSize = catalogRequest.limit;
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const catalogQuery = useQuery(
    modelCatalogQueryOptions({
      availability,
      direction,
      page,
      providerId,
      query,
      sort,
    }),
  );
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
            defaultParameters?: BaseModel["defaultParameters"];
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
  const columns = useModelCatalogColumns({
    isUpdating,
    providerById,
    updateModelWithImpact,
  });

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
        <Section>
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
              <ModelCatalogDiagnostics
                model={selectedModel}
                provider={providerById.get(selectedModel.providerId)}
              />
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
        </Section>
        {dialog}
      </div>
    );
  }
  return (
    <>
      <section>
        <div>
          <div className="rm-card-title">{t("models")}</div>
          <p className="text-sm text-muted">{t("modelCatalogDescription")}</p>
        </div>
        <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <StatRow
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
              {
                label: t("modelNeedsAttention"),
                value: models.filter(
                  (model) => modelConfigIssues(model).length > 0,
                ).length,
              },
            ]}
          />
          <div className="rm-model-catalog-toolbar">
            <label className="rm-model-search" htmlFor="model-catalog-search">
              <Search aria-hidden="true" size={15} />
              <RoutedTableSearchInput
                ariaLabel={t("searchModels")}
                id="model-catalog-search"
                key={query}
                name="modelSearch"
                onCommit={commitSearch}
                placeholder={t("searchModels")}
                routeValue={query}
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
              minTableWidth={1280}
              onRowActivate={(model) => onNavigationChange({ model: model.id })}
              rowHref={(model) =>
                appHref("/admin", {
                  availability,
                  direction,
                  model: model.id,
                  page,
                  provider: providerId,
                  query,
                  section: "providers",
                  sort,
                  view: "base-models",
                  workspace: workspaceId,
                })
              }
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
