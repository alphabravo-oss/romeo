import { Button, Input } from "@romeo/ui";
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
  const pinnedIds = [...pinnedModels.keys()];
  const ref = useRef<HTMLDivElement>(null);
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
  const enabledModels = models.filter(
    (model) => model.enabled && enabledProviderIds.has(model.providerId),
  );
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );
  const filteredModels = enabledModels
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
        .includes(query.trim().toLowerCase()),
    );
  filteredModels.sort((left, right) => {
    const pinDifference =
      Number(pinnedIds.includes(right.id)) -
      Number(pinnedIds.includes(left.id));
    return pinDifference || left.displayName.localeCompare(right.displayName);
  });
  const groupedModels = groupModelsByProvider(filteredModels);
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
    const options = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    ).filter((option) => !option.disabled);
    if (options.length === 0) return;
    event.preventDefault();
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : event.key === "ArrowDown"
            ? current < 0
              ? 0
              : (current + 1) % options.length
            : current < 0
              ? options.length - 1
              : (current - 1 + options.length) % options.length;
    options[next]?.focus();
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
          {selectedModel?.displayName ?? "Select model"}
        </span>
        <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
      </Button>

      {open ? (
        <div
          className="rm-composer-model-menu rm-model-menu rm-chat-model-menu"
          onKeyDown={handleModelMenuKeyDown}
          role="listbox"
          style={
            menuMaxHeight === undefined
              ? undefined
              : { maxHeight: menuMaxHeight }
          }
        >
          <label className="rm-chat-model-search">
            <Search aria-hidden="true" size={14} />
            <Input
              aria-label={t("searchModels")}
              autoFocus
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("searchModels")}
              value={query}
            />
          </label>
          <div className="rm-chat-model-filters">
            {(["all", "tools", "vision"] as const).map((filter) => (
              <Button
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
          <div className="rm-chat-model-list">
            {filteredModels.length === 0 ? (
              <div className="p-3 text-sm text-muted">
                {t("noMatchingModels")}
              </div>
            ) : (
              [...groupedModels].map(([groupProviderId, groupModels]) => (
                <div key={groupProviderId}>
                  <div className="rm-chat-model-group">
                    {providerById.get(groupProviderId) ?? groupProviderId}
                  </div>
                  {groupModels.map((model) => (
                    <div className="rm-chat-model-row" key={model.id}>
                      <Button
                        aria-selected={model.id === selectedModelId}
                        className="rm-model-option min-w-0 flex-1"
                        onClick={() => {
                          onSelectModel(model.id);
                          closeModelMenu({ restoreFocus: true });
                        }}
                        role="option"
                        type="button"
                      >
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate">
                            {model.displayName}
                          </span>
                          <small className="block truncate text-muted">
                            {model.capabilities.toolCalling ? "Tools" : "Chat"}
                            {model.capabilities.vision
                              ? " · Vision"
                              : ""} · {formatModelContext(model.contextWindow)}
                          </small>
                        </span>
                        {model.id === selectedModelId ? (
                          <Check aria-hidden="true" size={16} />
                        ) : null}
                      </Button>
                      <Button
                        aria-label={
                          pinnedIds.includes(model.id)
                            ? `Unpin ${model.displayName}`
                            : `Pin ${model.displayName}`
                        }
                        className={`rm-chat-model-pin ${pinnedIds.includes(model.id) ? "active" : ""}`}
                        onClick={() => void togglePinned(model.id)}
                        type="button"
                      >
                        <Star
                          aria-hidden="true"
                          fill={
                            pinnedIds.includes(model.id)
                              ? "currentColor"
                              : "none"
                          }
                          size={14}
                        />
                      </Button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatModelContext(contextWindow: number): string {
  return contextWindow >= 1_000
    ? `${Math.round(contextWindow / 1_000)}k context`
    : `${contextWindow} context`;
}

function groupModelsByProvider(models: BaseModel[]): Map<string, BaseModel[]> {
  const grouped = new Map<string, BaseModel[]>();
  for (const model of models) {
    const group = grouped.get(model.providerId) ?? [];
    group.push(model);
    grouped.set(model.providerId, group);
  }
  return grouped;
}
