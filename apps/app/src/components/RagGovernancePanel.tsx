import { Button, Field, NativeSelect, Select, Textarea } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Database from "lucide-react/dist/esm/icons/database.mjs";
import { useState } from "react";

import {
  approveRagPolicyChangeRequest,
  createRagPolicyChangeRequest,
  getRagPolicyChangeRequest,
  rejectRagPolicyChangeRequest,
  ragPolicyChangeJustificationCodes,
  ragPolicyChangeRejectReasonCodes,
  type CreateRagPolicyChangeRequestInput,
  type RagPolicyChangeJustificationCode,
  type RagPolicyChangeRejectReasonCode,
  type RagPolicyChangeRequest,
} from "../features/rag-governance";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale, type MessageKey } from "../lib/i18n";
import { Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { PageActions } from "./PageActions";
import { parseRagPolicyPatch } from "./rag-change-request";
import { RagPolicyTab } from "./RagPolicyTab";
import { RagPostureTab } from "./RagPostureTab";
import { RagReplayTab } from "./RagReplayTab";
import { RagValidateTab } from "./RagValidateTab";
import { Tabs } from "./Tabs";

export function RagGovernancePanel() {
  const { t } = useLocale();
  return (
    <Section>
      <Tabs
        tabs={[
          {
            id: "setup",
            label: t("ragSetupTab"),
            content: <RagPolicyTab />,
          },
          {
            id: "health",
            label: t("ragHealthTab"),
            content: (
              <div className="grid gap-6">
                <RagValidateTab />
                <RagPostureTab />
              </div>
            ),
          },
          {
            id: "governance",
            label: t("ragGovernanceTab"),
            content: (
              <Tabs
                tabs={[
                  {
                    id: "change-requests",
                    label: t("changeRequests"),
                    content: <ChangeRequestTab />,
                  },
                  {
                    id: "replay",
                    label: t("replay"),
                    content: <RagReplayTab />,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </Section>
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
  const [justificationCode, setJustificationCode] =
    useState<RagPolicyChangeJustificationCode>(
      ragPolicyChangeJustificationCodes[0],
    );
  const [policyPatch, setPolicyPatch] = useState(
    '{\n  "enabledTiers": ["workspace"]\n}',
  );
  const [createError, setCreateError] = useState<MessageKey>();

  const createMutation = useMutation({
    mutationFn: (input: CreateRagPolicyChangeRequestInput) =>
      createRagPolicyChangeRequest(input),
  });
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

  async function handleCreate() {
    const parsed = parseRagPolicyPatch(policyPatch);
    if (!parsed.ok) {
      setCreateError(ragPolicyPatchErrorKey(parsed.error));
      return;
    }
    setCreateError(undefined);
    const input: CreateRagPolicyChangeRequestInput = {
      justificationCode,
      policy: parsed.policy as CreateRagPolicyChangeRequestInput["policy"],
    };
    try {
      await createMutation.mutateAsync(input);
      await queryClient.invalidateQueries({
        queryKey: ["ragPolicyChangeRequest"],
      });
      toast(t("changeRequestCreated"), "success");
    } catch {
      toast(t("couldNotCreateChangeRequest"), "error");
    }
  }

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
    } catch {
      toast(t("couldNotApproveChangeRequest"), "error");
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
    } catch {
      toast(t("couldNotRejectChangeRequest"), "error");
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("policyChangeRequests")}</div>
        <PageActions
          onRefresh={() => void changeRequestQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={changeRequestQuery.isFetching}
        />
      </div>
      <form
        className="grid gap-3 rounded-md border border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <div className="font-medium">{t("proposePolicyChange")}</div>
        <Field label={t("changeRequestJustification")}>
          <Select
            name="justificationCode"
            onValueChange={(value) =>
              setJustificationCode(value as RagPolicyChangeJustificationCode)
            }
            options={ragPolicyChangeJustificationCodes.map((code) => ({
              label: t(ragPolicyJustificationKey(code)),
              value: code,
            }))}
            value={justificationCode}
          />
        </Field>
        <Field
          description={t("policyPatchJsonHelp")}
          label={t("proposedPolicyPatch")}
          {...(createError === undefined ? {} : { error: t(createError) })}
        >
          <Textarea
            name="policyPatch"
            onChange={(event) => {
              setPolicyPatch(event.currentTarget.value);
              if (createError !== undefined) setCreateError(undefined);
            }}
            rows={7}
            spellCheck={false}
            value={policyPatch}
          />
        </Field>
        <Button
          variant="primary"
          disabled={
            !changeRequestQuery.isSuccess ||
            changeRequestQuery.data?.status === "pending" ||
            createMutation.isPending
          }
          pending={createMutation.isPending}
          type="submit"
        >
          {createMutation.isPending
            ? t("creatingChangeRequest")
            : t("createChangeRequest")}
        </Button>
        {changeRequestQuery.data?.status === "pending" ? (
          <div className="text-xs text-muted">
            {t("pendingChangeRequestExists")}
          </div>
        ) : null}
      </form>
      <PanelState
        query={changeRequestQuery}
        empty={t("noChangeRequest")}
        emptyDescription={t("noChangeRequestDescription")}
        emptyIcon={<Database aria-hidden size={24} />}
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
      <StatRow
        items={[
          { label: t("status"), value: request.status },
          { label: t("changedFields"), value: request.changedFields.length },
          {
            label: t("justification"),
            value:
              request.justificationCode === undefined
                ? "—"
                : t(ragPolicyJustificationKey(request.justificationCode)),
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
          <span className="rm-mono" translate="no">
            {request.requestId}
          </span>
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

function ragPolicyJustificationKey(
  code: RagPolicyChangeJustificationCode,
): MessageKey {
  switch (code) {
    case "compliance_update":
      return "ragJustificationComplianceUpdate";
    case "incident_response":
      return "ragJustificationIncidentResponse";
    case "manual_risk_reduction":
      return "ragJustificationManualRiskReduction";
    case "retrieval_replay_improvement":
      return "ragJustificationRetrievalReplayImprovement";
    default:
      return code satisfies never;
  }
}

function ragPolicyPatchErrorKey(
  error: "empty_patch" | "invalid_json" | "object_required",
): MessageKey {
  switch (error) {
    case "empty_patch":
      return "policyPatchEmpty";
    case "invalid_json":
      return "policyPatchInvalidJson";
    case "object_required":
      return "policyPatchObjectRequired";
    default:
      return error satisfies never;
  }
}
