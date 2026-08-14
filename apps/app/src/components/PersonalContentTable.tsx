import { Button, StatusBadge, Switch } from "@romeo/ui";
import { useMemo } from "react";

import type {
  ContentKind,
  WorkspaceContentItem,
} from "../features/workspace-content";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { createColumnHelper, DataTable } from "./DataTable";

const contentColumn = createColumnHelper<WorkspaceContentItem>();

export function PersonalContentTable({
  items,
  kind,
  onEdit,
  onPatch,
  onRemove,
}: {
  items: WorkspaceContentItem[];
  kind: ContentKind;
  onEdit: (item: WorkspaceContentItem) => void;
  onPatch: (
    item: WorkspaceContentItem,
    patch: Partial<WorkspaceContentItem>,
  ) => Promise<void>;
  onRemove: (item: WorkspaceContentItem) => Promise<void>;
}) {
  const { t } = useLocale();
  const columns = useMemo(
    () => [
      contentColumn.accessor("title", {
        header: t("title"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.title}</strong>
            <small className="block truncate text-muted">
              {row.original.body}
            </small>
          </span>
        ),
      }),
      contentColumn.accessor("scope", {
        header: t("visibility"),
        cell: ({ getValue }) =>
          getValue() === "personal" ? t("personal") : t("workspace"),
      }),
      contentColumn.accessor("expiresAt", {
        header: t("expired"),
        cell: ({ row }) => (
          <StatusBadge tone={row.original.expired ? "warning" : "success"}>
            {row.original.expired ? t("expired") : t("active")}
          </StatusBadge>
        ),
      }),
      contentColumn.accessor("updatedAt", {
        header: t("contentUpdated"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
      contentColumn.display({
        id: "state",
        header: t("status"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            {kind === "memories" ? (
              <Switch
                checked={row.original.enabled}
                label={t("enabled")}
                onCheckedChange={() =>
                  void onPatch(row.original, {
                    enabled: !row.original.enabled,
                  })
                }
              />
            ) : null}
            <Button
              onClick={() =>
                void onPatch(row.original, { pinned: !row.original.pinned })
              }
              size="sm"
              type="button"
              variant={row.original.pinned ? "secondary" : "ghost"}
            >
              {row.original.pinned ? t("unpin") : t("pin")}
            </Button>
          </div>
        ),
        enableSorting: false,
      }),
      contentColumn.display({
        id: "actions",
        header: t("managedModelActions"),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              onClick={() => onEdit(row.original)}
              size="sm"
              type="button"
            >
              {t("edit")}
            </Button>
            <Button
              onClick={() => void onRemove(row.original)}
              size="sm"
              type="button"
              variant="danger"
            >
              {t("delete")}
            </Button>
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
      }),
    ],
    [kind, onEdit, onPatch, onRemove, t],
  );
  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(item) => item.id}
      minTableWidth={840}
      preferenceKey={`personal-content-${kind}`}
    />
  );
}
