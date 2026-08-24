import type {
  KnowledgeBase,
  KnowledgeSource,
} from "../features/knowledge/types";
import type { Agent } from "../features/types";
import { useLocale } from "../lib/i18n";
import { AddButton } from "./AddButton";
import { AgentKnowledgeBindingControls } from "./AgentKnowledgeBindingControls";
import { KnowledgeSourceList } from "./KnowledgeSourceList";
import { PanelStats } from "./PanelStats";
import { summarizeKnowledgeQuality } from "./knowledge-quality";
import type { ServerTableState } from "./DataTable";

export function KnowledgeSourcesTab({
  activeAgent,
  activeKnowledgeBase,
  canUpload = true,
  isDeleting,
  isExtracting,
  isReindexing,
  onAddSource,
  onDelete,
  onExtract,
  onReindex,
  sources,
  tableState,
}: {
  activeAgent: Agent | undefined;
  activeKnowledgeBase: KnowledgeBase | undefined;
  canUpload?: boolean;
  isDeleting: boolean;
  isExtracting: boolean;
  isReindexing: boolean;
  onAddSource: () => void;
  onDelete: (sourceId: string) => void;
  onExtract: (sourceId: string) => void;
  onReindex: (sourceId: string) => void;
  sources: KnowledgeSource[];
  tableState: ServerTableState;
}) {
  const { t } = useLocale();
  const quality = summarizeKnowledgeQuality(sources);
  return (
    <div className="grid gap-4">
      <AgentKnowledgeBindingControls
        activeAgent={activeAgent}
        activeKnowledgeBase={activeKnowledgeBase}
      />

      <div className="grid gap-4">
        <AddButton
          disabled={!activeKnowledgeBase || !canUpload}
          onClick={onAddSource}
        >
          {t("knowledgeAddSource")}
        </AddButton>
        <div>
          <h3>{t("knowledgeQualityTitle")}</h3>
          <p className="rm-section-help">{t("knowledgeQualityDescription")}</p>
        </div>
        <PanelStats
          items={[
            {
              label: t("knowledgeHealthySources"),
              value: quality.healthySources,
            },
            {
              label: t("knowledgeNeedsFreshnessReview"),
              value: quality.staleSources,
            },
            {
              label: t("knowledgeFailedSources"),
              value: quality.failedSources,
            },
            {
              label: t("knowledgePendingSources"),
              value: quality.pendingSources,
            },
            {
              label: t("knowledgeChunks"),
              value: quality.totalChunks,
            },
            {
              label: t("knowledgeDuplicateSources"),
              value: quality.duplicateSources,
            },
          ]}
        />
        <KnowledgeSourceList
          canUpload={canUpload}
          isDeleting={isDeleting}
          isExtracting={isExtracting}
          isReindexing={isReindexing}
          onDelete={onDelete}
          onExtract={onExtract}
          onReindex={onReindex}
          sources={sources}
          tableState={tableState}
        />
      </div>
    </div>
  );
}
