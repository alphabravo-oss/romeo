import { StatusBadge } from "@romeo/ui";

import type { TenantOrganizationSummary } from "../features/tenant-administration";
import type { MessageKey } from "../lib/i18n";
import { LocalizedDateTime, LocalizedNumber } from "../lib/locale-format";
import { createColumnHelper, type ColumnDef } from "./DataTable";
import { OverflowMenu } from "./OverflowMenu";

const organizationColumn = createColumnHelper<TenantOrganizationSummary>();

export function organizationColumns(options: {
  onEdit: (row: TenantOrganizationSummary) => void;
  onReactivate: (row: TenantOrganizationSummary) => void;
  onSuspend: (row: TenantOrganizationSummary) => void;
  t: (key: MessageKey) => string;
}): ColumnDef<TenantOrganizationSummary, any>[] {
  const { onEdit, onReactivate, onSuspend, t } = options;
  return [
    organizationColumn.accessor((row) => row.organization.name, {
      id: "name",
      header: t("organizationsName"),
      cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
    }),
    organizationColumn.accessor((row) => row.organization.slug, {
      id: "slug",
      header: t("organizationsSlug"),
      cell: (cell) => (
        <span className="rm-cell-muted rm-mono" translate="no">
          {cell.getValue()}
        </span>
      ),
    }),
    organizationColumn.accessor((row) => row.organization.id, {
      id: "id",
      header: t("organizationsId"),
      cell: (cell) => (
        <span className="rm-cell-muted rm-mono" translate="no">
          {cell.getValue()}
        </span>
      ),
    }),
    organizationColumn.accessor((row) => row.suspension.suspended, {
      id: "status",
      header: t("organizationsStatus"),
      cell: (cell) =>
        cell.getValue() ? (
          <StatusBadge tone="warning">
            {t("organizationsSuspended")}
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">{t("organizationsActive")}</StatusBadge>
        ),
    }),
    organizationColumn.accessor((row) => row.counts.users, {
      id: "users",
      header: t("organizationsUsers"),
      cell: (cell) => (
        <span className="rm-cell-muted">
          <LocalizedNumber value={cell.getValue()} />
        </span>
      ),
    }),
    organizationColumn.accessor((row) => row.counts.workspaces, {
      id: "workspaces",
      header: t("organizationsWorkspaces"),
      cell: (cell) => (
        <span className="rm-cell-muted">
          <LocalizedNumber value={cell.getValue()} />
        </span>
      ),
    }),
    organizationColumn.accessor((row) => row.suspension.suspendedAt ?? "", {
      id: "suspendedAt",
      header: t("organizationsSuspendedAt"),
      cell: (cell) =>
        cell.getValue() ? (
          <span className="rm-cell-muted">
            <LocalizedDateTime value={cell.getValue()} />
          </span>
        ) : (
          <span className="rm-cell-muted">—</span>
        ),
    }),
    organizationColumn.display({
      id: "actions",
      header: "",
      cell: (cell) => {
        const row = cell.row.original;
        return (
          <div className="flex justify-end">
            <OverflowMenu
              items={[
                { label: t("organizationsEdit"), onClick: () => onEdit(row) },
                row.suspension.suspended
                  ? {
                      label: t("organizationsReactivate"),
                      onClick: () => onReactivate(row),
                    }
                  : {
                      label: t("organizationsSuspend"),
                      onClick: () => onSuspend(row),
                      tone: "danger",
                    },
              ]}
              label={`${t("organizationsActionsFor")} ${row.organization.name}`}
            />
          </div>
        );
      },
    }),
  ];
}
