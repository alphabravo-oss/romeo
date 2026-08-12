import { AddButton } from "./AddButton";

import type { KnowledgeBase } from "../features/types";
import { useLocale } from "../lib/i18n";

export function KnowledgeBaseSummary({
  canUpload = true,
  knowledgeBase,
  onAddSource,
}: {
  canUpload?: boolean;
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
        <AddButton
          disabled={!canUpload}
          onClick={onAddSource}
          {...(canUpload
            ? {}
            : { title: t("knowledgeIngestBlockedEmbedding") })}
        >
          {t("knowledgeAddSource")}
        </AddButton>
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
