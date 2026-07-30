import { StatusBadge, Switch } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { useMemo } from "react";

import type { Agent } from "../features/managed-models";
import {
  listAgentTools,
  updateAgentToolBinding,
  type AgentToolSummary,
} from "../features/tools";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { createColumnHelper, DataTable } from "./DataTable";

const toolColumn = createColumnHelper<AgentToolSummary>();

export function ManagedModelToolPanel({
  activeAgent,
}: {
  activeAgent: Agent | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const toolsQuery = useQuery({
    queryKey: ["agentTools", activeAgent?.id],
    queryFn: () => listAgentTools(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });
  const updateMutation = useMutation({ mutationFn: updateAgentToolBinding });
  const tools = toolsQuery.data ?? [];
  const columns = useMemo(
    () => [
      toolColumn.accessor("name", {
        header: t("tools"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.name}</strong>
            <small className="block truncate text-muted">
              {row.original.description}
            </small>
          </span>
        ),
      }),
      toolColumn.accessor("riskLevel", {
        header: t("managedModelToolRisk"),
      }),
      toolColumn.accessor("hasAccess", {
        header: t("managedModelToolAccessible"),
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() ? "success" : "danger"}>
            {getValue()
              ? t("managedModelToolAccessible")
              : t("managedModelToolNoAccess")}
          </StatusBadge>
        ),
      }),
      toolColumn.accessor("enabled", {
        header: t("managedModelToolEnabled"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={
              !activeAgent ||
              !row.original.hasAccess ||
              updateMutation.isPending
            }
            label={t("managedModelToolEnabled")}
            onCheckedChange={(checked) =>
              void update(row.original.id, { enabled: checked === true })
            }
          />
        ),
      }),
      toolColumn.accessor("approvalRequired", {
        header: t("managedModelToolApproval"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.approvalRequired}
            disabled={
              !activeAgent || !row.original.enabled || updateMutation.isPending
            }
            label={
              <span className="inline-flex items-center gap-1">
                <ShieldCheck aria-hidden="true" size={13} />
                {t("managedModelToolApproval")}
              </span>
            }
            onCheckedChange={(checked) =>
              void update(row.original.id, {
                approvalRequired: checked === true,
              })
            }
          />
        ),
      }),
    ],
    [activeAgent, t, updateMutation.isPending],
  );

  async function update(
    toolId: string,
    patch: { enabled?: boolean; approvalRequired?: boolean },
  ) {
    if (!activeAgent) return;
    try {
      await updateMutation.mutateAsync({
        agentId: activeAgent.id,
        toolId,
        ...patch,
      });
      await queryClient.invalidateQueries({
        queryKey: ["agentTools", activeAgent.id],
      });
      toast(t("managedModelToolBindingSaved"), "success");
    } catch {
      toast(t("managedModelToolBindingFailed"), "error");
    }
  }

  return (
    <section className="rm-managed-model-section">
      <div className="rm-managed-model-section__header">
        <span className="rm-managed-model-section__icon">
          <Wrench aria-hidden="true" size={17} />
        </span>
        <div>
          <h3>{t("managedModelTools")}</h3>
          <p>{t("managedModelToolsDescription")}</p>
        </div>
      </div>
      {toolsQuery.isLoading ? (
        <p className="text-sm text-muted" role="status">
          {t("loading")}…
        </p>
      ) : tools.length === 0 ? (
        <div className="rm-managed-model-empty">
          <strong>{t("managedModelNoTools")}</strong>
          <span>{t("managedModelNoToolsDescription")}</span>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={tools}
          getRowId={(tool) => tool.id}
          minTableWidth={760}
          preferenceKey={`assistant-tools-${activeAgent?.id ?? "draft"}`}
          searchVisibility="always"
        />
      )}
    </section>
  );
}
