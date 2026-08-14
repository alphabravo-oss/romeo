import { Button, Input, Textarea } from "@romeo/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  compareTieredKnowledgeReplayMutationOptions,
  replayTieredKnowledgeMutationOptions,
  type KnowledgeRetrievalReplayComparisonReport,
  type KnowledgeRetrievalReplayReport,
  type RagReplayCaseInput,
} from "../features/knowledge";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";

function textToList(text: string): string[] {
  return text
    .split(/[,\n]/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// ── Replay tab ────────────────────────────────────────────────────────────────

export function RagReplayTab() {
  const { t } = useLocale();
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState("");
  const [query, setQuery] = useState("");
  const [expectedChunkIds, setExpectedChunkIds] = useState("");
  const [candidateKnowledgeBaseIds, setCandidateKnowledgeBaseIds] =
    useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [compareEnabled, setCompareEnabled] = useState(false);

  const [report, setReport] = useState<KnowledgeRetrievalReplayReport | null>(
    null,
  );
  const [comparison, setComparison] =
    useState<KnowledgeRetrievalReplayComparisonReport | null>(null);

  const replayMutation = useMutation(replayTieredKnowledgeMutationOptions());
  const compareMutation = useMutation(
    compareTieredKnowledgeReplayMutationOptions(),
  );

  function buildCase(
    rawKbIds: string,
    rawQuery: string,
    rawExpected: string,
  ): RagReplayCaseInput | null {
    const knowledgeBaseIdList = textToList(rawKbIds);
    const trimmedQuery = rawQuery.trim();
    if (knowledgeBaseIdList.length === 0) {
      toast(t("atLeastOneKnowledgeBaseId"), "error");
      return null;
    }
    if (trimmedQuery.length === 0) {
      toast(t("replayQueryRequired"), "error");
      return null;
    }
    const expected = textToList(rawExpected);
    return {
      knowledgeBaseIds: knowledgeBaseIdList,
      query: trimmedQuery,
      ...(expected.length > 0 ? { expectedChunkIds: expected } : {}),
    };
  }

  async function handleReplay() {
    const baselineCase = buildCase(knowledgeBaseIds, query, expectedChunkIds);
    if (baselineCase === null) return;
    setComparison(null);
    try {
      const result = await replayMutation.mutateAsync({
        cases: [baselineCase],
      });
      setReport(result);
      toast(t("replayComplete"), "success");
    } catch (caught) {
      toast(t("couldNotRunReplay"), "error");
      throw caught;
    }
  }

  async function handleCompare() {
    const baselineCase = buildCase(knowledgeBaseIds, query, expectedChunkIds);
    if (baselineCase === null) return;
    const candidateCase = buildCase(
      candidateKnowledgeBaseIds,
      candidateQuery,
      "",
    );
    if (candidateCase === null) return;
    try {
      const result = await compareMutation.mutateAsync({
        baseline: [baselineCase],
        candidate: [candidateCase],
      });
      setComparison(result);
      setReport(result.candidate);
      toast(t("comparisonComplete"), "success");
    } catch (caught) {
      toast(t("couldNotRunComparison"), "error");
      throw caught;
    }
  }

  const busy = replayMutation.isPending || compareMutation.isPending;

  return (
    <div className="grid gap-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("retrievalReplay")}</div>
      </div>

      <div className="grid gap-2">
        <label className="text-sm text-muted" htmlFor="rag-replay-kb-ids">
          {t("knowledgeBaseIdsSeparated")}
        </label>
        <Textarea
          id="rag-replay-kb-ids"
          onChange={(event) => setKnowledgeBaseIds(event.currentTarget.value)}
          placeholder={"kb_finance\nkb_hr"}
          rows={2}
          value={knowledgeBaseIds}
        />
        <label className="text-sm text-muted" htmlFor="rag-replay-query">
          {t("ragQuery")}
        </label>
        <Input
          id="rag-replay-query"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("ragQueryPlaceholder")}
          value={query}
        />
        <label className="text-sm text-muted" htmlFor="rag-replay-expected">
          {t("expectedChunkIdsSeparated")}
        </label>
        <Textarea
          id="rag-replay-expected"
          onChange={(event) => setExpectedChunkIds(event.currentTarget.value)}
          placeholder={"chunk_1\nchunk_2"}
          rows={2}
          value={expectedChunkIds}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Input
          checked={compareEnabled}
          onChange={(event) => setCompareEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{t("compareCandidateCase")}</span>
      </label>

      {compareEnabled ? (
        <div className="grid gap-2">
          <label
            className="text-sm text-muted"
            htmlFor="rag-replay-candidate-kb-ids"
          >
            {t("candidateKnowledgeBaseIds")}
          </label>
          <Textarea
            id="rag-replay-candidate-kb-ids"
            onChange={(event) =>
              setCandidateKnowledgeBaseIds(event.currentTarget.value)
            }
            placeholder={"kb_finance_v2"}
            rows={2}
            value={candidateKnowledgeBaseIds}
          />
          <label
            className="text-sm text-muted"
            htmlFor="rag-replay-candidate-query"
          >
            {t("candidateQuery")}
          </label>
          <Input
            id="rag-replay-candidate-query"
            onChange={(event) => setCandidateQuery(event.currentTarget.value)}
            placeholder={t("ragQueryPlaceholder")}
            value={candidateQuery}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {compareEnabled ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void handleCompare()}
            type="button"
          >
            {busy ? t("ragRunning") : t("runComparison")}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void handleReplay()}
            type="button"
          >
            {busy ? t("ragRunning") : t("runReplay")}
          </Button>
        )}
      </div>

      {comparison !== null ? (
        <div className="grid gap-2">
          <div className="rm-card-title">{t("comparison")}</div>
          <PanelStats
            items={[
              { label: t("outcome"), value: comparison.outcome },
              {
                label: t("deltaPrecision"),
                value:
                  comparison.deltas.averagePrecision === null ? (
                    "—"
                  ) : (
                    <LocalizedNumber
                      options={{ maximumFractionDigits: 3 }}
                      value={comparison.deltas.averagePrecision}
                    />
                  ),
              },
              {
                label: t("deltaRecall"),
                value:
                  comparison.deltas.averageRecall === null ? (
                    "—"
                  ) : (
                    <LocalizedNumber
                      options={{ maximumFractionDigits: 3 }}
                      value={comparison.deltas.averageRecall}
                    />
                  ),
              },
              {
                label: t("deltaLatencyMs"),
                value: comparison.deltas.averageLatencyMs,
              },
              { label: t("deltaHits"), value: comparison.deltas.hitCount },
            ]}
          />
        </div>
      ) : null}

      {report !== null ? <ReplayReportView report={report} /> : null}
    </div>
  );
}

function ReplayReportView(props: { report: KnowledgeRetrievalReplayReport }) {
  const { t } = useLocale();
  const { report } = props;
  return (
    <div className="grid gap-2">
      <div className="rm-card-title">{t("replayReport")}</div>
      <PanelStats
        items={[
          { label: t("status"), value: report.status },
          { label: t("cases"), value: report.caseCount },
          {
            label: t("averagePrecision"),
            value:
              report.metrics.averagePrecision === null ? (
                "—"
              ) : (
                <LocalizedNumber
                  options={{ maximumFractionDigits: 3 }}
                  value={report.metrics.averagePrecision}
                />
              ),
          },
          {
            label: t("averageRecall"),
            value:
              report.metrics.averageRecall === null ? (
                "—"
              ) : (
                <LocalizedNumber
                  options={{ maximumFractionDigits: 3 }}
                  value={report.metrics.averageRecall}
                />
              ),
          },
          {
            label: t("averageLatencyMs"),
            value: report.metrics.averageLatencyMs,
          },
          { label: t("hits"), value: report.metrics.hitCount },
        ]}
      />
      <div className="grid gap-1">
        {report.cases.map((replayCase, index) => (
          <div className="text-sm" key={replayCase.caseId ?? index}>
            <span className="rm-mono" translate="no">
              {replayCase.caseId ?? `${t("caseLabel")} ${index + 1}`}
            </span>{" "}
            <span className="rm-cell-muted">
              {replayCase.status} · {t("hitsLower")} {replayCase.hitCount} ·{" "}
              {t("precision")}{" "}
              {replayCase.precision === null ? (
                "—"
              ) : (
                <LocalizedNumber
                  options={{ maximumFractionDigits: 3 }}
                  value={replayCase.precision}
                />
              )}{" "}
              · {t("recall")}{" "}
              {replayCase.recall === null ? (
                "—"
              ) : (
                <LocalizedNumber
                  options={{ maximumFractionDigits: 3 }}
                  value={replayCase.recall}
                />
              )}{" "}
              · <LocalizedNumber value={replayCase.latencyMs} />
              ms
            </span>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted">
        {t("generated")} <LocalizedDateTime value={report.generatedAt} />
      </div>
    </div>
  );
}
