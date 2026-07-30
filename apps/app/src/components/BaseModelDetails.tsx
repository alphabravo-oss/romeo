import { Button, Checkbox, Field, Input, StatusBadge, Switch } from "@romeo/ui";
import { useState } from "react";

import type { BaseModel, Provider } from "../features/providers/types";
import type { Agent } from "../features/managed-models/types";
import { LocalizedTokens } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";

const perMillion = 1_000_000;

export interface BaseModelDetailsProps {
  isUpdating: boolean;
  dependentAgents: Agent[];
  model: BaseModel;
  provider: Provider | undefined;
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
}

export function BaseModelDetails({
  isUpdating,
  dependentAgents,
  model,
  provider,
  onUpdateModel,
  onUpdatePricing,
}: BaseModelDetailsProps) {
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
      {model.available === false ? (
        <div className="rm-connection-result error" role="status">
          <span>{t("modelUnavailableDescription")}</span>
        </div>
      ) : null}
      <div className="rm-model-meta-grid">
        <span>
          <small>{t("availability")}</small>
          <StatusBadge tone={model.available === false ? "danger" : "success"}>
            {model.available === false ? t("unavailable") : t("available")}
          </StatusBadge>
        </span>
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
        <span>
          <small>{t("modelDependentAssistants")}</small>
          {dependentAgents.length}
        </span>
      </div>
      {dependentAgents.length > 0 ? (
        <div className="rounded-md border border-border p-3 text-sm">
          <strong>{t("dependencyImpact")}</strong>
          <p className="mt-1 text-muted">
            {dependentAgents.map((agent) => agent.name).join(", ")}
          </p>
        </div>
      ) : null}
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
          <ImagePriceInput
            label={t("inputUsdPerMillion")}
            onChange={setInputPrice}
            value={inputPrice}
          />
          <ImagePriceInput
            label={t("outputUsdPerMillion")}
            onChange={setOutputPrice}
            value={outputPrice}
          />
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
