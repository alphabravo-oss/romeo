import { Button, Input } from "@romeo/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { deleteFavorite, favoriteResource, listFavorites } from "../features";
import type { BaseModel, Provider } from "../features/types";
import { useLocale } from "../lib/i18n";

export function ComposerModelSelect({
  disabled,
  models,
  providers,
  onSelectModel,
  selectedModelId,
}: {
  disabled: boolean;
  models: BaseModel[];
  providers: Provider[];
  onSelectModel: (modelId: string) => void;
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
  const pickerRows = useMemo(
    () => modelPickerRows(filteredModels, providerById),
    [filteredModels, providerById],
  );
  const modelRowIndexes = useMemo(
    () =>
      pickerRows.flatMap((row, index) => (row.kind === "model" ? [index] : [])),
    [pickerRows],
  );
  const rowVirtualizer = useVirtualizer({
    count: pickerRows.length,
    estimateSize: (index) => (pickerRows[index]?.kind === "provider" ? 32 : 56),
    getItemKey: (index) => pickerRows[index]?.id ?? index,
    getScrollElement: () => listRef.current,
    overscan: 8,
  });
  const selectedModel = enabledModels.find(
    (model) => model.id === selectedModelId,
  );

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
    setMenuMaxHeight(Math.max(120, Math.floor(available)));
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
      (row) => row.kind === "model" && row.model.id === activeModelId,
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
    if (nextRowIndex === undefined || nextRow?.kind !== "model") return;
    rowVirtualizer.scrollToIndex(nextRowIndex, { align: "auto" });
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        ref.current
          ?.querySelector<HTMLButtonElement>(
            `[data-model-id="${CSS.escape(nextRow.model.id)}"]`,
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

  if (enabledModels.length === 0) return null;

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
        <span className="truncate">
          {selectedModel?.displayName ?? t("selectModel")}
        </span>
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
            {filteredModels.length === 0 ? (
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
                      ) : (
                        <ModelPickerOption
                          closeModelMenu={closeModelMenu}
                          model={row.model}
                          onSelectModel={onSelectModel}
                          pinned={pinnedIds.has(row.model.id)}
                          selected={row.model.id === selectedModelId}
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
  model,
  onSelectModel,
  pinned,
  selected,
  togglePinned,
}: {
  closeModelMenu: (options?: { restoreFocus?: boolean }) => void;
  model: BaseModel;
  onSelectModel: (modelId: string) => void;
  pinned: boolean;
  selected: boolean;
  togglePinned: (modelId: string) => Promise<void>;
}) {
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
        <span className="min-w-0 flex-1 text-left">
          <span
            className="rm-chat-model-name"
            title={model.displayName}
            translate="no"
          >
            {model.displayName}
          </span>
          <small className="rm-chat-model-meta">
            {model.capabilities.toolCalling ? "Tools" : "Chat"}
            {model.capabilities.vision ? " · Vision" : ""} ·{" "}
            {formatModelContext(model.contextWindow)}
          </small>
        </span>
        {selected ? <Check aria-hidden="true" size={16} /> : null}
      </Button>
      <Button
        aria-label={
          pinned ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`
        }
        className={`rm-chat-model-pin ${pinned ? "active" : ""}`}
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

function formatModelContext(contextWindow: number): string {
  return contextWindow >= 1_000
    ? `${Math.round(contextWindow / 1_000)}k context`
    : `${contextWindow} context`;
}

type ModelPickerRow =
  | { id: string; kind: "provider"; label: string }
  | { id: string; kind: "model"; model: BaseModel };

function modelPickerRows(
  models: BaseModel[],
  providerById: Map<string, string>,
): ModelPickerRow[] {
  const grouped = new Map<string, BaseModel[]>();
  for (const model of models) {
    const group = grouped.get(model.providerId) ?? [];
    group.push(model);
    grouped.set(model.providerId, group);
  }
  return [...grouped].flatMap(([providerId, providerModels]) => [
    {
      id: `provider:${providerId}`,
      kind: "provider" as const,
      label: providerById.get(providerId) ?? providerId,
    },
    ...providerModels.map((model) => ({
      id: `model:${model.id}`,
      kind: "model" as const,
      model,
    })),
  ]);
}
