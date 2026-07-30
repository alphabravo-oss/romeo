import { DropdownMenuPrimitive, Input } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Pin from "lucide-react/dist/esm/icons/pin.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import { useMemo, useState } from "react";

import { deleteFavorite, favoriteResource, listFavorites } from "../features";
import {
  getServerInterfacePreferences,
  updateServerInterfacePreferences,
} from "../features/interface-preferences";
import type { AgentGalleryItem } from "../features/managed-models";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { ManagedModelAvatar } from "./ManagedModelAvatar";

export default function ModelSelectorMenu({
  activeAgentId,
  agents,
  onSelectAgent,
  workspaceId,
}: {
  activeAgentId: string | undefined;
  agents: AgentGalleryItem[];
  onSelectAgent: (agentId: string) => void;
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: listFavorites,
  });
  const favoriteMutation = useMutation({ mutationFn: favoriteResource });
  const deleteFavoriteMutation = useMutation({ mutationFn: deleteFavorite });
  const interfacePreferencesQuery = useQuery({
    queryKey: ["interfacePreferences"],
    queryFn: getServerInterfacePreferences,
  });
  const defaultMutation = useMutation({
    mutationFn: updateServerInterfacePreferences,
  });
  const agentFavoriteIds = useMemo(
    () =>
      new Map(
        (favoritesQuery.data ?? [])
          .filter((favorite) => favorite.resourceType === "agent")
          .map((favorite) => [favorite.resourceId, favorite.id]),
      ),
    [favoritesQuery.data],
  );
  const visibleAgents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return agents
      .filter((agent) =>
        needle === ""
          ? true
          : [agent.name, agent.description]
              .filter(Boolean)
              .some((value) => value!.toLocaleLowerCase().includes(needle)),
      )
      .sort(
        (left, right) =>
          Number(agentFavoriteIds.has(right.id) || right.favorite) -
            Number(agentFavoriteIds.has(left.id) || left.favorite) ||
          left.name.localeCompare(right.name),
      );
  }, [agentFavoriteIds, agents, query]);
  const favoriteCount = visibleAgents.filter(
    (agent) => agentFavoriteIds.has(agent.id) || agent.favorite,
  ).length;

  async function toggleFavorite(agentId: string) {
    try {
      const favoriteId = agentFavoriteIds.get(agentId);
      if (favoriteId === undefined) {
        await favoriteMutation.mutateAsync({
          resourceType: "agent",
          resourceId: agentId,
        });
      } else {
        await deleteFavoriteMutation.mutateAsync(favoriteId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["favorites"] }),
        queryClient.invalidateQueries({
          queryKey: ["agentGallery", workspaceId],
        }),
      ]);
    } catch {
      toast(t("assistantFavoriteFailed"), "error");
    }
  }

  async function toggleDefault(agentId: string) {
    if (workspaceId === undefined) return;
    const current =
      interfacePreferencesQuery.data?.defaultAgentByWorkspace ?? {};
    const next = { ...current };
    if (next[workspaceId] === agentId) delete next[workspaceId];
    else next[workspaceId] = agentId;
    try {
      await defaultMutation.mutateAsync({ defaultAgentByWorkspace: next });
      await queryClient.invalidateQueries({
        queryKey: ["interfacePreferences"],
      });
    } catch {
      toast(t("assistantDefaultFailed"), "error");
    }
  }

  function renderAgent(agent: AgentGalleryItem) {
    const isFavorite =
      agentFavoriteIds.has(agent.id) ||
      (favoritesQuery.data === undefined && agent.favorite);
    const isBlocked = agent.readinessStatus === "blocked";
    const isDefault =
      workspaceId !== undefined &&
      interfacePreferencesQuery.data?.defaultAgentByWorkspace[workspaceId] ===
        agent.id;
    return (
      <div className="rm-assistant-option" key={agent.id}>
        <DropdownMenuPrimitive.RadioItem
          className="rm-ui-menu__item rm-model-option"
          disabled={isBlocked}
          title={isBlocked ? agent.readinessReason : undefined}
          value={agent.id}
        >
          <ManagedModelAvatar agent={agent} size={28} />
          <span className="rm-assistant-option__copy">
            <span className="rm-assistant-option__name">{agent.name}</span>
            {isBlocked ? (
              <small className="rm-assistant-option__description">
                {agent.readinessReason ?? t("assistantUnavailable")}
              </small>
            ) : agent.description ? (
              <small className="rm-assistant-option__description">
                {agent.description}
              </small>
            ) : null}
          </span>
          <DropdownMenuPrimitive.ItemIndicator>
            <Check aria-hidden="true" size={16} />
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.RadioItem>
        <DropdownMenuPrimitive.CheckboxItem
          aria-label={t(
            isDefault ? "assistantClearDefault" : "assistantMakeDefault",
          )}
          checked={isDefault}
          className="rm-assistant-default"
          disabled={defaultMutation.isPending || isBlocked}
          onCheckedChange={() => void toggleDefault(agent.id)}
          onSelect={(event) => event.preventDefault()}
          title={t(
            isDefault ? "assistantClearDefault" : "assistantMakeDefault",
          )}
        >
          <Pin
            aria-hidden="true"
            fill={isDefault ? "currentColor" : "none"}
            size={14}
          />
        </DropdownMenuPrimitive.CheckboxItem>
        <DropdownMenuPrimitive.CheckboxItem
          aria-label={t(
            isFavorite ? "assistantRemoveFavorite" : "assistantAddFavorite",
          )}
          checked={isFavorite}
          className="rm-assistant-favorite"
          disabled={
            favoriteMutation.isPending || deleteFavoriteMutation.isPending
          }
          onCheckedChange={() => void toggleFavorite(agent.id)}
          onSelect={(event) => event.preventDefault()}
          title={t(
            isFavorite ? "assistantRemoveFavorite" : "assistantAddFavorite",
          )}
        >
          <Star
            aria-hidden="true"
            fill={isFavorite ? "currentColor" : "none"}
            size={15}
          />
        </DropdownMenuPrimitive.CheckboxItem>
      </div>
    );
  }

  const favorites = visibleAgents.slice(0, favoriteCount);
  const remaining = visibleAgents.slice(favoriteCount);

  return (
    <>
      <div className="rm-assistant-search">
        <Search aria-hidden="true" size={15} />
        <Input
          aria-label={t("assistantSearch")}
          autoComplete="off"
          name="assistantSearch"
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("assistantSearchPlaceholder")}
          value={query}
        />
      </div>
      <DropdownMenuPrimitive.RadioGroup
        onValueChange={onSelectAgent}
        {...(activeAgentId ? { value: activeAgentId } : {})}
      >
        {favorites.length > 0 ? (
          <>
            <DropdownMenuPrimitive.Label className="rm-assistant-menu__label">
              {t("assistantFavorites")}
            </DropdownMenuPrimitive.Label>
            {favorites.map(renderAgent)}
          </>
        ) : null}
        {remaining.length > 0 ? (
          <>
            <DropdownMenuPrimitive.Label className="rm-assistant-menu__label">
              {favorites.length > 0
                ? t("assistantAll")
                : t("assistantAvailable")}
            </DropdownMenuPrimitive.Label>
            {remaining.map(renderAgent)}
          </>
        ) : null}
        {visibleAgents.length === 0 ? (
          <div className="rm-assistant-menu__empty">
            {t("assistantNoMatches")}
          </div>
        ) : null}
      </DropdownMenuPrimitive.RadioGroup>
    </>
  );
}
