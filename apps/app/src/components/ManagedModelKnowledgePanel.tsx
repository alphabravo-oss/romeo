import { Switch } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import Database from "lucide-react/dist/esm/icons/database.mjs";
import { useCallback, useMemo } from "react";

import { knowledgeBasesQueryOptions } from "../features/knowledge";
import { agentKnowledgeBindingsQueryOptions } from "../features/managed-models";
import { updateAgentKnowledgeBindingMutationOptions } from "../features/managed-models/mutation-options";
import type { Agent } from "../features/managed-models";
import type { KnowledgeBase } from "../features/types";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { createColumnHelper, DataTable } from "./DataTable";

const knowledgeColumn = createColumnHelper<KnowledgeBase>();

export function ManagedModelKnowledgePanel({
  activeAgent,
  workspaceId,
}: {
  activeAgent: Agent | undefined;
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();
  const knowledgeQuery = useQuery(knowledgeBasesQueryOptions(workspaceId));
  const bindingsQuery = useQuery(
    agentKnowledgeBindingsQueryOptions(activeAgent?.id),
  );
  const updateMutation = useMutation(
    updateAgentKnowledgeBindingMutationOptions(),
  );
  const enabledByKnowledgeBase = useMemo(
    () =>
      new Map(
        (bindingsQuery.data ?? []).map((binding) => [
          binding.knowledgeBaseId,
          binding.enabled,
        ]),
      ),
    [bindingsQuery.data],
  );
  const knowledgeBases = knowledgeQuery.data ?? [];
  const toggle = useCallback(
    async (knowledgeBaseId: string, enabled: boolean) => {
      if (!activeAgent) return;
      try {
        await updateMutation.mutateAsync({
          agentId: activeAgent.id,
          knowledgeBaseId,
          enabled,
        });
        toast(
          t(enabled ? "knowledgeBoundNotice" : "knowledgeDisabledNotice"),
          "success",
        );
      } catch {
        toast(t("failed"), "error");
      }
    },
    [activeAgent, t, updateMutation],
  );
  const columns = useMemo(
    () => [
      knowledgeColumn.accessor("name", {
        header: t("knowledgeName"),
        cell: ({ row }) => (
          <span className="block min-w-0">
            <strong className="block truncate">{row.original.name}</strong>
            <small className="block truncate text-muted">
              {row.original.description || t("managedModelKnowledgeBase")}
            </small>
          </span>
        ),
      }),
      knowledgeColumn.accessor("sourceCount", {
        header: t("knowledgeTotalSources"),
      }),
      knowledgeColumn.accessor("indexedSourceCount", {
        header: t("knowledgeIndexedSources"),
      }),
      knowledgeColumn.display({
        id: "access",
        header: t("managedModelKnowledgeAccess"),
        cell: ({ row }) => (
          <Switch
            checked={enabledByKnowledgeBase.get(row.original.id) === true}
            disabled={!activeAgent || updateMutation.isPending}
            label={t("managedModelKnowledgeAccess")}
            onCheckedChange={(checked) =>
              void toggle(row.original.id, checked === true)
            }
          />
        ),
        enableSorting: false,
      }),
    ],
    [activeAgent, enabledByKnowledgeBase, t, toggle, updateMutation.isPending],
  );

  return (
    <section className="rm-managed-model-section">
      <div className="rm-managed-model-section__header">
        <span className="rm-managed-model-section__icon">
          <Database aria-hidden="true" size={17} />
        </span>
        <div>
          <h3>{t("managedModelKnowledge")}</h3>
          <p>{t("managedModelKnowledgeDescription")}</p>
        </div>
      </div>
      {knowledgeQuery.isLoading || bindingsQuery.isLoading ? (
        <p className="text-sm text-muted" role="status">
          {t("loading")}…
        </p>
      ) : knowledgeBases.length === 0 ? (
        <div className="rm-managed-model-empty">
          <strong>{t("managedModelNoKnowledge")}</strong>
          <span>{t("managedModelNoKnowledgeDescription")}</span>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={knowledgeBases}
          getRowId={(knowledgeBase) => knowledgeBase.id}
          minTableWidth={620}
          preferenceKey={`assistant-knowledge-${activeAgent?.id ?? "draft"}`}
          searchVisibility="always"
        />
      )}
    </section>
  );
}
