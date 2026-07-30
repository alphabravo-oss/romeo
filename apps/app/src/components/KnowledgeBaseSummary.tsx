import { Button } from "@romeo/ui";

import type { KnowledgeBase } from "../features/types";
import { useLocale } from "../lib/i18n";

export function KnowledgeBaseSummary({
  knowledgeBase,
  onAddSource,
}: {
  knowledgeBase: KnowledgeBase;
  onAddSource: () => void;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{knowledgeBase.name}</div>
          {knowledgeBase.description ? (
            <p className="text-sm text-muted">{knowledgeBase.description}</p>
          ) : null}
        </div>
        <Button onClick={onAddSource} type="button" variant="primary">
          + {t("knowledgeAddSource")}
        </Button>
      </div>

      <div className="rm-model-meta-grid">
        <span>
          <small>{t("knowledgeSources")}</small>
          {knowledgeBase.sourceCount ?? 0}
        </span>
        <span>
          <small>{t("knowledgeIndexedSources")}</small>
          {knowledgeBase.indexedSourceCount ?? 0}
        </span>
        <span>
          <small>{t("knowledgeDependents")}</small>
          {knowledgeBase.dependentAgentCount ?? 0}
        </span>
        <span>
          <small>{t("knowledgeGrants")}</small>
          {knowledgeBase.grantCount ?? 0}
        </span>
      </div>
    </>
  );
}
