import { Button, Input } from "@romeo/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { deleteFavorite, favoriteResource, listFavorites } from "../features";
import type { AgentGalleryItem } from "../features/managed-models";
import type { BaseModel, Provider } from "../features/types";
import { useLocale } from "../lib/i18n";
import {
  CustomModelPickerOption,
  ModelPickerOption,
  modelPickerRows,
  selectableRowId,
} from "./composer-model-picker-options";
import { type ModelCapabilityFilter } from "./composer-model-capability-filter";
import { useComposerModelOptions } from "./use-composer-model-options";

export { formatModelPricing } from "./composer-model-picker-options";

export function ComposerModelSelect({
  customModels = [],
  defaultModelId,
  disabled,
  models,
  providers,
  onSelectCustomModel,
  onSelectModel,
  onToggleDefaultModel,
  requiresReasoning,
  requiresTools,
  requiresVision,
  requiresLocalOnly,
  minContextWindow,
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
  requiresReasoning: boolean;
  requiresTools?: boolean;
  requiresVision: boolean;
  requiresLocalOnly?: boolean;
  minContextWindow?: number;
  selectedCustomModelId?: string;
  selectedModelId: string | undefined;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [capabilityFilter, setCapabilityFilter] =
    useState<ModelCapabilityFilter>("all");
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>();
  const [pinnedModels, setPinnedModels] = useState<Map<string, string>>(
    () => new Map(),
  );
  const pinnedIds = useMemo(() => new Set(pinnedModels.keys()), [pinnedModels]);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const {
    enabledModels,
    filteredCustomModels,
    filteredModels,
    readyCustomModels,
  } = useComposerModelOptions({
      models,
      providers,
      customModels,
      query,
      capabilityFilter,
      pinnedIds,
      requiresReasoning,
      requiresVision,
      requiresTools,
      requiresLocalOnly,
      minContextWindow,
    });
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
  const requiredCapabilities = [
    requiresReasoning ? t("reasoning") : undefined,
    requiresVision ? t("vision") : undefined,
  ].filter((value): value is string => value !== undefined);

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
            {(["all", "economy", "reasoning", "tools", "vision"] as const).map(
              (filter) => (
                <Button
                  aria-pressed={capabilityFilter === filter}
                  className={capabilityFilter === filter ? "active" : ""}
                  key={filter}
                  onClick={() => setCapabilityFilter(filter)}
                  type="button"
                >
                  {filter === "all"
                    ? t("all")
                    : filter === "economy"
                      ? t("economy")
                      : filter === "reasoning"
                        ? t("reasoning")
                        : filter === "tools"
                          ? t("tools")
                          : t("vision")}
                </Button>
              ),
            )}
          </div>
          {requiredCapabilities.length > 0 ? (
            <p className="text-sm text-muted" role="status">
              {t("turnRequiresCapabilities", {
                capabilities: requiredCapabilities.join(", "),
              })}
            </p>
          ) : null}
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
