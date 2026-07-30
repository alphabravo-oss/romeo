import { Button } from "@romeo/ui";
import type { UseQueryResult } from "@tanstack/react-query";

import type {
  KnowledgeBase,
  KnowledgeSource,
} from "../features/knowledge/types";
import type { Agent } from "../features/types";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { AgentKnowledgeBindingControls } from "./AgentKnowledgeBindingControls";
import { KnowledgeSourceList } from "./KnowledgeSourceList";
import { PanelStats } from "./PanelStats";

export function KnowledgeSourcesTab({
  activeAgent,
  activeKnowledgeBase,
  isDeleting,
  isExtracting,
  isReindexing,
  onAddSource,
  onDelete,
  onExtract,
  onReindex,
  sourcesQuery,
}: {
  activeAgent: Agent | undefined;
  activeKnowledgeBase: KnowledgeBase | undefined;
  isDeleting: boolean;
  isExtracting: boolean;
  isReindexing: boolean;
  onAddSource: () => void;
  onDelete: (sourceId: string) => void;
  onExtract: (sourceId: string) => void;
  onReindex: (sourceId: string) => void;
  sourcesQuery: UseQueryResult<KnowledgeSource[], Error>;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-4">
      <AgentKnowledgeBindingControls
        activeAgent={activeAgent}
        activeKnowledgeBase={activeKnowledgeBase}
      />

      <PanelState
        query={sourcesQuery}
        empty={t("knowledgeNoSources")}
        emptyAction={
          <Button
            variant="primary"
            disabled={!activeKnowledgeBase}
            onClick={onAddSource}
            type="button"
          >
            + {t("knowledgeAddSource")}
          </Button>
        }
      >
        {(sources) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: t("knowledgeTotalSources"), value: sources.length },
                {
                  label: t("knowledgeIndexed"),
                  value: sources.filter((source) => source.status === "indexed")
                    .length,
                },
              ]}
            />
            <KnowledgeSourceList
              isDeleting={isDeleting}
              isExtracting={isExtracting}
              isReindexing={isReindexing}
              onDelete={onDelete}
              onExtract={onExtract}
              onReindex={onReindex}
              sources={sources}
            />
          </div>
        )}
      </PanelState>
    </div>
  );
}
