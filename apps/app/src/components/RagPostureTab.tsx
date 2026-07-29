import { useQuery } from "@tanstack/react-query";

import {
  getRagPosture,
  type RagPostureReport,
} from "../features/rag-governance";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { PanelStats } from "./PanelStats";
import { PageActions } from "./PageActions";

export function RagPostureTab() {
  const { t } = useLocale();
  const postureQuery = useQuery({
    queryKey: ["ragPosture"],
    queryFn: getRagPosture,
  });

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("retrievalPosture")}</div>
        <PageActions
          onRefresh={() => void postureQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={postureQuery.isFetching}
        />
      </div>
      <PanelState
        query={postureQuery}
        empty={t("noPostureReport")}
        isEmpty={() => false}
      >
        {(report) => <PostureView report={report} />}
      </PanelState>
    </div>
  );
}

function PostureView({ report }: { report: RagPostureReport }) {
  const { t } = useLocale();
  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("status"), value: report.status },
          { label: t("vectorDriver"), value: report.vector.driver },
          {
            label: t("isolationStatus"),
            value: report.vector.physicalIsolation.status,
          },
          {
            label: t("fallback"),
            value: report.fallback.degraded ? t("degraded") : t("nominal"),
          },
          { label: t("warnings"), value: report.readiness.warnings.length },
        ]}
      />
      <PanelStats
        items={[
          { label: t("workspaces"), value: report.corpus.workspaceCount },
          {
            label: t("knowledgeBases"),
            value: report.corpus.knowledgeBaseCount,
          },
          { label: t("ragSources"), value: report.corpus.sourceCount },
          {
            label: t("indexedSources"),
            value: report.corpus.indexedSourceCount,
          },
          {
            label: t("pendingSources"),
            value: report.corpus.pendingSourceCount,
          },
          { label: t("failedSources"), value: report.corpus.failedSourceCount },
        ]}
      />
      <PanelStats
        items={[
          { label: t("chunks"), value: report.corpus.chunkCount },
          { label: t("embeddings"), value: report.corpus.embeddingCount },
          {
            label: t("embeddedChunks"),
            value: report.corpus.embeddedChunkCount,
          },
          {
            label: t("chunksMissingEmbedding"),
            value: report.corpus.chunksMissingProviderEmbeddingCount,
          },
          {
            label: t("staleEmbeddings"),
            value: report.corpus.staleEmbeddingRecordCount,
          },
          { label: t("staleSources"), value: report.corpus.staleSourceCount },
        ]}
      />
      <PanelStats
        items={[
          {
            label: t("failedEmbedJobs"),
            value: report.jobs.failedEmbeddingIndexJobCount,
          },
          {
            label: t("failedExtractJobs"),
            value: report.jobs.failedExtractionJobCount,
          },
          {
            label: t("failedReindexJobs"),
            value: report.jobs.failedReindexJobCount,
          },
          {
            label: t("queuedJobs"),
            value: report.jobs.queuedKnowledgeJobCount,
          },
          {
            label: t("runningJobs"),
            value: report.jobs.runningKnowledgeJobCount,
          },
        ]}
      />
      {report.readiness.warnings.length > 0 ? (
        <div className="grid gap-1">
          <div className="text-sm text-muted">{t("warnings")}</div>
          <ul className="grid gap-1">
            {report.readiness.warnings.map((warning) => (
              <li className="text-sm" key={warning.code}>
                <span className="rm-mono" translate="no">
                  {warning.code}
                </span>{" "}
                <span className="rm-cell-muted">
                  ({warning.severity}, {warning.count})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="text-xs text-muted">
        {t("generated")} <LocalizedDateTime value={report.generatedAt} />
      </div>
    </div>
  );
}
