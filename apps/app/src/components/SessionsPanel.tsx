import { Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { getBootstrap } from "../features";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type Session,
} from "../features/sessions";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { decorateSessions } from "./session-rows";

type SessionRow = Session & { current: boolean };

const col = createColumnHelper<SessionRow>();

function sessionStatus(session: Session): "active" | "expired" | "revoked" {
  if (session.revokedAt !== undefined) return "revoked";
  if (new Date(session.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

export function SessionsPanel() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
  });
  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
  });
  const revokeOthersMutation = useMutation({ mutationFn: revokeOtherSessions });

  async function handleRevoke(session: SessionRow) {
    if (
      !(await ask({
        title: session.current
          ? t("revokeCurrentSessionTitle")
          : t("signOutSessionTitle"),
        body: session.current
          ? t("revokeCurrentSessionBody")
          : t("signOutSessionBody"),
        confirmLabel: t("revoke"),
        tone: "danger",
      }))
    )
      return;
    try {
      await revokeMutation.mutateAsync(session.id);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast(t("sessionRevoked"), "success");
    } catch {
      toast(t("revokeSessionFailed"), "error");
    }
  }

  async function handleRevokeOthers() {
    if (
      !(await ask({
        title: t("signOutOthersTitle"),
        body: t("signOutOthersBody"),
        confirmLabel: t("signOutEverywhereElse"),
        tone: "danger",
      }))
    )
      return;
    try {
      const revoked = await revokeOthersMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast(`${t("revokedStatus")}: ${revoked.length}`, "success");
    } catch {
      toast(t("revokeOthersFailed"), "error");
    }
  }

  const columns = useMemo<ColumnDef<SessionRow, any>[]>(
    () => [
      col.accessor("name", {
        header: t("device"),
        cell: (c) => (
          <span className="flex items-center gap-2 font-medium">
            {c.getValue()}
            {c.row.original.current ? (
              <span className="rm-status pass">{t("thisDevice")}</span>
            ) : null}
          </span>
        ),
      }),
      col.accessor("createdAt", {
        header: t("created"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      col.accessor((row) => row.lastSeenAt ?? "", {
        id: "lastSeen",
        header: t("lastSeen"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {c.getValue() ? <LocalizedDateTime value={c.getValue()!} /> : "—"}
          </span>
        ),
      }),
      col.accessor((row) => row.expiresAt, {
        id: "expires",
        header: t("expires"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      col.accessor((row) => sessionStatus(row), {
        id: "status",
        header: t("status"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "active" ? "pass" : "fail"}`}
          >
            {c.getValue() === "active"
              ? t("active")
              : c.getValue() === "expired"
                ? t("expiredStatus")
                : t("revokedStatus")}
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            disabled={
              sessionStatus(c.row.original) !== "active" ||
              revokeMutation.isPending
            }
            onClick={() => void handleRevoke(c.row.original)}
            type="button"
          >
            {t("revoke")}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revokeMutation.isPending, t],
  );

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("activeSessions")}</div>
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={revokeOthersMutation.isPending}
            onClick={() => void handleRevokeOthers()}
            type="button"
          >
            {revokeOthersMutation.isPending
              ? t("signingOut")
              : t("signOutEverywhereElse")}
          </Button>
          <Button
            disabled={sessionsQuery.isFetching}
            onClick={() => void sessionsQuery.refetch()}
            type="button"
          >
            {sessionsQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <PanelState query={sessionsQuery} empty={t("noActiveSessions")}>
          {(rows) => (
            <DataTable
              columns={columns}
              data={decorateSessions(
                rows,
                bootstrapQuery.data?.subject.sessionId,
              )}
              empty={t("noActiveSessions")}
            />
          )}
        </PanelState>
      </div>
      {dialog}
    </section>
  );
}
