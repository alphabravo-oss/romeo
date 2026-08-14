import { Button, StatusBadge } from "@romeo/ui";
import type { UseQueryResult } from "@tanstack/react-query";

import type { AgentGalleryItem } from "../features/managed-models";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { Section } from "./console";
import { ResourceRow } from "./ResourceRow";

export function CollaborationDiscoverableModels(props: {
  activeAgentId: string | undefined;
  activeFavorite: boolean;
  favoritePending: boolean;
  galleryQuery: UseQueryResult<AgentGalleryItem[], unknown>;
  onFavorite: () => void;
}) {
  const { t } = useLocale();
  return (
    <Section
      description={t("workspaceDiscoverableHelp")}
      title={t("workspaceDiscoverableModels")}
    >
      <PanelState
        empty={t("workspaceNoDiscoverable")}
        query={props.galleryQuery}
      >
        {(agents) => (
          <div className="rm-resource-list">
            {agents.map((agent) => {
              const activeFavorite =
                agent.id === props.activeAgentId && props.activeFavorite;
              return (
                <ResourceRow
                  actions={
                    agent.id === props.activeAgentId ? (
                      <Button
                        disabled={props.favoritePending || activeFavorite}
                        onClick={props.onFavorite}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {activeFavorite
                          ? t("workspaceFavorited")
                          : t("workspaceFavoriteAgent")}
                      </Button>
                    ) : null
                  }
                  badge={
                    <StatusBadge tone={agent.favorite ? "success" : "neutral"}>
                      {agent.favorite
                        ? t("workspaceFavorite")
                        : t("workspaceDiscoverable")}
                    </StatusBadge>
                  }
                  key={agent.id}
                  title={agent.name}
                />
              );
            })}
          </div>
        )}
      </PanelState>
    </Section>
  );
}
