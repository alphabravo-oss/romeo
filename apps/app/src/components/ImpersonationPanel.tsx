import { Button } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import UserCog from "lucide-react/dist/esm/icons/user-cog.mjs";
import { useMemo } from "react";

import {
  approveImpersonationRequestMutationOptions,
  type ImpersonationRequest,
  type ImpersonationSession,
  rejectImpersonationRequestMutationOptions,
  revokeImpersonationSessionMutationOptions,
} from "../features/sessions";
import { shareTargetsQueryOptions } from "../features/collaboration";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { Section } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PageActions } from "./PageActions";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const requestCol = createColumnHelper<ImpersonationRequest>();
const sessionCol = createColumnHelper<ImpersonationSession>();

export function ImpersonationPanel() {
  const { t } = useLocale();
  const requestTable = useInventoriedServerTable<ImpersonationRequest>(
    "support_access_requests",
    { filters: [{ field: "status", operator: "eq", value: "pending" }] },
  );
  const sessionTable = useInventoriedServerTable<
    ImpersonationSession & { id: string }
  >("support_sessions", {
    filters: [{ field: "status", operator: "eq", value: "active" }],
  });
  const { ask, dialog } = useConfirm();
  const shareTargetsQuery = useQuery(
    shareTargetsQueryOptions({ context: "impersonation" }),
  );
  const approveMutation = useMutation(
    approveImpersonationRequestMutationOptions(),
  );
  const rejectMutation = useMutation(
    rejectImpersonationRequestMutationOptions(),
  );
  const revokeMutation = useMutation(
    revokeImpersonationSessionMutationOptions(),
  );

  const userLabels = useMemo(
    () =>
      new Map(
        (shareTargetsQuery.data ?? [])
          .filter((target) => target.principalType === "user")
          .map((target) => [target.principalId, target.label]),
      ),
    [shareTargetsQuery.data],
  );

  const columns = useMemo<ColumnDef<ImpersonationRequest, any>[]>(
    () => [
      requestCol.accessor("targetUserId", {
        header: t("impersonationTargetUser"),
        cell: (c) => (
          <span>{userLabels.get(c.getValue()) ?? c.getValue()}</span>
        ),
      }),
      requestCol.accessor("requestedByUserId", {
        header: t("impersonationRequestedBy"),
        cell: (c) => (
          <span className="rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      requestCol.accessor("ttlMinutes", {
        header: t("impersonationTtlMinutes"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedNumber value={c.getValue()} />
          </span>
        ),
      }),
      requestCol.accessor((row) => row.ticketRef ?? "", {
        id: "ticketRef",
        header: t("impersonationTicket"),
        cell: (c) => (
          <span className="rm-cell-muted">{c.getValue() || "—"}</span>
        ),
      }),
      requestCol.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: t("impersonationRequested"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      requestCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <span className="flex gap-2">
            <Button
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => void handleApprove(c.row.original)}
              type="button"
            >
              {t("impersonationApprove")}
            </Button>
            <Button
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => void handleReject(c.row.original.id)}
              type="button"
            >
              {t("impersonationReject")}
            </Button>
          </span>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approveMutation.isPending, rejectMutation.isPending, t, userLabels],
  );

  const sessionColumns = useMemo<ColumnDef<ImpersonationSession, any>[]>(
    () => [
      sessionCol.accessor("adminUserId", {
        header: t("impersonationImpersonator"),
        cell: (c) => (
          <span className="rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      sessionCol.accessor("targetUserId", {
        header: t("impersonationTargetUser"),
        cell: (c) => (
          <span className="rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      sessionCol.accessor((row) => row.ttlMinutes ?? "", {
        id: "ttlMinutes",
        header: t("impersonationTtlMinutes"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue() ? <LocalizedNumber value={c.getValue()} /> : "—"}
          </span>
        ),
      }),
      sessionCol.accessor((row) => row.session.createdAt, {
        id: "createdAt",
        header: t("impersonationStarted"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      sessionCol.accessor((row) => row.session.expiresAt, {
        id: "expiresAt",
        header: t("impersonationExpires"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      sessionCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            disabled={revokeMutation.isPending}
            onClick={() => void handleRevoke(c.row.original.session.id)}
            type="button"
          >
            {t("impersonationRevoke")}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending, t],
  );

  async function handleApprove(request: ImpersonationRequest) {
    if (
      !(await ask({
        title: t("approveImpersonationTitle"),
        body: `${t("approveImpersonationBody")} ${
          userLabels.get(request.targetUserId) ?? request.targetUserId
        }`,
        confirmLabel: t("impersonationApprove"),
        tone: "danger",
      }))
    )
      return;
    try {
      await approveMutation.mutateAsync(request.id);
      toast(t("impersonationApproved"), "success");
    } catch {
      toast(t("impersonationCouldNotApprove"), "error");
    }
  }

  async function handleReject(requestId: string) {
    try {
      await rejectMutation.mutateAsync(requestId);
      toast(t("impersonationRejected"), "success");
    } catch {
      toast(t("impersonationCouldNotReject"), "error");
    }
  }

  async function handleRevoke(sessionId: string) {
    if (
      !(await ask({
        title: t("impersonationRevokeTitle"),
        body: t("impersonationRevokeBody"),
        confirmLabel: t("impersonationRevoke"),
        tone: "danger",
      }))
    )
      return;
    try {
      await revokeMutation.mutateAsync(sessionId);
      toast(t("impersonationSessionRevoked"), "success");
    } catch {
      toast(t("impersonationCouldNotRevoke"), "error");
    }
  }

  return (
    <Section
      actions={
        <PageActions
          onRefresh={() => void requestTable.query.refetch()}
          refreshLabel={t("refresh")}
          refreshing={requestTable.query.isFetching}
        />
      }
      title={t("impersonationRequests")}
    >
      <PanelState
        query={requestTable.query}
        empty={t("impersonationNoPending")}
        emptyDescription={t("impersonationNoPendingDescription")}
        emptyIcon={<UserCog aria-hidden size={24} />}
        isEmpty={() =>
          requestTable.rows.length === 0 &&
          requestTable.isFirstPage &&
          requestTable.search.trim() === ""
        }
      >
        {() => (
          <DataTable
            serverState={requestTable.serverState}
            columns={columns}
            data={requestTable.rows}
          />
        )}
      </PanelState>

      <div className="rm-card-header mt-6">
        <div className="rm-card-title">{t("impersonationActiveSessions")}</div>
        <PageActions
          onRefresh={() => void sessionTable.query.refetch()}
          refreshLabel={t("refresh")}
          refreshing={sessionTable.query.isFetching}
        />
      </div>
      <PanelState
        query={sessionTable.query}
        empty={t("impersonationNoActive")}
        emptyDescription={t("impersonationNoActiveDescription")}
        emptyIcon={<UserCog aria-hidden size={24} />}
        isEmpty={() =>
          sessionTable.rows.length === 0 &&
          sessionTable.isFirstPage &&
          sessionTable.search.trim() === ""
        }
      >
        {() => (
          <DataTable
            columns={sessionColumns}
            data={sessionTable.rows}
            serverState={sessionTable.serverState}
          />
        )}
      </PanelState>
      {dialog}
    </Section>
  );
}
