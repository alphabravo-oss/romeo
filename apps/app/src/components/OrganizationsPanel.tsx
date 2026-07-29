import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { listOrganizations, type Organization } from "../features/tenancy";
import { useLocale } from "../lib/i18n";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { PageActions } from "./PageActions";

const orgCol = createColumnHelper<Organization>();

export function OrganizationsPanel() {
  const { t } = useLocale();
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });

  const columns = useMemo<ColumnDef<Organization, any>[]>(
    () => [
      orgCol.accessor("name", {
        header: t("organizationsName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      orgCol.accessor("slug", {
        header: t("organizationsSlug"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      orgCol.accessor("id", {
        header: t("organizationsId"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
    ],
    [t],
  );

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("organizationsTitle")}</div>
        <PageActions
          onRefresh={() => void organizationsQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={organizationsQuery.isFetching}
        />
      </div>
      <div className="mt-4">
        <DataTable
          columns={columns}
          data={organizationsQuery.data ?? []}
          empty={t("organizationsNone")}
        />
      </div>
    </section>
  );
}
