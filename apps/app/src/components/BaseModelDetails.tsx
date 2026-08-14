import { Button, Checkbox, Field, Input, StatusBadge, Switch } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { BaseModel, Provider } from "../features/providers/types";
import type { Agent } from "../features/managed-models/types";
import { LocalizedTokens } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { revokeModelShare, shareModel } from "../features/access/api";
import { modelSharesQueryOptions } from "../features/access/query-options";
import { toast } from "../lib/toast";
import { modelConfigIssues } from "../lib/model-config-attention";
import { ResourceGrantEditor } from "./ResourceGrantEditor";
import { ProviderModelCapabilityEvidencePanel } from "./ProviderCapabilityEvidence";
import type { MessageKey } from "../lib/i18n";

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
          defaultParameters?: BaseModel["defaultParameters"];
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
  const sharesQuery = useQuery(modelSharesQueryOptions(model.id));
  const [capabilities, setCapabilities] = useState(model.capabilities);
  const [contextWindow, setContextWindow] = useState(
    String(model.contextWindow),
  );
  const [temperature, setTemperature] = useState(
    model.defaultParameters?.temperature === undefined
      ? ""
      : String(model.defaultParameters.temperature),
  );
  const [topP, setTopP] = useState(
    model.defaultParameters?.topP === undefined
      ? ""
      : String(model.defaultParameters.topP),
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(
    model.defaultParameters?.maxOutputTokens === undefined
      ? ""
      : String(model.defaultParameters.maxOutputTokens),
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
  const showImagePricing =
    capabilities.imageGeneration === true ||
    model.pricing?.imageGenerationUsd !== undefined;
  const attentionIssues = modelConfigIssues(model);
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
      {attentionIssues.length > 0 ? (
        <div className="rm-attention-note" role="status">
          <strong>{t("modelNeedsAttention")}</strong>
          <p>{t("modelNeedsAttentionHelp")}</p>
          <ul>
            {attentionIssues.map((issue) => (
              <li key={issue}>{t(modelIssueMessageKey(issue))}</li>
            ))}
          </ul>
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
      <ProviderModelCapabilityEvidencePanel modelId={model.id} />
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
      {capabilities.temperature === false ? (
        <p className="text-xs text-muted">{t("modelTemperatureUnsupported")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Field label={t("agentTemperature")}>
            <Input
              max={2}
              min={0}
              onChange={(event) => setTemperature(event.currentTarget.value)}
              placeholder={t("modelDefaultUnset")}
              step="0.1"
              type="number"
              value={temperature}
            />
          </Field>
          <Field label={t("agentTopP")}>
            <Input
              max={1}
              min={0}
              onChange={(event) => setTopP(event.currentTarget.value)}
              placeholder={t("modelDefaultUnset")}
              step="0.05"
              type="number"
              value={topP}
            />
          </Field>
          <Field label={t("agentMaxOutputTokens")}>
            <Input
              min={1}
              onChange={(event) =>
                setMaxOutputTokens(event.currentTarget.value)
              }
              placeholder={t("modelDefaultUnset")}
              type="number"
              value={maxOutputTokens}
            />
          </Field>
        </div>
      )}
      {capabilities.temperature === false ? (
        <Field label={t("agentMaxOutputTokens")}>
          <Input
            min={1}
            onChange={(event) => setMaxOutputTokens(event.currentTarget.value)}
            placeholder={t("modelDefaultUnset")}
            type="number"
            value={maxOutputTokens}
          />
        </Field>
      ) : null}
      <Button
        disabled={isUpdating || Number(contextWindow) < 1}
        onClick={() =>
          void onUpdateModel({
            modelId: model.id,
            capabilities,
            contextWindow: Number(contextWindow),
            defaultParameters: parseDefaultParameters(
              capabilities.temperature === false ? "" : temperature,
              capabilities.temperature === false ? "" : topP,
              maxOutputTokens,
            ),
          }).then(() => toast(t("capabilitiesSaved"), "success"))
        }
        pending={isUpdating}
      >
        {t("saveCapabilities")}
      </Button>
      <div className="border-t border-border pt-4">
        <div className="mb-2 text-sm font-medium">{t("modelAccess")}</div>
        <p className="mb-2 text-xs text-muted">{t("modelAccessHelp")}</p>
        <ResourceGrantEditor
          grants={sharesQuery.data ?? []}
          onGrant={(share) => shareModel(model.id, share)}
          onRevoke={(grantId) => revokeModelShare(model.id, grantId)}
          permissionOptions={["use"]}
          queryKey={["modelShares", model.id]}
        />
      </div>
      <div className="border-t border-border pt-4">
        <div className="mb-2 text-sm font-medium">{t("modelPricing")}</div>
        <p className="mb-2 text-xs text-muted">{t("modelTokenPricingHelp")}</p>
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
        {showImagePricing ? (
          <>
            <p className="mb-2 mt-3 text-xs text-muted">
              {t("modelImagePricingHelp")}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <ImagePriceInput
                label={t("modelImagePriceSquare")}
                onChange={setImageSquarePrice}
                value={imageSquarePrice}
              />
              <ImagePriceInput
                label={t("modelImagePricePortrait")}
                onChange={setImagePortraitPrice}
                value={imagePortraitPrice}
              />
              <ImagePriceInput
                label={t("modelImagePriceLandscape")}
                onChange={setImageLandscapePrice}
                value={imageLandscapePrice}
              />
            </div>
          </>
        ) : null}
        <Button
          className="mt-2"
          disabled={isUpdating}
          onClick={() =>
            void onUpdatePricing({
              modelId: model.id,
              inputTokenUsd: Number(inputPrice) / perMillion,
              outputTokenUsd: Number(outputPrice) / perMillion,
              ...(showImagePricing
                ? {
                    imageGenerationUsd: {
                      "1024x1024": Number(imageSquarePrice),
                      "1024x1536": Number(imagePortraitPrice),
                      "1536x1024": Number(imageLandscapePrice),
                    },
                  }
                : {}),
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

function modelIssueMessageKey(
  issue: ReturnType<typeof modelConfigIssues>[number],
): MessageKey {
  if (issue === "missing_pricing") return "modelIssueMissingPricing";
  if (issue === "invalid_context_window") return "modelIssueInvalidContext";
  if (issue === "missing_max_output") return "modelIssueMissingMaxOutput";
  return "modelIssueUnavailable";
}

function parseDefaultParameters(
  temperature: string,
  topP: string,
  maxOutputTokens: string,
): BaseModel["defaultParameters"] | undefined {
  const parameters: NonNullable<BaseModel["defaultParameters"]> = {};
  const parsedTemperature = Number(temperature);
  if (temperature.trim() !== "" && Number.isFinite(parsedTemperature)) {
    parameters.temperature = parsedTemperature;
  }
  const parsedTopP = Number(topP);
  if (topP.trim() !== "" && Number.isFinite(parsedTopP)) {
    parameters.topP = parsedTopP;
  }
  const parsedMax = Number(maxOutputTokens);
  if (
    maxOutputTokens.trim() !== "" &&
    Number.isInteger(parsedMax) &&
    parsedMax > 0
  ) {
    parameters.maxOutputTokens = parsedMax;
  }
  return Object.keys(parameters).length === 0 ? undefined : parameters;
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
