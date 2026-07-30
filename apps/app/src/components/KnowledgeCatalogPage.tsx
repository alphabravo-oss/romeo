import { Button, StatusBadge } from "@romeo/ui";
import { useMemo, useState } from "react";

import type { KnowledgeBase } from "../features/types";
import {
  formatBytes,
  formatNumber,
  LocalizedDateTime,
} from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { createColumnHelper, DataTable } from "./DataTable";
import { KnowledgeBaseCreateDialog } from "./KnowledgeBaseCreateDialog";

const knowledgeBaseColumn = createColumnHelper<KnowledgeBase>();

export function KnowledgeCatalogPage({
  isLoading,
  knowledgeBases,
  onCreated,
  onSelectionChange,
  workspaceId,
}: {
  isLoading: boolean;
  knowledgeBases: KnowledgeBase[];
  onCreated: (knowledgeBaseId: string) => void;
  onSelectionChange: (knowledgeBaseId: string) => void;
  workspaceId: string | undefined;
}) {
  const { locale, t } = useLocale();
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
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div>
          <div className="rm-card-title">{t("knowledgeTitle")}</div>
          <p className="text-sm text-muted">
            {t("knowledgeCatalogDescription")}
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          type="button"
          variant="primary"
        >
          + {t("knowledgeAddBase")}
        </Button>
      </div>
      <KnowledgeBaseCreateDialog
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
        open={createOpen}
        workspaceId={workspaceId}
      />
      <div className="mt-4">
        <DataTable
          columns={columns}
          data={knowledgeBases}
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
    </section>
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
