import { StatusBadge } from "@romeo/ui";
import { useMemo, useState } from "react";

import type { KnowledgeIngestReadiness } from "../features/knowledge";
import type { KnowledgeBase } from "../features/types";
import {
  formatBytes,
  formatNumber,
  LocalizedDateTime,
} from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { AddButton } from "./AddButton";
import { createColumnHelper, DataTable } from "./DataTable";
import { KnowledgeBaseCreateDialog } from "./KnowledgeBaseCreateDialog";
import { KnowledgeIngestNotice } from "./KnowledgeIngestNotice";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const knowledgeBaseColumn = createColumnHelper<KnowledgeBase>();

export function KnowledgeCatalogPage({
  ingestReadiness,
  isAdmin = false,
  isLoading,
  knowledgeBases,
  onCreated,
  onSelectionChange,
  workspaceId,
}: {
  ingestReadiness?: KnowledgeIngestReadiness;
  isAdmin?: boolean;
  isLoading: boolean;
  knowledgeBases: KnowledgeBase[];
  onCreated: (knowledgeBaseId: string) => void;
  onSelectionChange: (knowledgeBaseId: string) => void;
  workspaceId: string | undefined;
}) {
  const { locale, t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<KnowledgeBase>(
    "knowledge_bases",
    { enabled: workspaceId !== undefined, workspaceId },
  );
  const [createOpen, setCreateOpen] = useState(false);
  const columns = useMemo(
    () => [
      knowledgeBaseColumn.accessor("name", {
        header: t("knowledgeName"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.name}</strong>
            {row.original.description ? (
              <small className="block truncate text-muted">
                {row.original.description}
              </small>
            ) : null}
          </span>
        ),
      }),
      knowledgeBaseColumn.accessor("sourceCount", {
        header: t("knowledgeTotalSources"),
        cell: ({ getValue }) => formatNumber(getValue() ?? 0, locale),
      }),
      knowledgeBaseColumn.accessor("indexedSourceCount", {
        header: t("knowledgeStatus"),
        cell: ({ row }) => (
          <KnowledgeIndexStatus knowledgeBase={row.original} />
        ),
      }),
      knowledgeBaseColumn.accessor("totalSizeBytes", {
        header: t("knowledgeSize"),
        cell: ({ getValue }) => formatBytes(getValue() ?? 0, locale),
      }),
      knowledgeBaseColumn.accessor("dependentAgentCount", {
        header: t("knowledgeDependents"),
        cell: ({ getValue }) => formatNumber(getValue() ?? 0, locale),
      }),
      knowledgeBaseColumn.accessor("grantCount", {
        header: t("knowledgeAccess"),
        cell: ({ getValue }) =>
          `${formatNumber(getValue() ?? 0, locale)} ${t("knowledgeGrants")}`,
      }),
      knowledgeBaseColumn.accessor("createdBy", {
        header: t("knowledgeOwner"),
      }),
      knowledgeBaseColumn.accessor("updatedAt", {
        header: t("knowledgeUpdated"),
        cell: ({ getValue }) => <LocalizedDateTime value={getValue()} />,
      }),
    ],
    [locale, t],
  );
  return (
    <div className="rm-console-page">
      {/* A page-level warning spans the column; it is not a toolbar item. */}
      <KnowledgeIngestNotice isAdmin={isAdmin} readiness={ingestReadiness} />
      <div className="rm-console-toolbar">
        <AddButton onClick={() => setCreateOpen(true)}>
          {t("knowledgeAddBase")}
        </AddButton>
      </div>
      <KnowledgeBaseCreateDialog
        isAdmin={isAdmin}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
        open={createOpen}
        workspaceId={workspaceId}
      />
      <DataTable
        serverState={inventoriedTable.serverState}
        columns={columns}
        data={inventoriedTable.rows}
        empty={isLoading ? t("loading") : t("knowledgeNoBases")}
        getRowId={(knowledgeBase) => knowledgeBase.id}
        minTableWidth={980}
        onRowActivate={(knowledgeBase) => onSelectionChange(knowledgeBase.id)}
        preferenceKey="workspace-knowledge-bases"
        rowAriaLabel={(knowledgeBase) =>
          t("knowledgeOpenBase", { name: knowledgeBase.name })
        }
        searchVisibility="always"
      />
    </div>
  );
}

function KnowledgeIndexStatus({
  knowledgeBase,
}: {
  knowledgeBase: KnowledgeBase;
}) {
  const { locale, t } = useLocale();
  const total = knowledgeBase.sourceCount ?? 0;
  const indexed = knowledgeBase.indexedSourceCount ?? 0;
  return (
    <StatusBadge
      tone={total === 0 ? "neutral" : indexed === total ? "success" : "warning"}
    >
      {total === 0
        ? t("knowledgeEmpty")
        : `${formatNumber(indexed, locale)}/${formatNumber(total, locale)} ${t("knowledgeIndexed")}`}
    </StatusBadge>
  );
}
