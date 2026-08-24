import { Button } from "@romeo/ui";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";

import { markNotificationReadMutationOptions } from "../features/notifications";
import { toast } from "../lib/toast";
import type { UserNotification } from "../features/notifications";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { useEventCallback } from "../lib/use-event-callback";
import { Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const col = createColumnHelper<UserNotification>();

export function NotificationPanel() {
  const { t } = useLocale();
  const table = useInventoriedServerTable("notifications");
  const readMutation = useMutation(markNotificationReadMutationOptions());

  async function handleRead(notificationId: string) {
    try {
      await readMutation.mutateAsync(notificationId);
      toast(t("notificationRead"), "success");
    } catch {
      toast(t("couldNotMarkRead"), "error");
    }
  }

  const onRead = useEventCallback(handleRead);

  const columns = useMemo<ColumnDef<UserNotification, any>[]>(
    () => [
      col.accessor("type", {
        header: t("type"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor("resourceId", {
        header: t("resource"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
        ),
      }),
      col.accessor((row) => (row.readAt ? "read" : "unread"), {
        id: "status",
        header: t("status"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "read" ? "pass" : "warn"}`}
          >
            {c.getValue() === "read" ? t("read") : t("unread")}
          </span>
        ),
      }),
      col.accessor("createdAt", {
        header: t("received"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={c.getValue()} />
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            disabled={
              c.row.original.readAt !== undefined || readMutation.isPending
            }
            onClick={() => void onRead(c.row.original.id)}
            type="button"
          >
            {c.row.original.readAt ? t("read") : t("markRead")}
          </Button>
        ),
      }),
    ],
    [onRead, readMutation.isPending, t],
  );

  return (
    <Section>
      <div className="rm-card-title">{t("notifications")}</div>
      <PanelState
        empty={t("noNotifications")}
        isEmpty={(page) =>
          page.items.length === 0 &&
          table.isFirstPage &&
          table.search.trim() === ""
        }
        query={table.query}
      >
        {() => (
          <div className="grid gap-4">
            <StatRow
              items={[
                {
                  label: t("total"),
                  value: table.summary.total ?? table.estimatedTotal,
                },
                {
                  label: t("unread"),
                  value: table.summary.unreadTotal ?? 0,
                },
              ]}
            />
            <DataTable
              serverState={table.serverState}
              columns={columns}
              data={table.rows}
              empty={t("noNotifications")}
            />
          </div>
        )}
      </PanelState>
    </Section>
  );
}
