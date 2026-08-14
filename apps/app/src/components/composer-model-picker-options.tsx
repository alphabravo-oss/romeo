import { Button } from "@romeo/ui";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Pin from "lucide-react/dist/esm/icons/pin.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";

import type { AgentGalleryItem } from "../features/managed-models";
import type { BaseModel } from "../features/types";
import { useLocale } from "../lib/i18n";

export function ModelPickerOption({
  closeModelMenu,
  isDefault,
  model,
  onSelectModel,
  onToggleDefaultModel,
  pinned,
  selected,
  togglePinned,
}: {
  closeModelMenu: (options?: { restoreFocus?: boolean }) => void;
  isDefault: boolean;
  model: BaseModel;
  onSelectModel: (modelId: string) => void;
  onToggleDefaultModel: (modelId: string) => void;
  pinned: boolean;
  selected: boolean;
  togglePinned: (modelId: string) => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <div className={`rm-chat-model-row ${selected ? "selected" : ""}`}>
      <Button
        aria-selected={selected}
        className="rm-model-option min-w-0 flex-1"
        data-model-id={model.id}
        onClick={() => {
          onSelectModel(model.id);
          closeModelMenu({ restoreFocus: true });
        }}
        role="option"
        type="button"
      >
        <span className="rm-chat-model-copy">
          <span
            className="rm-chat-model-name"
            title={model.displayName}
            translate="no"
          >
            {model.displayName}
          </span>
          <small className="rm-chat-model-meta">
            {isDefault ? `${t("defaultModelBadge")} · ` : ""}
            {model.capabilities.toolCalling ? "Tools" : "Chat"}
            {model.capabilities.vision ? " · Vision" : ""} ·{" "}
            {formatModelContext(model.contextWindow)}
            {model.pricing === undefined
              ? ""
              : ` · ${formatModelPricing(model.pricing)}`}
          </small>
        </span>
        {selected ? (
          <Check aria-hidden="true" className="rm-chat-model-check" size={14} />
        ) : null}
      </Button>
      <Button
        aria-label={
          isDefault ? t("assistantClearDefault") : t("assistantMakeDefault")
        }
        className={`rm-chat-model-action rm-chat-model-default ${isDefault ? "active" : ""}`}
        onClick={() => onToggleDefaultModel(model.id)}
        title={
          isDefault ? t("assistantClearDefault") : t("assistantMakeDefault")
        }
        type="button"
      >
        <Pin
          aria-hidden="true"
          fill={isDefault ? "currentColor" : "none"}
          size={13}
        />
      </Button>
      <Button
        aria-label={
          pinned ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`
        }
        className={`rm-chat-model-action rm-chat-model-pin ${pinned ? "active" : ""}`}
        onClick={() => void togglePinned(model.id)}
        type="button"
      >
        <Star
          aria-hidden="true"
          fill={pinned ? "currentColor" : "none"}
          size={14}
        />
      </Button>
    </div>
  );
}

export function CustomModelPickerOption({
  agent,
  baseLabel,
  closeModelMenu,
  onSelect,
  selected,
}: {
  agent: AgentGalleryItem;
  baseLabel: string | undefined;
  closeModelMenu: (options?: { restoreFocus?: boolean }) => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <div className={`rm-chat-model-row ${selected ? "selected" : ""}`}>
      <Button
        aria-selected={selected}
        className="rm-model-option min-w-0 flex-1"
        data-model-id={`agent:${agent.id}`}
        onClick={() => {
          onSelect();
          closeModelMenu({ restoreFocus: true });
        }}
        role="option"
        type="button"
      >
        <span className="rm-chat-model-copy">
          <span
            className="rm-chat-model-name"
            title={agent.name}
            translate="no"
          >
            {agent.name}
          </span>
          {baseLabel === undefined ? null : (
            <small className="rm-chat-model-meta">{baseLabel}</small>
          )}
        </span>
        {selected ? (
          <Check aria-hidden="true" className="rm-chat-model-check" size={14} />
        ) : null}
      </Button>
    </div>
  );
}

function formatModelContext(contextWindow: number): string {
  return contextWindow >= 1_000
    ? `${Math.round(contextWindow / 1_000)}k context`
    : `${contextWindow} context`;
}

export function formatModelPricing(
  pricing: NonNullable<BaseModel["pricing"]>,
): string {
  return `$${formatPerMillion(pricing.inputTokenUsd)}/$${formatPerMillion(pricing.outputTokenUsd)} per 1M`;
}

function formatPerMillion(perTokenUsd: number): string {
  const perMillion = perTokenUsd * 1_000_000;
  return perMillion.toLocaleString("en-US", {
    maximumFractionDigits: perMillion < 1 ? 3 : 2,
    minimumFractionDigits: 0,
  });
}

export function modelUnitCost(model: BaseModel): number {
  if (model.pricing === undefined) return Number.POSITIVE_INFINITY;
  return model.pricing.inputTokenUsd + model.pricing.outputTokenUsd;
}

export type ModelPickerRow =
  | { id: string; kind: "provider"; label: string }
  | { id: string; kind: "model"; model: BaseModel }
  | {
      id: string;
      kind: "custom";
      agent: AgentGalleryItem;
      base: BaseModel | undefined;
    };

export function selectableRowId(row: ModelPickerRow): string | undefined {
  if (row.kind === "model") return row.model.id;
  if (row.kind === "custom") return `agent:${row.agent.id}`;
  return undefined;
}

export function modelPickerRows(
  models: BaseModel[],
  providerById: Map<string, string>,
  customModels: AgentGalleryItem[],
  customGroupLabel: string,
): ModelPickerRow[] {
  const rows: ModelPickerRow[] = [];
  if (customModels.length > 0) {
    rows.push({
      id: "provider:custom",
      kind: "provider",
      label: customGroupLabel,
    });
    const baseById = new Map(models.map((model) => [model.id, model]));
    for (const agent of customModels) {
      rows.push({
        id: `custom:${agent.id}`,
        kind: "custom",
        agent,
        base: baseById.get(agent.baseModelId),
      });
    }
  }
  const grouped = new Map<string, BaseModel[]>();
  for (const model of models) {
    const group = grouped.get(model.providerId) ?? [];
    group.push(model);
    grouped.set(model.providerId, group);
  }
  for (const [providerId, providerModels] of grouped) {
    rows.push({
      id: `provider:${providerId}`,
      kind: "provider",
      label: providerById.get(providerId) ?? providerId,
    });
    for (const model of providerModels) {
      rows.push({
        id: `model:${model.id}`,
        kind: "model",
        model,
      });
    }
  }
  return rows;
}
