import { Button, Input, Textarea } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { queryTieredKnowledgeMutationOptions } from "../features/knowledge";
import {
  buildRagValidateChecklist,
  ragPolicyQueryOptions,
  ragPostureQueryOptions,
  vectorBackendPresetFromPolicy,
} from "../features/rag-governance";
import { useLocale } from "../lib/i18n";
import { LocalizedNumber } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { PageActions } from "./PageActions";
import { PanelStats } from "./PanelStats";
import { safeUserErrorMessage } from "../lib/safe-user-error";

function textToIds(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function RagValidateTab() {
  const { t } = useLocale();
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState("");
  const [query, setQuery] = useState("What policies apply?");
  const [testSummary, setTestSummary] = useState<string | null>(null);

  const postureQuery = useQuery(ragPostureQueryOptions());
  const policyQuery = useQuery(ragPolicyQueryOptions());
  const testMutation = useMutation(queryTieredKnowledgeMutationOptions());

  const expectedBackend = policyQuery.data
    ? vectorBackendPresetFromPolicy(policyQuery.data)
    : "pgvector";

  const checks = useMemo(() => {
    if (postureQuery.data === undefined) return [];
    return buildRagValidateChecklist(postureQuery.data, expectedBackend);
  }, [expectedBackend, postureQuery.data]);

  const passCount = checks.filter((check) => check.ok).length;

  async function handleValidateRefresh() {
    await Promise.all([postureQuery.refetch(), policyQuery.refetch()]);
    toast(t("ragValidateRefreshed"), "success");
  }

  async function handleRetrievalTest() {
    const ids = textToIds(knowledgeBaseIds);
    const trimmed = query.trim();
    if (ids.length === 0) {
      toast(t("atLeastOneKnowledgeBaseId"), "error");
      return;
    }
    if (trimmed.length === 0) {
      toast(t("ragTestQueryRequired"), "error");
      return;
    }
    try {
      const result = await testMutation.mutateAsync({
        knowledgeBaseIds: ids,
        query: trimmed,
      });
      const hitCount = result.hits?.length ?? 0;
      const planCount = result.plan?.authorizedCount ?? 0;
      setTestSummary(
        t("ragTestResultSummary", {
          hits: hitCount,
          authorized: planCount,
          driver: result.plan?.posture?.vectorDriver ?? "—",
        }),
      );
      toast(
        hitCount > 0 ? t("ragTestRetrievalOk") : t("ragTestRetrievalEmpty"),
        hitCount > 0 ? "success" : "default",
      );
    } catch (caught) {
      setTestSummary(null);
      toast(safeUserErrorMessage(caught, t("ragTestRetrievalFailed")), "error");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{t("ragValidateTitle")}</div>
          <p className="text-sm text-muted">{t("ragValidateDescription")}</p>
        </div>
        <PageActions
          onRefresh={() => void handleValidateRefresh()}
          primary={
            <Button
              disabled={postureQuery.isFetching}
              onClick={() => void handleValidateRefresh()}
              type="button"
              variant="primary"
            >
              {t("ragRunValidation")}
            </Button>
          }
          refreshLabel={t("refresh")}
          refreshing={postureQuery.isFetching}
        />
      </div>

      <PanelState
        query={postureQuery}
        empty={t("noPostureReport")}
        isEmpty={() => false}
      >
        {(report) => (
          <>
            <PanelStats
              items={[
                {
                  label: t("ragChecksPassed"),
                  value: `${passCount}/${checks.length}`,
                },
                { label: t("status"), value: report.status },
                { label: t("vectorDriver"), value: report.vector.driver },
                {
                  label: t("ragExpectedBackend"),
                  value: expectedBackend,
                },
              ]}
            />
            <ul className="grid gap-2">
              {checks.map((check) => (
                <li
                  className={`rounded-md border px-3 py-2 text-sm ${
                    check.ok
                      ? "border-[color-mix(in_srgb,var(--rm-success)_35%,var(--rm-border))]"
                      : "border-[color-mix(in_srgb,var(--rm-danger)_40%,var(--rm-border))]"
                  }`}
                  key={check.id}
                >
                  <strong className="mr-2">
                    {check.ok ? t("ragCheckPass") : t("ragCheckFail")}
                  </strong>
                  <span className="text-muted">{check.detail}</span>
                </li>
              ))}
            </ul>
            {report.readiness.warnings.length > 0 ? (
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="mb-1 font-medium">{t("warnings")}</div>
                <ul className="list-disc pl-5 text-muted">
                  {report.readiness.warnings.map((warning) => (
                    <li key={warning.code}>
                      {warning.code}
                      {warning.count !== undefined ? ` ×${warning.count}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </PanelState>

      <section className="grid gap-3 rounded-md border border-border p-3">
        <div>
          <div className="font-medium text-sm">
            {t("ragTestRetrievalTitle")}
          </div>
          <p className="text-xs text-muted">{t("ragTestRetrievalHelp")}</p>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">{t("knowledgeBaseIdsSeparated")}</span>
          <Textarea
            name="rag-test-kb-ids"
            onChange={(event) => setKnowledgeBaseIds(event.currentTarget.value)}
            placeholder="kb_…"
            rows={2}
            value={knowledgeBaseIds}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">{t("ragTestQuery")}</span>
          <Input
            name="rag-test-query"
            onChange={(event) => setQuery(event.currentTarget.value)}
            value={query}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={testMutation.isPending}
            onClick={() => void handleRetrievalTest()}
            type="button"
            variant="primary"
          >
            {testMutation.isPending
              ? t("ragTestingRetrieval")
              : t("ragRunRetrievalTest")}
          </Button>
          {testSummary ? (
            <span className="text-sm text-muted">{testSummary}</span>
          ) : null}
        </div>
        {testMutation.data ? (
          <PanelStats
            items={[
              {
                label: t("ragTestHits"),
                value: (
                  <LocalizedNumber
                    value={testMutation.data.hits?.length ?? 0}
                  />
                ),
              },
              {
                label: t("ragTestAuthorizedBases"),
                value: (
                  <LocalizedNumber
                    value={testMutation.data.plan?.authorizedCount ?? 0}
                  />
                ),
              },
            ]}
          />
        ) : null}
      </section>
    </div>
  );
}
