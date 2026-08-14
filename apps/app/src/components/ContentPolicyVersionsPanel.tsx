import { Button, Field, StatusBadge, Textarea } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  createContentPolicyVersionMutationOptions,
  dryRunContentPolicyVersionMutationOptions,
  publishContentPolicyVersionMutationOptions,
  resolveContentPolicyApprovalMutationOptions,
  rollbackContentPolicyMutationOptions,
} from "../features/content-policy-lifecycle-mutation-options";
import {
  contentPolicyApprovalsQueryOptions,
  contentPolicyDecisionsQueryOptions,
  contentPolicyVersionsQueryOptions,
} from "../features/content-policy-lifecycle-query-options";
import type { ContentPolicyReport } from "../features/content-policy";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";

export function ContentPolicyVersionsPanel({
  report,
}: {
  report: ContentPolicyReport;
}) {
  const { t } = useLocale();
  const versionsQuery = useQuery(contentPolicyVersionsQueryOptions());
  const decisionsQuery = useQuery(contentPolicyDecisionsQueryOptions());
  const approvalsQuery = useQuery(contentPolicyApprovalsQueryOptions());
  const createMutation = useMutation(createContentPolicyVersionMutationOptions());
  const publishMutation = useMutation(publishContentPolicyVersionMutationOptions());
  const rollbackMutation = useMutation(rollbackContentPolicyMutationOptions());
  const resolveMutation = useMutation(resolveContentPolicyApprovalMutationOptions());
  const dryRunMutation = useMutation(dryRunContentPolicyVersionMutationOptions());
  const [dryRunContent, setDryRunContent] = useState("");
  const versions = versionsQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];
  const approvals = approvalsQuery.data ?? [];

  async function createDraft() {
    try {
      await createMutation.mutateAsync({
        detectors: report.detectors,
        approvalRequired: false,
      });
      toast(t("contentPolicyDraftCreated"), "success");
    } catch {
      toast(t("contentPolicyDraftFailed"), "error");
    }
  }

  async function publish(versionId: string) {
    try {
      await publishMutation.mutateAsync(versionId);
      toast(t("contentPolicyPublished"), "success");
    } catch {
      toast(t("contentPolicyPublishFailed"), "error");
    }
  }

  async function rollback(versionId: string) {
    try {
      await rollbackMutation.mutateAsync({ versionId });
      toast(t("contentPolicyRolledBack"), "success");
    } catch {
      toast(t("contentPolicyRollbackFailed"), "error");
    }
  }

  async function dryRun(versionId: string) {
    const content = dryRunContent;
    if (content.trim().length === 0) return;
    try {
      await dryRunMutation.mutateAsync({ versionId, content });
      setDryRunContent("");
    } catch {
      toast(t("contentPolicySimulationFailed"), "error");
    }
  }

  async function resolve(approvalId: string, decision: "approve" | "deny") {
    try {
      await resolveMutation.mutateAsync({ approvalId, decision });
      toast(t("contentPolicyApprovalResolved"), "success");
    } catch {
      toast(t("contentPolicyApprovalFailed"), "error");
    }
  }

  return (
    <div className="grid gap-4">
      <section aria-labelledby="content-policy-versions" className="rm-card">
        <div className="rm-card-title" id="content-policy-versions">
          {t("contentPolicyVersions")}
        </div>
        <p className="rm-muted">{t("contentPolicyVersionsHelp")}</p>
        <Field label={t("contentPolicySampleLabel")}>
          <Textarea
            autoComplete="off"
            name="content_policy_version_dry_run"
            onChange={(event) => setDryRunContent(event.currentTarget.value)}
            rows={3}
            spellCheck={false}
            value={dryRunContent}
          />
        </Field>
        <div className="rm-form-actions">
          <Button
            disabled={createMutation.isPending}
            onClick={() => void createDraft()}
            type="button"
            variant="secondary"
          >
            {t("contentPolicyCreateDraft")}
          </Button>
        </div>
        {versions.length === 0 ? (
          <p className="rm-muted">{t("contentPolicyNoVersions")}</p>
        ) : (
          <ul className="rm-plain-list">
            {versions.map((version) => (
              <li key={version.id}>
                <StatusBadge
                  tone={version.state === "published" ? "info" : "neutral"}
                >
                  {versionStateLabel(version.state, t)}
                </StatusBadge>{" "}
                v{version.version}
                {version.state === "draft" || version.state === "staged" ? (
                  <Button
                    disabled={publishMutation.isPending}
                    onClick={() => void publish(version.id)}
                    type="button"
                    variant="secondary"
                  >
                    {t("contentPolicyPublish")}
                  </Button>
                ) : null}
                <Button
                  disabled={
                    dryRunMutation.isPending || dryRunContent.trim().length === 0
                  }
                  onClick={() => void dryRun(version.id)}
                  type="button"
                  variant="secondary"
                >
                  {t("contentPolicySimulate")}
                </Button>
                {version.state === "retired" ? (
                  <Button
                    disabled={rollbackMutation.isPending}
                    onClick={() => void rollback(version.id)}
                    type="button"
                    variant="secondary"
                  >
                    {t("contentPolicyRollback")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="content-policy-decisions" className="rm-card">
        <div className="rm-card-title" id="content-policy-decisions">
          {t("contentPolicyDecisions")}
        </div>
        {decisions.length === 0 ? (
          <p className="rm-muted">{t("contentPolicyNoDetections")}</p>
        ) : (
          <ul className="rm-plain-list">
            {decisions.map((decision) => (
              <li key={decision.id}>
                {decision.action} · {decision.surface} · {decision.detectors.length}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="content-policy-approvals" className="rm-card">
        <div className="rm-card-title" id="content-policy-approvals">
          {t("contentPolicyApprovals")}
        </div>
        <p className="rm-muted">{t("contentPolicyApprovalRequired")}</p>
        {approvals.length === 0 ? (
          <p className="rm-muted">{t("contentPolicyNoApprovals")}</p>
        ) : (
          <ul className="rm-plain-list">
            {approvals.map((approval) => (
              <li key={approval.id}>
                {approval.state} · {approval.runId}
                {approval.state === "pending" ? (
                  <>
                    <Button
                      onClick={() => void resolve(approval.id, "approve")}
                      type="button"
                      variant="secondary"
                    >
                      {t("contentPolicyApprovalApprove")}
                    </Button>
                    <Button
                      onClick={() => void resolve(approval.id, "deny")}
                      type="button"
                      variant="secondary"
                    >
                      {t("contentPolicyApprovalDeny")}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function versionStateLabel(
  state: "draft" | "staged" | "published" | "retired",
  t: ReturnType<typeof useLocale>["t"],
) {
  if (state === "draft") return t("contentPolicyVersionState_draft");
  if (state === "staged") return t("contentPolicyVersionState_staged");
  if (state === "published") return t("contentPolicyVersionState_published");
  return t("contentPolicyVersionState_retired");
}
