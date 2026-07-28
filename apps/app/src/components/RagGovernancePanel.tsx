import { Input, Textarea, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  approveRagPolicyChangeRequest,
  createRagPolicyChangeRequest,
  getRagPolicyChangeRequest,
  getRagPosture,
  rejectRagPolicyChangeRequest,
  ragPolicyChangeJustificationCodes,
  ragPolicyChangeRejectReasonCodes,
  type CreateRagPolicyChangeRequestInput,
  type RagPolicyChangeJustificationCode,
  type RagPolicyChangeRejectReasonCode,
  type RagPolicyChangeRequest,
  type RagPostureReport,
} from "../features/rag-governance";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { useConfirm } from "./ConfirmDialog";
import { PanelStats } from "./PanelStats";
import { RagPolicyTab } from "./RagPolicyTab";
import { RagReplayTab } from "./RagReplayTab";
import { Tabs } from "./Tabs";

export function RagGovernancePanel() {
  const { t } = useLocale();
  return (
    <section className="rm-panel p-4">
      <Tabs
        tabs={[
          {
            id: "policy",
            label: t("notificationPolicy"),
            content: <RagPolicyTab />,
          },
          { id: "posture", label: t("posture"), content: <PostureTab /> },
          {
            id: "change-requests",
            label: t("changeRequests"),
            content: <ChangeRequestTab />,
          },
          { id: "replay", label: t("replay"), content: <RagReplayTab /> },
        ]}
      />
    </section>
  );
}

// ── Posture tab ───────────────────────────────────────────────────────────────

function PostureTab() {
  const { t } = useLocale();
  const postureQuery = useQuery({
    queryKey: ["ragPosture"],
    queryFn: getRagPosture,
  });

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("retrievalPosture")}</div>
        <Button
          disabled={postureQuery.isFetching}
          onClick={() => void postureQuery.refetch()}
          type="button"
        >
          {postureQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
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

function PostureView(props: { report: RagPostureReport }) {
  const { t } = useLocale();
  const { report } = props;
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
          { label: t("sources"), value: report.corpus.sourceCount },
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
                <span className="rm-mono">{warning.code}</span>{" "}
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

// ── Change requests tab ───────────────────────────────────────────────────────

function ChangeRequestTab() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const changeRequestQuery = useQuery({
    queryKey: ["ragPolicyChangeRequest"],
    queryFn: getRagPolicyChangeRequest,
  });
  const { ask, dialog } = useConfirm();

  const approveMutation = useMutation({
    mutationFn: (requestId: string) =>
      approveRagPolicyChangeRequest(requestId, { confirmRequestId: requestId }),
  });
  const rejectMutation = useMutation({
    mutationFn: (input: {
      requestId: string;
      reasonCode: RagPolicyChangeRejectReasonCode;
    }) =>
      rejectRagPolicyChangeRequest(input.requestId, {
        confirmRequestId: input.requestId,
        reasonCode: input.reasonCode,
      }),
  });

  async function handleApprove(request: RagPolicyChangeRequest) {
    const confirmed = await ask({
      title: t("approveChangeRequestTitle"),
      body: `${t("applyProposedRagPolicyForRequest")} ${request.requestId}.`,
      confirmLabel: t("approve"),
    });
    if (!confirmed) return;
    try {
      await approveMutation.mutateAsync(request.requestId);
      await queryClient.invalidateQueries({
        queryKey: ["ragPolicyChangeRequest"],
      });
      await queryClient.invalidateQueries({ queryKey: ["ragPolicy"] });
      await queryClient.invalidateQueries({ queryKey: ["ragPosture"] });
      toast(t("changeRequestApproved"), "success");
    } catch (caught) {
      toast(t("couldNotApproveChangeRequest"), "error");
      throw caught;
    }
  }

  async function handleReject(
    request: RagPolicyChangeRequest,
    reasonCode: RagPolicyChangeRejectReasonCode,
  ) {
    const confirmed = await ask({
      title: t("rejectChangeRequestTitle"),
      body: `${t("rejectRequest")} ${request.requestId} (${reasonCode}).`,
      confirmLabel: t("reject"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await rejectMutation.mutateAsync({
        requestId: request.requestId,
        reasonCode,
      });
      await queryClient.invalidateQueries({
        queryKey: ["ragPolicyChangeRequest"],
      });
      toast(t("changeRequestRejected"), "success");
    } catch (caught) {
      toast(t("couldNotRejectChangeRequest"), "error");
      throw caught;
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("policyChangeRequests")}</div>
        <Button
          disabled={changeRequestQuery.isFetching}
          onClick={() => void changeRequestQuery.refetch()}
          type="button"
        >
          {changeRequestQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <PanelState
        query={changeRequestQuery}
        empty={t("noChangeRequest")}
        isEmpty={(request) => request === null}
      >
        {(request) =>
          request === null ? (
            <div className="rm-empty">{t("noChangeRequest")}</div>
          ) : (
            <ChangeRequestView
              request={request}
              busy={approveMutation.isPending || rejectMutation.isPending}
              onApprove={() => void handleApprove(request)}
              onReject={(reasonCode) => void handleReject(request, reasonCode)}
            />
          )
        }
      </PanelState>
      {dialog}
    </div>
  );
}

function ChangeRequestView(props: {
  request: RagPolicyChangeRequest;
  busy: boolean;
  onApprove: () => void;
  onReject: (reasonCode: RagPolicyChangeRejectReasonCode) => void;
}) {
  const { t } = useLocale();
  const { request, busy, onApprove, onReject } = props;
  const [reasonCode, setReasonCode] = useState<RagPolicyChangeRejectReasonCode>(
    ragPolicyChangeRejectReasonCodes[0],
  );
  const pending = request.status === "pending";

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("status"), value: request.status },
          { label: t("changedFields"), value: request.changedFields.length },
          {
            label: t("justification"),
            value: request.justificationCode ?? "—",
          },
          {
            label: t("replayCases"),
            value: request.evidenceSummary?.replayCaseCount ?? "—",
          },
        ]}
      />
      <div className="grid gap-1 text-sm">
        <div>
          <span className="text-muted">{t("request")} </span>
          <span className="rm-mono">{request.requestId}</span>
        </div>
        <div className="rm-cell-muted">
          {t("requestedBy")} {request.requestedBy} {t("ragAt")}{" "}
          <LocalizedDateTime value={request.requestedAt} />
        </div>
        {request.reviewedBy ? (
          <div className="rm-cell-muted">
            {t("reviewedBy")} {request.reviewedBy}
            {request.reviewedAt ? (
              <>
                {" "}
                {t("ragAt")} <LocalizedDateTime value={request.reviewedAt} />
              </>
            ) : (
              ""
            )}
            {request.rejectReasonCode ? ` — ${request.rejectReasonCode}` : ""}
          </div>
        ) : null}
        {request.changedFields.length > 0 ? (
          <div className="rm-cell-muted">
            {t("changed")}: {request.changedFields.join(", ")}
          </div>
        ) : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={busy}
            onClick={onApprove}
            type="button"
          >
            {busy ? t("working") : t("approve")}
          </Button>
          <NativeSelect
            aria-label={t("rejectReason")}
            onChange={(event) =>
              setReasonCode(
                event.currentTarget.value as RagPolicyChangeRejectReasonCode,
              )
            }
            value={reasonCode}
          >
            {ragPolicyChangeRejectReasonCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => onReject(reasonCode)}
            type="button"
          >
            {t("reject")}
          </Button>
        </div>
      ) : (
        <div className="text-xs text-muted">
          {t("requestHasBeen")} {request.status}.
        </div>
      )}
    </div>
  );
}
