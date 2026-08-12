import { Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { listNotifications, markNotificationRead } from "../features";
import { toast } from "../lib/toast";
import type { UserNotification } from "../features/notifications";
import { PanelState } from "../lib/panel-state";
import { LocalizedDateTime } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { Section, StatRow } from "./console";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const col = createColumnHelper<UserNotification>();

export function NotificationPanel() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
  });
  const readMutation = useMutation({ mutationFn: markNotificationRead });

  async function handleRead(notificationId: string) {
    try {
      await readMutation.mutateAsync(notificationId);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast(t("notificationRead"), "success");
    } catch {
      toast(t("couldNotMarkRead"), "error");
    }
  }

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
            onClick={() => void handleRead(c.row.original.id)}
            type="button"
          >
            {c.row.original.readAt ? t("read") : t("markRead")}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readMutation.isPending, t],
  );

  return (
    <Section>
      <div className="rm-card-title">{t("notifications")}</div>
      <PanelState query={notificationsQuery} empty={t("noNotifications")}>
        {(notifications) => (
          <div className="grid gap-4">
            <StatRow
              items={[
                { label: t("total"), value: notifications.length },
                {
                  label: t("unread"),
                  value: notifications.filter(
                    (notification) => notification.readAt === undefined,
                  ).length,
                },
              ]}
            />
            <DataTable
              columns={columns}
              data={notifications}
              empty={t("noNotifications")}
            />
          </div>
        )}
      </PanelState>
    </Section>
  );
}
