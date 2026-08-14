import { Button } from "@romeo/ui";
import { useMemo } from "react";

import type { KnowledgeSource } from "../features/types";
import { useLocale } from "../lib/i18n";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const col = createColumnHelper<KnowledgeSource>();

export function KnowledgeSourceList({
  canUpload = true,
  isDeleting,
  isExtracting,
  isReindexing,
  onDelete,
  onExtract,
  onReindex,
  sources,
}: {
  canUpload?: boolean;
  isDeleting: boolean;
  isExtracting: boolean;
  isReindexing: boolean;
  onDelete: (sourceId: string) => void;
  onExtract: (sourceId: string) => void;
  onReindex: (sourceId: string) => void;
  sources: KnowledgeSource[];
}) {
  const { t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<KnowledgeSource>(
    "knowledge_sources",
    {
      enabled: sources[0]?.knowledgeBaseId !== undefined,
      parentId: sources[0]?.knowledgeBaseId,
    },
  );
  const columns = useMemo<ColumnDef<KnowledgeSource, any>[]>(
    () => [
      col.accessor("fileName", {
        header: t("knowledgeName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor("mimeType", {
        header: t("knowledgeType"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
        ),
      }),
      col.accessor("status", {
        header: t("knowledgeStatus"),
        cell: (c) => (
          <span
            className={`rm-status ${c.getValue() === "indexed" ? "pass" : c.getValue() === "failed" ? "fail" : "warn"}`}
          >
            {t(knowledgeSourceStatusKey(c.getValue()))}
          </span>
        ),
      }),
      col.accessor((row) => row.chunkCount ?? 0, {
        id: "chunks",
        header: t("knowledgeChunks"),
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>,
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <div className="flex gap-2">
            <Button
              disabled={!canUpload || isReindexing}
              onClick={() => onReindex(c.row.original.id)}
              type="button"
            >
              {t("knowledgeReindex")}
            </Button>
            <Button
              disabled={
                !canUpload ||
                isExtracting ||
                c.row.original.status !== "pending"
              }
              onClick={() => onExtract(c.row.original.id)}
              type="button"
            >
              {t("knowledgeExtract")}
            </Button>
            <Button
              disabled={isDeleting}
              onClick={() => onDelete(c.row.original.id)}
              type="button"
              variant="danger"
            >
              {t("knowledgeDelete")}
            </Button>
          </div>
        ),
      }),
    ],
    [
      canUpload,
      isDeleting,
      isExtracting,
      isReindexing,
      onDelete,
      onExtract,
      onReindex,
      t,
    ],
  );

  return (
    <div className="mt-3">
      <DataTable
        serverState={inventoriedTable.serverState}
        columns={columns}
        data={inventoriedTable.rows}
        empty={t("knowledgeNoSources")}
      />
    </div>
  );
}

function knowledgeSourceStatusKey(
  status: KnowledgeSource["status"],
):
  | "knowledgeStatusFailed"
  | "knowledgeStatusIndexed"
  | "knowledgeStatusPending" {
  if (status === "indexed") return "knowledgeStatusIndexed";
  if (status === "failed") return "knowledgeStatusFailed";
  return "knowledgeStatusPending";
}
