import type { UseQueryResult } from "@tanstack/react-query";

import type {
  KnowledgeBase,
  KnowledgeSource,
} from "../features/knowledge/types";
import type { Agent, RetrievalHit } from "../features/types";
import { useLocale } from "../lib/i18n";
import { KnowledgeQueryTab } from "./KnowledgeQueryTab";
import { KnowledgeSourcesTab } from "./KnowledgeSourcesTab";
import { Tabs } from "./Tabs";

export function KnowledgeWorkspaceTabs(props: {
  activeAgent: Agent | undefined;
  activeKnowledgeBase: KnowledgeBase;
  canUpload: boolean;
  hits: readonly RetrievalHit[];
  isDeleting: boolean;
  isExtracting: boolean;
  isQuerying: boolean;
  isReindexing: boolean;
  notice: string | undefined;
  onAddSource: () => void;
  onDelete: (sourceId: string) => void;
  onExtract: (sourceId: string) => void;
  onQuery: (query: string) => Promise<void>;
  onReindex: (sourceId: string) => void;
  sourcesQuery: UseQueryResult<KnowledgeSource[], unknown>;
}) {
  const { t } = useLocale();
  return (
    <Tabs
      tabs={[
        {
          id: "sources",
          label: t("knowledgeSources"),
          content: (
            <KnowledgeSourcesTab
              activeAgent={props.activeAgent}
              activeKnowledgeBase={props.activeKnowledgeBase}
              canUpload={props.canUpload}
              isDeleting={props.isDeleting}
              isExtracting={props.isExtracting}
              isReindexing={props.isReindexing}
              onAddSource={props.onAddSource}
              onDelete={props.onDelete}
              onExtract={props.onExtract}
              onReindex={props.onReindex}
              sourcesQuery={props.sourcesQuery}
            />
          ),
        },
        {
          id: "query",
          label: t("knowledgeQuery"),
          content: (
            <KnowledgeQueryTab
              enabled={props.canUpload}
              hits={props.hits}
              isPending={props.isQuerying}
              notice={props.notice}
              onQuery={props.onQuery}
            />
          ),
        },
      ]}
    />
  );
}
