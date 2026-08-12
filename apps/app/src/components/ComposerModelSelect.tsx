import { Button, Input } from "@romeo/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Pin from "lucide-react/dist/esm/icons/pin.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { deleteFavorite, favoriteResource, listFavorites } from "../features";
import type { AgentGalleryItem } from "../features/managed-models";
import type { BaseModel, Provider } from "../features/types";
import { useLocale } from "../lib/i18n";
import { isGenericCustomModelName } from "./chat-enterprise";

export function ComposerModelSelect({
  customModels = [],
  defaultModelId,
  disabled,
  models,
  providers,
  onSelectCustomModel,
  onSelectModel,
  onToggleDefaultModel,
  selectedCustomModelId,
  selectedModelId,
}: {
  customModels?: AgentGalleryItem[];
  defaultModelId: string | undefined;
  disabled: boolean;
  models: BaseModel[];
  providers: Provider[];
  onSelectCustomModel?: (agentId: string, baseModelId: string) => void;
  onSelectModel: (modelId: string) => void;
  onToggleDefaultModel: (modelId: string) => void;
  selectedCustomModelId?: string;
  selectedModelId: string | undefined;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState<
    "all" | "tools" | "vision"
  >("all");
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>();
  const [pinnedModels, setPinnedModels] = useState<Map<string, string>>(
    () => new Map(),
  );
  const pinnedIds = useMemo(() => new Set(pinnedModels.keys()), [pinnedModels]);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const enabledProviderIds = useMemo(
    () =>
      new Set(
        providers
          .filter((provider) => provider.enabled)
          .map((provider) => provider.id),
      ),
    [providers],
  );
  const enabledModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.available !== false &&
          enabledProviderIds.has(model.providerId),
      ),
    [enabledProviderIds, models],
  );
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const readyCustomModels = useMemo(
    () =>
      customModels.filter(
        (agent) =>
          agent.readinessStatus === "ready" &&
          !isGenericCustomModelName(agent.name),
      ),
    [customModels],
  );
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return enabledModels
      .filter((model) =>
        capabilityFilter === "vision"
          ? model.capabilities.vision
          : capabilityFilter === "tools"
            ? model.capabilities.toolCalling
            : true,
      )
      .filter((model) =>
        `${model.displayName} ${model.name} ${model.providerId}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .sort((left, right) => {
        const pinDifference =
          Number(pinnedIds.has(right.id)) - Number(pinnedIds.has(left.id));
        return (
          pinDifference || left.displayName.localeCompare(right.displayName)
        );
      });
  }, [capabilityFilter, enabledModels, pinnedIds, query]);
  const filteredCustomModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return readyCustomModels.filter((agent) => {
      const base = enabledModels.find(
        (model) => model.id === agent.baseModelId,
      );
      if (capabilityFilter === "vision" && base?.capabilities.vision !== true)
        return false;
      if (
        capabilityFilter === "tools" &&
        base?.capabilities.toolCalling !== true
      )
        return false;
      return `${agent.name} ${agent.description ?? ""} ${base?.displayName ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [capabilityFilter, enabledModels, query, readyCustomModels]);
  const pickerRows = useMemo(
    () =>
      modelPickerRows(
        filteredModels,
        providerById,
        filteredCustomModels,
        t("modelGroupCustom"),
      ),
    [filteredCustomModels, filteredModels, providerById, t],
  );
  const modelRowIndexes = useMemo(
    () =>
      pickerRows.flatMap((row, index) =>
        row.kind === "provider" ? [] : [index],
      ),
    [pickerRows],
  );
  const rowVirtualizer = useVirtualizer({
    count: pickerRows.length,
    estimateSize: (index) => (pickerRows[index]?.kind === "provider" ? 28 : 40),
    getItemKey: (index) => pickerRows[index]?.id ?? index,
    getScrollElement: () => listRef.current,
    overscan: 8,
  });
  const selectedCustomModel = readyCustomModels.find(
    (agent) => agent.id === selectedCustomModelId,
  );
  const selectedModel = enabledModels.find(
    (model) => model.id === selectedModelId,
  );
  const triggerLabel =
    selectedCustomModel?.name ?? selectedModel?.displayName ?? t("selectModel");

  function closeModelMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function measureMenuMaxHeight() {
    const headerHeight = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--rm-shell-header-height",
      ),
    );
    const safeHeaderHeight = Number.isFinite(headerHeight) ? headerHeight : 60;
    const compact = window.matchMedia("(max-width: 900px)").matches;
    const available = compact
      ? window.innerHeight - safeHeaderHeight - 92
      : (triggerRef.current?.getBoundingClientRect().top ??
          window.innerHeight) -
        safeHeaderHeight -
        12;
    // Cap hard: a near-viewport menu reads as a sheet, not a picker.
    setMenuMaxHeight(Math.max(160, Math.min(320, Math.floor(available))));
  }

  function handleModelMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModelMenu({ restoreFocus: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (modelRowIndexes.length === 0) return;
    event.preventDefault();
    const activeModelId = (document.activeElement as HTMLElement | null)
      ?.dataset.modelId;
    const currentRow = pickerRows.findIndex(
      (row) => selectableRowId(row) === activeModelId,
    );
    const current = modelRowIndexes.indexOf(currentRow);
    const nextPosition =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? modelRowIndexes.length - 1
          : event.key === "ArrowDown"
            ? current < 0
              ? 0
              : (current + 1) % modelRowIndexes.length
            : current < 0
              ? modelRowIndexes.length - 1
              : (current - 1 + modelRowIndexes.length) % modelRowIndexes.length;
    const nextRowIndex = modelRowIndexes[nextPosition];
    const nextRow = pickerRows[nextRowIndex ?? -1];
    const nextId = nextRow === undefined ? undefined : selectableRowId(nextRow);
    if (nextRowIndex === undefined || nextId === undefined) return;
    rowVirtualizer.scrollToIndex(nextRowIndex, { align: "auto" });
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        ref.current
          ?.querySelector<HTMLButtonElement>(
            `[data-model-id="${CSS.escape(nextId)}"]`,
          )
          ?.focus(),
      ),
    );
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measureMenuMaxHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!open || !window.matchMedia("(pointer: fine)").matches) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void listFavorites().then((favorites) => {
      if (!active) return;
      setPinnedModels(
        new Map(
          favorites
            .filter((favorite) => favorite.resourceType === "model")
            .map((favorite) => [favorite.resourceId, favorite.id]),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [open]);

  if (enabledModels.length === 0 && readyCustomModels.length === 0) return null;

  async function togglePinned(modelId: string) {
    const favoriteId = pinnedModels.get(modelId);
    if (favoriteId !== undefined) {
      await deleteFavorite(favoriteId);
      setPinnedModels((current) => {
        const next = new Map(current);
        next.delete(modelId);
        return next;
      });
      return;
    }
    const favorite = await favoriteResource({
      resourceType: "model",
      resourceId: modelId,
    });
    setPinnedModels((current) => new Map(current).set(modelId, favorite.id));
  }

  return (
    <div className="rm-composer-model-selector" ref={ref}>
      <Button
        aria-label={t("chooseModel")}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="rm-composer-model-select"
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeModelMenu();
            return;
          }
          measureMenuMaxHeight();
          setOpen(true);
        }}
        ref={triggerRef}
        title={t("chooseModelTitle")}
        type="button"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
      </Button>

      {open ? (
        // Keyboard handling belongs on the composite dialog so arrows work
        // consistently from its search, filters, and virtualized listbox.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          className="rm-composer-model-menu rm-model-menu rm-chat-model-menu"
          aria-label={t("chooseModel")}
          onKeyDown={handleModelMenuKeyDown}
          role="dialog"
          tabIndex={-1}
          style={
            menuMaxHeight === undefined
              ? undefined
              : { maxHeight: menuMaxHeight }
          }
        >
          <label
            className="rm-chat-model-search"
            htmlFor="composer-model-search"
          >
            <Search aria-hidden="true" size={14} />
            <Input
              aria-label={t("searchModels")}
              autoComplete="off"
              id="composer-model-search"
              name="model-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("searchModels")}
              ref={searchRef}
              value={query}
            />
          </label>
          <div className="rm-chat-model-filters">
            {(["all", "tools", "vision"] as const).map((filter) => (
              <Button
                aria-pressed={capabilityFilter === filter}
                className={capabilityFilter === filter ? "active" : ""}
                key={filter}
                onClick={() => setCapabilityFilter(filter)}
                type="button"
              >
                {filter === "all"
                  ? t("all")
                  : filter === "tools"
                    ? t("tools")
                    : t("vision")}
              </Button>
            ))}
          </div>
          <div
            aria-label={t("models")}
            className="rm-chat-model-list"
            ref={listRef}
            role="listbox"
          >
            {filteredModels.length === 0 &&
            filteredCustomModels.length === 0 ? (
              <div className="p-3 text-sm text-muted">
                {t("noMatchingModels")}
              </div>
            ) : (
              <div
                className="rm-chat-model-virtual-canvas"
                style={{ height: rowVirtualizer.getTotalSize() }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = pickerRows[virtualRow.index];
                  if (row === undefined) return null;
                  return (
                    <div
                      className="rm-chat-model-virtual-row"
                      data-index={virtualRow.index}
                      key={row.id}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {row.kind === "provider" ? (
                        <div
                          className="rm-chat-model-group"
                          role="presentation"
                        >
                          {row.label}
                        </div>
                      ) : row.kind === "custom" ? (
                        <CustomModelPickerOption
                          agent={row.agent}
                          baseLabel={
                            row.base === undefined
                              ? undefined
                              : t("modelBasedOn", {
                                  name: row.base.displayName,
                                })
                          }
                          closeModelMenu={closeModelMenu}
                          onSelect={() =>
                            onSelectCustomModel === undefined
                              ? onSelectModel(row.agent.baseModelId)
                              : onSelectCustomModel(
                                  row.agent.id,
                                  row.agent.baseModelId,
                                )
                          }
                          selected={row.agent.id === selectedCustomModelId}
                        />
                      ) : (
                        <ModelPickerOption
                          closeModelMenu={closeModelMenu}
                          isDefault={row.model.id === defaultModelId}
                          model={row.model}
                          onSelectModel={onSelectModel}
                          onToggleDefaultModel={onToggleDefaultModel}
                          pinned={pinnedIds.has(row.model.id)}
                          selected={
                            selectedCustomModel === undefined &&
                            row.model.id === selectedModelId
                          }
                          togglePinned={togglePinned}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelPickerOption({
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

function CustomModelPickerOption({
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

type ModelPickerRow =
  | { id: string; kind: "provider"; label: string }
  | { id: string; kind: "model"; model: BaseModel }
  | {
      id: string;
      kind: "custom";
      agent: AgentGalleryItem;
      base: BaseModel | undefined;
    };

function selectableRowId(row: ModelPickerRow): string | undefined {
  if (row.kind === "model") return row.model.id;
  if (row.kind === "custom") return `agent:${row.agent.id}`;
  return undefined;
}

function modelPickerRows(
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
