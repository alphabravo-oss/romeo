import Search from "lucide-react/dist/esm/icons/search.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import { Button, Checkbox, Field, Input, Select, Switch } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { listModelsPage } from "../features/providers/queries";
import type { BaseModel, Provider } from "../features/providers/types";
import { toast } from "../lib/toast";
import { LocalizedTokens } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { CatalogPager } from "./CatalogPager";
import { PanelStats } from "./PanelStats";

const perMillion = 1_000_000;

export function ModelCatalogPanel({
  availability,
  isUpdating,
  models,
  onNavigationChange,
  page,
  providers,
  providerId,
  query,
  selectedModelId,
  onUpdateModel,
  onUpdatePricing,
}: {
  availability: "all" | "enabled" | "disabled";
  isUpdating: boolean;
  models: BaseModel[];
  onNavigationChange: (next: {
    availability?: "all" | "enabled" | "disabled";
    model?: string | null;
    page?: number;
    provider?: string;
    query?: string;
  }) => void;
  page: number;
  providers: Provider[];
  providerId: string;
  query: string;
  selectedModelId: string | undefined;
  onUpdateModel: (
    input:
      | { modelId: string; enabled: boolean }
      | {
          modelId: string;
          capabilities: BaseModel["capabilities"];
          contextWindow: number;
        },
  ) => Promise<void>;
  onUpdatePricing: (input: {
    inputTokenUsd: number;
    modelId: string;
    outputTokenUsd: number;
    imageGenerationUsd?: {
      "1024x1024": number;
      "1024x1536": number;
      "1536x1024": number;
    };
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  const pageSize = 50;
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const catalogQuery = useQuery({
    queryKey: ["models", "catalog", query, providerId, availability, page],
    queryFn: () =>
      listModelsPage({
        limit: pageSize,
        offset: page * pageSize,
        ...(query.trim() === "" ? {} : { query }),
        ...(providerId === "all" ? {} : { providerId }),
        ...(availability === "all"
          ? {}
          : { enabled: availability === "enabled" }),
      }),
    placeholderData: (previous) => previous,
  });
  const catalogModels = catalogQuery.data?.items ?? [];
  const catalogTotal = catalogQuery.data?.total ?? 0;
  const selectedModel = catalogModels.find(
    (model) => model.id === selectedModelId,
  );

  useEffect(() => {
    if (selectedModelId === undefined && catalogModels[0])
      onNavigationChange({ model: catalogModels[0].id });
    else if (
      selectedModelId &&
      !catalogModels.some((model) => model.id === selectedModelId)
    )
      onNavigationChange({ model: catalogModels[0]?.id ?? null });
  }, [catalogModels, onNavigationChange, selectedModelId]);

  return (
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
          <label className="rm-model-search">
            <Search aria-hidden="true" size={15} />
            <Input
              aria-label={t("searchModels")}
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
              { label: t("enabled"), value: "enabled" },
              { label: t("disabled"), value: "disabled" },
            ]}
            value={availability}
          />
        </div>
        <div className="rm-model-catalog-layout">
          <div
            className="rm-model-catalog-list"
            role="listbox"
            aria-label={t("models")}
          >
            {catalogQuery.isLoading ? (
              <div className="rm-empty-state-text p-4">
                {t("loadingModels")}
              </div>
            ) : catalogQuery.isError ? (
              <div className="rm-empty-state-text p-4" role="alert">
                {t("unableToLoadModels")}
              </div>
            ) : catalogTotal === 0 ? (
              <div className="rm-empty-state-text p-4">
                {t("noMatchingModels")}
              </div>
            ) : (
              catalogModels.map((model) => {
                const provider = providerById.get(model.providerId);
                return (
                  <Button
                    aria-selected={model.id === selectedModelId}
                    className={`rm-model-catalog-item ${model.id === selectedModelId ? "selected" : ""}`}
                    key={model.id}
                    onClick={() => onNavigationChange({ model: model.id })}
                    role="option"
                    type="button"
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block truncate">
                        {model.displayName}
                      </strong>
                      <small className="block truncate">
                        {provider?.name ?? model.providerId} ·{" "}
                        <LocalizedTokens value={model.contextWindow} />
                      </small>
                    </span>
                    {model.capabilities.toolCalling ? (
                      <Wrench aria-label={t("toolCalling")} size={14} />
                    ) : null}
                    {model.enabled ? (
                      <Eye aria-label={t("enabled")} size={14} />
                    ) : (
                      <EyeOff aria-label={t("disabled")} size={14} />
                    )}
                  </Button>
                );
              })
            )}
          </div>
          <div className="rm-model-inspector">
            {selectedModel ? (
              <ModelInspector
                isUpdating={isUpdating}
                key={`${selectedModel.id}:${selectedModel.capabilitiesSource ?? "detected"}`}
                model={selectedModel}
                provider={providerById.get(selectedModel.providerId)}
                onUpdateModel={onUpdateModel}
                onUpdatePricing={onUpdatePricing}
              />
            ) : (
              <div className="rm-empty-state-text">
                {t("selectModelToConfigure")}
              </div>
            )}
          </div>
        </div>
        <CatalogPager
          onPageChange={(nextPage) =>
            onNavigationChange({ model: null, page: nextPage })
          }
          page={page}
          pageSize={pageSize}
          total={catalogTotal}
        />
      </div>
    </section>
  );
}

function ModelInspector({
  isUpdating,
  model,
  provider,
  onUpdateModel,
  onUpdatePricing,
}: {
  isUpdating: boolean;
  model: BaseModel;
  provider: Provider | undefined;
  onUpdateModel: Parameters<typeof ModelCatalogPanel>[0]["onUpdateModel"];
  onUpdatePricing: Parameters<typeof ModelCatalogPanel>[0]["onUpdatePricing"];
}) {
  const { t } = useLocale();
  const [capabilities, setCapabilities] = useState(model.capabilities);
  const [contextWindow, setContextWindow] = useState(
    String(model.contextWindow),
  );
  const [inputPrice, setInputPrice] = useState(
    String((model.pricing?.inputTokenUsd ?? 0) * perMillion),
  );
  const [outputPrice, setOutputPrice] = useState(
    String((model.pricing?.outputTokenUsd ?? 0) * perMillion),
  );
  const [imageSquarePrice, setImageSquarePrice] = useState(
    String(model.pricing?.imageGenerationUsd?.["1024x1024"] ?? 0),
  );
  const [imagePortraitPrice, setImagePortraitPrice] = useState(
    String(model.pricing?.imageGenerationUsd?.["1024x1536"] ?? 0),
  );
  const [imageLandscapePrice, setImageLandscapePrice] = useState(
    String(model.pricing?.imageGenerationUsd?.["1536x1024"] ?? 0),
  );
  const capabilityFields = [
    ["streaming", t("streaming")],
    ["toolCalling", t("toolCalling")],
    ["vision", t("vision")],
    ["audioInput", t("audioInput")],
    ["structuredJson", t("structuredJson")],
    ["reasoning", t("reasoning")],
    ["imageGeneration", t("imageGeneration")],
  ] as const;

  function toggle(key: (typeof capabilityFields)[number][0]) {
    setCapabilities((current) => {
      const value = !current[key];
      if (key === "vision")
        return {
          ...current,
          vision: value,
          modalities: value
            ? [...new Set([...current.modalities, "vision" as const])]
            : current.modalities.filter((item) => item !== "vision"),
        };
      if (key === "audioInput")
        return {
          ...current,
          audioInput: value,
          modalities: value
            ? [...new Set([...current.modalities, "audio-input" as const])]
            : current.modalities.filter((item) => item !== "audio-input"),
        };
      return { ...current, [key]: value };
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{model.displayName}</h3>
          <p className="truncate text-xs text-muted">
            {model.name} · {provider?.name ?? model.providerId}
          </p>
        </div>
        <Switch
          checked={model.enabled}
          disabled={isUpdating}
          label={t("enabled")}
          onCheckedChange={(checked) =>
            void onUpdateModel({
              modelId: model.id,
              enabled: checked === true,
            })
          }
        />
      </div>
      <div className="rm-model-meta-grid">
        <span>
          <small>{t("context")}</small>
          <LocalizedTokens value={model.contextWindow} />
        </span>
        <span>
          <small>{t("capabilities")}</small>
          {model.capabilitiesSource === "override"
            ? t("adminOverride")
            : t("detectedDefault")}
        </span>
        <span>
          <small>{t("deployment")}</small>
          {model.capabilities.deployment.mode === "local-runtime"
            ? t("localDeployment")
            : t("hosted")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {capabilityFields.map(([key, label]) => (
          <Checkbox
            checked={capabilities[key] === true}
            key={key}
            label={label}
            onCheckedChange={() => toggle(key)}
          />
        ))}
      </div>
      <Field label={t("contextWindow")}>
        <Input
          min="1"
          onChange={(event) => setContextWindow(event.currentTarget.value)}
          type="number"
          value={contextWindow}
        />
      </Field>
      <Button
        disabled={isUpdating || Number(contextWindow) < 1}
        onClick={() =>
          void onUpdateModel({
            modelId: model.id,
            capabilities,
            contextWindow: Number(contextWindow),
          }).then(() => toast(t("capabilitiesSaved"), "success"))
        }
        pending={isUpdating}
      >
        {t("saveCapabilities")}
      </Button>
      <div className="border-t border-border pt-4">
        <div className="mb-2 text-sm font-medium">{t("modelPricing")}</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("inputUsdPerMillion")}>
            <Input
              min="0"
              onChange={(event) => setInputPrice(event.currentTarget.value)}
              step="0.01"
              type="number"
              value={inputPrice}
            />
          </Field>
          <Field label={t("outputUsdPerMillion")}>
            <Input
              min="0"
              onChange={(event) => setOutputPrice(event.currentTarget.value)}
              step="0.01"
              type="number"
              value={outputPrice}
            />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <ImagePriceInput
            label="1024×1024 USD"
            onChange={setImageSquarePrice}
            value={imageSquarePrice}
          />
          <ImagePriceInput
            label="1024×1536 USD"
            onChange={setImagePortraitPrice}
            value={imagePortraitPrice}
          />
          <ImagePriceInput
            label="1536×1024 USD"
            onChange={setImageLandscapePrice}
            value={imageLandscapePrice}
          />
        </div>
        <Button
          className="mt-2"
          disabled={isUpdating}
          onClick={() =>
            void onUpdatePricing({
              modelId: model.id,
              inputTokenUsd: Number(inputPrice) / perMillion,
              outputTokenUsd: Number(outputPrice) / perMillion,
              imageGenerationUsd: {
                "1024x1024": Number(imageSquarePrice),
                "1024x1536": Number(imagePortraitPrice),
                "1536x1024": Number(imageLandscapePrice),
              },
            }).then(() => toast(t("pricingSaved"), "success"))
          }
          pending={isUpdating}
        >
          {t("savePricing")}
        </Button>
      </div>
    </div>
  );
}

function ImagePriceInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Field label={label}>
      <Input
        min="0"
        onChange={(event) => onChange(event.currentTarget.value)}
        step="0.001"
        type="number"
        value={value}
      />
    </Field>
  );
}
